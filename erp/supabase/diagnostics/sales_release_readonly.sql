-- Read-only release evidence. No credentials, customer content or mutating RPCs are read/invoked.
-- Presence alone is not deployment completion: compare definitions with the frozen release,
-- verify worker versions/JWT controls, then authenticate and exercise each capability.
select 'table' kind,n.name object,
 to_regclass(n.name) is not null present,
 case when c.oid is not null then c.relrowsecurity else null end rls,
 case when c.oid is not null then has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') else null end member_can_write
from (values ('public.sales_source_history'),('public.sales_desk_messages'),('public.sales_execution_packages'),('public.sales_execution_events'),('private.sales_dispatch_jobs'),('private.sales_sender_readiness'),('private.sales_mail_evidence_jobs'),('private.sales_contact_discovery_jobs'),('private.sales_crm_threads'),('private.sales_reply_jobs'),('private.sales_contact_suppressions')) n(name)
left join pg_catalog.pg_class c on c.oid=to_regclass(n.name)
order by n.name;

select n.name object,p.oid is not null present,p.prosecdef security_definer,
 case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end anon_execute,
 case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end member_execute,
 case when p.oid is not null then has_function_privilege('service_role',p.oid,'EXECUTE') end service_execute,
 case when p.oid is not null then md5(pg_get_functiondef(p.oid)) end definition_hash
from (values
 ('public.sales_source_versions(uuid,integer)'),('public.sales_automation_readiness()'),('public.sales_desk_list(bigint)'),('public.sales_desk_submit(uuid,uuid,text,text)'),
 ('public.sales_strategies(integer)'),('public.sales_execution_get(uuid)'),('public.sales_execution_decide(uuid,integer,text,text)'),
 ('public.sales_dispatch_claim(uuid)'),('public.sales_dispatch_finish(uuid,uuid,text,text)'),
 ('public.sales_sender_check_begin()'),('public.sales_sender_check_finish(uuid,jsonb)'),
 ('public.sales_mail_evidence_claim(uuid,uuid)'),('public.sales_mail_evidence_finish(uuid,jsonb)'),
 ('public.sales_contact_discovery_claim(uuid,uuid)'),('public.sales_contact_discovery_finish(uuid,jsonb)'),
 ('public.sales_reply_claim(uuid,uuid)'),('public.sales_reply_finish(uuid,jsonb)'),
 ('private.sales_execution_material(uuid)'),('private.sales_execution_material_before_contact_evidence(uuid)'),
 ('private.sales_strategy_targets(uuid)'),('private.sales_execution_summary()'),('private.sales_strategy_brief()')
) n(name) left join pg_catalog.pg_proc p on p.oid=to_regprocedure(n.name)
order by n.name;

select t.tgname trigger_name,t.tgenabled enabled,n.nspname schema_name,c.relname table_name
from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and t.tgname in ('sales_source_capture','sales_execution_after_preparation','sales_dispatch_enqueue') order by t.tgname;

-- Run this statement only when the preflight confirms pg_cron is installed.
select jobname,schedule,active from cron.job where jobname like 'wkly_sales_%' order by jobname;
