-- Planning quality: planning and conversation use a stronger model with room to reason,
-- reservations cover the larger output caps, and the weekly budget renews itself.
begin;
-- Reasoning tokens are billed as output, so a reservation must cover the worker's full output cap.
create function private.sales_ai_topup(p_id uuid,p_input_tokens integer,p_cap integer,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare usage_row public.growth_ai_usage; budget public.growth_ai_budgets; amount numeric; extra numeric;
begin
 if not (p_result->>'execute')::boolean then return p_result; end if;
 -- growth_ai_reserve holds the shared transaction lock. A rejected top-up rolls back its reservation too, before the provider is called.
 select * into usage_row from public.growth_ai_usage where id=p_id for update;
 select * into budget from public.growth_ai_budgets where id=usage_row.budget_id for update;
 amount:=ceil(p_input_tokens*(p_result->>'input_rate')::numeric+p_cap*(p_result->>'output_rate')::numeric)/1000000;
 if amount>1 then raise exception '요청당 비용 한도 $1을 넘습니다.'; end if;
 extra:=amount-usage_row.reserved_usd;
 if extra<=0 then return p_result; end if;
 if budget.spent_usd+budget.reserved_usd+extra>budget.limit_usd then raise exception 'AI 한도에 도달했습니다. 자동 작업을 보류합니다. 사용 한도 결정을 기다립니다.'; end if;
 update public.growth_ai_budgets set reserved_usd=reserved_usd+extra where id=budget.id;
 update public.growth_ai_usage set reserved_usd=amount where id=p_id;
 return p_result;
end $$;
revoke all on function private.sales_ai_topup(uuid,integer,integer,jsonb) from public,anon,authenticated;

create or replace function public.sales_strategy_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not (
  exists(select 1 from private.sales_strategy_jobs j join public.sales_strategies s on s.id=j.id where j.id=p_id and j.claimed and s.requested_by=p_user)
  or exists(select 1 from private.sales_strategy_preparations j join public.sales_strategies s on s.id=j.strategy_id where j.id=p_id and j.claimed and not j.done and (s.status='승인' or (s.status='승인 대기' and s.preparation_before_approval)) and coalesce(s.decided_by,s.requested_by)=p_user)
 ) then raise exception '인증된 영업 기획 작업이 아닙니다.' using errcode='42501'; end if;
 return private.sales_ai_topup(p_id,p_input_tokens,12000,public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens));
end $$;
create or replace function public.sales_desk_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not exists(select 1 from public.sales_desk_messages m join private.sales_desk_jobs j on j.id=m.id where m.id=p_id and m.owner_id=p_user and m.status='처리 중' and j.claimed and m.created_at>now()-interval '5 minutes') then raise exception '인증된 영업 대화 작업이 아닙니다.' using errcode='42501'; end if;
 return private.sales_ai_topup(p_id,p_input_tokens,12000,public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens));
end $$;
create or replace function public.sales_followup_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not exists(select 1 from private.sales_followup_jobs j join public.profiles u on u.id=j.actor where j.id=p_id and j.actor=p_user and j.state='claimed' and j.created_at>now()-interval '5 minutes' and u.active and u.role='admin' and not u.is_agent and j.input is not distinct from private.sales_followup_input(j.dispatch_id)) then raise exception 'Follow-up claim required' using errcode='42501';end if;
 return private.sales_ai_topup(p_id,p_input_tokens,6000,public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens));
end $$;
create or replace function public.sales_news_brands_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'classify' or not exists(select 1 from private.sales_news_brand_jobs j where j.id=p_id and j.actor=p_user and j.state='claimed' and j.created_at>now()-interval '5 minutes') then raise exception 'News claim required' using errcode='42501'; end if;
 return private.sales_ai_topup(p_id,p_input_tokens,3000,public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens));
end $$;

-- Planning, conversation and follow-up already prefer 'standard'; bulk article sorting stays on 'fast'.
insert into public.growth_ai_models(key,label,enabled,model_id,input_rate,output_rate) values('standard','기획 · 대화',true,'claude-sonnet-5-5',2,10)
on conflict(key) do update set label=excluded.label,enabled=true,model_id=excluded.model_id,input_rate=excluded.input_rate,output_rate=excluded.output_rate;
-- 2026-11-15 대표 결정: 주간 AI 한도 15달러.
update public.growth_ai_budgets set limit_usd=15 where enabled and starts_at<=now() and ends_at>now() and limit_usd<15;

-- The approved weekly limit continues into the next week instead of stopping all AI work when a period ends.
create function private.sales_ai_budget_roll() returns void language plpgsql security definer set search_path='' as $$
declare last public.growth_ai_budgets;
begin
 if exists(select 1 from public.growth_ai_budgets where starts_at<=now() and ends_at>now()) then return; end if;
 select * into last from public.growth_ai_budgets where ends_at<=now() order by ends_at desc limit 1;
 -- A period the administrator switched off, or one with no limit, is a decision to stop and is not renewed.
 if last.id is null or not last.enabled or last.limit_usd<=0 or last.ends_at<now()-interval '14 days' then return; end if;
 if exists(select 1 from public.growth_ai_budgets where starts_at>now()) then return; end if;
 insert into public.growth_ai_budgets(id,starts_at,ends_at,limit_usd,enabled) values(gen_random_uuid(),now(),now()+interval '7 days',last.limit_usd,true);
end $$;
revoke all on function private.sales_ai_budget_roll() from public,anon,authenticated;
select cron.schedule('wkly_sales_ai_budget_roll','*/15 * * * *','select private.sales_ai_budget_roll()');
commit;
