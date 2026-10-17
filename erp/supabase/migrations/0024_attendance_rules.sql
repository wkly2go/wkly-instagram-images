-- WKLY ERP 0024: 근태 규칙 — 출근 기준 시각 · 지각 · 신청 마감 · 미출근 알림 · 현장 일정 → 외근 신청 자동 생성 · 월간 근태 리포트
--   설정(app_settings): work_start '10:00', plan_deadline '18:00' (관리자가 팀 › 근태에서 변경)

insert into public.app_settings (key, value) values ('work_start', '"10:00"'::jsonb), ('plan_deadline', '"18:00"'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_app_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if p_key not in ('attendance_desktop_only', 'work_start', 'plan_deadline') then
    raise exception '알 수 없는 설정입니다.' using errcode = '22023';
  end if;
  if p_key in ('work_start', 'plan_deadline') and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '시각은 HH:MM 형식이어야 합니다.' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function private.setting_time(p_key text, p_default text)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::time from public.app_settings where key = p_key), p_default::time)
$$;

-- 1. 신청 마감: 전날 마감 시각 이후 신청은 늦은 신청(late)으로 표시 · 현장 업무에서 자동으로 만든 신청 구분
alter table public.work_plans add column if not exists late boolean not null default false;
alter table public.work_plans add column if not exists task_id uuid references public.tasks (id) on delete cascade;

create or replace function private.work_plan_late()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.late := (now() at time zone 'Asia/Seoul') > ((new.day - 1) + private.setting_time('plan_deadline', '18:00'));
  return new;
end;
$$;
drop trigger if exists work_plans_late on public.work_plans;
create trigger work_plans_late before insert on public.work_plans for each row execute function private.work_plan_late();

-- 현장 일정에서 자동으로 만든 신청은 관리자 알림 생략 (근태 탭 목록에서 한꺼번에 승인)
create or replace function private.work_plan_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_name text := (select name from public.profiles where id = new.user_id);
begin
  if new.task_id is not null then
    return null;
  end if;
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.id <> new.user_id loop
    perform public.notify(r.id, '승인', '근무 신청 · ' || coalesce(v_name, '') || ' ' || new.kind || ' ' || to_char(new.day, 'MM-DD') || case when new.late then ' (늦은 신청)' else '' end, coalesce(new.place, '') || case when new.reason is not null then ' · ' || new.reason else '' end, '/team?tab=attendance');
  end loop;
  return null;
end;
$$;

-- 2. 현장 일정(시공 · 설치 · 철수 · 현장 · 감리 · 반입 · 반출 / 단계 시공 · 운영)이 있는 업무 → 담당자의 그날 '현장 직출' 신청 자동 생성 (평일, 최대 14일)
create or replace function private.task_field_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
  v_from date := coalesce(new.start_date, new.due_date);
  v_to date := coalesce(new.due_date, new.start_date);
  v_place text;
begin
  if new.assignee_id is null or v_from is null or new.status = '완료' then
    return null;
  end if;
  if not (coalesce(new.phase, '') in ('시공', '운영') or new.title ~ '(현장|설치|철수|시공|감리|반입|반출)') then
    return null;
  end if;
  if exists (select 1 from public.profiles where id = new.assignee_id and is_agent) then
    return null;
  end if;
  if v_to - v_from > 13 then
    v_to := v_from + 13;
  end if;
  v_place := (select name from public.projects where id = new.project_id);
  for d in select generate_series(greatest(v_from, (now() at time zone 'Asia/Seoul')::date), v_to, interval '1 day')::date loop
    if extract(isodow from d) <= 5 then
      insert into public.work_plans (user_id, day, kind, place, reason, task_id)
      values (new.assignee_id, d, '현장 직출', left(coalesce(v_place, '현장'), 100), '[현장 일정 자동] ' || left(new.title, 150), new.id)
      on conflict (user_id, day) do nothing;
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists tasks_field_plans on public.tasks;
create trigger tasks_field_plans after insert or update of start_date, due_date, assignee_id, title, phase, status on public.tasks
  for each row execute function private.task_field_plans();

-- 3. 미출근 알림: 평일 출근 기준 + 30분이 지나도 출근 기록이 없으면 본인 · 관리자에게 알림 (하루 한 번)
create or replace function public.attendance_absent_alert()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Seoul';
  v_day date := v_now::date;
  v_names text := '';
  v_count integer := 0;
  r record;
