-- 결제 삭제를 모든 팀원이 (대표 지시 2026-11-09 "모든 사용자가 삭제할 수 있게") — 기존: 관리자만
drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments for delete to authenticated
  using ((select public.is_active_member()));
