-- =====================================================================
-- WKLY ERP 초기 스키마 (Supabase / Postgres 15)
--
-- - 프론트엔드는 anon/publishable 키로 Supabase에 직접 접속하므로
--   Row Level Security(RLS)가 유일한 보안 경계입니다.
-- - Supabase SQL Editor에 붙여넣어 여러 번 실행해도 안전하도록 작성했습니다.
-- - 상태/분류 값은 Postgres enum 대신 한글 text + CHECK 제약으로 관리합니다.
--   (값 변경: alter table ... drop constraint <이름>, add constraint <이름> check (...))
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 공용 트리거 함수: updated_at 자동 갱신
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 1-1. profiles: auth.users 1:1
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text not null default '',
  role        text not null default 'member'
              constraint profiles_role_check check (role in ('admin', 'member')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 1-2. clients (거래처)
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null default '클라이언트'
               constraint clients_category_check check (category in ('클라이언트', '협력사', '기타')),
  business_no  text,
  phone        text,
  email        text,
  address      text,
  website      text,
  memo         text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 1-3. contacts (거래처 담당자)
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  title       text,
  phone       text,
  email       text,
  memo        text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 1-4. projects
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  client_id    uuid references public.clients (id) on delete set null,
  category     text not null default '팝업'
               constraint projects_category_check check (category in ('팝업', '캠페인', '콘텐츠', '기타')),
  status       text not null default '기획'
               constraint projects_status_check check (status in ('기획', '진행', '완료', '보류')),
  owner_id     uuid references public.profiles (id) on delete set null,
  start_date   date,
  end_date     date,
  location     text,
  description  text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_date_range_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

-- 1-5. tasks (할 일/일정). project_id 가 null 이면 프로젝트와 무관한 개별 할 일
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects (id) on delete cascade,
  title         text not null,
  assignee_id   uuid references public.profiles (id) on delete set null,
  due_date      date,
  status        text not null default '할 일'
                constraint tasks_status_check check (status in ('할 일', '진행 중', '완료')),
  memo          text,
  completed_at  timestamptz,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1-6. work_logs (업무 일지 + 거래처 커뮤니케이션 이력)
create table if not exists public.work_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid default auth.uid() references public.profiles (id) on delete set null,
  log_date           date not null default current_date,
  kind               text not null default '업무'
                     constraint work_logs_kind_check
                     check (kind in ('업무', '메일 발신', '메일 수신', '미팅', '전화', '메신저', '기타')),
  content            text not null,
  email_counterpart  text,
  email_subject      text,
  client_id          uuid references public.clients (id) on delete set null,
  project_id         uuid references public.projects (id) on delete set null,
  minutes            int constraint work_logs_minutes_check check (minutes is null or minutes >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 1-7. chat_rooms (채팅방)
create table if not exists public.chat_rooms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null constraint chat_rooms_name_key unique,
  description  text,
  project_id   uuid references public.projects (id) on delete set null,
  is_archived  boolean not null default false,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 1-8. chat_messages (채팅 메시지)
create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  user_id     uuid default auth.uid() references public.profiles (id) on delete set null,
  content     text not null
              constraint chat_messages_content_check check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

-- 1-9. chat_reads (방별 마지막 읽은 시각)
create table if not exists public.chat_reads (
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  room_id       uuid not null references public.chat_rooms (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, room_id)
);

-- 1-10. approvals (승인/결재 요청). target_id 는 여러 테이블을 가리킬 수 있어 FK 없음
create table if not exists public.approvals (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null
                    constraint approvals_kind_check
                    check (kind in ('업무 보고', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타')),
  title             text not null,
  content           text,
  payload           jsonb not null default '{}'::jsonb,
  target_id         uuid,
  amount            bigint constraint approvals_amount_check check (amount is null or amount >= 0),
  requested_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  approver_id       uuid references public.profiles (id) on delete set null,
  status            text not null default '대기'
                    constraint approvals_status_check check (status in ('대기', '승인', '반려', '취소')),
  decided_by        uuid references public.profiles (id) on delete set null,
  decided_at        timestamptz,
  decision_comment  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. 인덱스 (모든 FK 컬럼 + 조회용)
-- ---------------------------------------------------------------------
create index if not exists clients_created_by_idx        on public.clients (created_by);

create index if not exists contacts_client_id_idx        on public.contacts (client_id);

create index if not exists projects_client_id_idx        on public.projects (client_id);
create index if not exists projects_owner_id_idx         on public.projects (owner_id);
create index if not exists projects_created_by_idx       on public.projects (created_by);
create index if not exists projects_status_idx           on public.projects (status);
create index if not exists projects_dates_idx            on public.projects (start_date, end_date);

create index if not exists tasks_project_id_idx          on public.tasks (project_id);
create index if not exists tasks_assignee_id_idx         on public.tasks (assignee_id);
create index if not exists tasks_created_by_idx          on public.tasks (created_by);
create index if not exists tasks_due_date_idx            on public.tasks (due_date);

create index if not exists work_logs_user_id_idx         on public.work_logs (user_id);
create index if not exists work_logs_client_id_idx       on public.work_logs (client_id);
create index if not exists work_logs_project_id_idx      on public.work_logs (project_id);
create index if not exists work_logs_log_date_idx        on public.work_logs (log_date desc);

create index if not exists chat_rooms_project_id_idx     on public.chat_rooms (project_id);
create index if not exists chat_rooms_created_by_idx     on public.chat_rooms (created_by);

-- (room_id, created_at desc) 가 room_id FK 인덱스 역할도 겸함
create index if not exists chat_messages_room_created_idx on public.chat_messages (room_id, created_at desc);
create index if not exists chat_messages_user_id_idx     on public.chat_messages (user_id);

-- chat_reads.user_id 는 PK 선두 컬럼이라 별도 인덱스 불필요
create index if not exists chat_reads_room_id_idx        on public.chat_reads (room_id);

create index if not exists approvals_status_created_idx  on public.approvals (status, created_at desc);
create index if not exists approvals_requested_by_idx    on public.approvals (requested_by);
create index if not exists approvals_approver_id_idx     on public.approvals (approver_id);
create index if not exists approvals_decided_by_idx      on public.approvals (decided_by);
create index if not exists approvals_kind_idx            on public.approvals (kind);


-- ---------------------------------------------------------------------
-- 3. 권한 확인 헬퍼 함수 (RLS 정책에서 사용)
--    security definer: profiles 의 RLS 를 우회해 재귀 없이 조회
-- ---------------------------------------------------------------------
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role = 'admin'
  );
$$;

-- 승인 요청을 처리(승인/반려)할 수 있는지: 관리자 또는 지정 승인자(활성)
-- 테이블 행을 인자로 받으므로 PostgREST 에서 계산 컬럼으로도 조회 가능
--   예) supabase.from('approvals').select('*, can_decide')
create or replace function public.can_decide(a public.approvals)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_member() and a.approver_id = auth.uid());
$$;


-- ---------------------------------------------------------------------
-- 4. 신규 사용자 → profiles 자동 생성
--    최초 생성되는 프로필은 admin, 이후는 member
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      ''
    ),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- auth.users 는 Supabase 소유 테이블이라 DROP TRIGGER 에는 소유권이 필요할 수 있음.
-- CREATE OR REPLACE TRIGGER (PG14+) 는 TRIGGER 권한만으로 재실행 가능.
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이 스크립트 실행 전에 대시보드에서 이미 만든 사용자가 있으면 프로필을 채워 넣음
-- (프로필이 하나도 없던 경우 가장 먼저 가입한 사용자가 admin)
insert into public.profiles (id, email, name, role)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    ''
  ),
  case
    when not exists (select 1 from public.profiles)
         and row_number() over (order by u.created_at, u.id) = 1
      then 'admin'
    else 'member'
  end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 5. profiles 변경 보호 트리거
