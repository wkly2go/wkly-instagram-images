-- WKLY ERP 0023: 부서 · 주요 업무 / 휴대폰 출근 체크 + 외근 · 재택 사전 신청(전날 승인 시 자동 승인)

-- 1. 부서
create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  duties       text,
  lead_id      uuid references public.profiles (id) on delete set null,
  member_ids   uuid[] not null default '{}',
  agent_groups text[] not null default '{}',
  sort         integer not null default 0,
  updated_at   timestamptz not null default now()
);
comment on table public.departments is '부서 · 주요 업무 · 구성원 (사람과 AI 구분 없이 member_ids, 예약 작업은 agent_groups 로 묶음)';
alter table public.departments enable row level security;
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated using ((select public.is_active_member()));
drop policy if exists departments_admin on public.departments;
create policy departments_admin on public.departments for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.departments to authenticated;
revoke all on public.departments from anon;

-- 2. 외근 · 재택 · 현장 직출 사전 신청 (전날 신청 → 승인되면 당일 휴대폰 출근 자동 승인)
create table if not exists public.work_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day         date not null,
  kind        text not null check (kind in ('외근', '재택', '현장 직출')),
  place       text,
  reason      text,
  status      text not null default '대기' check (status in ('대기', '승인', '반려')),
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, day)
);
comment on table public.work_plans is '외근 · 재택 · 현장 직출 사전 신청. 관리자 승인 시 그날 휴대폰 출근이 자동 승인됨';
alter table public.work_plans enable row level security;
drop policy if exists work_plans_select on public.work_plans;
create policy work_plans_select on public.work_plans for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists work_plans_insert on public.work_plans;
create policy work_plans_insert on public.work_plans for insert to authenticated with check (user_id = (select auth.uid()) and status = '대기' and day >= ((now() at time zone 'Asia/Seoul')::date));
drop policy if exists work_plans_delete on public.work_plans;
create policy work_plans_delete on public.work_plans for delete to authenticated using ((user_id = (select auth.uid()) and status = '대기') or (select public.is_admin()));
grant select, insert, delete on public.work_plans to authenticated;
revoke all on public.work_plans from anon;

-- 3. 휴대폰 출근 체크 기록 (위치는 본인 · 관리자만)
create table if not exists public.attendance_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  day         date not null,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('출근', '외근', '재택', '현장 직출')),
  plan_id     uuid references public.work_plans (id) on delete set null,
  status      text not null check (status in ('승인', '대기', '반려')),
  lat         double precision,
  lng         double precision,
  accuracy_m  integer,
  note        text,
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  unique (user_id, day)
);
comment on table public.attendance_checkins is '휴대폰 출근 체크: 사전 신청 승인 건은 자동 승인, 없으면 관리자 확인 대기';
create index if not exists attendance_checkins_day_idx on public.attendance_checkins (day);
alter table public.attendance_checkins enable row level security;
drop policy if exists attendance_checkins_select on public.attendance_checkins;
create policy attendance_checkins_select on public.attendance_checkins for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke insert, update, delete on public.attendance_checkins from anon, authenticated;
grant select on public.attendance_checkins to authenticated;

-- 신청 알림 (관리자에게)
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
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.id <> new.user_id loop
    perform public.notify(r.id, '승인', '근무 신청 · ' || coalesce(v_name, '') || ' ' || new.kind || ' ' || to_char(new.day, 'MM-DD'), coalesce(new.place, '') || case when new.reason is not null then ' · ' || new.reason else '' end, '/team?tab=attendance');
  end loop;
  return null;
end;
$$;
drop trigger if exists work_plans_notify on public.work_plans;
create trigger work_plans_notify after insert on public.work_plans for each row execute function private.work_plan_notify();

-- 신청 승인 · 반려 (관리자). 이미 휴대폰 출근이 '대기'로 찍혀 있으면 함께 승인
create or replace function public.decide_work_plan(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_plans;
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
  perform public.notify(v.user_id, '승인', v.kind || ' 신청 ' || p_status || ' · ' || to_char(v.day, 'MM-DD'), coalesce(v.place, ''), '/team?tab=attendance');
end;
$$;
revoke execute on function public.decide_work_plan(uuid, text) from public, anon;
grant execute on function public.decide_work_plan(uuid, text) to authenticated;

-- 휴대폰 출근 체크: PC 전용 설정과 관계없이 출근 기록. 승인된 사전 신청이 있으면 자동 승인, 없으면 '대기' + 관리자 알림
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
  v_name text;
  r record;
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
  v_status := case when v_plan.id is not null then '승인' else '대기' end;
  insert into public.attendance_checkins (user_id, day, kind, plan_id, status, lat, lng, accuracy_m, note, decided_at)
  values (v_uid, v_day, p_kind, v_plan.id, v_status, p_lat, p_lng, p_accuracy, left(p_note, 300), case when v_status = '승인' then now() end);
  insert into public.attendance (user_id, day) values (v_uid, v_day) on conflict (user_id, day) do update set last_at = now();
  insert into public.access_log (user_id, day, source) values (v_uid, v_day, 'mobile')
  on conflict (user_id, day, source) do update set last_at = now();
  update public.profiles set today_status = case p_kind when '재택' then '재택' when '출근' then '출근' else '외근' end, status_updated_at = now() where id = v_uid;
  if v_status = '대기' then
    v_name := (select name from public.profiles where id = v_uid);
    for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.id <> v_uid loop
      perform public.notify(r.id, '승인', '휴대폰 출근 확인 · ' || coalesce(v_name, '') || ' ' || p_kind, coalesce(left(p_note, 200), '사전 신청 없음'), '/team?tab=attendance');
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'already', false);
end;
$$;
revoke execute on function public.mobile_check_in(text, text, double precision, double precision, integer) from public, anon;
grant execute on function public.mobile_check_in(text, text, double precision, double precision, integer) to authenticated;

-- 휴대폰 출근 확인 (관리자)
create or replace function public.decide_checkin(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.attendance_checkins;
begin
  if not public.is_admin() then
    raise exception '관리자만 확인할 수 있습니다.' using errcode = '42501';
  end if;
  if p_status not in ('승인', '반려') then
    raise exception '승인 또는 반려만 가능합니다.' using errcode = '22023';
  end if;
  update public.attendance_checkins set status = p_status, decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
  if v.id is null then
    raise exception '기록을 찾을 수 없습니다.' using errcode = '22023';
  end if;
  perform public.notify(v.user_id, '승인', '휴대폰 출근 ' || p_status || ' · ' || to_char(v.day, 'MM-DD'), v.kind, '/team?tab=attendance');
end;
$$;
revoke execute on function public.decide_checkin(uuid, text) from public, anon;
grant execute on function public.decide_checkin(uuid, text) to authenticated;
