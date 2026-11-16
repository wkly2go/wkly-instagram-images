-- Read only. Run in a new SQL Editor query, not appended to old installation SQL.
-- No install, data write, cron invocation or migration-history modification.
select label as "점검 항목", present as "설치 여부"
from (values
 ('기반 growth_items',to_regclass('public.growth_items') is not null),
 ('후보 수집 상태',to_regclass('public.growth_ig_sync') is not null),
 ('참여자 매핑',to_regclass('public.growth_ig_contacts') is not null),
 ('후보 저장 RPC',to_regprocedure('public.growth_ig_commit(text,integer,text,jsonb,uuid,text)') is not null)
) as checks(label,present);
select c.relname as "테이블",c.relrowsecurity as "RLS",
 has_table_privilege('anon',c.oid,'SELECT') as "비로그인 조회 권한",
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as "팀원 직접 변경 권한"
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('growth_ig_sync','growth_ig_contacts');
select p.proname as "함수",
 has_function_privilege('anon',p.oid,'EXECUTE') as "비로그인 실행",
 has_function_privilege('authenticated',p.oid,'EXECUTE') as "팀원 직접 실행",
 has_function_privilege('service_role',p.oid,'EXECUTE') as "서버 실행"
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='growth_ig_commit';
-- Approval source inspection only; compare against 0117 before deciding to install.
select pg_get_functiondef(to_regprocedure('public.growth_save(uuid,jsonb,integer)')) as "현재 승인 검증 함수";
