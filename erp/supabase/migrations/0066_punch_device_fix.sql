-- 0066 출근 확인 막힘 수정 (2026-10-29)
--   원인: 회사 인터넷 + PC 프로그램이어도 '처음 등록된 회사 PC'가 아니면 거절 (대표 Mac 이 등록 PC 와 달라 막힘)
--   - 관리자: PC 확인 생략, 쓰는 PC 를 자동으로 추가 등록
--   - 팀원: 이유를 구체적으로 안내 (PC 프로그램 아님 / 사무실 인터넷 아님 / 등록 안 된 PC)

create or replace function private.office_reason(p_uid uuid, p_source text, p_device text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_desktop_only boolean;
  v_admin boolean := exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'admin');
begin
  select coalesce((s.value)::text = 'true', false) into v_desktop_only from public.app_settings s where s.key = 'attendance_desktop_only';
  if coalesce(v_desktop_only, false) and p_source <> 'desktop' then
    return '출근은 회사 PC 의 인트라넷 프로그램에서 확인해 주세요. (브라우저 · 휴대폰은 출근 확인이 안 됩니다)';
  end if;
  if not private.is_office_ip(private.request_ip()) then
    return '사무실 인터넷이 아닙니다. 회사에 와서 확인하거나, 외근 · 재택은 전날까지 신청 · 승인을 받아 주세요.';
  end if;
  if p_source = 'desktop' and p_device is not null and char_length(p_device) between 8 and 80 then
    if not exists (select 1 from public.attendance_devices d where d.user_id = p_uid) or v_admin then
      insert into public.attendance_devices (user_id, device_id, label)
      values (p_uid, p_device, case when v_admin then '관리자 PC (자동 등록)' else '처음 출근한 회사 PC' end)
      on conflict do nothing;
    elsif not exists (select 1 from public.attendance_devices d where d.user_id = p_uid and d.device_id = p_device) then
      return '등록된 회사 PC 가 아닙니다. PC 를 바꿨다면 관리자에게 회사 PC 등록 초기화를 요청해 주세요.';
    end if;
  end if;
  return null;
end $$;

create or replace function private.office_ok(p_uid uuid, p_source text, p_device text) returns boolean
language sql security definer set search_path = '' as $$
  select private.office_reason(p_uid, p_source, p_device) is null
$$;

create or replace function public.attendance_punch(p_kind text, p_source text default 'web', p_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_plan public.work_plans;
  v_row public.attendance;
  v_why text;
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
    v_why := private.office_reason(v_uid, p_source, p_device);
    if v_why is not null then raise exception '%', v_why; end if;
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
