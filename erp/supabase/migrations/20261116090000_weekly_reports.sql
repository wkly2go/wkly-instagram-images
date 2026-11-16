-- 주간 보고 (대표 지시 2026-11-16 "업무 근태탭에 주간 보고를 만들고 주간 활동 내용을 취합해")
--  - 한 사람 · 한 주(월요일 날짜)에 한 건. 활동 내용은 업무 일지(work_logs)에서 그때그때 취합하고, 여기엔 총평 · 다음 주 계획 · 제출 시각만
--  - 빠진 부분 보완은 work_logs 에 바로 들어가므로 일간 업무에 자동 연동됨
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start date not null,
  summary text check (summary is null or char_length(summary) <= 4000),
  next_plan text check (next_plan is null or char_length(next_plan) <= 4000),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start),
  check (extract(isodow from week_start) = 1)
);
create index if not exists weekly_reports_week_idx on public.weekly_reports (week_start desc);
alter table public.weekly_reports enable row level security;
create policy weekly_reports_select on public.weekly_reports for select to authenticated using ((select public.is_active_member()));
create policy weekly_reports_insert on public.weekly_reports for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy weekly_reports_update on public.weekly_reports for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy weekly_reports_delete on public.weekly_reports for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
grant select, insert, update, delete on public.weekly_reports to authenticated;
revoke all on public.weekly_reports from anon;
