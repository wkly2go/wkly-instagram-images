-- 0065 근태 규칙 (대표 지시 2026-10-28)
--   1) "모든 근태는 출근 또는 퇴근 등을 선택 후 확인 버튼을 눌러야 출근 기록 인정"
--      → 접속만으로는 출근이 잡히지 않음 (접속 기록만 남김). attendance_punch(종류) 를 눌러야 출근 · 퇴근 인정
--      → 출근은 지금처럼 회사(사무실 IP · 등록 PC)에서만, 외근 · 재택은 승인된 신청이 있는 날에만
--   2) "외근이나 연차 등은 전일 승인 요청을 해야 인정" → 외근 · 재택 · 현장 직출 · 연차 · 반차는 전날까지 신청 (관리자 예외)
--      병가 · 경조사는 미리 알 수 없어 당일 신청 허용
--   3) 승인된 외근 · 재택도 그날 '확인'을 눌러야 근태 인정 (자동 기록 중단)

alter table public.attendance add column if not exists checkin_at timestamptz;
alter table public.attendance add column if not exists checkout_at timestamptz;
alter table public.attendance add column if not exists kind text check (kind is null or kind in ('출근', '외근', '재택', '현장 직출'));

-- 회사에서 접속했는지 (예전 touch_attendance_v3 의 출근 조건 그대로)
create or replace function private.office_ok(p_uid uuid, p_source text, p_device text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := private.request_ip();
  v_desktop_only boolean;
  v_ok boolean := true;
begin
  select coalesce((s.value)::text = 'true', false) into v_desktop_only from public.app_settings s where s.key = 'attendance_desktop_only';
  if not (p_source = 'desktop' or not coalesce(v_desktop_only, false)) then return false; end if;
  if not private.is_office_ip(v_ip) then return false; end if;
  if p_source = 'desktop' and p_device is not null and char_length(p_device) between 8 and 80 then
    if exists (select 1 from public.attendance_devices d where d.user_id = p_uid) then
      v_ok := exists (select 1 from public.attendance_devices d where d.user_id = p_uid and d.device_id = p_device);
    else
      insert into public.attendance_devices (user_id, device_id, label) values (p_uid, p_device, '처음 출근한 회사 PC') on conflict do nothing;
    end if;
  end if;
  return v_ok;
end $$;

-- 접속 기록만 (자동 출근 중단)
create or replace function public.touch_attendance_v3(p_source text, p_device text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_ip text := private.request_ip();
begin
  if v_uid is null or not public.is_active_member() then return; end if;
  if p_source not in ('desktop', 'web', 'mobile') then
    raise exception '알 수 없는 접속 경로입니다.' using errcode = '22023';
  end if;
  insert into public.access_log (user_id, day, source, ip) values (v_uid, v_day, p_source, v_ip)
  on conflict (user_id, day, source) do update set last_at = now(), ip = coalesce(excluded.ip, public.access_log.ip)
    where public.access_log.last_at < now() - interval '1 minute';
  -- 이미 출근 확인한 날은 마지막 접속 시각만 갱신
  update public.attendance a set last_at = now()
   where a.user_id = v_uid and a.day = v_day and a.checkin_at is not null and a.checkout_at is null
     and a.last_at < now() - interval '1 minute';
end $$;

-- 출근 · 외근 · 재택 · 현장 직출 · 퇴근 '확인'
create or replace function public.attendance_punch(p_kind text, p_source text default 'web', p_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_plan public.work_plans;
  v_row public.attendance;
begin
  if v_uid is null or not public.is_active_member() then raise exception '로그인이 필요합니다.'; end if;
  if p_kind not in ('출근', '외근', '재택', '현장 직출', '퇴근') then raise exception '출근 · 외근 · 재택 · 현장 직출 · 퇴근 중에서 골라 주세요.'; end if;

  if p_kind = '퇴근' then
    update public.attendance set checkout_at = now(), last_at = now()
     where user_id = v_uid and day = v_day and checkin_at is not null
    returning * into v_row;
    if v_row.user_id is null then raise exception '오늘 출근 확인 기록이 없습니다. 먼저 출근을 확인해 주세요.'; end if;
    update public.profiles set today_status = '퇴근', status_updated_at = now() where id = v_uid;
    return jsonb_build_object('kind', '퇴근', 'at', v_row.checkout_at);
  end if;

  if p_kind = '출근' then
    if not private.office_ok(v_uid, p_source, p_device) then
      raise exception '출근은 회사(사무실 인터넷 · 등록된 회사 PC)에서만 확인됩니다. 외근 · 재택은 전날까지 신청 · 승인이 필요합니다.';
    end if;
  else
    select * into v_plan from public.work_plans where user_id = v_uid and day = v_day and status = '승인' and kind = p_kind;
    if v_plan.id is null then
      raise exception '오늘 승인된 % 신청이 없습니다. 외근 · 재택은 전날까지 신청하고 승인받아야 인정됩니다.', p_kind;
    end if;
  end if;

  insert into public.attendance (user_id, day, first_at, last_at, checkin_at, kind, ip)
  values (v_uid, v_day, now(), now(), now(), p_kind, private.request_ip())
  on conflict (user_id, day) do update
    set checkin_at = coalesce(public.attendance.checkin_at, now()),
        first_at = case when public.attendance.checkin_at is null then now() else public.attendance.first_at end,
        kind = coalesce(public.attendance.kind, excluded.kind),
        checkout_at = null,
        last_at = now()
  returning * into v_row;
  update public.profiles set today_status = case p_kind when '현장 직출' then '외근' else p_kind end, status_updated_at = now() where id = v_uid;
  return jsonb_build_object('kind', v_row.kind, 'at', v_row.checkin_at);
end $$;
grant execute on function public.attendance_punch(text, text, text) to authenticated;

-- 승인된 외근 · 재택: 근태 자동 기록 중단 (그날 휴대폰 '출근 체크' 또는 '확인'을 눌러야 인정)
create or replace function private.apply_work_plan(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  return; -- 예전: 승인 시 그날 근태 자동 기록. 이제는 본인이 확인해야 인정
end $$;

-- 휴대폰 출근 체크 (외근 · 재택): 누르는 것이 곧 확인 → 출근 시각 · 구분 기록
create or replace function public.mobile_check_in(p_kind text, p_note text default null, p_lat double precision default null, p_lng double precision default null, p_accuracy integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_plan public.work_plans;
begin
  if v_uid is null or not public.is_active_member() then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if exists (select 1 from public.attendance where user_id = v_uid and day = v_day and checkin_at is not null) then
    return jsonb_build_object('ok', true, 'status', '승인', 'already', true);
  end if;
  select * into v_plan from public.work_plans where user_id = v_uid and day = v_day and status = '승인';
  if v_plan.id is null then
    raise exception '오늘 승인된 외근 · 재택 신청이 없습니다. 외근 · 재택은 전날까지 신청 · 승인이 필요합니다.' using errcode = 'P0001', hint = 'need_plan';
  end if;
  insert into public.attendance_checkins (user_id, day, kind, plan_id, status, lat, lng, accuracy_m, note, decided_at)
  values (v_uid, v_day, v_plan.kind, v_plan.id, '승인', p_lat, p_lng, p_accuracy, left(p_note, 300), now())
  on conflict do nothing;
  insert into public.attendance (user_id, day, first_at, last_at, checkin_at, kind, ip)
  values (v_uid, v_day, now(), now(), now(), v_plan.kind, private.request_ip())
  on conflict (user_id, day) do update set checkin_at = coalesce(public.attendance.checkin_at, now()), kind = coalesce(public.attendance.kind, excluded.kind), last_at = now();
  insert into public.access_log (user_id, day, source, ip) values (v_uid, v_day, 'mobile', private.request_ip())
  on conflict (user_id, day, source) do update set last_at = now();
  update public.profiles set today_status = case v_plan.kind when '재택' then '재택' else '외근' end, status_updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'status', '승인', 'already', false);
end $$;

-- 지난 기록 · 오늘 이미 잡힌 출근은 그대로 인정 (규칙은 지금부터)
update public.attendance set checkin_at = first_at where checkin_at is null;

-- 전날까지 신청 (관리자는 예외)
create or replace function private.require_prior_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_day date;
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'work_plans' then
    v_day := new.day;
    if tg_op = 'UPDATE' and new.day = old.day then return new; end if;
    if v_day <= v_today then
      raise exception '외근 · 재택 · 현장 직출은 전날까지 신청해야 인정됩니다. (% 신청은 %까지)', to_char(v_day, 'MM-DD'), to_char(v_day - 1, 'MM-DD');
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
create or replace trigger work_plans_prior_day before insert or update of day on public.work_plans for each row execute function private.require_prior_day();
create or replace trigger leave_records_prior_day before insert or update of start_date on public.leave_records for each row execute function private.require_prior_day();
