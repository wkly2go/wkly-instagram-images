-- 읽기 전용: 설치 상태만 확인하며 고객 정보·메일 본문·키를 조회하지 않습니다.
-- 미설치 상태에서도 실행할 수 있습니다. 결과의 '있음'만으로 전체 설치 성공을 단정하지 않습니다.
select category as "구분", object_name as "확인 대상",
       case when present then '있음' else '없음' end as "상태"
from (
  select '기반 테이블' as category, name as object_name, to_regclass(name) is not null as present
  from (values ('public.profiles'),('public.clients'),('public.contacts'),('public.projects'),('public.marketing_campaigns'),('public.mail_index')) as required(name)
  union all
  select '신규 테이블', name, to_regclass(name) is not null
  from (values ('public.sales_opportunities'),('public.sales_activities'),('public.sales_revisions'),('public.growth_items'),('public.growth_revisions'),('public.growth_ai_models'),('public.growth_ai_budgets'),('public.growth_ai_usage')) as expected(name)
  union all
  select '서버 함수', name, to_regprocedure(name) is not null
  from (values ('public.sales_save_opportunity(uuid,jsonb,integer)'),('public.growth_save(uuid,jsonb,integer)'),('public.growth_backfill_mail()'),('public.growth_ai_reserve(uuid,uuid,text,text,text,integer)'),('public.growth_ai_finish(uuid,numeric,text,boolean)')) as expected(name)
  union all
  select '메일 자동 후보', name, exists(select 1 from pg_catalog.pg_trigger t where t.tgname=expected.name and t.tgrelid=to_regclass('public.mail_index') and t.tgenabled<>'D' and not t.tgisinternal)
  from (values ('growth_mail_capture'),('growth_mail_backfill')) as expected(name)
  union all
  select '설치 이력', 'supabase_migrations.schema_migrations', to_regclass('supabase_migrations.schema_migrations') is not null
) checks
order by category, object_name;