begin
  if extract(isodow from v_day) > 5 or v_now::time < private.setting_time('work_start', '10:00') + interval '30 minutes' then
    return 0;
  end if;
  if exists (select 1 from public.app_settings where key = 'absent_alert_day' and value #>> '{}' = v_day::text) then
    return 0;
  end if;
  insert into public.app_settings (key, value) values ('absent_alert_day', to_jsonb(v_day::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  for r in
    select p.id, p.name from public.profiles p
    where p.active and not p.is_agent
      and not exists (select 1 from public.attendance a where a.user_id = p.id and a.day = v_day)
      and not exists (select 1 from public.leave_records l where l.profile_id = p.id and l.status = '승인' and v_day between l.start_date and l.end_date)
  loop
    perform public.notify(r.id, '알람', '출근 기록이 없습니다', '출근 기준 ' || to_char(private.setting_time('work_start', '10:00'), 'HH24:MI') || ' · PC 프로그램을 켜거나 휴대폰으로 출근 체크해 주세요', '/');
    v_names := v_names || case when v_count > 0 then ', ' else '' end || r.name;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
      perform public.notify(r.id, '알람', '미출근 ' || v_count || '명', left(v_names, 300), '/team?tab=attendance');
    end loop;
  end if;
  return v_count;
end;
$$;
revoke execute on function public.attendance_absent_alert() from public, anon, authenticated;

-- 4. 월간 근태 요약 (관리자 화면 · 매월 1일 리포트 공용)
create or replace function public.attendance_month_summary(p_month date)
returns table (user_id uuid, name text, work_days integer, late_days integer, mobile_days integer, field_days integer, pending integer, leave_days numeric, absent_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, (now() at time zone 'Asia/Seoul')::date);
  v_start time := private.setting_time('work_start', '10:00');
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;
  return query
  select p.id, p.name,
    (select count(*)::int from public.attendance a where a.user_id = p.id and a.day between v_from and v_to),
    (select count(*)::int from public.attendance a where a.user_id = p.id and a.day between v_from and v_to
       and (a.first_at at time zone 'Asia/Seoul')::time > v_start
       and not exists (select 1 from public.work_plans w where w.user_id = p.id and w.day = a.day and w.status = '승인')),
    (select count(*)::int from public.attendance_checkins c where c.user_id = p.id and c.day between v_from and v_to),
    (select count(*)::int from public.work_plans w where w.user_id = p.id and w.day between v_from and v_to and w.status = '승인'),
    (select count(*)::int from public.attendance_checkins c where c.user_id = p.id and c.day between v_from and v_to and c.status = '대기'),
    (select coalesce(sum(l.days), 0) from public.leave_records l where l.profile_id = p.id and l.status = '승인' and l.start_date <= v_to and l.end_date >= v_from),
    (select count(*)::int from generate_series(greatest(v_from, coalesce((select min(a0.day) from public.attendance a0), v_from)), v_to, interval '1 day') g(d)
       where extract(isodow from g.d) <= 5
         and not exists (select 1 from public.attendance a where a.user_id = p.id and a.day = g.d::date)
         and not exists (select 1 from public.leave_records l where l.profile_id = p.id and l.status = '승인' and g.d::date between l.start_date and l.end_date))
  from public.profiles p
  where p.active and not p.is_agent
  order by p.name;
end;
$$;
revoke execute on function public.attendance_month_summary(date) from public, anon;
grant execute on function public.attendance_month_summary(date) to authenticated;

-- 5. 매월 1일 지난달 근태 리포트 → 관리자 알림
create or replace function public.attendance_monthly_report()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::date;
  v_body text;
  r record;
begin
  select string_agg(s.name || ' 출근 ' || s.work_days || ' · 지각 ' || s.late_days || ' · 외근/재택 ' || s.field_days || ' · 미출근 ' || s.absent_days || ' · 휴가 ' || s.leave_days, E'\n')
    into v_body from public.attendance_month_summary(v_month) s;
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
    perform public.notify(r.id, '일일 보고', '📋 ' || to_char(v_month, 'YYYY년 MM월') || ' 근태 리포트', left(coalesce(v_body, '기록 없음'), 1000), '/team?tab=attendance&month=' || to_char(v_month, 'YYYY-MM'));
  end loop;
end;
$$;
revoke execute on function public.attendance_monthly_report() from public, anon, authenticated;

-- 예약 실행 (UTC): 미출근 알림은 10분마다 확인(실제 알림은 하루 한 번), 월간 리포트는 매월 1일 09:05 KST
select cron.schedule('wkly_absent_alert', '*/10 * * * *', 'select public.attendance_absent_alert()');
select cron.schedule('wkly_attendance_monthly', '5 0 1 * *', 'select public.attendance_monthly_report()');
