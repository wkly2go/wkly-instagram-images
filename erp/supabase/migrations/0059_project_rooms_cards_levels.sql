-- 0059 대화에서 일이 끝나게 (2026-10-23 "손에 붙게" 3단계)
-- 1) 프로젝트 대화방: 기획 · 진행 프로젝트마다 방 자동 생성, 끝나면(완료 · 보류 · NIC) 보관
-- 2) 카드: 프로젝트 할 일 · 결재 · 드라이브 파일이 그 방에 카드로 올라옴 (화면에서 버튼으로 처리)
-- 3) 방마다 알림 단계: 전체 · 멘션만 · 끄기 (기본: 1:1 · 일반 방 = 전체, 프로젝트 방 = 담당/멤버 전체 · 그 외 멘션만)

create table if not exists public.chat_room_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  level text not null check (level in ('all', 'mention', 'mute')),
  updated_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
create index if not exists chat_room_prefs_room_ix on public.chat_room_prefs (room_id);
alter table public.chat_room_prefs enable row level security;
create policy chat_room_prefs_own on public.chat_room_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select is_active_member()));

-- 사람 · 방의 알림 단계 (설정이 없으면 기본값)
create or replace function public.chat_level(p_user uuid, p_room uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select level from public.chat_room_prefs where user_id = p_user and room_id = p_room),
    (select case
       when r.members is not null then 'all'
       when r.project_id is null then 'all'
       when exists (select 1 from public.projects p where p.id = r.project_id and p.owner_id = p_user)
         or exists (select 1 from public.project_members m where m.project_id = r.project_id and m.profile_id = p_user) then 'all'
       else 'mention' end
     from public.chat_rooms r where r.id = p_room),
    'all')
$$;
revoke execute on function public.chat_level(uuid, uuid) from public, anon;
grant execute on function public.chat_level(uuid, uuid) to authenticated, service_role;

-- 방 목록 v3: 알림 단계 · 나를 부른 안 읽은 메시지 수 · 프로젝트 상태 포함
create or replace function public.chat_room_summaries_v3()
returns table(id uuid, name text, description text, project_id uuid, is_archived boolean, created_by uuid, created_at timestamptz, members uuid[],
  last_content text, last_at timestamptz, last_user_id uuid, unread integer, mentions integer, level text, project_status text)
language sql stable set search_path = '' as $$
  select r.id, r.name, r.description, r.project_id, r.is_archived, r.created_by, r.created_at, r.members,
    lm.content, lm.created_at, lm.user_id,
    coalesce((select count(*)::int from public.chat_messages m
      where m.room_id = r.id and m.user_id is distinct from auth.uid() and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)), 0),
    coalesce((select count(*)::int from public.chat_messages m
      where m.room_id = r.id and m.user_id is distinct from auth.uid() and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
        and strpos(m.content, '@' || (select btrim(p.name) from public.profiles p where p.id = auth.uid())) > 0), 0),
    public.chat_level(auth.uid(), r.id),
    pr.status
  from public.chat_rooms r
  left join public.chat_reads cr on cr.room_id = r.id and cr.user_id = auth.uid()
  left join public.projects pr on pr.id = r.project_id
  left join lateral (select m.content, m.created_at, m.user_id from public.chat_messages m where m.room_id = r.id order by m.created_at desc, m.id desc limit 1) lm on true
  where not r.is_archived
  order by coalesce(lm.created_at, r.created_at) desc
$$;
grant execute on function public.chat_room_summaries_v3() to authenticated;