--    - 로그인 사용자 요청(auth.uid() 존재)에서 관리자가 아니면 role/active 변경 불가
--      (SQL Editor / service_role 처럼 auth.uid() 가 없는 경우는 이 검사 제외)
--    - 누구든 활성 관리자가 0명이 되는 변경은 불가
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_admin()
  then
    raise exception '권한(role)과 활성 상태(active)는 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.role = 'admin' and old.active
     and not (new.role = 'admin' and new.active)
  then
    -- 두 관리자가 동시에 서로를 해제하는 경우를 막기 위해 직렬화
    perform pg_advisory_xact_lock(hashtext('public.profiles_guard'));

    if not exists (
      select 1
      from public.profiles p
      where p.role = 'admin'
        and p.active
        and p.id <> old.id
    ) then
      raise exception '활성 관리자가 최소 1명 있어야 합니다. 다른 관리자를 먼저 지정하세요.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();


-- ---------------------------------------------------------------------
-- 6. 기타 트리거
-- ---------------------------------------------------------------------

-- 6-1. updated_at
drop trigger if exists set_updated_at on public.clients;
create trigger set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.work_logs;
create trigger set_updated_at
  before update on public.work_logs
  for each row execute function public.set_updated_at();

-- 6-2. tasks.completed_at: '완료'가 되면 기록, '완료'에서 벗어나면 비움
create or replace function public.tasks_set_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = '완료' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from '완료' then
      new.completed_at := now();
    else
      new.completed_at := coalesce(new.completed_at, old.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at
  before insert or update on public.tasks
  for each row execute function public.tasks_set_completed_at();

-- 6-3. chat_messages.edited_at: 내용이 바뀌면 수정 시각 기록
create or replace function public.chat_messages_set_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_set_edited_at on public.chat_messages;
create trigger chat_messages_set_edited_at
  before update on public.chat_messages
  for each row execute function public.chat_messages_set_edited_at();

-- 6-4. approvals 상태 전이 규칙
--   요청자(대기 중): title/content/payload/amount/approver_id/kind/target_id 수정, 또는 '취소'
--   처리자(관리자 또는 지정 승인자): '대기' → '승인'/'반려' (decided_by/decided_at 자동 기록)
--   본인 요청은 관리자만 직접 처리 가능
--   처리 완료(승인/반려/취소)된 요청은 변경 불가. 단, 처리자는 decision_comment 수정 가능
--   (auth.uid() 가 없는 SQL Editor / service_role 은 규칙 검사 제외)
create or replace function public.approvals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid        uuid    := auth.uid();
  v_requester  boolean;
  v_decider    boolean;
  v_old        jsonb   := to_jsonb(old) - 'updated_at';
  v_new        jsonb   := to_jsonb(new) - 'updated_at';
begin
  if v_uid is null then
    if new.status in ('승인', '반려') and old.status = '대기' and new.decided_at is null then
      new.decided_at := now();
    end if;
    return new;
  end if;

  v_requester := old.requested_by = v_uid;
  v_decider   := public.is_admin() or (public.is_active_member() and old.approver_id = v_uid);

  -- 처리 완료된 요청
  if old.status <> '대기' then
    if new.status is distinct from old.status then
      raise exception '이미 처리된 요청(%)은 상태를 변경할 수 없습니다.', old.status
        using errcode = '42501';
    end if;
    if v_new - 'decision_comment' is distinct from v_old - 'decision_comment' then
      raise exception '이미 처리된 요청은 수정할 수 없습니다.'
        using errcode = '42501';
    end if;
    if new.decision_comment is distinct from old.decision_comment
       and old.decided_by is distinct from v_uid then
      raise exception '처리 의견은 해당 요청을 처리한 사람만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 중 → 대기 (내용 수정)
  if new.status = '대기' then
    if not v_requester then
      raise exception '대기 중인 요청은 요청자만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    if v_new - array['title', 'content', 'payload', 'amount', 'approver_id', 'kind', 'target_id']
       is distinct from
       v_old - array['title', 'content', 'payload', 'amount', 'approver_id', 'kind', 'target_id'] then
      raise exception '요청자는 제목·내용·첨부 데이터·금액·승인자·종류·대상만 수정할 수 있습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 → 취소
  if new.status = '취소' then
    if not v_requester then
      raise exception '요청 취소는 요청자만 할 수 있습니다.'
        using errcode = '42501';
    end if;
    if v_new - 'status' is distinct from v_old - 'status' then
      raise exception '취소할 때는 다른 항목을 함께 변경할 수 없습니다.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 대기 → 승인 / 반려
  if not v_decider then
    raise exception '이 요청을 승인하거나 반려할 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if v_requester and not public.is_admin() then
    raise exception '본인이 올린 요청은 직접 승인하거나 반려할 수 없습니다.'
      using errcode = '42501';
  end if;
  if v_new - array['status', 'decided_by', 'decided_at', 'decision_comment']
     is distinct from
     v_old - array['status', 'decided_by', 'decided_at', 'decision_comment'] then
    raise exception '승인/반려할 때는 상태와 처리 의견만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  new.decided_by := v_uid;
  new.decided_at := now();
  return new;
end;
$$;

drop trigger if exists approvals_guard on public.approvals;
create trigger approvals_guard
  before update on public.approvals
  for each row execute function public.approvals_guard();

drop trigger if exists set_updated_at on public.approvals;
create trigger set_updated_at
  before update on public.approvals
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 7. Row Level Security
--    (select fn()) 형태는 행마다가 아니라 쿼리당 1회만 평가되도록 하기 위함
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.clients       enable row level security;
alter table public.contacts      enable row level security;
alter table public.projects      enable row level security;
alter table public.tasks         enable row level security;
alter table public.work_logs     enable row level security;
alter table public.chat_rooms    enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads    enable row level security;
alter table public.approvals     enable row level security;

-- 7-1. profiles: 활성 멤버 전체 조회 / 본인 수정 / 관리자는 전체 수정
--      (insert 는 트리거로만, delete 는 auth.users 삭제 시 cascade 로만)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_member()))
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 7-2. clients: 활성 멤버 조회/등록/수정, 삭제는 관리자
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete to authenticated
  using ((select public.is_admin()));

