-- WKLY ERP 0027: 출근 = 회사 인터넷(IP) + 등록된 회사 PC(PC 프로그램) / 외근 · 재택 = 승인된 날만 노트북 · 휴대폰 출근
--   app_settings.office_ips: 회사 공인 IP 목록(IP 또는 CIDR). 비어 있으면 IP 제한 없음(등록 전)
--   attendance_devices: 사람별 회사 PC (PC 프로그램이 만든 기기 ID). 처음 회사 IP에서 출근한 PC가 자동 등록, 이후 그 PC만 출근 인정
--   mobile_check_in: 그날 승인된 외근 · 재택 · 현장 직출 신청이 있어야만 가능 (없으면 거절 → 긴급 신청)

insert into public.app_settings (key, value) values ('office_ips', '[]'::jsonb) on conflict (key) do nothing;

alter table public.access_log add column if not exists ip text;
alter table public.attendance add column if not exists ip text;

create table if not exists public.attendance_devices (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 8 and 80),
  label      text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, device_id)
);
comment on table public.attendance_devices is '사람별 출근 인정 회사 PC (PC 프로그램 기기 ID)';
alter table public.attendance_devices enable row level security;
drop policy if exists attendance_devices_select on public.attendance_devices;
create policy attendance_devices_select on public.attendance_devices for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists attendance_devices_delete on public.attendance_devices;
create policy attendance_devices_delete on public.attendance_devices for delete to authenticated using ((select public.is_admin()));
grant select, delete on public.attendance_devices to authenticated;
revoke all on public.attendance_devices from anon;

-- 요청한 사람의 공인 IP (Supabase API 앞단이 넣어 주는 헤더)
create or replace function private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h json := nullif(current_setting('request.headers', true), '')::json;
  v text;
begin
  if h is null then
    return null;
  end if;
  v := coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1));
  v := nullif(trim(v), '');
  if v is null then
    return null;
  end if;
  perform v::inet; -- 형식 검사
  return v;
exception when others then
  return null;
end;
$$;

create or replace function private.is_office_ip(p_ip text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list jsonb := coalesce((select value from public.app_settings where key = 'office_ips'), '[]'::jsonb);
begin
  if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) = 0 then
    return true; -- 아직 회사 IP 미등록 → 제한 없음
  end if;
  if p_ip is null then
    return false;
  end if;
  return exists (select 1 from jsonb_array_elements_text(v_list) x where p_ip::inet <<= x::inet);
exception when others then
  return false;
end;
$$;

-- 지금 내 접속 정보 (근태 화면 안내 · 관리자 회사 IP 등록용)
create or replace function public.my_access_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ip text := private.request_ip();
  v_list jsonb := coalesce((select value from public.app_settings where key = 'office_ips'), '[]'::jsonb);
begin
  return jsonb_build_object('ip', v_ip, 'office', private.is_office_ip(v_ip), 'office_ips', case when public.is_admin() then v_list else null end, 'configured', jsonb_array_length(v_list) > 0);
end;
$$;
revoke execute on function public.my_access_info() from public, anon;
grant execute on function public.my_access_info() to authenticated;

