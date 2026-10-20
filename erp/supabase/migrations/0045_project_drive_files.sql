-- 0045 · 프로젝트에 구글 드라이브 자료 첨부 (대표 지시 2026-10-20
--   "드라이브의 자료를 프로젝트에 첨부가능하게, 첨부한 자료는 구글드라이브와 연동")
-- 파일을 복사하지 않고 드라이브 파일을 가리킴 → 드라이브에서 고치면 인트라넷에서도 늘 최신.
-- 보기: 활성 팀원 · 첨부: 활성 팀원(본인 이름으로) · 빼기: 첨부한 사람 · 관리자
create table if not exists public.project_drive_files (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  drive_id    text not null check (drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  name        text not null check (length(btrim(name)) between 1 and 300),
  mime_type   text,
  url         text not null check (url ~ '^https://(drive|docs)\.google\.com/[^\s<>"]{1,1000}$'),
  icon_url    text check (icon_url is null or icon_url ~ '^https://[^\s<>"]{1,500}$'),
  note        text check (note is null or length(note) <= 500),
  added_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (project_id, drive_id)
);
create index if not exists project_drive_files_project_idx on public.project_drive_files (project_id, created_at desc);
alter table public.project_drive_files enable row level security;

create policy project_drive_files_select on public.project_drive_files for select to authenticated
  using ((select public.is_active_member()));
create policy project_drive_files_insert on public.project_drive_files for insert to authenticated
  with check ((select public.is_active_member()) and added_by = (select auth.uid()));
create policy project_drive_files_update on public.project_drive_files for update to authenticated
  using ((select public.is_admin()) or added_by = (select auth.uid()))
  with check ((select public.is_admin()) or added_by = (select auth.uid()));
create policy project_drive_files_delete on public.project_drive_files for delete to authenticated
  using ((select public.is_admin()) or added_by = (select auth.uid()));

grant select, insert, update, delete on public.project_drive_files to authenticated;
