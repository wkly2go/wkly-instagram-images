-- 2026-11-16 대표 지시 '100%까지 개발 진행': 전체 흐름 운영 점검 · 장애 복구 · 연속 운영 기록.
-- ① 영업 예약 작업 19개를 매분 한 번 도는 '영업 맥박' 하나로 묶는다.
--    (같은 분에 여러 작업이 동시에 뜨며 생기던 'job startup timeout' 실패를 줄이고, 한 단계가 실패해도 다른 단계는 계속 돈다)
-- ② 정해진 시각 작업(수집 · 브리핑 · 기획)은 놓쳤거나 실패하면 같은 회차 안에서 최대 3번 다시 시도한다(밀린 회차 따라잡기).
-- ③ 단계별 · 날짜별 성공/실패/놓침을 기록하고 하루 단위로 정상 여부를 판정한다. 3번 연속 실패한 단계는 관리자에게 알린다(6시간에 한 번).
-- ④ 실제 발송이 확인되어 회신 감지(sales_reply_tick)를 함께 켠다. 회신 감지는 읽기 · 기록만 하며 메일을 보내지 않는다.
-- 발송 스위치 · 수신자 범위는 바꾸지 않는다. 자동 후속 발송(sales_followup_tick)은 켜지 않는다.
begin;

create table if not exists private.sales_ops_steps(
 step text primary key,
 label text not null,
 call text not null,
 every_min integer check(every_min between 1 and 60),
 at_hours integer[],
 at_minutes integer[],
 at_dow integer,
 grace_min integer not null default 50,
 enabled boolean not null default true,
 last_slot timestamptz,
 slot_attempts integer not null default 0,
 last_attempt timestamptz,
 last_ok timestamptz,
 last_ok_slot timestamptz,
 last_error text,
 last_error_at timestamptz,
 consecutive_fails integer not null default 0,
 alerted_at timestamptz,
 check(every_min is not null or (at_hours is not null and at_minutes is not null))
);
create table if not exists private.sales_ops_daily(
 day date not null,
 step text not null references private.sales_ops_steps(step) on delete cascade,
 runs integer not null default 0,
 ok integer not null default 0,
 fails integer not null default 0,
 primary key(day,step)
);
create table if not exists private.sales_ops_meta(id integer primary key default 1 check(id=1),started_at timestamptz not null default now());
insert into private.sales_ops_meta(id) values(1) on conflict(id) do nothing;
create table if not exists private.sales_ops_days(
 day date primary key,
 healthy boolean not null,
 final boolean not null default false,
 detail jsonb not null default '{}',
 checked_at timestamptz not null default now()
);
alter table private.sales_ops_steps enable row level security;
alter table private.sales_ops_daily enable row level security;
alter table private.sales_ops_days enable row level security;
alter table private.sales_ops_meta enable row level security;
revoke all on private.sales_ops_steps,private.sales_ops_daily,private.sales_ops_days,private.sales_ops_meta from public,anon,authenticated;

insert into private.sales_ops_steps(step,label,call,every_min,at_hours,at_minutes,at_dow,grace_min) values
 ('receive','AI 작업 결과 받기','private.sales_receive()',1,null,null,null,1),
 ('desk_watchdog','AI 대화 멈춤 복구','private.sales_desk_watchdog()',1,null,null,null,1),
 ('g2b_watchdog','나라장터 수집 멈춤 복구','private.sales_g2b_watchdog()',1,null,null,null,1),
 ('dispatch','승인 메일 발송','private.sales_dispatch_tick()',1,null,null,null,1),
 ('dispatch_watchdog','발송 멈춤 복구','private.sales_dispatch_watchdog()',2,null,null,null,2),
 ('execution_material','실행 묶음 준비','private.sales_execution_schedule()',2,null,null,null,2),
 ('strategy_receive','기획안 받기','private.sales_strategy_receive()',2,null,null,null,2),
 ('contact_evidence','연락처 근거 확보','private.sales_contact_evidence_tick()',5,null,null,null,5),
 ('followup_research','후속 조사','private.sales_followup_research_tick()',5,null,null,null,5),
 ('replies','회신 · 수신 거부 감지','private.sales_reply_tick()',5,null,null,null,5),
 ('brand_site','브랜드 공식 사이트 찾기','private.sales_brand_site_tick()',10,null,null,null,10),
 ('contact_discovery','회사 연락 창구 찾기','private.sales_contact_discovery_tick()',10,null,null,null,10),
 ('news_brands','뉴스 속 브랜드 등록','private.sales_news_brands_tick()',10,null,null,null,10),
 ('ai_budget','AI 한도 갱신','private.sales_ai_budget_roll()',15,null,null,null,15),
 ('news','뉴스 수집','private.sales_news_queue()',null,array[0,3,6,9,12,15,18,21],array[10],null,50),
 ('collect','08시 나라장터 · 영업 수집','private.sales_collect()',null,array[23],array[0,20,40],null,15),
 ('brief','09시 영업 브리핑','private.sales_brief()',null,array[0],array[0],null,50),
 ('strategy_brief','09시 기획 브리핑','private.sales_strategy_brief()',null,array[0],array[0],null,50),
 ('strategy_prepare','자동 기획 (하루 6회)','private.sales_strategy_schedule()',null,array[3,7,11,15,19,23],array[45],null,50),
 ('method_review','주간 영업 방법 검토','private.sales_method_review_tick()',null,array[23],array[30],0,50),
 ('ops_check','운영 점검','private.sales_ops_check()',null,array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],array[55],null,4)
