-- Planning learns from decisions: for each sales method, how often it was approved or rejected and
-- the most recent rejection reasons are handed to the planner with every new plan.
begin;
create or replace function private.sales_method_learning() returns jsonb language sql stable security definer set search_path='' as $$
 with decided as (select left(plan->>'category',60) category,status,feedback,decided_at from public.sales_strategies where plan is not null and status in ('승인','수정 요청','보류') and created_at>now()-interval '90 days'),
 counted as (select category,count(*) filter (where status='승인')::integer approved,count(*) filter (where status<>'승인')::integer rejected from decided group by category order by count(*) desc,category limit 8)
 select coalesce(jsonb_agg(jsonb_build_object('category',c.category,'approved',c.approved,'rejected',c.rejected,'reasons',
  coalesce((select jsonb_agg(left(r.feedback,80) order by r.decided_at desc) from (select d.feedback,d.decided_at from decided d where d.category=c.category and d.status<>'승인' and btrim(d.feedback)<>'' order by d.decided_at desc nulls last limit 2) r),'[]'::jsonb)) order by c.approved+c.rejected desc,c.category),'[]'::jsonb) from counted c
$$;
revoke all on function private.sales_method_learning() from public,anon,authenticated;
do $$
declare def text; old text:='if job is null or job->>''phase'' is distinct from ''prepare'' then return job;end if;';
 new text:='if job is null then return null;end if; if job->>''phase'' is distinct from ''prepare'' then return job||jsonb_build_object(''learning'',private.sales_method_learning());end if;';
begin
 def:=pg_get_functiondef('public.sales_strategy_claim(uuid,uuid)'::regprocedure);
 if position('sales_method_learning' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner claim'; end if;
 execute replace(def,old,new);
end $$;
commit;
