-- 설치 후 메타데이터·권한 점검. 고객 자료·키를 읽거나 DB를 변경하지 않습니다.
-- 정상은 아래 기본 검사 통과를 뜻하며 실제 사용자 저장·동시 수정 검증을 대신하지 않습니다.
with expected_tables(name, policy_name) as (
 values
 ('sales_opportunities','sales_read'),
 ('sales_activities','sales_activity_read'),
 ('sales_revisions','sales_revision_read'),
 ('growth_items','growth_read'),
 ('growth_revisions','growth_history_read'),
 ('growth_ai_models','ai_models_read'),
 ('growth_ai_budgets','ai_budget_read'),
 ('growth_ai_usage','ai_usage_read')
), tables as (
 select e.*, c.oid, c.relrowsecurity
 from expected_tables e
 left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||e.name)
), expected_functions(signature) as (
 values
 ('public.sales_save_opportunity(uuid,jsonb,integer)'),
 ('public.sales_add_activity(uuid,uuid,text,text)'),
 ('public.growth_safe_url(text)'),
 ('public.growth_save(uuid,jsonb,integer)'),
 ('public.growth_link_sales(uuid,integer)'),
 ('public.growth_capture_mail()'),
 ('public.growth_backfill_mail()'),
 ('public.growth_ai_configure(jsonb,jsonb)'),
 ('public.growth_ai_reserve(uuid,uuid,text,text,text,integer)'),
 ('public.growth_ai_finish(uuid,numeric,text,boolean)'),
 ('public.growth_ai_reconcile(uuid,numeric,text)')
), functions as (
 select signature, to_regprocedure(signature) as oid from expected_functions
), checks(n, item, actual, expected) as (
 select 1, '신규 테이블', count(oid), 8 from tables
 union all
 select 2, '행별 접근 제어(RLS)', count(*) filter(where relrowsecurity), 8 from tables
 union all
 select 3, '팀원 조회 정책', count(*) filter(where exists(
  select 1 from pg_catalog.pg_policy p
  where p.polrelid=t.oid and p.polname=t.policy_name and p.polcmd='r'
   and (select oid from pg_catalog.pg_roles where rolname='authenticated')=any(p.polroles)
   and pg_get_expr(p.polqual,p.polrelid) like '%is_active_member%'
 )), 8 from tables t
 union all
 select 4, '비로그인 테이블 접근 차단', count(*) filter(where oid is not null and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 8 from tables
 union all
 select 5, '팀원 조회 권한', count(*) filter(where oid is not null and has_table_privilege('authenticated',oid,'SELECT')), 8 from tables
 union all
 select 6, '팀원 직접 변경 차단', count(*) filter(where oid is not null and not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 8 from tables
 union all
 select 7, '필수 DB 함수', count(oid), 11 from functions
 union all
 select 8, 'AI 예약·정산 서버 전용 권한', count(*) filter(where oid is not null
  and signature in ('public.growth_ai_reserve(uuid,uuid,text,text,text,integer)','public.growth_ai_finish(uuid,numeric,text,boolean)')
  and has_function_privilege('service_role',oid,'EXECUTE')
  and not has_function_privilege('anon',oid,'EXECUTE')
  and not has_function_privilege('authenticated',oid,'EXECUTE')), 2 from functions
 union all
 select 9, '메일 자동 후보 트리거', count(*), 2
 from pg_catalog.pg_trigger
 where tgrelid=to_regclass('public.mail_index')
  and tgfoid=to_regprocedure('public.growth_capture_mail()')
  and ((tgname='growth_mail_capture' and tgtype=5) or (tgname='growth_mail_backfill' and tgtype=17))
  and tgenabled in ('O','A') and not tgisinternal
)
select item as "점검 항목", actual||'/'||expected as "확인 수",
 case when actual=expected then '정상' else '확인 필요' end as "결과"
from checks order by n;
