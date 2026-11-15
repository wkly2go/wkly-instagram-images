-- Prepare evidence and proposals before a decision; data work belongs to the system.
begin;
alter table public.sales_strategies add column preparation_before_approval boolean not null default false;
alter table public.sales_strategies add column targets jsonb not null default '[]';
alter table public.sales_strategies add column approval_snapshot jsonb;
alter table public.sales_strategy_tasks add column executor text not null default 'legacy' check(executor in ('legacy','system'));
alter table public.sales_strategy_tasks alter column owner_id drop not null;
alter table public.sales_strategy_tasks add constraint sales_task_executor_owner check((executor='system' and owner_id is null) or (executor='legacy' and owner_id is not null));

create function private.sales_strategy_targets(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',p.id,'name',p.name,'kind',coalesce(p.reviewed_kind,p.entity_kind),'source',p.source,'source_url',p.source_url,
 'company_id',c.id,'company',coalesce(c.name,p.organization,''),'person_id',h.id,'person',coalesce(h.name,b.contact_name,''),
 'email',e.email,'email_origin',e.origin,'source_signature',private.sales_prospect_signature(p),
 'status',case when private.sales_prospect_blocked(p) or coalesce(p.reviewed_assessment,p.assessment) in ('보류','제외') or p.end_date<(now() at time zone 'Asia/Seoul')::date or exists(select 1 from public.brand_contacts x where x.opt_out and lower(btrim(x.email))=e.email and e.email<>'') then '접촉 제외'
 when e.email='' then '연락처 자동 보완 대상' else '저장 연락처 연결' end,
 'next_action',case when e.email='' then '시스템의 공식 창구 추가 탐색 대상' else '시스템의 담당 역할·수신 자격·제안 적합성 검증 대상' end,
 'outreach_ready',false) order by p.id),'[]'::jsonb)
 from public.sales_strategies s join public.sales_prospects p on s.plan->'evidence_ids' ? p.id::text
 left join public.contacts h on h.id=p.contact_id and (p.client_id is null or h.client_id=p.client_id)
 left join public.clients c on c.id=coalesce(p.client_id,h.client_id)
 left join public.brand_contacts b on p.source='브랜드 연락처' and b.id::text=p.source_key
 cross join lateral (select lower(btrim(case when p.contact_id is not null then coalesce(h.email,'') when b.id is not null then coalesce(b.email,'') else coalesce(c.email,'') end)) raw_email,
 case when p.contact_id is not null then '담당자 DB' when b.id is not null then '브랜드 연락처 DB' when c.id is not null then '거래처 DB' else '연결 없음' end origin) raw
 cross join lateral (select case when char_length(raw_email)<=254 and raw_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then raw_email else '' end email,origin) e
 where s.id=p_id
$$;
revoke all on function private.sales_strategy_targets(uuid) from public,anon,authenticated;

create function private.sales_strategy_prepare_before_decision() returns trigger language plpgsql security definer set search_path='' as $$
declare prep private.sales_strategy_preparations;
begin
 update public.sales_strategies set preparation_before_approval=true,preparation_status='준비 중',targets=private.sales_strategy_targets(new.id) where id=new.id;
 insert into private.sales_strategy_preparations(strategy_id) values(new.id) returning * into prep;
 begin perform private.sales_strategy_post(prep.id,prep.token);
 exception when others then
  update public.sales_strategies set preparation_status='확인 필요',preparation_error='자동 준비 서버 연결 실패 · 기존 기획 보존 · 시스템 연결 복구 대상' where id=new.id;
  update private.sales_strategy_preparations set done=true where id=prep.id;
 end;
 return new;
