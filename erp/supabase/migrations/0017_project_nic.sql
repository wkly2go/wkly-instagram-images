-- WKLY ERP 0017: 프로젝트 상태에 'NIC'(Not In Contract · 계약 전) 추가
--   기획 · 진행 · NIC · 완료 · 보류
--   NIC 프로젝트는 계약 전이라 매출 · 계약 합계에서 빠짐 (화면 계산)
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('기획', '진행', 'NIC', '완료', '보류'));
comment on column public.projects.status is '상태: 기획 · 진행 · NIC(Not In Contract, 계약 전) · 완료 · 보류';