-- 7-3. projects: 활성 멤버 조회/등록/수정, 삭제는 관리자
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using ((select public.is_admin()));

-- 7-4. contacts: 활성 멤버 전체 권한
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete to authenticated
  using ((select public.is_active_member()));

-- 7-5. tasks: 활성 멤버 전체 권한
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using ((select public.is_active_member()));

-- 7-6. work_logs: 활성 멤버 전체 조회, 본인 명의로만 작성, 수정/삭제는 본인 또는 관리자
drop policy if exists work_logs_select on public.work_logs;
create policy work_logs_select on public.work_logs
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists work_logs_insert on public.work_logs;
create policy work_logs_insert on public.work_logs
  for insert to authenticated
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists work_logs_update on public.work_logs;
create policy work_logs_update on public.work_logs
  for update to authenticated
  using (
    (select public.is_active_member())
    and (user_id = (select auth.uid()) or (select public.is_admin()))
  )
  with check (
    (select public.is_active_member())
    and (user_id = (select auth.uid()) or (select public.is_admin()))
  );

drop policy if exists work_logs_delete on public.work_logs;
create policy work_logs_delete on public.work_logs
  for delete to authenticated
  using (
    (select public.is_active_member())
    and (user_id = (select auth.uid()) or (select public.is_admin()))
  );

