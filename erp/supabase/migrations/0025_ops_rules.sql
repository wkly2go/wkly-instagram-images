-- WKLY ERP 0025: 운영 규칙
--   1) 담당자 없이 '진행'으로 바꿀 수 없음  2) 업무 쏠림 경고(남은 할 일 15건 초과)
--   3) 수금 · 지급 기한 지남 알림(매일 09:10)  4) 업무 일지 리마인드(평일 18:00)
--   5) 읽은 알림 30일 뒤 삭제 · 휴대폰 출근 위치 90일 뒤 삭제(매일 03:00)

-- 1. 프로젝트 담당자 필수 (진행으로 바꾸는 순간에만 검사, 기존 행은 그대로)
create or replace function private.project_owner_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = '진행' and new.owner_id is null and (tg_op = 'INSERT' or old.status is distinct from '진행') then
    raise exception '담당자를 지정해야 진행으로 바꿀 수 있습니다.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists projects_owner_guard on public.projects;
create trigger projects_owner_guard before insert or update of status, owner_id on public.projects
  for each row execute function private.project_owner_guard();

-- 2. 업무 쏠림 경고: 담당자의 남은 할 일이 15건을 넘으면 관리자에게 하루 한 번 알림
create or replace function private.task_overload_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open integer;
  v_name text;
  r record;
begin
  if new.assignee_id is null or new.status = '완료' then
    return null;
  end if;
  select count(*) into v_open from public.tasks where assignee_id = new.assignee_id and status <> '완료';
  if v_open <= 15 then
    return null;
  end if;
  v_name := (select name from public.profiles where id = new.assignee_id);
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
    if not exists (select 1 from public.notifications n where n.user_id = r.id and n.title like '업무 쏠림 · ' || v_name || '%' and n.created_at > now() - interval '20 hours') then
      perform public.notify(r.id, '알람', '업무 쏠림 · ' || v_name || ' 남은 할 일 ' || v_open || '건', '업무를 나누거나 마감을 조정해 주세요', '/team');
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists tasks_overload_notify on public.tasks;
create trigger tasks_overload_notify after insert or update of assignee_id on public.tasks
  for each row execute function private.task_overload_notify();

-- 3. 수금 · 지급 기한 지남 알림 (금액은 쓰지 않음)
create or replace function public.payments_overdue_alert()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_in integer;
  v_out integer;
  v_list text;
  r record;
begin
  if extract(isodow from v_day) > 5 then
    return;
  end if;
  select count(*) into v_in from public.payments where direction = '수금' and status <> '완료' and due_date < v_day;
  select count(*) into v_out from public.payments where direction = '지급' and status in ('대기', '예정') and due_date < v_day;
  if v_in + v_out = 0 then
    return;
  end if;
  select string_agg(coalesce(p.payee, p.title, '') || ' (' || to_char(p.due_date, 'MM-DD') || ')', ', ') into v_list
    from (select * from public.payments where status <> '완료' and due_date < v_day and (direction = '수금' or status in ('대기', '예정')) order by due_date limit 8) p;
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
    perform public.notify(r.id, '결제', '기한 지난 결제 · 받을 돈 ' || v_in || '건 · 줄 돈 ' || v_out || '건', left(coalesce(v_list, ''), 300), '/payments');
  end loop;
end;
$$;
revoke execute on function public.payments_overdue_alert() from public, anon, authenticated;

-- 4. 업무 일지 리마인드: 평일 18:00, 오늘 출근했는데 일지가 없는 사람
create or replace function public.worklog_reminder()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  r record;
begin
  if extract(isodow from v_day) > 5 then
    return;
  end if;
  for r in
    select p.id from public.profiles p
    where p.active and not p.is_agent
      and exists (select 1 from public.attendance a where a.user_id = p.id and a.day = v_day)
      and not exists (select 1 from public.work_logs w where w.user_id = p.id and w.log_date = v_day)
  loop
    perform public.notify(r.id, '알람', '오늘 업무 일지가 없습니다', '퇴근 전에 오늘 한 일을 한 줄이라도 남겨 주세요', '/work');
  end loop;
end;
$$;
revoke execute on function public.worklog_reminder() from public, anon, authenticated;

-- 5. 정리: 읽은 알림 30일, 휴대폰 출근 위치 90일
create or replace function public.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications where read_at is not null and created_at < now() - interval '30 days';
  update public.attendance_checkins set lat = null, lng = null, accuracy_m = null where day < (now() at time zone 'Asia/Seoul')::date - 90 and lat is not null;
end;
$$;
revoke execute on function public.housekeeping() from public, anon, authenticated;

-- 예약 (UTC)
select cron.schedule('wkly_payments_overdue', '10 0 * * *', 'select public.payments_overdue_alert()');
select cron.schedule('wkly_worklog_reminder', '0 9 * * 1-5', 'select public.worklog_reminder()');
select cron.schedule('wkly_housekeeping', '0 18 * * *', 'select public.housekeeping()');
