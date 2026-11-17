-- 보안 점검 · 보강 (2026-11-17 대표 지시 '보안 설정 점검하고 개선해')
-- 화면 동작은 그대로. 비활성 계정(퇴사자 등) · 로그인 안 한 사람이 볼 수 있던 틈만 닫는다.

-- 1) 로그인만 하면 누구나 읽던 표 3개 → 활성 팀원만 (2026-10-17 DB 에서 직접 만든 using true 정책)
drop policy if exists meeting_minutes_read on public.meeting_minutes;
create policy meeting_minutes_read on public.meeting_minutes for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists agent_roster_read on public.agent_roster;
create policy agent_roster_read on public.agent_roster for select to authenticated
  using ((select public.is_active_member()));

-- 2) 로그인 안 한 사람(anon)이 부를 수 있던 함수 정리
--    메일 → 프로젝트 맞추기: 프로젝트 이름을 떠볼 수 없게 (메일 색인 트리거 안에서만 씀)
revoke execute on function public.match_projects(text) from public, anon;
revoke execute on function public.match_projects_loose(text) from public, anon;
--    AI 지시 목록: 토큰 확인이 없어 누구나 읽을 수 있었음. 토큰을 확인하는 agent_ad_team_context 안에서만 씀
revoke execute on function public.agent_directives_for(text, text) from public, anon, authenticated;

-- 3) 예전 현장 실측 페이지(AR2610-11-1103 · 로그인 없이 씀): 사진 보관함 읽기 · 고치기를 그 프로젝트 폴더로만
drop policy if exists fs_obj_select on storage.objects;
create policy fs_obj_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103');
drop policy if exists fs_obj_update on storage.objects;
create policy fs_obj_update on storage.objects for update to anon, authenticated
  using (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103')
  with check (bucket_id = 'field-survey' and (storage.foldername(name))[1] = 'AR2610-11-1103');

-- 4) 로그인 안 한 사람(anon)에게 남아 있던 표 권한 회수 (RLS 가 이미 막지만 이중 잠금)
--    로그인 없이 쓰는 현장 실측 표(field_survey)만 남긴다.
do $$
declare r record;
begin
  for r in
    select table_schema, table_name from information_schema.role_table_grants
    where grantee = 'anon' and table_schema in ('public', 'design') and table_name <> 'field_survey'
    group by table_schema, table_name
  loop
    execute format('revoke all on table %I.%I from anon', r.table_schema, r.table_name);
  end loop;
end $$;

-- 5) 검색 경로가 고정되지 않은 함수 3개 고정 (표를 쓰지 않는 계산 함수)
alter function public.utmk_to_wgs84(double precision, double precision) set search_path = '';
alter function public.wkly_region_of(text) set search_path = '';
alter function public.congest_areas() set search_path = '';