end $$;
revoke all on function private.sales_strategy_prepare_before_decision() from public,anon,authenticated;
create trigger sales_strategy_prepare_before_decision after update of status on public.sales_strategies for each row when(old.status='기획 중' and new.status='승인 대기' and new.plan is not null) execute function private.sales_strategy_prepare_before_decision();
create or replace function public.sales_strategy_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.sales_strategies; recent jsonb; prep private.sales_strategy_preparations;
begin
 update private.sales_strategy_jobs set claimed=true where id=p_id and token=p_token and not claimed and started_at>now()-interval '5 minutes';
 if not found then
  update private.sales_strategy_preparations set claimed=true where id=p_id and token=p_token and not claimed and not done and started_at>now()-interval '5 minutes' returning * into prep;
  if prep.id is null then return null; end if;
  select * into p from public.sales_strategies where id=prep.strategy_id and (status='승인' or (status='승인 대기' and preparation_before_approval)) and preparation_status='준비 중';
  if p.id is null then return null; end if;
  return jsonb_build_object('id',prep.id,'phase','prepare','plan',p.plan,'actor',coalesce(p.decided_by,p.requested_by),'today',p.report_date,'sources',p.sources,'recent','[]'::jsonb,'feedback',p.feedback,'model',(select key from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1));
 end if;
 select * into p from public.sales_strategies where id=p_id and status='기획 중';
 if p.id is null then return null; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into recent from (select s.plan->>'title' title,s.plan->>'category' category,s.status,left(s.feedback,100) feedback,(select left(string_agg(t.result,E'\n' order by t.ordinal),300) from public.sales_strategy_tasks t where t.strategy_id=s.id and t.status='완료') result from public.sales_strategies s where s.plan is not null order by s.created_at desc limit 8) x;
 return jsonb_build_object('id',p.id,'actor',p.requested_by,'today',p.report_date,'sources',p.sources,'recent',recent,'feedback',p.feedback,'model',(select key from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1));
end $$;

