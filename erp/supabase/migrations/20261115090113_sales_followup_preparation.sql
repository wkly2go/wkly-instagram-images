-- System-prepared, evidence-quoted follow-up drafts. No send authorization or transport.
begin;
create table private.sales_followup_jobs(
 sequence bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),
 actor uuid not null references public.profiles(id),input jsonb not null,input_hash text not null,
 state text not null default 'queued' check(state in ('queued','claimed','done','failed','stale')),
 plan jsonb,error text not null default '',created_at timestamptz not null default now(),finished_at timestamptz
);
create unique index sales_followup_active on private.sales_followup_jobs(dispatch_id) where state in ('queued','claimed');
create index sales_followup_history on private.sales_followup_jobs(dispatch_id,created_at desc);
revoke all on private.sales_followup_jobs from public,anon,authenticated,service_role;
create function private.sales_followup_input(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('reply',jsonb_build_object('id',r.message_id,'text',left(r.text,1600),'received_at',r.received_at),
 'sent',jsonb_build_object('subject',left(j.message->>'subject',160),'body',left(j.message->>'body',1200)),
 'proposal',left(coalesce(p.payload->'attachments'->0->>'content',''),1000),
 'pipeline',jsonb_build_object('stage',o.stage,'revision',o.revision))
 from private.sales_crm_threads c join private.sales_dispatch_jobs j on j.id=c.dispatch_id
 join public.sales_execution_packages p on p.id=j.package_id join public.sales_strategies s on s.id=c.strategy_id
 join lateral(select * from private.sales_crm_replies where dispatch_id=c.dispatch_id order by received_at desc,message_id desc limit 1) r on r.signal='reply'
 left join public.sales_opportunities o on o.id=c.opportunity_id
 where c.dispatch_id=p_id and c.stage<>'연락 중단' and c.sent_at>now()-interval '30 days' and s.status in ('승인 대기','승인') and p.status<>'보류'
 and (o.id is null or o.stage not in ('수주','실주','보류'))
 and not exists(select 1 from private.sales_contact_suppressions where recipient=c.recipient)
 and not exists(select 1 from public.brand_contacts where opt_out and lower(btrim(email))=c.recipient)
$$;
create function private.sales_followup_tick() returns void language plpgsql security definer set search_path='' as $$
declare c record;packet jsonb;hash text;gateway text;run uuid;run_token uuid;started integer:=0;daily_count integer;
begin
 if not pg_try_advisory_xact_lock(903150113) then return;end if;
 update private.sales_followup_jobs set state='failed',error='처리 시간 초과 · 기록 보존 · 중복 유료 호출 없이 시스템 처리 상태 대조 대상',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '5 minutes';
 if not exists(select 1 from public.growth_ai_models where enabled) or not exists(select 1 from public.growth_ai_budgets where enabled and starts_at<=now() and ends_at>now() and limit_usd>spent_usd+reserved_usd) then return;end if;
 select count(*) into daily_count from private.sales_followup_jobs where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date;
 if daily_count>=6 then return;end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;if coalesce(gateway,'')='' then return;end if;
 for c in select t.* from private.sales_crm_threads t where t.last_reply_at is not null and t.sent_at>now()-interval '30 days'
 and exists(select 1 from public.profiles where id=t.pipeline_actor and active and role='admin' and not is_agent)
 and not exists(select 1 from private.sales_followup_jobs j where j.dispatch_id=t.dispatch_id and j.state in ('queued','claimed'))
 and (select count(*) from private.sales_followup_jobs j where j.dispatch_id=t.dispatch_id and j.created_at>now()-interval '24 hours')<2
 order by (select max(j.created_at) from private.sales_followup_jobs j where j.dispatch_id=t.dispatch_id) nulls first,t.dispatch_id limit 20 loop
  packet:=private.sales_followup_input(c.dispatch_id);if packet is null then continue;end if;
  hash:=encode(sha256(convert_to(packet::text,'UTF8')),'hex');
  -- One paid generation per identical input. A changed reply/pipeline may create a new bounded version.
  if exists(select 1 from private.sales_followup_jobs where dispatch_id=c.dispatch_id and input_hash=hash) then continue;end if;
  insert into private.sales_followup_jobs(dispatch_id,actor,input,input_hash) values(c.dispatch_id,c.pipeline_actor,packet,hash) returning id,token into run,run_token;
  begin
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-followup',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',run,'token',run_token),timeout_milliseconds:=10000);
  exception when others then update private.sales_followup_jobs set state='failed',error='후속안 처리기 연결 실패 · 원문 보존 · 시스템 연결 복구 대상',finished_at=now() where id=run;end;
  started:=started+1;if started>=3 or daily_count+started>=6 then exit;end if;
 end loop;
