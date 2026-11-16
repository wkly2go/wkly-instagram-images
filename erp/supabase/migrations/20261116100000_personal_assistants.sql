-- 개인 AI 비서 (대표 지시 2026-11-16 "나만의 ai 비서 · 다른 팀원들에게도 · 다른 사람에게는 노출 안 되는 구조")
--  - 사람마다 비서 계정 하나 (profiles is_agent + ai_agents private = true, owner_id = 그 사람)
--  - 비서 계정 · 설정 · 대화 · 처리 기록 · 예약 · 지시는 주인만 봄 (관리자도 못 봄). 1:1 대화방은 원래 두 사람만 보임
--  - 대화는 기존 agent-chat 함수가 처리 (주인의 1:1 대화에만 답함)
alter table public.ai_agents add column if not exists private boolean not null default false;
create unique index if not exists ai_agents_private_owner_key on public.ai_agents (owner_id) where private;

-- 이 계정이 '남의 비서'인가 (정책에서 씀 · ai_agents 자체 정책과 무관하게 판정)
create or replace function public.assistant_hidden(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ai_agents a where a.profile_id = p_profile and a.private and a.owner_id is distinct from (select auth.uid()));
$$;
revoke all on function public.assistant_hidden(uuid) from public, anon;
grant execute on function public.assistant_hidden(uuid) to authenticated;

drop policy if exists profiles_hide_assistants on public.profiles;
create policy profiles_hide_assistants on public.profiles as restrictive for select to authenticated using (not (is_agent and (select public.assistant_hidden(id))));
drop policy if exists ai_agents_private on public.ai_agents;
create policy ai_agents_private on public.ai_agents as restrictive for all to authenticated
  using (not private or owner_id = (select auth.uid())) with check (not private or owner_id = (select auth.uid()));
-- 주인은 자기 비서의 지침만 고칠 수 있음 (도구 · 주인 · 비공개 여부는 그대로)
drop policy if exists ai_agents_owner_update on public.ai_agents;
create policy ai_agents_owner_update on public.ai_agents for update to authenticated
  using (private and owner_id = (select auth.uid())) with check (private and owner_id = (select auth.uid()));
drop policy if exists agent_actions_private on public.agent_actions;
create policy agent_actions_private on public.agent_actions as restrictive for select to authenticated using (not (select public.assistant_hidden(agent_id)));
drop policy if exists agent_schedules_private on public.agent_schedules;
create policy agent_schedules_private on public.agent_schedules as restrictive for select to authenticated using (not (select public.assistant_hidden(agent_id)));
drop policy if exists agent_instructions_private on public.agent_instructions;
create policy agent_instructions_private on public.agent_instructions as restrictive for select to authenticated using (not (select public.assistant_hidden(agent_id)));

-- is_agent 는 관리자만 바꾸지만, 비서 만들기 함수 안에서는 허용
create or replace function public.profiles_agent_guard()
returns trigger language plpgsql set search_path to '' as $$
begin
  if auth.uid() is not null
     and new.is_agent is distinct from old.is_agent
     and not public.is_admin()
     and coalesce(current_setting('wkly.assistant_setup', true), '') <> '1'
  then
    raise exception '에이전트 여부(is_agent)는 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 한 사람의 비서 만들기 (있으면 그대로) → 비서 계정 id
create or replace function private.assistant_ensure(p_owner uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_admin boolean;
begin
  select a.profile_id into v_id from public.ai_agents a where a.private and a.owner_id = p_owner;
  if v_id is not null then return v_id; end if;
  select p.name, p.role = 'admin' into v_name, v_admin from public.profiles p where p.id = p_owner and p.active and not p.is_agent;
  if v_name is null then raise exception '비서를 만들 수 없는 계정입니다.' using errcode = '22023'; end if;
  v_id := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-secretary-' || replace(p_owner::text, '-', '') || '@thewklyn.com',
    extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', v_name || ' 비서', 'agent', true), now(), now(), '', '', '', '');
  perform set_config('wkly.assistant_setup', '1', true);
  update public.profiles set is_agent = true, name = v_name || ' 비서', title = '개인 비서', role = 'member' where id = v_id;
  perform set_config('wkly.assistant_setup', '', true);
  insert into public.ai_agents (profile_id, role, instructions, tools, owner_id, model, created_by, private)
  values (v_id, case when v_admin then '대표 개인 비서 (총괄)' else '개인 비서' end, '', '{}', p_owner, '기본', p_owner, true);
  return v_id;
end $$;

-- 내 비서와의 1:1 대화방 열기 (비서가 없으면 만든다)
create or replace function public.my_assistant()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_agent uuid;
  v_key text;
  v_room uuid;
begin
  if v_me is null or not public.is_active_member() then raise exception '로그인한 팀원만 쓸 수 있습니다.' using errcode = '42501'; end if;
  v_agent := private.assistant_ensure(v_me);
  v_key := least(v_me::text, v_agent::text) || ':' || greatest(v_me::text, v_agent::text);
  select r.id into v_room from public.chat_rooms r where r.dm_key = v_key;
  if v_room is null then
    insert into public.chat_rooms (name, description, members, dm_key, created_by)
    values ('dm:' || v_key, null, array[v_me, v_agent], v_key, v_me)
    on conflict (dm_key) do nothing returning id into v_room;
    if v_room is null then select r.id into v_room from public.chat_rooms r where r.dm_key = v_key; end if;
  end if;
  return jsonb_build_object('agent_id', v_agent, 'room_id', v_room);
end $$;
revoke all on function public.my_assistant() from public, anon;
grant execute on function public.my_assistant() to authenticated;

-- 남의 비서와는 대화방을 열 수 없음
create or replace function public.chat_open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_me is null or not public.is_active_member() then
    raise exception '로그인한 팀원만 대화할 수 있습니다.' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception '대화 상대를 골라 주세요.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_other and p.active) or public.assistant_hidden(p_other) then
    raise exception '대화할 수 없는 팀원입니다.' using errcode = '22023';
  end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select r.id into v_id from public.chat_rooms r where r.dm_key = v_key;
  if v_id is null then
    insert into public.chat_rooms (name, description, members, dm_key, created_by)
    values ('dm:' || v_key, null, array[v_me, p_other], v_key, v_me)
    on conflict (dm_key) do nothing
    returning id into v_id;
    if v_id is null then
      select r.id into v_id from public.chat_rooms r where r.dm_key = v_key;
    end if;
  end if;
  return v_id;
end;
$$;

-- 지금 있는 사람 팀원 모두에게 비서를 만들어 둔다 (새 팀원은 처음 '내 비서'를 열 때 만들어짐)
do $$ declare r record; begin
  for r in select id from public.profiles where active and not is_agent loop
    perform private.assistant_ensure(r.id);
  end loop;
end $$;
