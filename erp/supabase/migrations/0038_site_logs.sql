-- 0038 · 인테리어 현장 작업일지 (대표 지시 2026-10-18, 엑셀 '작업일지' 양식을 그대로 옮김)
-- 프로젝트 · 날짜마다 한 장: 상단 정보(날씨 · 현장소장 · 담당) · 결재(현장소장 · 현장감리 · 대표)
-- 가. 용역비 지급 현황(공종별 주간 · 야간 인원 · 단가 · 협력사) · 나. 자재 반출입/인건비 지급 · 금일/익일 공정 · 사진
-- 개인정보 보호: 주민번호 · 계좌번호는 여기 적지 않음 (지급은 결제 대장에서 관리)
create table if not exists public.site_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  log_date date not null,
  weather text,
  site_manager text,
  staff text,
  labor jsonb not null default '[]'::jsonb,
  materials jsonb not null default '[]'::jsonb,
  today_work text,
  next_work text,
  photos jsonb not null default '[]'::jsonb,
  signs jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, log_date)
);
create index if not exists site_logs_project_idx on public.site_logs (project_id, log_date desc);

alter table public.site_logs enable row level security;
create policy site_logs_select on public.site_logs for select to authenticated using ((select public.is_active_member()));
create policy site_logs_insert on public.site_logs for insert to authenticated with check ((select public.is_active_member()) and created_by = (select auth.uid()));
-- 결재 칸은 현장소장 · 감리 · 대표가 각자 눌러야 하므로 고치기는 구성원 모두, 지우기는 쓴 사람 · 관리자만
create policy site_logs_update on public.site_logs for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy site_logs_delete on public.site_logs for delete to authenticated using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
grant select, insert, update, delete on public.site_logs to authenticated;
