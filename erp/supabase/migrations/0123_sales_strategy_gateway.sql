-- Keep gateway JWT verification enabled. The existing public anon JWT is
-- configured in Vault as WKLY_EDGE_ANON_KEY; it is not a service-role key.
-- The separate one-time job token is still required by the worker.
begin;
create function private.sales_strategy_post(p_id uuid,p_token uuid) returns bigint
language plpgsql set search_path='' as $$
declare gateway_key text; request_id bigint;
begin
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 if coalesce(gateway_key,'')='' then raise exception '영업 기획 서버 호출 인증 설정을 확인해 주세요.'; end if;
 select net.http_post(
  url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-planner',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),
  body:=jsonb_build_object('id',p_id,'token',p_token),timeout_milliseconds:=10000
 ) into request_id;
 return request_id;
end $$;
revoke all on function private.sales_strategy_post(uuid,uuid) from public,anon,authenticated;
create or replace function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns uuid
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
 net_id:=private.sales_strategy_post(p_id,job_token);
 update private.sales_strategy_jobs set request_id=net_id where id=p_id;
 return p_id;
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
  perform private.sales_strategy_post(prep.id,prep.token);
 elsif p_decision='수정 요청' then
  begin
   perform private.sales_strategy_queue(gen_random_uuid(),auth.uid(),left('이전 제안: '||(p.plan->>'title')||'. 수정 의견: '||p_feedback,600));
  exception when others then
   update public.sales_strategies set error='수정 의견은 저장했습니다. 자동 재기획은 대기 중입니다: '||left(sqlerrm,300) where id=p_id;
  end;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
