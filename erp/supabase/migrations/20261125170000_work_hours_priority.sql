-- 업무 시간에는 사람 팀원 먼저 (대표 지시 2026-11-25 '서버 사용을 줄여서 여유 사용을 늘리고 업무 시간에 사람팀원이 원활하게 사용가능하도록')
-- ① 영업 맥박의 뒤에서 도는 단계는 평일 09~19시(KST)에 덜 자주 (work_every_min) — 발송 · 결과 받기 · 회신 감지 · 문의처럼 사람이 기다리는 단계는 그대로
-- ② 접속 신호(근태 · 접속 기록) 기록 간격 1분 → 4분 (화면은 5분마다 신호를 보냄 · 실시간 감시가 처리할 바뀜이 줄어듦)
-- ③ 접속 기록(access_log)은 실시간 감시에서 뺌 — 팀원 화면이 2분마다 다시 읽음

alter table private.sales_ops_steps add column if not exists work_every_min integer
  check (work_every_min is null or (work_every_min between 1 and 60 and 60 % work_every_min = 0));

comment on column private.sales_ops_steps.work_every_min is '평일 09~19시(KST)에 쓰는 간격(분). 비우면 every_min 그대로';

update private.sales_ops_steps set work_every_min = v.m
from (values
  ('brand_site', 30),          -- 0.7초 · 10분 → 30분
  ('contact_evidence', 60),    -- 1.9초 · 30분 → 60분
  ('execution_material', 10),  -- 0.2초 · 5분 → 10분
  ('followup_research', 15),
  ('g2b_watchdog', 10),        -- 나라장터 수집은 새벽 · 아침이라 낮에는 10분이면 충분
  ('interview_mail', 20),      -- 0.3초 · 10분 → 20분
  ('interview_prospects', 30),
  ('inquiry_threads', 20),     -- 알림 단계가 2시간 · 하루라 20분이면 충분
  ('news_brands', 30),
  ('target_refresh', 30),
  ('ai_budget', 30)
) v(step, m)
where private.sales_ops_steps.step = v.step;

-- 지금이 평일 업무 시간(KST 09:00~18:59)인지
create or replace function private.is_work_hours(p_now timestamptz default now())
returns boolean
language sql
stable
set search_path to ''
as $$
  select extract(isodow from p_now at time zone 'Asia/Seoul') between 1 and 5
     and extract(hour from p_now at time zone 'Asia/Seoul') between 9 and 18
$$;

revoke all on function private.is_work_hours(timestamptz) from public, anon, authenticated;

-- 두 시각 사이의 평일 업무 시간(분)
create or replace function private.work_minutes_between(p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
set search_path to ''
as $$
  select coalesce(sum(extract(epoch from least(p_to, d.e) - greatest(p_from, d.s)) / 60), 0)
  from (
    select (g::date + time '09:00') at time zone 'Asia/Seoul' s, (g::date + time '19:00') at time zone 'Asia/Seoul' e
    from generate_series((p_from at time zone 'Asia/Seoul')::date, (p_to at time zone 'Asia/Seoul')::date, interval '1 day') g
    where extract(isodow from g) between 1 and 5
  ) d
  where d.e > p_from and d.s < p_to
$$;

revoke all on function private.work_minutes_between(timestamptz, timestamptz) from public, anon, authenticated;

-- 회차 계산: 업무 시간이면 work_every_min 을 씀 (나머지는 예전과 같음)
create or replace function private.sales_ops_slot(s private.sales_ops_steps, p_now timestamp with time zone)
 returns timestamp with time zone
 language sql
 stable
 set search_path to ''
as $function$
 select case when s.every_min is not null then
   date_trunc('minute',p_now at time zone 'UTC') at time zone 'UTC' - make_interval(mins=>(extract(minute from p_now at time zone 'UTC')::integer
     % (case when s.work_every_min is not null and private.is_work_hours(p_now) then s.work_every_min else s.every_min end)))
 else (select max(t) from (
   select (d + make_time(h,m,0)) at time zone 'UTC' t
   from generate_series(((p_now at time zone 'UTC')::date - 7),(p_now at time zone 'UTC')::date,interval '1 day') g(d),unnest(s.at_hours) h,unnest(s.at_minutes) m
   where s.at_dow is null or extract(dow from g.d)=s.at_dow) x where t<=p_now)
 end
$function$;

-- 하루 정상 판정: 업무 시간에는 덜 도는 만큼 기대 횟수도 줄여서 셈 (예전엔 늘 every_min 기준)
create or replace function private.sales_ops_judge(p_day date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare s private.sales_ops_steps;d private.sales_ops_daily;start_at timestamptz;end_at timestamptz;expected integer;problems jsonb:='[]';steps jsonb:='[]';r1 jsonb;wm numeric;total numeric;
begin
 start_at:=greatest(p_day::timestamp at time zone 'Asia/Seoul',(select started_at from private.sales_ops_meta where id=1));
 end_at:=least(now(),(p_day::timestamp at time zone 'Asia/Seoul')+interval '1 day');
 for s in select * from private.sales_ops_steps where enabled and step<>'ops_check' order by step loop
  select * into d from private.sales_ops_daily where day=p_day and step=s.step;
  if s.every_min is not null then
   total:=greatest(extract(epoch from end_at-start_at)/60,0);
   wm:=case when s.work_every_min is null then 0 else least(private.work_minutes_between(start_at,end_at),total) end;
   expected:=floor((total-wm)/greatest(s.every_min,2)+wm/greatest(coalesce(s.work_every_min,s.every_min),2))::integer;
  else
   select count(*) into expected from generate_series((start_at at time zone 'UTC')::date-1,(end_at at time zone 'UTC')::date,interval '1 day') g(x),unnest(s.at_hours) h,unnest(s.at_minutes) m
    where (x+make_time(h,m,0)) at time zone 'UTC'>=start_at and (x+make_time(h,m,0)) at time zone 'UTC'<=end_at-make_interval(mins=>s.grace_min)
     and (s.at_dow is null or extract(dow from x)=s.at_dow);
  end if;
  expected:=greatest(expected,0);
  r1:=jsonb_build_object('step',s.step,'label',s.label,'expected',expected,'runs',coalesce(d.runs,0),'ok',coalesce(d.ok,0),'fails',coalesce(d.fails,0),'streak_fails',s.consecutive_fails);
  steps:=steps||r1;
  if (s.every_min is not null and coalesce(d.ok,0)<floor(expected*0.9))
   or (s.every_min is null and coalesce(d.ok,0)<expected)
   or (p_day=(now() at time zone 'Asia/Seoul')::date and s.consecutive_fails>=3) then problems:=problems||r1;end if;
 end loop;
 return jsonb_build_object('healthy',jsonb_array_length(problems)=0,'partial',start_at>(p_day::timestamp at time zone 'Asia/Seoul'),'problems',problems,'steps',steps);
end $function$;

-- 접속 신호: 같은 사람 · 같은 날 기록은 4분에 한 번만 고침 (예전 1분)
create or replace function public.touch_attendance_v3(p_source text, p_device text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    where public.access_log.last_at < now() - interval '4 minutes';
  update public.attendance a set last_at = now()
   where a.user_id = v_uid and a.day = v_day and a.checkin_at is not null and a.checkout_at is null
     and a.last_at < now() - interval '4 minutes';
end $function$;

-- 접속 기록은 실시간 감시에서 뺌 (팀원 화면이 2분마다 다시 읽음 · 표와 자료는 그대로)
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'access_log') then
    alter publication supabase_realtime drop table public.access_log;
  end if;
end $$;
