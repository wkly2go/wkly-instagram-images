-- Open-ended AI sales planning. Approval authorizes internal preparation only.
begin;
create table public.sales_strategy_settings(id boolean primary key default true check(id),automatic boolean not null default true);
insert into public.sales_strategy_settings values(true,true);
create table public.sales_strategies(
 id uuid primary key,report_date date not null default (now() at time zone 'Asia/Seoul')::date,
 auto_slot integer check(auto_slot between 1 and 3),requested_by uuid not null references public.profiles(id),
 status text not null default '기획 중' check(status in ('기획 중','승인 대기','승인','수정 요청','보류','생성 실패')),
 preparation_status text not null default '미요청' check(preparation_status in ('미요청','준비 중','완료','확인 필요')),preparation jsonb,preparation_error text not null default '',
 plan jsonb,sources jsonb not null default '[]',source_status jsonb not null default '[]',
 feedback text not null default '',error text not null default '',revision integer not null default 1,
 created_at timestamptz not null default now(),decided_at timestamptz,decided_by uuid references public.profiles(id),
 unique(report_date,auto_slot),check(plan is null or (jsonb_typeof(plan)='object' and octet_length(plan::text)<=30000))
);
create index sales_strategies_date_idx on public.sales_strategies(created_at desc,id);
create table private.sales_strategy_jobs(
 id uuid primary key references public.sales_strategies(id),token uuid not null default gen_random_uuid(),claimed boolean not null default false,request_id bigint,started_at timestamptz not null default now()
);
create table private.sales_strategy_preparations(id uuid primary key default gen_random_uuid(),strategy_id uuid not null unique references public.sales_strategies(id),token uuid not null default gen_random_uuid(),claimed boolean not null default false,done boolean not null default false,started_at timestamptz not null default now());
alter table private.sales_strategy_preparations enable row level security;
revoke all on private.sales_strategy_preparations from public,anon,authenticated;
create table public.sales_strategy_tasks(
 id uuid primary key default gen_random_uuid(),strategy_id uuid not null references public.sales_strategies(id),ordinal integer not null,
 owner_id uuid not null references public.profiles(id),title text not null,output text not null,due_date date not null,status text not null default '대기' check(status in ('대기','진행','완료')),
 result text not null default '',revision integer not null default 1,updated_by uuid references public.profiles(id),updated_at timestamptz not null default now(),unique(strategy_id,ordinal)
);
alter table public.sales_strategy_settings enable row level security;
alter table public.sales_strategies enable row level security;
alter table public.sales_strategy_tasks enable row level security;
alter table private.sales_strategy_jobs enable row level security;
create policy strategies_read on public.sales_strategies for select to authenticated using((select public.is_active_member()));
create policy strategy_settings_read on public.sales_strategy_settings for select to authenticated using((select public.is_active_member()));
create policy strategy_tasks_read on public.sales_strategy_tasks for select to authenticated using((select public.is_active_member()));
revoke all on public.sales_strategy_settings,public.sales_strategies,public.sales_strategy_tasks from public,anon,authenticated;
revoke all on private.sales_strategy_jobs from public,anon,authenticated;
grant select on public.sales_strategy_settings,public.sales_strategies,public.sales_strategy_tasks to authenticated;

