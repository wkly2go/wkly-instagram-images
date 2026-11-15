-- 0126 설계 프로젝트 보기: 인트라넷 프로젝트(이름 · 코드 · 주소 · 거래처 · 기간) + 설계 정보(공간 종류 · 면적 · 단계 · 모델 버전)
-- 화면(public.design_project_info)과 작업 처리기(design.project_info)가 같은 모양으로 읽는다. 기존 표는 바꾸지 않는다.
begin;
create view design.project_info with (security_invoker = true) as
  select p.id, pp.code, pp.name, pp.location as address, c.name as client_name,
         p.space_type, p.area_m2, p.budget,
         coalesce(p.work_start, pp.start_date) as start_date, pp.end_date,
         p.stage, p.model_version, p.share_consent, pp.status, pp.division, pp.drive_url, p.created_at
  from design.projects p
  join public.projects pp on pp.id = p.id
  left join public.clients c on c.id = pp.client_id;
revoke all on design.project_info from public, anon;
grant select on design.project_info to authenticated, service_role, design_worker;

create view public.design_project_info with (security_invoker = true) as select * from design.project_info;
revoke all on public.design_project_info from public, anon;
grant select on public.design_project_info to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
