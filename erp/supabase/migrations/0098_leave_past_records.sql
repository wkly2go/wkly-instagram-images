-- 지난 연차 · 휴가도 '완료'로 기록 (대표 지시 2026-11-09 "연차 휴가 기록 이전 기록도 완료로 기록할 수 있게")
--   끝난 날짜(종료일 < 오늘)의 휴가는 본인이 바로 승인(완료) 상태로 넣을 수 있음 · 앞으로의 휴가는 지금처럼 전날까지 신청 → 관리자 승인
--   본인이 넣은 지난 기록은 본인이 지울 수 있음 (잘못 넣었을 때)
drop policy if exists leave_records_insert on public.leave_records;
create policy leave_records_insert on public.leave_records for insert to authenticated
  with check (
    public.is_admin()
    or (
      profile_id = (select auth.uid()) and public.is_active_member()
      and (status = '신청' or (status = '승인' and end_date < (now() at time zone 'Asia/Seoul')::date))
    )
  );

drop policy if exists leave_records_delete on public.leave_records;
create policy leave_records_delete on public.leave_records for delete to authenticated
  using (
    public.is_admin()
    or (profile_id = (select auth.uid()) and status = '신청')
    or (profile_id = (select auth.uid()) and created_by = (select auth.uid()) and end_date < (now() at time zone 'Asia/Seoul')::date)
  );

create or replace function private.require_prior_day()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_day date;
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'work_plans' then
    if new.kind = '외근' then return new; end if;
    v_day := new.day;
    if tg_op = 'UPDATE' and new.day = old.day then return new; end if;
    if v_day <= v_today then
      raise exception '재택 · 현장 직출은 전날까지 신청해야 인정됩니다. (% 신청은 %까지) 외근은 언제든 신청할 수 있습니다.', to_char(v_day, 'MM-DD'), to_char(v_day - 1, 'MM-DD');
    end if;
  else
    if new.kind in ('병가', '경조사') then return new; end if;
    -- 이미 지난 휴가 기록은 날짜 제한 없음 (2026-11-09)
    if new.end_date < v_today then return new; end if;
    v_day := new.start_date;
    if tg_op = 'UPDATE' and new.start_date = old.start_date then return new; end if;
    if v_day <= v_today then
      raise exception '연차 · 반차는 전날까지 신청해야 인정됩니다. 갑작스러운 일은 병가 · 경조사로 신청하거나 관리자에게 요청해 주세요.';
    end if;
  end if;
  return new;
end $function$;
