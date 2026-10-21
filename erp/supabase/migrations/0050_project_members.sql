-- 프로젝트 참여 담당자 = 우리 팀원 (대표 지시 2026-10-21 "담당자 추가는 우리 팀원 중에서만")
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index if not exists project_members_profile_idx on public.project_members (profile_id);
comment on table public.project_members is '프로젝트에 참여하는 우리 팀원 (역할 메모)';
alter table public.project_members enable row level security;
create policy project_members_all on public.project_members for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
