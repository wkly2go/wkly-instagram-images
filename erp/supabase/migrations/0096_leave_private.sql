-- 개인의 공간은 다른 사람이 볼 수 없게 (대표 지시 2026-11-06)
--   휴가 기록(종류 · 사유 · 일수 · 상태)은 본인과 관리자만. 팀 달력에는 '누가 언제 쉬는지'만 (승인된 휴가 · 반차 여부)
drop policy if exists leave_records_select on public.leave_records;
create policy leave_records_select on public.leave_records for select to authenticated
  using (((profile_id = (select auth.uid())) and (select public.is_active_member())) or (select public.is_admin()));

create or replace function public.team_leave_days(p_from date default (now() at time zone 'Asia/Seoul')::date - 62)
returns table (id uuid, profile_id uuid, start_date date, end_date date, half boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.profile_id, l.start_date, l.end_date, l.kind = '반차'
  from public.leave_records l
  where public.is_active_member() and l.status = '승인' and l.end_date >= p_from
$$;
revoke all on function public.team_leave_days(date) from public, anon;
grant execute on function public.team_leave_days(date) to authenticated;
