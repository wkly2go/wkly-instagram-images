-- 0037 · 주고받은 자료: 고치기도 올린 사람 · 관리자만 (대표 지시 2026-10-18 "자료 생성자 및 관리자는 해당 자료를 삭제 수정 할 수 있게")
-- 지우기는 이미 올린 사람 · 관리자만이라 고치기도 같은 기준으로 맞춘다. (drop/create 는 운영 DB에서 시간 초과 → alter 한 줄로)
alter policy exchange_files_update on public.exchange_files
  using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