-- 회사 IP 목록 설정 (관리자)
create or replace function public.set_office_ips(p_ips text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x text;
begin
  if not public.is_admin() then
    raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  foreach x in array coalesce(p_ips, '{}') loop
    perform x::inet;
  end loop;
  insert into public.app_settings (key, value, updated_by, updated_at) values ('office_ips', to_jsonb(coalesce(p_ips, '{}')), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
exception when invalid_text_representation then
  raise exception 'IP 형식이 올바르지 않습니다: %', x using errcode = '22023';
end;
$$;
revoke execute on function public.set_office_ips(text[]) from public, anon;
grant execute on function public.set_office_ips(text[]) to authenticated;

-- 접속 기록 + 출근 (v3): PC 프로그램(desktop) · 회사 IP · 등록된 회사 PC 일 때만 출근
create or replace function public.touch_attendance_v3(p_source text, p_device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_ip text := private.request_ip();
  v_desktop_only boolean;
  v_device_ok boolean := true;
begin
  if v_uid is null or not public.is_active_member() then
    return;
  end if;
  if p_source not in ('desktop', 'web', 'mobile') then
    raise exception '알 수 없는 접속 경로입니다.' using errcode = '22023';
  end if;
  insert into public.access_log (user_id, day, source, ip) values (v_uid, v_day, p_source, v_ip)
  on conflict (user_id, day, source) do update set last_at = now(), ip = coalesce(excluded.ip, public.access_log.ip)
    where public.access_log.last_at < now() - interval '1 minute';

  select coalesce((s.value)::text = 'true', false) into v_desktop_only from public.app_settings s where s.key = 'attendance_desktop_only';
  if not (p_source = 'desktop' or not coalesce(v_desktop_only, false)) then
    return;
  end if;
  if not private.is_office_ip(v_ip) then
    return; -- 회사 밖: 외부 접속으로만 남김 (외근은 승인 후 출근 체크)
  end if;
  if p_source = 'desktop' and p_device is not null and char_length(p_device) between 8 and 80 then
    if exists (select 1 from public.attendance_devices d where d.user_id = v_uid) then
      v_device_ok := exists (select 1 from public.attendance_devices d where d.user_id = v_uid and d.device_id = p_device);
    else
      insert into public.attendance_devices (user_id, device_id, label) values (v_uid, p_device, '처음 출근한 회사 PC') on conflict do nothing;
    end if;
    if v_device_ok then
      update public.attendance_devices set last_seen = now() where user_id = v_uid and device_id = p_device and last_seen < now() - interval '5 minutes';
    end if;
  end if;
  if not v_device_ok then
    return; -- 등록되지 않은 PC
  end if;
  perform public.attendance_check_in();
  update public.attendance set ip = coalesce(ip, v_ip) where user_id = v_uid and day = v_day;
end;
$$;
revoke execute on function public.touch_attendance_v3(text, text) from public, anon;
grant execute on function public.touch_attendance_v3(text, text) to authenticated;
-- 예전 PC 프로그램 · 화면이 부르는 v2 는 v3 로 넘김 (drop 하지 않음: 사용 중 잠금 방지)
create or replace function public.touch_attendance_v2(p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.touch_attendance_v3(p_source, null);
end;
$$;

-- 휴대폰 · 노트북 출근: 그날 승인된 외근 · 재택 · 현장 직출 신청이 있을 때만
create or replace function public.mobile_check_in(p_kind text, p_note text default null, p_lat double precision default null, p_lng double precision default null, p_accuracy integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_plan public.work_plans;
  v_status text;
begin
  if v_uid is null or not public.is_active_member() then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_kind not in ('출근', '외근', '재택', '현장 직출') then
    raise exception '알 수 없는 출근 구분입니다.' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_checkins where user_id = v_uid and day = v_day) then
    select status into v_status from public.attendance_checkins where user_id = v_uid and day = v_day;
    return jsonb_build_object('ok', true, 'status', v_status, 'already', true);
  end if;
  select * into v_plan from public.work_plans where user_id = v_uid and day = v_day and status = '승인';
  if v_plan.id is null then
    raise exception '오늘 승인된 외근 · 재택 신청이 없습니다. 신청 후 승인되면 출근 체크할 수 있습니다.' using errcode = 'P0001', hint = 'need_plan';
  end if;
  insert into public.attendance_checkins (user_id, day, kind, plan_id, status, lat, lng, accuracy_m, note, decided_at)
  values (v_uid, v_day, v_plan.kind, v_plan.id, '승인', p_lat, p_lng, p_accuracy, left(p_note, 300), now());
  insert into public.attendance (user_id, day, ip) values (v_uid, v_day, private.request_ip()) on conflict (user_id, day) do update set last_at = now();
  insert into public.access_log (user_id, day, source, ip) values (v_uid, v_day, 'mobile', private.request_ip())
  on conflict (user_id, day, source) do update set last_at = now();
  update public.profiles set today_status = case v_plan.kind when '재택' then '재택' else '외근' end, status_updated_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'status', '승인', 'already', false);
end;
$$;
revoke execute on function public.mobile_check_in(text, text, double precision, double precision, integer) from public, anon;
grant execute on function public.mobile_check_in(text, text, double precision, double precision, integer) to authenticated;

-- 당일 긴급 신청이 승인되면 신청자에게 '지금 출근 체크하세요' 알림 (decide_work_plan 의 알림 문구 보강)
create or replace function public.decide_work_plan(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    update public.attendance_checkins set status = '승인', plan_id = v.id, decided_by = auth.uid(), decided_at = now()
     where user_id = v.user_id and day = v.day and status = '대기';
  end if;
  perform public.notify(v.user_id, '승인', v.kind || ' 신청 ' || p_status || ' · ' || to_char(v.day, 'MM-DD'),
    case when p_status = '승인' and v.day = v_today then '지금 휴대폰 · 노트북으로 출근 체크할 수 있습니다' else coalesce(v.place, '') end, '/team?tab=attendance');
end;
$$;