on conflict(step) do nothing;

-- 가장 최근에 와야 했던 회차 시각 (UTC). 아직 회차가 없으면 null.
create or replace function private.sales_ops_slot(s private.sales_ops_steps,p_now timestamptz) returns timestamptz language sql stable set search_path='' as $$
 select case when s.every_min is not null then
   date_trunc('minute',p_now at time zone 'UTC') at time zone 'UTC' - make_interval(mins=>(extract(minute from p_now at time zone 'UTC')::integer % s.every_min))
 else (select max(t) from (
   select (d + make_time(h,m,0)) at time zone 'UTC' t
   from generate_series(((p_now at time zone 'UTC')::date - 7),(p_now at time zone 'UTC')::date,interval '1 day') g(d),unnest(s.at_hours) h,unnest(s.at_minutes) m
   where s.at_dow is null or extract(dow from g.d)=s.at_dow) x where t<=p_now)
 end
$$;

create or replace function private.sales_ops_pulse() returns integer language plpgsql security definer set search_path='' as $$
declare s private.sales_ops_steps;slot timestamptz;due boolean;ran integer:=0;v_day date:=(now() at time zone 'Asia/Seoul')::date;msg text;
begin
 if not pg_try_advisory_xact_lock(903161100) then return 0;end if;
 for s in select * from private.sales_ops_steps where enabled order by every_min nulls last,step loop
  slot:=private.sales_ops_slot(s,now());
  continue when slot is null or now()-slot>make_interval(mins=>s.grace_min);
  due:= s.last_slot is distinct from slot
   or (s.last_ok_slot is distinct from slot and s.slot_attempts<3 and s.every_min is null and s.last_attempt<now()-interval '4 minutes');
  continue when not due;
  ran:=ran+1;
  update private.sales_ops_steps set slot_attempts=case when last_slot is distinct from slot then 1 else slot_attempts+1 end,last_slot=slot,last_attempt=now() where step=s.step;
  insert into private.sales_ops_daily(day,step,runs) values(v_day,s.step,1) on conflict(day,step) do update set runs=private.sales_ops_daily.runs+1;
  begin
   execute 'select '||s.call;
   update private.sales_ops_steps set last_ok=now(),last_ok_slot=slot,consecutive_fails=0 where step=s.step;
   update private.sales_ops_daily set ok=ok+1 where private.sales_ops_daily.day=v_day and private.sales_ops_daily.step=s.step;
  exception when others then
   get stacked diagnostics msg=message_text;
   update private.sales_ops_steps set last_error=left(msg,500),last_error_at=now(),consecutive_fails=consecutive_fails+1 where step=s.step;
   update private.sales_ops_daily set fails=fails+1 where private.sales_ops_daily.day=v_day and private.sales_ops_daily.step=s.step;
  end;
 end loop;
 return ran;
end $$;