create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare snapshots jsonb; coverage jsonb; job_token uuid; net_id bigint;
begin
 perform pg_advisory_xact_lock(2147482998);
 if exists(select 1 from public.sales_strategies where id=p_id) then return p_id; end if;
 if exists(select 1 from public.sales_strategies where status='기획 중' and created_at>now()-interval '6 minutes') then raise exception '진행 중인 기획 결과를 먼저 확인해 주세요.'; end if;
 if (select count(*) from public.sales_strategies where report_date=(now() at time zone 'Asia/Seoul')::date)>=6 then raise exception '오늘의 기획 생성 한도 6건에 도달했습니다. 기존 안을 먼저 검토해 주세요.'; end if;
 -- Mix source types rather than hard-coding three business verticals. Current
 -- exclusions are checked before any evidence is sent to the model.
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into snapshots from (
  select id,name,source,left(evidence,1200) evidence,source_url,source_updated_at,signature from (
   select p.*,private.sales_prospect_signature(p) signature,row_number() over(partition by p.source order by p.source_updated_at desc nulls last,p.score desc,p.id) n
   from public.sales_prospects p where not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in ('보류','제외')
   and (p.end_date is null or p.end_date>=(now() at time zone 'Asia/Seoul')::date)
   and not exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0)
   and not exists(select 1 from public.growth_items g where p.source in ('민간 영업 후보','나라장터 보관 공고') and g.id::text=p.source_key and (g.status in ('제외','취소') or g.document->>'qualification'='불충족'))
  ) pool where n<=8 order by md5(id::text||p_id::text) limit 10
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into coverage from (select distinct on(source) source,status,source_at,note from public.sales_collection_runs order by source,started_at desc) x;
 insert into public.sales_strategies(id,auto_slot,requested_by,sources,source_status,feedback) values(p_id,p_slot,p_actor,snapshots,coverage,p_feedback);
 if not exists(select 1 from public.growth_ai_models where enabled) or not exists(select 1 from public.growth_ai_budgets where enabled and starts_at<=now() and ends_at>now() and limit_usd>spent_usd+reserved_usd) then
  update public.sales_strategies set status='생성 실패',error='AI 작성 모델 또는 사용 가능한 기간 한도가 설정되지 않았습니다.',revision=revision+1 where id=p_id;return p_id;
 end if;
 insert into private.sales_strategy_jobs(id) values(p_id) returning sales_strategy_jobs.token into job_token;
 select net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-planner',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('id',p_id,'token',job_token),timeout_milliseconds:=5000) into net_id;
 update private.sales_strategy_jobs set request_id=net_id where id=p_id;
 return p_id;
end $$;

create function public.sales_strategy_request(p_id uuid,p_feedback text default '') returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 새 영업 기획을 요청할 수 있습니다.' using errcode='42501'; end if;
 if p_id is null or p_feedback is null or char_length(p_feedback)>600 then raise exception '기획 방향은 600자 이내로 입력해 주세요.'; end if;
 return private.sales_strategy_queue(p_id,auth.uid(),btrim(p_feedback));
end $$;

create function public.sales_strategy_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.sales_strategies; recent jsonb; prep private.sales_strategy_preparations;
begin
 update private.sales_strategy_jobs set claimed=true where id=p_id and token=p_token and not claimed and started_at>now()-interval '5 minutes';
 if not found then
  update private.sales_strategy_preparations set claimed=true where id=p_id and token=p_token and not claimed and not done and started_at>now()-interval '5 minutes' returning * into prep;
  if prep.id is null then return null; end if;
  select * into p from public.sales_strategies where id=prep.strategy_id and status='승인' and preparation_status='준비 중';
  if p.id is null then return null; end if;
  return jsonb_build_object('id',prep.id,'phase','prepare','plan',p.plan,'actor',p.decided_by,'today',p.report_date,'sources',p.sources,'recent','[]'::jsonb,'feedback',p.feedback,'model',(select key from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1));
 end if;
 select * into p from public.sales_strategies where id=p_id and status='기획 중';
 if p.id is null then return null; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into recent from (select s.plan->>'title' title,s.plan->>'category' category,s.status,left(s.feedback,100) feedback,(select left(string_agg(t.result,E'\n' order by t.ordinal),300) from public.sales_strategy_tasks t where t.strategy_id=s.id and t.status='완료') result from public.sales_strategies s where s.plan is not null order by s.created_at desc limit 8) x;
 return jsonb_build_object('id',p.id,'actor',p.requested_by,'today',p.report_date,'sources',p.sources,'recent',recent,'feedback',p.feedback,'model',(select key from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1));
end $$;

