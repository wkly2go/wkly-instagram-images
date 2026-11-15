-- Sales JSON needs more output than the general draft assistant. Keep its
-- existing budget, idempotency, concurrency and human-user checks intact.
begin;
create function public.sales_strategy_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; usage_row public.growth_ai_usage; budget public.growth_ai_budgets; amount numeric; extra numeric;
begin
 if p_task is distinct from 'write' or not (
  exists(select 1 from private.sales_strategy_jobs j join public.sales_strategies s on s.id=j.id where j.id=p_id and j.claimed and s.requested_by=p_user)
  or exists(select 1 from private.sales_strategy_preparations j join public.sales_strategies s on s.id=j.strategy_id where j.id=p_id and j.claimed and s.decided_by=p_user)
 ) then raise exception '인증된 영업 기획 작업이 아닙니다.' using errcode='42501'; end if;
 result:=public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens);
 if not (result->>'execute')::boolean then return result; end if;
 -- growth_ai_reserve holds the shared transaction lock. A rejected top-up
 -- rolls back its initial reservation too, before the provider is called.
 select * into usage_row from public.growth_ai_usage where id=p_id for update;
 select * into budget from public.growth_ai_budgets where id=usage_row.budget_id for update;
 amount:=ceil(p_input_tokens*(result->>'input_rate')::numeric+4096*(result->>'output_rate')::numeric)/1000000;
 if amount>1 then raise exception '요청당 비용 한도 $1을 넘습니다.'; end if;
 extra:=amount-usage_row.reserved_usd;
 if budget.spent_usd+budget.reserved_usd+extra>budget.limit_usd then raise exception 'AI 한도에 도달했습니다. 수동 작성으로 계속해 주세요.'; end if;
 update public.growth_ai_budgets set reserved_usd=reserved_usd+extra where id=budget.id;
 update public.growth_ai_usage set reserved_usd=amount where id=p_id;
 return result;
end $$;
revoke all on function public.sales_strategy_ai_reserve(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.sales_strategy_ai_reserve(uuid,uuid,text,text,text,integer) to service_role;
commit;
