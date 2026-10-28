-- 0061 근태: 승인된 외근 · 재택 · 현장 직출은 그날 근태에 바로 반영 (2026-10-28 "외근 근무 승인하면 외근으로 잡혀야 하는데 안된 사례")
-- 예전: 승인 뒤에도 본인이 그날 휴대폰 · 노트북으로 '출근 체크'를 해야만 외근으로 잡힘 → 체크를 안 하거나 나중에 사무실에서 접속하면 일반 출근(지각)으로 잡힘
-- 지금: 승인되면(그날이 됐거나 지난 날이면) 그날 근태에 외근 · 재택 기록 + 출근 시각은 출근 기준 시각, 오늘이면 상태도 외근/재택

create or replace function private.apply_work_plan(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.work_plans;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_start time := private.setting_time('work_start', '10:00');
begin
  select * into v from public.work_plans where id = p_id;
  if v.id is null or v.status <> '승인' or v.day > v_today then
    return;
  end if;
  insert into public.attendance_checkins (user_id, day, kind, plan_id, status, note, decided_by, decided_at)
  select v.user_id, v.day, v.kind, v.id, '승인', '승인된 신청으로 자동 기록', v.decided_by, coalesce(v.decided_at, now())
  where not exists (select 1 from public.attendance_checkins c where c.user_id = v.user_id and c.day = v.day);
  update public.attendance_checkins set status = '승인', plan_id = v.id, decided_by = v.decided_by, decided_at = coalesce(v.decided_at, now())
   where user_id = v.user_id and day = v.day and status = '대기';
  insert into public.attendance (user_id, day, first_at, last_at)
  values (v.user_id, v.day, (v.day + v_start) at time zone 'Asia/Seoul', (v.day + v_start) at time zone 'Asia/Seoul')
  on conflict (user_id, day) do nothing;
  if v.day = v_today then
    update public.profiles set today_status = case v.kind when '재택' then '재택' else '외근' end, status_updated_at = now() where id = v.user_id;
  end if;
end $$;

create or replace function public.decide_work_plan(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.work_plans;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin() then
    raise exception '관리자만 승인할 수 있습니다.' using errcode = '42501';
  end if;
  if p_status not in ('승인', '반려') then
    raise exception '승인 또는 반려만 가능합니다.' using errcode = '22023';
  end if;
  update public.work_plans set status = p_status, decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
  if v.id is null then
    raise exception '신청을 찾을 수 없습니다.' using errcode = '22023';
  end if;
  if p_status = '승인' then
    perform private.apply_work_plan(v.id);
  end if;
  perform public.notify(v.user_id, '승인', v.kind || ' 신청 ' || p_status || ' · ' || to_char(v.day, 'MM-DD'),
    case when p_status = '승인' then '그날 근태에 ' || v.kind || '(으)로 기록됩니다' || coalesce(' · ' || v.place, '') else coalesce(v.place, '') end, '/team?tab=attendance');
end $$;

-- 사무실 접속이 나중에 와도 오늘 외근 · 재택 상태를 출근으로 덮어쓰지 않음
create or replace function public.attendance_check_in()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null or not public.is_active_member() then
    return;
  end if;
  insert into public.attendance (user_id, day) values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  if found then
    update public.profiles p
       set today_status = '출근'
     where p.id = v_uid
       and (p.status_updated_at is null or (p.status_updated_at at time zone 'Asia/Seoul')::date < v_day)
       and p.today_status <> '출근'
       and not exists (select 1 from public.work_plans w where w.user_id = v_uid and w.day = v_day and w.status = '승인');
  else
    update public.attendance a
       set last_at = now()
     where a.user_id = v_uid and a.day = v_day
       and a.last_at < now() - interval '1 minute';
  end if;
end $$;

-- 매일 0시 1분(한국 시간): 오늘 승인된 신청을 근태에 반영
create or replace function private.apply_today_work_plans() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.work_plans where status = '승인' and day = (now() at time zone 'Asia/Seoul')::date loop
    perform private.apply_work_plan(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('wkly_apply_work_plans', '1 15 * * *', 'select private.apply_today_work_plans()');

-- 이미 승인됐는데 반영 안 된 지난 신청 (최근 60일)
do $$ declare r record; begin
  for r in select id from public.work_plans where status = '승인' and day >= (now() at time zone 'Asia/Seoul')::date - 60 loop
    perform private.apply_work_plan(r.id);
  end loop;
end $$;
