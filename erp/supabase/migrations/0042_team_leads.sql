-- 팀장 AI 조직 v3 (2026-10-18 대표 승인)
--   1) 팀장 → 팀원 AI 동적 지침 (agent_directives) · 지침 수정 대기열 (agent_prompt_edits)
--   2) agent_roster.is_lead / lead_code
--   3) 채팅에서 '@마케팅팀장' 등 팀장 언급 → agent-chat 호출
-- 1)·2)는 10-18 운영 DB에 먼저 적용됨(if not exists 로 재실행 안전).

create table if not exists public.agent_directives (
  id uuid primary key default gen_random_uuid(),
  agent_code text not null,
  team text not null,
  directive text not null check (char_length(directive) <= 2000),
  priority int not null default 5,
  active boolean not null default true,
  expires_at timestamptz,
  set_by text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_directives_lookup on public.agent_directives (agent_code, active, priority);

create table if not exists public.agent_prompt_edits (
  id uuid primary key default gen_random_uuid(),
  trigger_id text not null,
  agent_code text,
  team text,
  old_text text,
  new_text text not null,
  reason text,
  requested_by text not null,
  status text not null default '대기' check (status in ('대기','반영','거절','취소')),
  applied_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

alter table public.agent_directives enable row level security;
alter table public.agent_prompt_edits enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'agent_directives' and policyname = 'agent_directives_read') then
    create policy agent_directives_read on public.agent_directives for select to authenticated using (public.is_active_member());
    create policy agent_directives_write on public.agent_directives for all to authenticated
      using (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_agent))
      with check (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_agent));
    create policy agent_prompt_edits_read on public.agent_prompt_edits for select to authenticated using (public.is_active_member());
    create policy agent_prompt_edits_write on public.agent_prompt_edits for all to authenticated
      using (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_agent))
      with check (public.is_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_agent));
  end if;
end $$;

alter table public.agent_roster add column if not exists is_lead boolean not null default false;
alter table public.agent_roster add column if not exists lead_code text;

create or replace function public.agent_directives_for(p_code text, p_team text)
returns table (id uuid, directive text, priority int, set_by text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.directive, d.priority, d.set_by, d.expires_at
  from public.agent_directives d
  where d.active and (d.expires_at is null or d.expires_at > now())
    and (d.agent_code = p_code or (d.agent_code = '*' and d.team = p_team))
  order by d.priority, d.created_at
$$;

-- 채팅: 사람이 보냈고, AI 1:1 방 · '@AI이름' · '@팀장 언급(agent_roster.home.mention, 띄어쓰기 무시)' 중 하나일 때
create or replace function private.agent_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
  v_compact text := regexp_replace(coalesce(new.content, ''), '\s+', '', 'g');
begin
  if new.user_id is null or exists (select 1 from public.profiles p where p.id = new.user_id and p.is_agent) then
    return null;
  end if;
  select r.members into v_members from public.chat_rooms r where r.id = new.room_id;
  if exists (
    select 1 from public.profiles a
    where a.is_agent and a.active
      and ((v_members is not null and a.id = any (v_members)) or strpos(new.content, '@' || a.name) > 0)
  ) or exists (
    select 1 from public.agent_roster r
    where r.is_lead and r.active and coalesce(r.home ->> 'mention', '') <> ''
      and strpos(v_compact, '@' || (r.home ->> 'mention')) > 0
  ) then
    perform private.agent_call(jsonb_build_object('type', 'chat', 'message_id', new.id));
  end if;
  return null;
end;
$$;
