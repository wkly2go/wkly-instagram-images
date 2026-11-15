-- 2026-11-16 대표 지시: AI 작업과 에이전트 업무가 24시간 돌아가게 한다 (비용 없는 범위 · 주간 AI 한도 안).
-- ① 뉴스 수집: 하루 2회 → 3시간마다 (같은 검색어는 170분 안에 다시 돌리지 않음 · 하루 최대 9회)
-- ② 자동 기획: 아침 3건 → 4시간마다 1건씩 하루 6건 (08:45 · 12:45 · 16:45 · 20:45 · 00:45 · 04:45), 수동 포함 하루 12건
begin;
do $$
declare def text;
begin
 def:=pg_get_functiondef('private.sales_news_queue()'::regprocedure);
 if position('interval ''170 minutes''' in def)=0 then
  if position('(report_date=day and status in (''완료'',''일부 수집''))' in def)=0 or position('and report_date=day)>=3 then continue' in def)=0 then raise exception 'Unexpected news queue'; end if;
  execute replace(replace(def,'(report_date=day and status in (''완료'',''일부 수집''))','(status in (''완료'',''일부 수집'') and started_at>now()-interval ''170 minutes'')'),'and report_date=day)>=3 then continue','and report_date=day)>=9 then continue');
 end if;
 def:=pg_get_functiondef('private.sales_strategy_queue(uuid,uuid,text,integer)'::regprocedure);
 if position('한도 12건' in def)=0 then
  if position('>=6 then raise exception ''오늘의 기획 생성 한도 6건에' in def)=0 then raise exception 'Unexpected planner limit'; end if;
  execute replace(def,'>=6 then raise exception ''오늘의 기획 생성 한도 6건에','>=12 then raise exception ''오늘의 기획 생성 한도 12건에');
 end if;
 def:=pg_get_functiondef('private.sales_strategy_schedule()'::regprocedure);
 if position('generate_series(1,6)' in def)=0 then
  if position('generate_series(1,3)' in def)=0 then raise exception 'Unexpected planner schedule'; end if;
  execute replace(def,'generate_series(1,3)','generate_series(1,6)');
 end if;
end $$;
alter table public.sales_strategies drop constraint if exists sales_strategies_auto_slot_check;
alter table public.sales_strategies add constraint sales_strategies_auto_slot_check check(auto_slot between 1 and 6);
select cron.schedule('wkly_sales_news','10 */3 * * *','select private.sales_news_queue()');
select cron.schedule('wkly_sales_strategy_prepare','45 3,7,11,15,19,23 * * *','select private.sales_strategy_schedule()');
commit;