end $$;
create function public.sales_followup_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_followup_jobs;current_input jsonb;model text;
begin
 select * into j from private.sales_followup_jobs where id=p_id and token=p_token and state='queued' and created_at>now()-interval '5 minutes' for update;if j.id is null then return null;end if;
 current_input:=private.sales_followup_input(j.dispatch_id);
 if current_input is distinct from j.input or not exists(select 1 from public.profiles where id=j.actor and active and role='admin' and not is_agent) then update private.sales_followup_jobs set state='stale',finished_at=now() where id=p_id;return null;end if;
 update private.sales_followup_jobs set state='claimed' where id=p_id;
 select key into model from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1;
 return jsonb_build_object('id',j.id,'actor',j.actor,'model',coalesce(model,'standard'),'input',j.input);
end $$;
create function public.sales_followup_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not exists(select 1 from private.sales_followup_jobs j join public.profiles u on u.id=j.actor where j.id=p_id and j.actor=p_user and j.state='claimed' and j.created_at>now()-interval '5 minutes' and u.active and u.role='admin' and not u.is_agent and j.input is not distinct from private.sales_followup_input(j.dispatch_id)) then raise exception 'Follow-up claim required' using errcode='42501';end if;
 return public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens);
end $$;
create function public.sales_followup_finish(p_id uuid,p_plan jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_followup_jobs;v jsonb;k text;activity uuid;c private.sales_crm_threads;
begin
 select * into j from private.sales_followup_jobs where id=p_id for update;
 if j.id is not null and j.state='done' and j.plan is not distinct from p_plan and coalesce(p_error,'')='' then return;end if;
 if j.id is not null and j.state='failed' and j.error=left(p_error,500) and p_plan is null then return;end if;
 if j.id is null or j.state<>'claimed' or j.created_at<=now()-interval '5 minutes' then raise exception 'Follow-up lease expired' using errcode='PT409';end if;
 if j.input is distinct from private.sales_followup_input(j.dispatch_id) or not exists(select 1 from public.profiles where id=j.actor and active and role='admin' and not is_agent) then update private.sales_followup_jobs set state='stale',finished_at=now() where id=p_id;return;end if;
 if coalesce(p_error,'')<>'' then update private.sales_followup_jobs set state='failed',error=left(p_error,500),finished_at=now() where id=p_id;return;end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan-array['summary','action','evidence','next_action','missing','draft']<>'{}' or pg_column_size(p_plan)>30000 or coalesce(p_plan->>'action','') not in ('prepare_reply','research','hold') then raise exception 'Invalid follow-up plan';end if;
 foreach k in array array['summary','next_action'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'string' or length(btrim(p_plan->>k)) not between 1 and (case k when 'summary' then 800 else 600 end) then raise exception 'Invalid follow-up text';end if;
 end loop;
 if jsonb_typeof(p_plan->'evidence') is distinct from 'array' or jsonb_array_length(p_plan->'evidence') not between 1 and 4 or jsonb_typeof(p_plan->'missing') is distinct from 'array' or jsonb_array_length(p_plan->'missing')>6 then raise exception 'Invalid follow-up evidence';end if;
 for v in select value from jsonb_array_elements(p_plan->'evidence') loop
  if jsonb_typeof(v) is distinct from 'object' or v-array['quote','meaning']<>'{}' or jsonb_typeof(v->'quote') is distinct from 'string' or length(btrim(v->>'quote')) not between 1 and 400 or strpos(j.input->'reply'->>'text',v->>'quote')=0 or jsonb_typeof(v->'meaning') is distinct from 'string' or length(btrim(v->>'meaning')) not between 1 and 500 then raise exception 'Unverified reply quotation';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_plan->'missing') loop
  if jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}')) not between 1 and 300 then raise exception 'Invalid missing evidence';end if;
 end loop;
 if p_plan->>'action'='prepare_reply' then
  v:=p_plan->'draft';
  if jsonb_typeof(v) is distinct from 'object' or v-array['subject','body']<>'{}' or jsonb_typeof(v->'subject') is distinct from 'string' or length(btrim(v->>'subject')) not between 1 and 200 or v->>'subject' ~ '[[:cntrl:]]' or jsonb_typeof(v->'body') is distinct from 'string' or length(btrim(v->>'body')) not between 1 and 3000 then raise exception 'Invalid reply draft';end if;
 elsif jsonb_typeof(p_plan->'draft') is distinct from 'null' then raise exception 'Unready plan cannot contain reply draft';end if;
 update private.sales_followup_jobs set state='done',plan=p_plan,finished_at=now() where id=p_id;
 select * into c from private.sales_crm_threads where dispatch_id=j.dispatch_id for update;
 if c.opportunity_id is not null and exists(select 1 from public.sales_opportunities where id=c.opportunity_id) then
  activity:=gen_random_uuid();insert into public.sales_activities(id,opportunity_id,kind,body,created_by) values(activity,c.opportunity_id,'메모','[시스템] 회신 후속안 초안 준비 · 외부 발송 승인 아님'||E'\n'||(p_plan->>'summary')||E'\n'||(p_plan->>'next_action'),j.actor);
  insert into private.sales_crm_pipeline_events(dispatch_id,event_key,opportunity_id,activity_id) values(c.dispatch_id,'followup:'||j.id::text,c.opportunity_id,activity);
 end if;
