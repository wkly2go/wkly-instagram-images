-- WKLY ERP 0010: 팀원 1:1 채팅 (개인 대화방)
--   chat_rooms.members 가 비어 있으면(null) 모든 팀원이 보는 방, 값이 있으면 그 사람들만 보는 방.
--   1:1 방은 chat_open_dm(상대) 로만 만든다 (두 사람 조합마다 하나: dm_key).
--   기존 정책은 그대로 두고 RESTRICTIVE 정책을 더해 '방 멤버만' 조건을 겹친다. 관리자도 남의 1:1 대화는 못 본다.

alter table public.chat_rooms add column members uuid[];
alter table public.chat_rooms add column dm_key text constraint chat_rooms_dm_key_key unique;
comment on column public.chat_rooms.members is '비어 있으면 전체 공개 방, 값이 있으면 이 사람들만 보는 방 (1:1 채팅)';

-- 지금 로그인한 사람이 이 방을 볼 수 있는지 (정책 안에서 chat_rooms 를 다시 읽으므로 security definer)
create function public.chat_room_visible(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_rooms r
    where r.id = p_room and (r.members is null or (select auth.uid()) = any (r.members))
  );
$$;
revoke execute on function public.chat_room_visible(uuid) from public, anon;
grant execute on function public.chat_room_visible(uuid) to authenticated;

-- 방
create policy chat_rooms_member_select on public.chat_rooms
  as restrictive for select to authenticated
  using (members is null or (select auth.uid()) = any (members));
create policy chat_rooms_member_insert on public.chat_rooms
  as restrictive for insert to authenticated
  with check (members is null and dm_key is null);
create policy chat_rooms_member_update on public.chat_rooms
  as restrictive for update to authenticated
  using (members is null or (select auth.uid()) = any (members))
  with check (members is null or (select auth.uid()) = any (members));
create policy chat_rooms_member_delete on public.chat_rooms
  as restrictive for delete to authenticated
  using (members is null or (select auth.uid()) = any (members));

-- 멤버 · 1:1 표시는 바꿀 수 없음
create function public.chat_rooms_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (new.members is distinct from old.members or new.dm_key is distinct from old.dm_key) then
    raise exception '대화방 멤버는 바꿀 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger chat_rooms_members_guard
  before update on public.chat_rooms
  for each row execute function public.chat_rooms_members_guard();

-- 메시지 · 읽음
create policy chat_messages_member_select on public.chat_messages
  as restrictive for select to authenticated
  using ((select public.chat_room_visible(room_id)));
create policy chat_messages_member_insert on public.chat_messages
  as restrictive for insert to authenticated
  with check ((select public.chat_room_visible(room_id)));
create policy chat_messages_member_update on public.chat_messages
  as restrictive for update to authenticated
  using ((select public.chat_room_visible(room_id)));
create policy chat_messages_member_delete on public.chat_messages
  as restrictive for delete to authenticated
  using ((select public.chat_room_visible(room_id)));

create policy chat_reads_member_select on public.chat_reads
  as restrictive for select to authenticated
  using ((select public.chat_room_visible(room_id)));
create policy chat_reads_member_insert on public.chat_reads
  as restrictive for insert to authenticated
  with check ((select public.chat_room_visible(room_id)));
create policy chat_reads_member_update on public.chat_reads
  as restrictive for update to authenticated
  using ((select public.chat_room_visible(room_id)));

-- 1:1 방 열기: 있으면 그 방, 없으면 만들어서 id 를 돌려줌
create function public.chat_open_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if not exists (select 1 from public.profiles p where p.id = p_other and p.active) then
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
revoke execute on function public.chat_open_dm(uuid) from public, anon;
grant execute on function public.chat_open_dm(uuid) to authenticated;

-- 방 목록 요약 v2: members 추가 (호출자 RLS 그대로 → 남의 1:1 방은 안 나옴)
--   반환 형식이 달라 기존 chat_room_summaries 는 그대로 두고 새 이름으로 만든다 (열려 있는 예전 화면 호환)
create function public.chat_room_summaries_v2()
returns table (
  id uuid,
  name text,
  description text,
  project_id uuid,
  is_archived boolean,
  created_by uuid,
  created_at timestamptz,
  members uuid[],
  last_content text,
  last_at timestamptz,
  last_user_id uuid,
  unread integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id, r.name, r.description, r.project_id, r.is_archived, r.created_by, r.created_at, r.members,
    lm.content, lm.created_at, lm.user_id,
    coalesce((
      select count(*)::int
      from public.chat_messages m
      where m.room_id = r.id
        and m.user_id is distinct from auth.uid()
        and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
    ), 0)
  from public.chat_rooms r
  left join public.chat_reads cr
    on cr.room_id = r.id and cr.user_id = auth.uid()
  left join lateral (
    select m.content, m.created_at, m.user_id
    from public.chat_messages m
    where m.room_id = r.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where not r.is_archived
  order by coalesce(lm.created_at, r.created_at) desc;
$$;
revoke execute on function public.chat_room_summaries_v2() from public, anon;
grant execute on function public.chat_room_summaries_v2() to authenticated;

-- 멘션 알림: 1:1 방에서는 그 방 멤버에게만
create or replace function public.chat_messages_notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender  text;
  v_room    text;
  v_members uuid[];
  r         record;
begin
  if strpos(new.content, '@') = 0 then
    return null;
  end if;

  select coalesce(nullif(btrim(p.name), ''), '누군가') into v_sender
  from public.profiles p where p.id = new.user_id;
  select case when c.members is null then c.name else '1:1 대화' end, c.members into v_room, v_members
  from public.chat_rooms c where c.id = new.room_id;

  for r in
    select p.id
    from public.profiles p
    where p.active
      and not p.is_agent
      and p.id is distinct from new.user_id
      and btrim(p.name) <> ''
      and strpos(new.content, '@' || p.name) > 0
      and (v_members is null or p.id = any (v_members))
  loop
    perform public.notify(
      r.id, '멘션',
      coalesce(v_sender, '누군가') || '님이 언급했어요 · ' || coalesce(v_room, '채팅'),
      left(new.content, 80),
      '/chat?room=' || new.room_id
    );
  end loop;

  return null;
end;
$$;
