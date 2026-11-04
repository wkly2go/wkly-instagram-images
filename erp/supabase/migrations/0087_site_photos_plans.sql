-- 현장 실측: 사진 위에 바로 치수 · 도면 위에 사진 배치 (대표 지시 2026-11-04)
--   site_plans  : 프로젝트 도면 (사진처럼 site-photos 저장소에 이미지로)
--   site_photos : 현장 사진 · marks(치수 선: 0~1 좌표 + 값) · 체크리스트 항목 연결 · 도면 위 위치(plan_id · plan_x · plan_y, 0~1)
create table if not exists public.site_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default '도면',
  path text not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  memo text,
  marks jsonb not null default '[]'::jsonb,
  survey_item_id uuid references public.site_survey_items(id) on delete set null,
  plan_id uuid references public.site_plans(id) on delete set null,
  plan_x real,
  plan_y real,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_photos_project_idx on public.site_photos (project_id, created_at desc);
create index if not exists site_plans_project_idx on public.site_plans (project_id, created_at desc);
alter table public.site_plans enable row level security;
alter table public.site_photos enable row level security;
create policy site_plans_all on public.site_plans for all to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy site_photos_all on public.site_photos for all to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
