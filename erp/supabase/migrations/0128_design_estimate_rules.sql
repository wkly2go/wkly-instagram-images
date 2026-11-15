-- 0128 프로젝트별 견적 규칙: 합계 방식(공과잡비+기업이윤 / 대행 수수료) · 요율 · 절삭 단위를 프로젝트마다 정한다.
-- 실제 견적서 기준 — 공사형(유니셈 본사 내역서: 공과잡비 · 이윤) / 행사 · 렌탈형(나름대로 팝업 2026-10-27: Agency fee 10% 후 절삭)
-- 비워 두면 회사 공통 규칙(design.rules 'estimate')을 따른다. 기존 표는 바꾸지 않는다(설계 구역만). 보기는 끝에 열만 덧붙인다.
begin;
alter table design.projects add column estimate_rules jsonb not null default '{}';
create or replace view public.design_projects with (security_invoker = true) as select * from design.projects;
create or replace view design.project_info with (security_invoker = true) as
  select p.id, pp.code, pp.name, pp.location as address, c.name as client_name,
         p.space_type, p.area_m2, p.budget,
         coalesce(p.work_start, pp.start_date) as start_date, pp.end_date,
         p.stage, p.model_version, p.share_consent, pp.status, pp.division, pp.drive_url, p.created_at, p.estimate_rules
  from design.projects p
  join public.projects pp on pp.id = p.id
  left join public.clients c on c.id = pp.client_id;
create or replace view public.design_project_info with (security_invoker = true) as select * from design.project_info;
notify pgrst, 'reload schema';
commit;