-- 휴대폰 알림 받을 사람 (send-push 가 부름): 알림 단계 · 멘션 반영
create or replace function public.chat_push_targets(p_room uuid, p_sender uuid, p_content text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p, public.chat_rooms r
  where r.id = p_room and p.active and not p.is_agent and p.id is distinct from p_sender
    and (r.members is null or p.id = any (r.members))
    and case public.chat_level(p.id, p_room)
          when 'all' then true
          when 'mention' then btrim(p.name) <> '' and strpos(coalesce(p_content, ''), '@' || btrim(p.name)) > 0
          else false end
$$;
revoke execute on function public.chat_push_targets(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.chat_push_targets(uuid, uuid, text) to service_role;

-- 프로젝트 방 만들기 · 이름 맞추기 · 보관
create or replace function private.project_room_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text := left(btrim(coalesce(new.code || ' ', '') || new.name), 60);
begin
  if new.status in ('기획', '진행') then
    if exists (select 1 from public.chat_rooms where project_id = new.id and members is null) then
      update public.chat_rooms set is_archived = false, name = v_name
       where project_id = new.id and members is null and (is_archived or name is distinct from v_name);
    else
      insert into public.chat_rooms (name, description, project_id, created_by)
      values (v_name, '프로젝트 대화 · 할 일 · 결재 · 파일이 여기에 모입니다', new.id, coalesce(new.owner_id, new.created_by));
    end if;
  else
    update public.chat_rooms set is_archived = true where project_id = new.id and members is null and not is_archived;
  end if;
  return null;
exception when unique_violation then
  return null; -- 같은 이름의 방이 이미 있으면 건너뜀
end $$;
create or replace trigger projects_room_sync after insert or update of status, name, code on public.projects
  for each row execute function private.project_room_sync();

-- 카드 첨부 허용 (파일 경로 없이 card 만, 파일은 지금처럼 방 경로 아래만)
alter table public.chat_messages drop constraint chat_messages_attachment_check;
alter table public.chat_messages add constraint chat_messages_attachment_check check (
  attachment is null or (jsonb_typeof(attachment) = 'object' and coalesce(attachment ->> 'name', '') <> '' and (
    (attachment ->> 'path') like (room_id::text || '/%')
    or (attachment ? 'card' and jsonb_typeof(attachment -> 'card') = 'object' and not attachment ? 'path')))) not valid;

-- 프로젝트 방에 카드 올리기
create or replace function private.post_card(p_project uuid, p_user uuid, p_content text, p_card jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  if p_project is null then return; end if;
  select id into v_room from public.chat_rooms where project_id = p_project and members is null and not is_archived order by created_at limit 1;
  if v_room is null then return; end if;
  insert into public.chat_messages (room_id, user_id, content, attachment)
  values (v_room, p_user, p_content, jsonb_build_object('card', p_card, 'name', coalesce(nullif(p_card ->> 'title', ''), '카드')));
exception when others then
  raise warning 'post_card: %', sqlerrm; -- 카드가 실패해도 원래 저장은 그대로
end $$;

create or replace function private.task_card() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.post_card(new.project_id, coalesce(new.created_by, new.assignee_id),
    '할 일을 만들었어요' || coalesce(' · 담당 ' || (select btrim(name) from public.profiles where id = new.assignee_id), ''),
    jsonb_build_object('kind', 'task', 'id', new.id, 'title', new.title));
  return null;
end $$;
create or replace trigger tasks_card after insert on public.tasks for each row when (new.project_id is not null) execute function private.task_card();

create or replace function private.approval_card() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  v_project := nullif(case when new.kind = '프로젝트' then new.target_id::text else new.payload ->> 'project_id' end, '')::uuid;
  perform private.post_card(v_project, new.requested_by, '결재를 올렸어요 · ' || new.kind,
    jsonb_build_object('kind', 'approval', 'id', new.id, 'title', new.title));
  return null;
exception when others then
  return null;
end $$;
create or replace trigger approvals_card after insert on public.approvals for each row execute function private.approval_card();

create or replace function private.drive_file_card() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.post_card(new.project_id, new.added_by, '파일을 올렸어요',
    jsonb_build_object('kind', 'file', 'id', new.id, 'title', new.name, 'url', new.url));
  return null;
end $$;
create or replace trigger project_drive_files_card after insert on public.project_drive_files for each row when (new.added_by is not null) execute function private.drive_file_card();

-- 지금 있는 기획 · 진행 프로젝트에 방 만들기
do $$ declare p record; begin
  for p in select * from public.projects where status in ('기획', '진행')
    and not exists (select 1 from public.chat_rooms r where r.project_id = projects.id and r.members is null) loop
    begin
      insert into public.chat_rooms (name, description, project_id, created_by)
      values (left(btrim(coalesce(p.code || ' ', '') || p.name), 60), '프로젝트 대화 · 할 일 · 결재 · 파일이 여기에 모입니다', p.id, coalesce(p.owner_id, p.created_by));
    exception when unique_violation then null;
    end;
  end loop;
end $$;