end $$;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_followup;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;
begin
 result:=public.sales_execution_get_before_followup(p_id);if result is null then return null;end if;
 select coalesce(jsonb_agg(t||jsonb_build_object('followup',jsonb_build_object('id',j.id,'state',case when j.id is not null and j.input is distinct from private.sales_followup_input(c.dispatch_id) then 'stale' else coalesce(j.state,'waiting') end,'plan',case when j.input is not distinct from private.sales_followup_input(c.dispatch_id) then j.plan else null end,'error',j.error,'created_at',j.created_at,'note','후속안은 검토용 초안입니다. 자동 조사 실행·외부 발송 승인 연결은 준비 중이며 사람이 자료를 가공할 필요가 없습니다.')) order by n),'[]') into rows
 from jsonb_array_elements(result->'crm'->'threads') with ordinality x(t,n) join private.sales_crm_threads c on c.dispatch_id=(t->>'dispatch_id')::uuid
 left join lateral(select * from private.sales_followup_jobs where dispatch_id=c.dispatch_id order by created_at desc,sequence desc limit 1) j on true;
 return jsonb_set(result,'{crm,threads}',rows);
end $$;
revoke all on function private.sales_followup_input(uuid),private.sales_followup_tick(),public.sales_execution_get_before_followup(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_followup_claim(uuid,uuid),public.sales_followup_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_followup_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_followup_claim(uuid,uuid),public.sales_followup_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_followup_finish(uuid,jsonb,text) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
select cron.schedule('wkly_sales_followup','*/5 * * * *','select private.sales_followup_tick()');
notify pgrst,'reload schema';
commit;
