-- WKLY ERP 0005: 프로필 사진 + 근태(하루 첫 접속 = 출근)
--   브라우저에서 256px 정사각 JPEG 로 줄여 data URL 로 저장 (별도 Storage 버킷 없이 기존 profiles RLS 그대로 사용)
--   본인 또는 관리자만 변경 (profiles_update_self / profiles_update_admin 정책)
alter table public.profiles add column if not exists photo text;

alter table public.profiles drop constraint if exists profiles_photo_check;
alter table public.profiles add constraint profiles_photo_check
  check (photo is null or (photo ~ '^data:image/(jpeg|png|webp);base64,' and length(photo) <= 200000));

comment on column public.profiles.photo is '프로필 사진 (256px 정사각 이미지 data URL, 200KB 이내)';

-- ---------------------------------------------------------------------
-- 근태: 하루 첫 접속 = 출근 시각. 오늘 접속 기록이 없으면 화면에 '미출근'
--   앱이 열려 있는 동안 touch_attendance() 를 몇 분마다 호출해 마지막 접속 시각을 갱신
--   날짜는 한국 시간 기준
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  primary key (user_id, day)
);
comment on table public.attendance is '근태: 하루 첫 접속(출근)·마지막 접속. touch_attendance() 로만 기록';

create index if not exists attendance_day_idx on public.attendance (day);

alter table public.attendance enable row level security;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (public.is_active_member());

revoke insert, update, delete on public.attendance from anon, authenticated;
grant select on public.attendance to authenticated;

create or replace function public.touch_attendance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_day   date := (now() at time zone 'Asia/Seoul')::date;
  v_first boolean;
begin
  if v_uid is null or not public.is_active_member() then
    return;
  end if;

  insert into public.attendance (user_id, day) values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  v_first := found;

  if v_first then
    -- 오늘 처음 접속: 어제 이전에 정해 둔 상태(퇴근 등)는 '출근'으로 되돌림
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

-- 이 파일을 실행하기 전에 로그인한 기록(마지막 로그인)을 그날 출근으로 채움 (다시 실행해도 중복 없음)
insert into public.attendance (user_id, day, first_at, last_at)
select u.id, (u.last_sign_in_at at time zone 'Asia/Seoul')::date, u.last_sign_in_at, u.last_sign_in_at
from auth.users u
join public.profiles p on p.id = u.id
where u.last_sign_in_at is not null and p.active and not p.is_agent
on conflict (user_id, day) do nothing;

revoke execute on function public.touch_attendance() from public, anon;
grant execute on function public.touch_attendance() to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
     )
  then
    alter publication supabase_realtime add table public.attendance;
  end if;
end;
$$;