create function public.sales_strategy_finish(p_id uuid,p_plan jsonb,p_error text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.sales_strategies; k text; step jsonb; v jsonb;
begin
 select * into p from public.sales_strategies where id=p_id for update;
 if p.id is null or p.status<>'기획 중' then return; end if;
 if not exists(select 1 from private.sales_strategy_jobs where id=p_id and claimed) then raise exception '인증된 기획 작업이 아닙니다.'; end if;
 if p_error<>'' then update public.sales_strategies set status='생성 실패',error=left(p_error,500),revision=revision+1 where id=p_id;return; end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or octet_length(p_plan::text)>30000 or p_plan-array['title','category','customer','opportunity','offer','why_now','approach','effect','resources','stop_rule','first_message','evidence_ids','questions','metrics','steps']<>'{}'::jsonb then raise exception '기획안 형식을 확인해 주세요.'; end if;
 foreach k in array array['title','category','customer','opportunity','offer','why_now','approach','effect','resources','stop_rule','first_message'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'string' or char_length(btrim(p_plan->>k)) not between 1 and (case when k='title' then 160 when k='category' then 60 else 1200 end) then raise exception '기획안 필수 내용이 잘못되었습니다.'; end if;
 end loop;
 foreach k in array array['questions','metrics'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'array' then raise exception '확인 사항과 지표가 필요합니다.'; end if;
  if jsonb_array_length(p_plan->k) not between 1 and 6 then raise exception '확인 사항과 지표 수를 확인해 주세요.'; end if;
  for v in select value from jsonb_array_elements(p_plan->k) loop if jsonb_typeof(v)<>'string' or char_length(btrim(v#>>'{}')) not between 1 and 500 then raise exception '확인 사항과 지표 형식을 확인해 주세요.'; end if; end loop;
 end loop;
 if jsonb_typeof(p_plan->'evidence_ids') is distinct from 'array' or jsonb_typeof(p_plan->'steps') is distinct from 'array' then raise exception '근거와 실행 순서가 필요합니다.'; end if;
 if jsonb_array_length(p_plan->'evidence_ids')>5 or jsonb_array_length(p_plan->'steps') not between 3 and 5 then raise exception '근거와 실행 순서 수를 확인해 주세요.'; end if;
 for v in select value from jsonb_array_elements(p_plan->'evidence_ids') loop
  if jsonb_typeof(v)<>'string' or not exists(select 1 from jsonb_array_elements(p.sources) s where s->>'id'=v#>>'{}') then raise exception '제공되지 않은 근거를 인용했습니다.'; end if;
 end loop;
 for step in select value from jsonb_array_elements(p_plan->'steps') loop
  if jsonb_typeof(step)<>'object' or step-array['action','output','day']<>'{}'::jsonb or jsonb_typeof(step->'action') is distinct from 'string' or char_length(btrim(step->>'action')) not between 1 and 300 or jsonb_typeof(step->'output') is distinct from 'string' or char_length(btrim(step->>'output')) not between 1 and 1000 or jsonb_typeof(step->'day') is distinct from 'number' or (step->>'day')::numeric not between 0 and 30 or (step->>'day')::numeric<>trunc((step->>'day')::numeric) then raise exception '실행 업무 형식을 확인해 주세요.'; end if;
 end loop;
 update public.sales_strategies set status='승인 대기',plan=p_plan,error='',revision=revision+1 where id=p_id;
end $$;

create function public.sales_strategies(p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 then raise exception '페이지를 확인해 주세요.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (select id,report_date,status,plan,sources,source_status,feedback,error,revision,created_at,decided_at,decided_by,preparation_status,preparation,preparation_error from public.sales_strategies order by created_at desc,id limit 10 offset p_page*10) x;
 return jsonb_build_object('items',items,'total',(select count(*) from public.sales_strategies),'automatic',(select automatic from public.sales_strategy_settings where id));
end $$;

create function public.sales_strategy_decide(p_id uuid,p_revision integer,p_decision text,p_feedback text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.sales_strategies; s jsonb; source public.sales_prospects; step jsonb; n integer:=0; prep private.sales_strategy_preparations;
begin
 if not public.is_admin() then raise exception '관리자만 영업 기획을 승인할 수 있습니다.' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('승인','수정 요청','보류') or p_feedback is null or char_length(p_feedback)>600 or (p_decision<>'승인' and char_length(btrim(p_feedback))<3) then raise exception '결정과 수정·보류 사유를 입력해 주세요.'; end if;
 select * into p from public.sales_strategies where id=p_id for update;
 if p.status=p_decision and p.decided_by=auth.uid() and p.revision=p_revision+1 then return; end if;
 if p.id is null or p.revision is distinct from p_revision or p.status<>'승인 대기' then raise exception '기획안이 변경되었습니다. 최신 내용을 다시 확인해 주세요.' using errcode='PT409'; end if;
 if p_decision='승인' then
  for s in select value from jsonb_array_elements(p.sources) where p.plan->'evidence_ids' ? (value->>'id') loop
   select * into source from public.sales_prospects where id=(s->>'id')::uuid;
   if source.id is null or private.sales_prospect_blocked(source) or coalesce(source.reviewed_assessment,source.assessment) in ('보류','제외') or source.end_date<(now() at time zone 'Asia/Seoul')::date or private.sales_prospect_signature(source) is distinct from s->>'signature' then raise exception '인용한 자료가 변경되거나 제외되었습니다. 최신 자료로 다시 기획해 주세요.' using errcode='PT409'; end if;
  end loop;
  for step in select value from jsonb_array_elements(p.plan->'steps') loop
   n:=n+1;insert into public.sales_strategy_tasks(strategy_id,ordinal,owner_id,title,output,due_date,updated_by) values(p.id,n,auth.uid(),step->>'action',step->>'output',(now() at time zone 'Asia/Seoul')::date+(step->>'day')::integer,auth.uid()) on conflict(strategy_id,ordinal) do nothing;
  end loop;
 end if;
 update public.sales_strategies set status=p_decision,feedback=btrim(p_feedback),decided_at=now(),decided_by=auth.uid(),revision=revision+1 where id=p_id;
 if p_decision='승인' then
  insert into private.sales_strategy_preparations(strategy_id) values(p_id) returning * into prep;
  update public.sales_strategies set preparation_status='준비 중' where id=p_id;
  perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-planner',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('id',prep.id,'token',prep.token),timeout_milliseconds:=5000);
 elsif p_decision='수정 요청' then
  begin
   perform private.sales_strategy_queue(gen_random_uuid(),auth.uid(),left('이전 제안: '||(p.plan->>'title')||'. 수정 의견: '||p_feedback,600));
  exception when others then
   update public.sales_strategies set error='수정 의견은 저장했습니다. 자동 재기획은 대기 중입니다: '||left(sqlerrm,300) where id=p_id;
  end;
 end if;
end $$;

create function public.sales_strategy_prepared(p_id uuid,p_plan jsonb,p_error text default '') returns void language plpgsql security definer set search_path='' as $$
declare prep private.sales_strategy_preparations; k text; item jsonb;
begin
 select * into prep from private.sales_strategy_preparations where id=p_id for update;
 if prep.id is null or not prep.claimed or prep.done then return; end if;
 if p_error<>'' then
  update public.sales_strategies set preparation_status='확인 필요',preparation_error=left(p_error,500) where id=prep.strategy_id;
  update private.sales_strategy_preparations set done=true where id=p_id;return;
 end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan-array['research','proposal','contact_draft','checks']<>'{}'::jsonb then raise exception '실행 자료 형식을 확인해 주세요.'; end if;
 foreach k in array array['research','proposal','contact_draft'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'string' or char_length(btrim(p_plan->>k)) not between 1 and 3000 then raise exception '실행 자료 필수 내용을 확인해 주세요.'; end if;
 end loop;
 if jsonb_typeof(p_plan->'checks') is distinct from 'array' then raise exception '실행 전 확인 사항이 필요합니다.'; end if;
 if jsonb_array_length(p_plan->'checks') not between 1 and 6 then raise exception '실행 전 확인 사항이 필요합니다.'; end if;
 for item in select value from jsonb_array_elements(p_plan->'checks') loop if jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}')) not between 1 and 500 then raise exception '확인 사항 형식이 잘못됐습니다.'; end if; end loop;
 update public.sales_strategies set preparation_status='완료',preparation=p_plan,preparation_error='' where id=prep.strategy_id and status='승인';
 update public.sales_strategy_tasks set status='진행',result='AI 준비 초안 · 외부 접촉 미실행'||E'\n'||case ordinal when 1 then p_plan->>'research' when 2 then p_plan->>'proposal' when 3 then p_plan->>'contact_draft' else p_plan->>'checks' end,revision=revision+1,updated_at=now() where strategy_id=prep.strategy_id and status='대기' and result='';
 update private.sales_strategy_preparations set done=true where id=p_id;
end $$;

create function public.sales_strategy_task_update(p_id uuid,p_revision integer,p_status text,p_result text) returns void language plpgsql security definer set search_path='' as $$
declare t public.sales_strategy_tasks;
begin
 if not public.is_admin() then raise exception '관리자만 승인된 실행 결과를 변경할 수 있습니다.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('대기','진행','완료') or p_result is null or char_length(p_result)>3000 or (p_status='완료' and char_length(btrim(p_result))<5) then raise exception '완료할 때는 확인 가능한 산출물·결과를 기록해 주세요.'; end if;
 select * into t from public.sales_strategy_tasks where id=p_id for update;
 if t.status=p_status and t.result=btrim(p_result) and t.revision=p_revision+1 and t.updated_by=auth.uid() then return; end if;
 if t.id is null or t.revision is distinct from p_revision then raise exception '실행 기록이 변경되었습니다. 다시 확인해 주세요.' using errcode='PT409'; end if;
 update public.sales_strategy_tasks set status=p_status,result=btrim(p_result),revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id;
end $$;
create function public.sales_strategy_automatic(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 자동 기획을 설정할 수 있습니다.' using errcode='42501'; end if;
 if p_enabled is null then raise exception '자동 기획 설정을 확인해 주세요.'; end if;
 update public.sales_strategy_settings set automatic=p_enabled where id;
end $$;

create function private.sales_strategy_schedule() returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; slot integer;
begin
 if not (select automatic from public.sales_strategy_settings where id) then return; end if;
 select id into actor from public.profiles where active and role='admin' and not is_agent order by id limit 1;
 if actor is null then return; end if;
 select n into slot from generate_series(1,3) n where not exists(select 1 from public.sales_strategies where report_date=(now() at time zone 'Asia/Seoul')::date and auto_slot=n) order by n limit 1;
 if slot is not null then perform private.sales_strategy_queue(gen_random_uuid(),actor,'서로 다른 고객군·상품 조합·접근 방식으로 오늘의 새로운 영업 기회를 기획해 주세요.',slot); end if;
end $$;
create function private.sales_strategy_receive() returns void language plpgsql security definer set search_path='' as $$
declare p record;
begin
 for p in select s.id from public.sales_strategies s join private.sales_strategy_jobs j on j.id=s.id where s.status='기획 중' and j.started_at<now()-interval '5 minutes' loop
  update public.sales_strategies set status='생성 실패',error='기획 결과가 도착하지 않았습니다. AI 사용 기록과 서버 상태를 확인해 주세요. 같은 유료 요청은 자동으로 반복하지 않습니다.',revision=revision+1 where id=p.id and status='기획 중';
  if exists(select 1 from public.growth_ai_usage where id=p.id and status='running') then perform public.growth_ai_finish(p.id,null,null,true); end if;
 end loop;
 for p in select id,strategy_id from private.sales_strategy_preparations where not done and started_at<now()-interval '5 minutes' loop
  update public.sales_strategies set preparation_status='확인 필요',preparation_error='AI 실행 자료의 결과가 도착하지 않았습니다. 사용 기록과 서버 상태를 확인해 주세요.' where id=p.strategy_id;
  update private.sales_strategy_preparations set done=true where id=p.id;
  if exists(select 1 from public.growth_ai_usage where id=p.id and status='running') then perform public.growth_ai_finish(p.id,null,null,true); end if;
 end loop;
end $$;
create function private.sales_strategy_brief() returns void language plpgsql security definer set search_path='' as $$
declare actor record; ready integer; failed integer;
begin
 select count(*) filter(where status='승인 대기'),count(*) filter(where status='생성 실패') into ready,failed from public.sales_strategies where report_date=(now() at time zone 'Asia/Seoul')::date;
 if ready+failed=0 then return; end if;
 for actor in select id from public.profiles where active and role='admin' and not is_agent loop
  perform public.notify(actor.id,'일일 보고','AI 영업 기획 브리핑',format('새 기획안 승인 대기 %s건 · 생성 확인 필요 %s건. 영업 기획실에서 근거·제안·실행 순서를 확인해 주세요.',ready,failed),'/sales');
 end loop;
end $$;

revoke all on function private.sales_strategy_queue(uuid,uuid,text,integer),private.sales_strategy_schedule(),private.sales_strategy_receive(),private.sales_strategy_brief() from public,anon,authenticated;
revoke all on function public.sales_strategy_claim(uuid,uuid),public.sales_strategy_finish(uuid,jsonb,text),public.sales_strategy_prepared(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_strategy_claim(uuid,uuid),public.sales_strategy_finish(uuid,jsonb,text),public.sales_strategy_prepared(uuid,jsonb,text) to service_role;
revoke all on function public.sales_strategies(integer),public.sales_strategy_request(uuid,text),public.sales_strategy_decide(uuid,integer,text,text),public.sales_strategy_task_update(uuid,integer,text,text),public.sales_strategy_automatic(boolean) from public,anon;
grant execute on function public.sales_strategies(integer),public.sales_strategy_request(uuid,text),public.sales_strategy_decide(uuid,integer,text,text),public.sales_strategy_task_update(uuid,integer,text,text),public.sales_strategy_automatic(boolean) to authenticated;
select cron.schedule('wkly_sales_strategy_prepare','45,50,55 23 * * *','select private.sales_strategy_schedule()');
select cron.schedule('wkly_sales_strategy_receive','*/2 * * * *','select private.sales_strategy_receive()');
select cron.schedule('wkly_sales_strategy_brief','0 0 * * *','select private.sales_strategy_brief()');
notify pgrst,'reload schema';
commit;
