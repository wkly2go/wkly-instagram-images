-- 외부 협업방 (로드맵 2단계 · 2026-11-17 · 설계 docs/EXTERNAL_COLLAB.md)
-- 거래처 · 협력사는 계정 없이 초대 링크(1회용) → 기기 열쇠로 서버 함수 collab 에만 들어옴.
-- 그래서 이 표들에는 anon 권한이 없고, 기기 열쇠 표(collab_links)는 팀원도 못 읽는다(서버 함수 service role 만).
-- 기존 표는 바꾸지 않음.

create table public.collab_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  intro text check (intro is null or char_length(intro) <= 1000),
  drive_folder_id text check (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{10,}$'),
  closed_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collab_rooms_project on public.collab_rooms (project_id);
comment on table public.collab_rooms is '외부 협업방 — 프로젝트마다 여러 개(발주처방 · 협력사방). 자료는 드라이브 01.협의자료/03.외부공유';

create table public.collab_guests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collab_rooms(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  org text check (org is null or char_length(org) <= 60),
  role text not null default '발주처' check (role in ('발주처', '협력사', '기타')),
  can_upload boolean not null default true,
  expires_at timestamptz not null default now() + interval '60 days',
  revoked_at timestamptz,
  last_seen_at timestamptz,
  read_upto bigint not null default 0,
  invited_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index collab_guests_room on public.collab_guests (room_id);
comment on table public.collab_guests is '외부 협업방 외부인 (계정 아님). 만들기는 서버 함수만, 해제 · 만료 · 올리기 허용은 팀원이 고침';

create table public.collab_links (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.collab_guests(id) on delete cascade,
  invite_hash text unique check (invite_hash is null or invite_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz not null,
  session_hash text unique check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  device text check (device is null or char_length(device) <= 80),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index collab_links_guest on public.collab_links (guest_id);
comment on table public.collab_links is '초대 링크(1회용) · 기기 열쇠 — SHA-256 해시만. 서버 함수 collab 만 읽고 씀';

create table public.collab_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.collab_rooms(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  guest_id uuid references public.collab_guests(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 20),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (user_id is null or guest_id is null)
);
create index collab_messages_room on public.collab_messages (room_id, id);

create table public.collab_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collab_rooms(id) on delete cascade,
  kind text not null default '미팅' check (kind in ('미팅', '마일스톤', '일정')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  day date not null,
  end_day date,
  start_time text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  place text check (place is null or char_length(place) <= 120),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_day is null or end_day >= day)
);
create index collab_events_room on public.collab_events (room_id, day);

create table public.collab_files (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.collab_rooms(id) on delete cascade,
  drive_id text not null check (drive_id ~ '^[A-Za-z0-9_-]{10,}$'),
  name text not null check (char_length(name) between 1 and 250),
  mime text,
  size bigint,
  user_id uuid references public.profiles(id) on delete set null,
  guest_id uuid references public.collab_guests(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, drive_id)
);
comment on table public.collab_files is '외부 협업방에서 올린 파일 기록(누가 올렸는지). 파일은 드라이브 방 폴더에';

create trigger collab_rooms_updated before update on public.collab_rooms for each row execute function public.set_updated_at();
create trigger collab_events_updated before update on public.collab_events for each row execute function public.set_updated_at();

-- ── 권한 ───────────────────────────────────────────────────────────────
alter table public.collab_rooms enable row level security;
alter table public.collab_guests enable row level security;
alter table public.collab_links enable row level security;
alter table public.collab_messages enable row level security;
alter table public.collab_events enable row level security;
alter table public.collab_files enable row level security;

revoke all on public.collab_rooms, public.collab_guests, public.collab_links, public.collab_messages, public.collab_events, public.collab_files from anon;
revoke all on public.collab_links from authenticated;
revoke all on sequence public.collab_messages_id_seq from anon;
revoke truncate on public.collab_rooms, public.collab_guests, public.collab_messages, public.collab_events, public.collab_files from authenticated;

-- 방 · 일정: 활성 팀원
create policy collab_rooms_staff on public.collab_rooms for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy collab_events_staff on public.collab_events for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
-- 방 만들기 · 드라이브 폴더 지정은 서버 함수만 (팀원이 다른 드라이브 폴더를 외부인에게 열지 못하게). 팀원은 이름 · 안내 · 닫기만
revoke insert, update, delete on public.collab_rooms from authenticated;
grant update (title, intro, closed_at) on public.collab_rooms to authenticated;
revoke insert, update on public.collab_events from authenticated;
grant insert (room_id, kind, title, day, end_day, start_time, place, note) on public.collab_events to authenticated;
grant update (kind, title, day, end_day, start_time, place, note) on public.collab_events to authenticated;

-- 외부인: 팀원은 읽기 · 일부 칸 고치기(해제 · 만료 · 올리기 허용 · 이름 · 회사 · 역할). 만들기 · 지우기는 서버 함수만
create policy collab_guests_read on public.collab_guests for select to authenticated using ((select public.is_active_member()));
create policy collab_guests_edit on public.collab_guests for update to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
revoke insert, update, delete on public.collab_guests from authenticated;
grant update (name, org, role, can_upload, expires_at, revoked_at) on public.collab_guests to authenticated;

-- 대화: 팀원은 읽기 · 본인 이름으로만 쓰기 · 본인 글 숨기기(deleted_at)만
create policy collab_messages_read on public.collab_messages for select to authenticated using ((select public.is_active_member()));
create policy collab_messages_write on public.collab_messages for insert to authenticated
  with check ((select public.is_active_member()) and user_id = (select auth.uid()) and guest_id is null);
create policy collab_messages_hide on public.collab_messages for update to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.collab_messages from authenticated;
grant insert (room_id, body, files) on public.collab_messages to authenticated;
grant update (deleted_at) on public.collab_messages to authenticated;

-- 파일 기록: 팀원은 읽기만 (쓰기는 서버 함수가 드라이브 확인 뒤)
create policy collab_files_read on public.collab_files for select to authenticated using ((select public.is_active_member()));
revoke insert, update, delete on public.collab_files from authenticated;

-- 팀원 화면 실시간 (외부인은 서버 함수로 8초마다 확인)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'collab_messages') then
    alter publication supabase_realtime add table public.collab_messages;
  end if;
end $$;