-- 7-7. chat_rooms: 활성 멤버 조회/생성/수정, 삭제는 만든 사람 또는 관리자
drop policy if exists chat_rooms_select on public.chat_rooms;
create policy chat_rooms_select on public.chat_rooms
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists chat_rooms_insert on public.chat_rooms;
create policy chat_rooms_insert on public.chat_rooms
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists chat_rooms_update on public.chat_rooms;
create policy chat_rooms_update on public.chat_rooms
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists chat_rooms_delete on public.chat_rooms;
create policy chat_rooms_delete on public.chat_rooms
  for delete to authenticated
  using (
    (select public.is_active_member())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  );

-- 7-8. chat_messages: 활성 멤버 조회, 본인 명의로만 작성, 수정은 본인, 삭제는 본인 또는 관리자
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()))
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete to authenticated
  using (
    (select public.is_active_member())
    and (user_id = (select auth.uid()) or (select public.is_admin()))
  );

-- 7-9. chat_reads: 본인 행만 (활성 멤버)
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
  for select to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads
  for insert to authenticated
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads
  for update to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()))
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists chat_reads_delete on public.chat_reads;
create policy chat_reads_delete on public.chat_reads
  for delete to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()));

-- 7-10. approvals: 요청자·지정 승인자·관리자만 조회
--       세부 상태 전이 규칙은 approvals_guard 트리거에서 검사
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals
  for select to authenticated
  using (
    (select public.is_active_member())
    and (
      requested_by = (select auth.uid())
      or approver_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals
  for insert to authenticated
  with check (
    (select public.is_active_member())
    and requested_by = (select auth.uid())
    and status = '대기'
    and decided_by is null
    and decided_at is null
  );

drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals
  for update to authenticated
  using (
    (select public.is_active_member())
    and (
      (requested_by = (select auth.uid()) and status = '대기')
      or approver_id = (select auth.uid())
      or (select public.is_admin())
    )
  )
  with check (
    (select public.is_active_member())
    and (
      requested_by = (select auth.uid())
      or approver_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

drop policy if exists approvals_delete on public.approvals;
create policy approvals_delete on public.approvals
  for delete to authenticated
  using ((select public.is_admin()));


-- ---------------------------------------------------------------------
-- 8. 권한(GRANT)
--    Supabase 기본 권한(anon/authenticated 에 ALL)을 덮어써서
--    authenticated 는 select/insert/update/delete 만, anon 은 아무것도 없음.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;

revoke all on table
  public.profiles, public.clients, public.contacts, public.projects, public.tasks,
  public.work_logs, public.chat_rooms, public.chat_messages, public.chat_reads,
  public.approvals
from anon, authenticated;

grant select, insert, update, delete on table
  public.profiles, public.clients, public.contacts, public.projects, public.tasks,
  public.work_logs, public.chat_rooms, public.chat_messages, public.chat_reads,
  public.approvals
to authenticated;

-- identity 컬럼은 시퀀스 권한 없이도 insert 가능하므로 시퀀스 권한은 주지 않음
revoke all on sequence public.chat_messages_id_seq from anon, authenticated;

revoke all on function
  public.is_active_member(), public.is_admin(), public.can_decide(public.approvals)
from public, anon;
grant execute on function
  public.is_active_member(), public.is_admin(), public.can_decide(public.approvals)
to authenticated;

-- 트리거 전용 함수는 직접 호출할 필요가 없음 (트리거 실행에는 EXECUTE 권한 불필요)
revoke all on function
  public.set_updated_at(),
  public.handle_new_user(),
  public.profiles_guard(),
  public.tasks_set_completed_at(),
  public.chat_messages_set_edited_at(),
  public.approvals_guard()
from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 9. 기본 데이터: 전체 채팅방
-- ---------------------------------------------------------------------
insert into public.chat_rooms (name, description)
values ('전체', '전 직원 공용 채팅방')
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 10. Realtime: chat_messages / approvals 변경 사항 구독 허용
--     (publication 이 있고 아직 포함되지 않은 테이블만 추가)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'approvals'] loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. 설명(comment)
-- ---------------------------------------------------------------------
comment on table public.profiles      is '사용자 프로필 (auth.users 와 1:1, 권한·활성 상태 관리)';
comment on table public.clients       is '거래처 (클라이언트·협력사 등)';
comment on table public.contacts      is '거래처 담당자';
comment on table public.projects      is '프로젝트 (팝업·캠페인·콘텐츠 등)';
comment on table public.tasks         is '할 일 / 일정 (프로젝트 없이 개별 등록 가능)';
comment on table public.work_logs     is '업무 일지 (거래처 커뮤니케이션 이력 포함)';
comment on table public.chat_rooms    is '사내 채팅방';
comment on table public.chat_messages is '채팅 메시지';
comment on table public.chat_reads    is '채팅방별 마지막 읽은 시각 (사용자별)';
comment on table public.approvals     is '승인/결재 요청 (업무 보고·메일 발송·지출 등)';

comment on column public.clients.business_no         is '사업자등록번호';
comment on column public.contacts.title              is '직함';
comment on column public.contacts.is_primary         is '대표 담당자 여부';
comment on column public.tasks.completed_at          is '완료 시각 (status 가 완료가 되면 자동 기록)';
comment on column public.work_logs.email_counterpart is '메일 상대 (이메일 또는 이름)';
comment on column public.work_logs.minutes           is '소요 시간(분)';
comment on column public.chat_messages.edited_at     is '내용 수정 시각 (내용 변경 시 자동 기록)';
comment on column public.approvals.payload          is '종류별 추가 데이터 (예: 메일 발송 {"to","subject","body"})';
comment on column public.approvals.target_id        is '관련 프로젝트/거래처/할 일 등의 id (FK 없음)';
comment on column public.approvals.amount           is '금액(원), 지출 요청용';
comment on column public.approvals.approver_id      is '지정 승인자 (null 이면 관리자 누구나 처리)';
