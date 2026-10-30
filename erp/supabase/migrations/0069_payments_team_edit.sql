-- 0069 프로젝트 현장 결제는 팀원 모두 기입 · 수정 (대표 지시 2026-10-30)
--   결제 대장(payments) · 공사 구분 예산(project_budget_lines) · 계약/목표(project_finances)
--   보기 · 추가 · 수정: 활동 중인 구성원 모두 / 지우기: 관리자만 (팀원은 '취소'로)
alter policy payments_select on public.payments using ((select public.is_active_member()));
alter policy payments_insert on public.payments with check ((select public.is_active_member()));
alter policy payments_update on public.payments using ((select public.is_active_member())) with check ((select public.is_active_member()));
alter policy project_budget_lines_insert on public.project_budget_lines with check ((select public.is_active_member()));
alter policy project_budget_lines_update on public.project_budget_lines using ((select public.is_active_member())) with check ((select public.is_active_member()));
alter policy project_finances_insert on public.project_finances with check ((select public.is_active_member()));
alter policy project_finances_update on public.project_finances using ((select public.is_active_member())) with check ((select public.is_active_member()));
