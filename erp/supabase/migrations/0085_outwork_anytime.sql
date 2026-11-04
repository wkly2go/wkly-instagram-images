-- 외근 신청은 어느 때나 (대표 지시 2026-11-04 "외근 신청 결제는 어느 때나 가능하게")
--   외근: 당일 · 지난 날짜도 신청 가능 (대표 승인은 그대로 필요)
--   재택 · 현장 직출 · 연차 · 반차: 기존처럼 전날까지 (관리자 예외)
create or replace function private.require_prior_day() returns trigger
language plpgsql security definer set search_path = '' as $$
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
    v_day := new.start_date;
    if tg_op = 'UPDATE' and new.start_date = old.start_date then return new; end if;
    if v_day <= v_today then
      raise exception '연차 · 반차는 전날까지 신청해야 인정됩니다. 갑작스러운 일은 병가 · 경조사로 신청하거나 관리자에게 요청해 주세요.';
    end if;
  end if;
  return new;
end $$;

-- 지난 날짜 외근도 나중에 신청 가능 (최근 31일 안) · 그 밖의 구분은 오늘 이후만
drop policy if exists work_plans_insert on public.work_plans;
create policy work_plans_insert on public.work_plans for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = '대기'
    and (day >= ((now() at time zone 'Asia/Seoul'))::date
         or (kind = '외근' and day >= ((now() at time zone 'Asia/Seoul'))::date - 31))
  );

-- 외근은 '늦은 신청' 표시 안 함
create or replace function private.work_plan_late() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.late := new.kind <> '외근' and (now() at time zone 'Asia/Seoul') > ((new.day - 1) + private.setting_time('plan_deadline', '18:00'));
  return new;
end $$;