create or replace function public.sales_strategy_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; usage_row public.growth_ai_usage; budget public.growth_ai_budgets; amount numeric; extra numeric;
begin
 if p_task is distinct from 'write' or not (
  exists(select 1 from private.sales_strategy_jobs j join public.sales_strategies s on s.id=j.id where j.id=p_id and j.claimed and s.requested_by=p_user)
  or exists(select 1 from private.sales_strategy_preparations j join public.sales_strategies s on s.id=j.strategy_id where j.id=p_id and j.claimed and not j.done and (s.status='승인' or (s.status='승인 대기' and s.preparation_before_approval)) and coalesce(s.decided_by,s.requested_by)=p_user)
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
 if budget.spent_usd+budget.reserved_usd+extra>budget.limit_usd then raise exception 'AI 한도에 도달했습니다. 자동 준비를 보류합니다. 사용 한도 결정을 기다립니다.'; end if;
 update public.growth_ai_budgets set reserved_usd=reserved_usd+extra where id=budget.id;
 update public.growth_ai_usage set reserved_usd=amount where id=p_id;
 return result;
end $$;

create or replace function public.sales_strategy_prepared(p_id uuid,p_plan jsonb,p_error text default '') returns void language plpgsql security definer set search_path='' as $$
declare prep private.sales_strategy_preparations; k text; item jsonb; target_id uuid;
begin
 select strategy_id into target_id from private.sales_strategy_preparations where id=p_id;
 perform 1 from public.sales_strategies where id=target_id for update;
 select * into prep from private.sales_strategy_preparations where id=p_id for update;
 if prep.id is null or not prep.claimed or prep.done then return; end if;
 if not exists(select 1 from public.sales_strategies where id=prep.strategy_id and (status='승인' or (status='승인 대기' and preparation_before_approval))) then update private.sales_strategy_preparations set done=true where id=p_id;return;end if;
 if prep.started_at<now()-interval '5 minutes' then p_error:='자동 준비 결과 도착 시간 초과 · 시스템 복구 대상';end if;
 if p_error<>'' then
  update public.sales_strategies set preparation_status='확인 필요',preparation_error=replace(left(p_error,500),'수동 작성으로 계속해 주세요.','자동 준비 보류 · 사용 한도 결정 필요'),revision=revision+1 where id=prep.strategy_id;
  update private.sales_strategy_preparations set done=true where id=p_id;return;
 end if;
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan-array['research','proposal','contact_draft','checks']<>'{}'::jsonb then raise exception '실행 자료 형식을 확인해 주세요.'; end if;
 foreach k in array array['research','proposal','contact_draft'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'string' or char_length(btrim(p_plan->>k)) not between 1 and 3000 then raise exception '실행 자료 필수 내용을 확인해 주세요.'; end if;
 end loop;
 if jsonb_typeof(p_plan->'checks') is distinct from 'array' then raise exception '실행 전 확인 사항이 필요합니다.'; end if;
 if jsonb_array_length(p_plan->'checks') not between 1 and 6 then raise exception '실행 전 확인 사항이 필요합니다.'; end if;
 for item in select value from jsonb_array_elements(p_plan->'checks') loop if jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}')) not between 1 and 500 then raise exception '확인 사항 형식이 잘못됐습니다.'; end if; end loop;
 update public.sales_strategies set preparation_status='완료',preparation=p_plan,preparation_error='',revision=revision+1 where id=prep.strategy_id and (status='승인' or (status='승인 대기' and preparation_before_approval));
 update public.sales_strategy_tasks set status='진행',result='AI 준비 초안 · 외부 접촉 미실행'||E'\n'||case ordinal when 1 then p_plan->>'research' when 2 then p_plan->>'proposal' when 3 then p_plan->>'contact_draft' else p_plan->>'checks' end,revision=revision+1,updated_at=now() where strategy_id=prep.strategy_id and status='대기' and result='';
 update private.sales_strategy_preparations set done=true where id=p_id;
end $$;

create or replace function public.sales_strategy_decide(p_id uuid,p_revision integer,p_decision text,p_feedback text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.sales_strategies; s jsonb; source public.sales_prospects; step jsonb; n integer:=0; prep private.sales_strategy_preparations;
begin
 if not public.is_admin() then raise exception '관리자만 영업 기획을 승인할 수 있습니다.' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('승인','수정 요청','보류') or p_feedback is null or char_length(p_feedback)>600 or (p_decision<>'승인' and char_length(btrim(p_feedback))<3) then raise exception '결정과 수정·보류 사유를 입력해 주세요.'; end if;
 select * into p from public.sales_strategies where id=p_id for update;
 if p.status=p_decision and p.decided_by=auth.uid() and p.revision=p_revision+1 then return; end if;
 if p.id is null or p.revision is distinct from p_revision or p.status<>'승인 대기' then raise exception '기획안이 변경되었습니다. 최신 내용을 다시 확인해 주세요.' using errcode='PT409'; end if;
 if p_decision='승인' then
  if p.preparation_before_approval and p.preparation_status<>'완료' then raise exception '시스템이 제안 자료를 준비 중이거나 복구가 필요합니다. 준비 완료 후 결정할 수 있습니다.';end if;
  if p.preparation_before_approval and p.targets is distinct from private.sales_strategy_targets(p_id) then raise exception '대상 회사·담당자·연락처가 변경되었습니다. 최신 자료로 재기획이 필요합니다.' using errcode='PT409';end if;
  for s in select value from jsonb_array_elements(p.sources) where p.plan->'evidence_ids' ? (value->>'id') loop
   select * into source from public.sales_prospects where id=(s->>'id')::uuid;
   if source.id is null or private.sales_prospect_blocked(source) or coalesce(source.reviewed_assessment,source.assessment) in ('보류','제외') or source.end_date<(now() at time zone 'Asia/Seoul')::date or private.sales_prospect_signature(source) is distinct from s->>'signature' then raise exception '인용한 자료가 변경되거나 제외되었습니다. 최신 자료로 다시 기획해 주세요.' using errcode='PT409'; end if;
  end loop;
  for step in select value from jsonb_array_elements(p.plan->'steps') loop
   n:=n+1;insert into public.sales_strategy_tasks(strategy_id,ordinal,owner_id,executor,title,output,due_date,updated_by) values(p.id,n,null,'system',step->>'action',step->>'output',(now() at time zone 'Asia/Seoul')::date+(step->>'day')::integer,auth.uid()) on conflict(strategy_id,ordinal) do nothing;
  end loop;
 end if;
 if p_decision<>'승인' and p.preparation_before_approval and p.preparation_status='준비 중' then
  update private.sales_strategy_preparations set done=true where strategy_id=p_id;
  update public.sales_strategies set preparation_status='확인 필요',preparation_error='기획 결정에 따라 추가 준비 중단 · 기존 자료 보존' where id=p_id;
 end if;
 update public.sales_strategies set status=p_decision,feedback=btrim(p_feedback),decided_at=now(),decided_by=auth.uid(),revision=revision+1 where id=p_id;
 if p_decision='승인' then
  update public.sales_strategies set approval_snapshot=jsonb_build_object('plan',p.plan,'preparation',p.preparation,'targets',p.targets,'sources',p.sources,'approved_at',now(),'approved_by',auth.uid(),'scope','기획 채택 · 외부 발송 미승인','outreach_enabled',false) where id=p_id;
 end if;
 if p_decision='승인' and not p.preparation_before_approval then
  insert into private.sales_strategy_preparations(strategy_id) values(p_id) returning * into prep;
  update public.sales_strategies set preparation_status='준비 중' where id=p_id;
  perform private.sales_strategy_post(prep.id,prep.token);
 elsif p_decision='수정 요청' then
  begin
   perform private.sales_strategy_queue(gen_random_uuid(),auth.uid(),left('이전 제안: '||(p.plan->>'title')||'. 수정 의견: '||p_feedback,600));
  exception when others then
   update public.sales_strategies set error='수정 의견은 저장했습니다. 자동 재기획은 대기 중입니다: '||left(sqlerrm,300) where id=p_id;
  end;
 end if;
end $$;

create or replace function public.sales_strategy_task_update(p_id uuid,p_revision integer,p_status text,p_result text) returns void language plpgsql security definer set search_path='' as $$
declare t public.sales_strategy_tasks;
begin
 if not public.is_admin() then raise exception '관리자만 승인된 실행 결과를 변경할 수 있습니다.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('대기','진행','완료') or p_result is null or char_length(p_result)>3000 or (p_status='완료' and char_length(btrim(p_result))<5) then raise exception '완료할 때는 확인 가능한 산출물·결과를 기록해 주세요.'; end if;
 select * into t from public.sales_strategy_tasks where id=p_id for update;
 if t.executor='system' then raise exception '시스템 업무는 자동 처리 기록으로 갱신합니다. 사람에게 자료 가공을 요청하지 않습니다.' using errcode='42501';end if;
 if t.status=p_status and t.result=btrim(p_result) and t.revision=p_revision+1 and t.updated_by=auth.uid() then return; end if;
 if t.id is null or t.revision is distinct from p_revision then raise exception '실행 기록이 변경되었습니다. 다시 확인해 주세요.' using errcode='PT409'; end if;
 update public.sales_strategy_tasks set status=p_status,result=btrim(p_result),revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id;
end $$;

create or replace function public.sales_strategies(p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 then raise exception '페이지를 확인해 주세요.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (select id,report_date,status,plan,sources,source_status,feedback,error,revision,created_at,decided_at,decided_by,preparation_before_approval,targets,approval_snapshot,preparation_status,preparation,preparation_error from public.sales_strategies order by created_at desc,id limit 10 offset p_page*10) x;
 return jsonb_build_object('items',items,'total',(select count(*) from public.sales_strategies),'automatic',(select automatic from public.sales_strategy_settings where id));
end $$;

create or replace function private.sales_strategy_receive() returns void language plpgsql security definer set search_path='' as $$
declare p record;
begin
 for p in select s.id from public.sales_strategies s join private.sales_strategy_jobs j on j.id=s.id where s.status='기획 중' and j.started_at<now()-interval '5 minutes' loop
  update public.sales_strategies set status='생성 실패',error='기획 결과가 도착하지 않았습니다. AI 사용 기록과 서버 상태를 확인해 주세요. 같은 유료 요청은 자동으로 반복하지 않습니다.',revision=revision+1 where id=p.id and status='기획 중';
  if exists(select 1 from public.growth_ai_usage where id=p.id and status='running') then perform public.growth_ai_finish(p.id,null,null,true); end if;
 end loop;
 for p in select id,strategy_id from private.sales_strategy_preparations where not done and started_at<now()-interval '5 minutes' loop
  update public.sales_strategies set preparation_status='확인 필요',preparation_error='자동 준비 결과 미도착 · 시스템 복구 대상 · 같은 유료 요청은 자동 반복하지 않습니다.',revision=revision+1 where id=p.strategy_id;
  update private.sales_strategy_preparations set done=true where id=p.id;
  if exists(select 1 from public.growth_ai_usage where id=p.id and status='running') then perform public.growth_ai_finish(p.id,null,null,true); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
