-- 보안 보강 (2026-11-17): 로그인만 하면 누구나(비활성 계정 포함) 읽을 수 있던 표 3개를 활성 팀원만 읽게.
-- 2026-10-17 에 DB 에서 직접 만든 정책(using true)이라 저장소 마이그레이션에 없던 것.
drop policy if exists meeting_minutes_read on public.meeting_minutes;
create policy meeting_minutes_read on public.meeting_minutes for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists agent_roster_read on public.agent_roster;
create policy agent_roster_read on public.agent_roster for select to authenticated
  using ((select public.is_active_member()));

-- 메일 → 프로젝트 맞추기 함수: 로그인 안 한 사람(anon)이 프로젝트 이름을 떠볼 수 없게
revoke execute on function public.match_projects(text) from public, anon;
revoke execute on function public.match_projects_loose(text) from public, anon;
