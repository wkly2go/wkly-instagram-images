// Assemble reviewed migrations into one transaction. Never executes SQL.
export function salesReleaseSQL(sections){
const guard=`do $release$ begin
 if to_regclass('public.sales_source_history') is not null or to_regclass('public.sales_desk_messages') is not null or to_regclass('public.sales_execution_packages') is not null then
  raise exception 'Sales release partially/already installed. Stop and verify applied state; do not rerun.';
 end if;
 if to_regprocedure('public.sales_strategy_prepared(uuid,jsonb,text)') is null or to_regclass('public.mail_index') is null then raise exception 'Sales baseline missing';end if;
end $release$;`
return '-- REVIEW ONLY: production hold must be cleared. Deploy compatible workers first.\n-- One transaction; any error must roll back. Never run against partial/already-applied state.\nbegin;\n'+guard+'\n'+sections.join('\n')+'\ncommit;\n'
}