-- 하루 정상 판정: 매분 · 몇 분마다 도는 단계는 와야 했던 회차의 90% 이상 성공, 정해진 시각 단계는 그날 회차 모두 성공, 3번 연속 실패 중인 단계 없음.
create or replace function private.sales_ops_judge(p_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.sales_ops_steps;d private.sales_ops_daily;start_at timestamptz;end_at timestamptz;expected integer;problems jsonb:='[]';steps jsonb:='[]';r1 jsonb;
begin
 start_at:=greatest(p_day::timestamp at time zone 'Asia/Seoul',(select started_at from private.sales_ops_meta where id=1));
 end_at:=least(now(),(p_day::timestamp at time zone 'Asia/Seoul')+interval '1 day');
 for s in select * from private.sales_ops_steps where enabled and step<>'ops_check' order by step loop
  select * into d from private.sales_ops_daily where day=p_day and step=s.step;
  if s.every_min is not null then
   expected:=floor(extract(epoch from end_at-start_at)/60/s.every_min)::integer;
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
end $$;

create or replace function private.sales_ops_check() returns void language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Seoul')::date;r jsonb;d date;bad record;
begin
 -- 끝난 날은 확정, 오늘은 진행 중 판정
 for d in select x.day from private.sales_ops_daily x where x.day<today and not exists(select 1 from private.sales_ops_days y where y.day=x.day and y.final) group by x.day loop
  r:=private.sales_ops_judge(d);
  insert into private.sales_ops_days(day,healthy,final,detail,checked_at) values(d,(r->>'healthy')::boolean,true,r,now())
   on conflict(day) do update set healthy=excluded.healthy,final=true,detail=excluded.detail,checked_at=now();
 end loop;
 r:=private.sales_ops_judge(today);
 insert into private.sales_ops_days(day,healthy,final,detail,checked_at) values(today,(r->>'healthy')::boolean,false,r,now())
  on conflict(day) do update set healthy=excluded.healthy,detail=excluded.detail,checked_at=now() where not private.sales_ops_days.final;
 for bad in select step,label,last_error from private.sales_ops_steps where enabled and consecutive_fails>=3 and (alerted_at is null or alerted_at<now()-interval '6 hours') loop
  insert into public.notifications(user_id,kind,title,body,link)
   select p.id,'영업 자동화','영업 자동화 점검 필요 · '||bad.label,'3번 연속 실패했습니다. 다음 회차에 자동으로 다시 시도합니다. 마지막 오류: '||coalesce(left(bad.last_error,200),'-'),'/sales'
   from public.profiles p where p.active and p.role='admin';
  update private.sales_ops_steps set alerted_at=now() where step=bad.step;
 end loop;
 delete from private.sales_ops_daily where day<today-60;
end $$;

-- 관리자 화면용: 최근 7일 판정 · 연속 정상 일수 · 단계 상태
create or replace function public.sales_ops_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Seoul')::date;streak integer:=0;d record;
begin
 if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode='42501';end if;
 for d in select * from private.sales_ops_days where final order by day desc loop
  exit when not d.healthy or coalesce((d.detail->>'partial')::boolean,false) or d.day<>today-1-streak;
  streak:=streak+1;
 end loop;
 return jsonb_build_object(
  'streak',streak,
  'today',(select to_jsonb(x)-'detail'||jsonb_build_object('problems',x.detail->'problems') from private.sales_ops_days x where x.day=today),
  'days',coalesce((select jsonb_agg(jsonb_build_object('day',x.day,'healthy',x.healthy,'final',x.final,'partial',coalesce((x.detail->>'partial')::boolean,false),'problems',jsonb_array_length(coalesce(x.detail->'problems','[]'))) order by x.day desc) from (select * from private.sales_ops_days order by day desc limit 7) x),'[]'),
  'steps',coalesce((select jsonb_agg(jsonb_build_object('step',s.step,'label',s.label,'last_ok',s.last_ok,'consecutive_fails',s.consecutive_fails,'last_error',case when s.consecutive_fails>0 then left(s.last_error,200) end) order by s.consecutive_fails desc,s.step) from private.sales_ops_steps s where s.enabled),'[]'));
end $$;

revoke all on function private.sales_ops_slot(private.sales_ops_steps,timestamptz),private.sales_ops_pulse(),private.sales_ops_judge(date),private.sales_ops_check() from public,anon,authenticated;
revoke all on function public.sales_ops_status() from public,anon;
grant execute on function public.sales_ops_status() to authenticated;

-- 따로 돌던 영업 예약 작업을 맥박 하나로 묶는다
do $$
declare n text;
begin
 foreach n in array array['wkly_sales_receive','wkly_sales_desk_watchdog','wkly_sales_g2b_watchdog','wkly_sales_dispatch','wkly_sales_dispatch_watchdog','wkly_sales_execution_material','wkly_sales_strategy_receive','wkly_sales_contact_evidence','wkly_sales_followup_research','wkly_sales_replies','wkly_sales_brand_site','wkly_sales_contact_discovery','wkly_sales_news_brands','wkly_sales_ai_budget_roll','wkly_sales_news','wkly_sales_collect','wkly_sales_brief','wkly_sales_strategy_brief','wkly_sales_strategy_prepare','wkly_sales_method_review'] loop
  if exists(select 1 from cron.job where jobname=n) then perform cron.unschedule(n);end if;
 end loop;
end $$;
select cron.schedule('wkly_sales_pulse','* * * * *','select private.sales_ops_pulse()');
commit;
