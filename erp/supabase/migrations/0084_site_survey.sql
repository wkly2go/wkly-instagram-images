-- 현장 실측 체크리스트 (대표 지시 2026-11-04 "현장 실측 체크리스트를 프로젝트 항목에 넣어")
--   포켓몬화석박물관 실측기록지(38항목)를 표준으로: 구분 · 점검 항목 · 근거 · 우선순위 · 가로/세로/높이(mm) · 위치 메모 · 사진 번호 · 확인자 · 상태
create table if not exists public.site_survey_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  no int not null default 0,
  category text not null default '',
  item text not null,
  basis text,
  priority text not null default '중' check (priority in ('상', '중', '하')),
  width_mm numeric,
  depth_mm numeric,
  height_mm numeric,
  memo text,
  photo_no text,
  checker text,
  status text not null default '미확인' check (status in ('미확인', '확인', '추가확인', '해당없음')),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_survey_items_project_idx on public.site_survey_items (project_id, no);
alter table public.site_survey_items enable row level security;
create policy site_survey_select on public.site_survey_items for select to authenticated using ((select public.is_active_member()));
create policy site_survey_insert on public.site_survey_items for insert to authenticated with check ((select public.is_active_member()));
create policy site_survey_update on public.site_survey_items for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy site_survey_delete on public.site_survey_items for delete to authenticated using ((select public.is_active_member()));
