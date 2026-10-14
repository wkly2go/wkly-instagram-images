-- WKLY ERP 0014: 설치 프로그램(PC) 출근 · 외부 접속 구분
--   access_log: 하루 · 접속 경로(desktop / web / mobile)별 첫 · 마지막 접속
--   app_settings.attendance_desktop_only = true 이면 출근(attendance)은 설치 프로그램 접속으로만 찍힌다.
--   브라우저 · 휴대폰 접속은 '외부 접속'으로 access_log 에만 남는다.

create table public.access_log (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  source   text not null check (source in ('desktop', 'web', 'mobile')),
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  primary key (user_id, day, source)
);
comment on table public.access_log is '접속 기록: 하루 · 경로(설치 프로그램 / 브라우저 / 휴대폰)별 첫 · 마지막 접속';
create index access_log_day_idx on public.access_log (day);
alter table public.access_log enable row level security;
create policy access_log_select on public.access_log for select to authenticated using (public.is_active_member());
revoke insert, update, delete on public.access_log from anon, authenticated;
grant select on public.access_log to authenticated;

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.app_settings is '회사 공통 설정 (관리자만 set_app_setting 으로 변경)';
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using (public.is_active_member());
revoke insert, update, delete on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
insert into public.app_settings (key, value) values ('attendance_desktop_only', 'false'::jsonb) on conflict (key) do nothing;

create function public.set_app_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if p_key not in ('attendance_desktop_only') then
    raise exception '알 수 없는 설정입니다.' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke execute on function public.set_app_setting(text, jsonb) from public, anon;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;

-- 출근 기록 본체 (예전 touch_attendance 내용). 직접 부르지 못하게 막고 touch_attendance_v2 에서만 사용
create function public.attendance_check_in()
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
       and p.today_status <> '출근';
  else
    update public.attendance a
       set last_at = now()
     where a.user_id = v_uid and a.day = v_day
       and a.last_at < now() - interval '1 minute';
  end if;
end;
$$;
revoke execute on function public.attendance_check_in() from public, anon, authenticated;

-- 접속 기록 + (설정에 따라) 출근
create function public.touch_attendance_v2(p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_desktop_only boolean;
begin
  if v_uid is null or not public.is_active_member() then
    return;
  end if;
  if p_source not in ('desktop', 'web', 'mobile') then
    raise exception '알 수 없는 접속 경로입니다.' using errcode = '22023';
  end if;
  insert into public.access_log (user_id, day, source) values (v_uid, v_day, p_source)
  on conflict (user_id, day, source) do update set last_at = now()
    where public.access_log.last_at < now() - interval '1 minute';

  select coalesce((s.value)::text = 'true', false) into v_desktop_only
    from public.app_settings s where s.key = 'attendance_desktop_only';
  if p_source = 'desktop' or not coalesce(v_desktop_only, false) then
    perform public.attendance_check_in();
  end if;
end;
$$;
revoke execute on function public.touch_attendance_v2(text) from public, anon;
grant execute on function public.touch_attendance_v2(text) to authenticated;

-- 예전 화면(브라우저 캐시)이 부르는 함수도 같은 규칙 (브라우저 접속으로 취급)
create or replace function public.touch_attendance()
returns void
language sql
security definer
set search_path = ''
as $$
  select public.touch_attendance_v2('web');
$$;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'access_log')
  then
    alter publication supabase_realtime add table public.access_log;
  end if;
end;
$$;
