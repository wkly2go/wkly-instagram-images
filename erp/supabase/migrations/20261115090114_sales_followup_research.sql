-- Execute bounded company-site research; never treat public content as permission or private demand.
begin;
create table private.sales_followup_research_jobs(
 sequence bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),dispatch_id uuid not null references private.sales_crm_threads(dispatch_id),
 seed jsonb not null,seed_hash text not null,questions jsonb not null,
 state text not null default 'queued' check(state in ('queued','claimed','done','expired')),
 created_at timestamptz not null default now(),finished_at timestamptz,result jsonb
);
create unique index sales_followup_research_active on private.sales_followup_research_jobs(dispatch_id) where state in ('queued','claimed');
create index sales_followup_research_history on private.sales_followup_research_jobs(dispatch_id,created_at desc);
revoke all on private.sales_followup_research_jobs from public,anon,authenticated,service_role;
alter function private.sales_followup_input(uuid) rename to sales_followup_input_before_research;
create function private.sales_followup_research_seed(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('base',base.value,'company',site.value)
 from private.sales_crm_threads c join public.sales_opportunities o on o.id=c.opportunity_id
 cross join lateral(select private.sales_followup_input_before_research(p_id) value) base
 cross join lateral(select private.sales_discovery_seed(o.client_id) value) site
 where c.dispatch_id=p_id and base.value is not null and site.value is not null
 and exists(select 1 from public.profiles where id=c.pipeline_actor and active and role='admin' and not is_agent)
$$;
create function private.sales_followup_research_tick() returns void language plpgsql security definer set search_path='' as $$
declare c record;seed jsonb;hash text;gateway text;run uuid;key uuid;started integer:=0;daily_count integer;
begin
 if not pg_try_advisory_xact_lock(903150114) then return;end if;
 update private.sales_followup_research_jobs set state='expired',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '3 minutes';
 select count(*) into daily_count from private.sales_followup_research_jobs where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date;if daily_count>=12 then return;end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;if coalesce(gateway,'')='' then return;end if;
 for c in select t.dispatch_id,f.plan from private.sales_crm_threads t
 join lateral(select * from private.sales_followup_jobs where dispatch_id=t.dispatch_id order by created_at desc,sequence desc limit 1) f on f.state='done'
 where (f.plan->>'action'='research' or (f.plan->>'action'='prepare_reply' and jsonb_array_length(f.plan->'missing')>0))
 and not exists(select 1 from private.sales_followup_research_jobs j where j.dispatch_id=t.dispatch_id and (j.state in ('queued','claimed') or j.created_at>now()-interval '15 minutes'))
 and (select count(*) from private.sales_followup_research_jobs j where j.dispatch_id=t.dispatch_id and j.created_at>now()-interval '24 hours')<2
 order by (select max(j.created_at) from private.sales_followup_research_jobs j where j.dispatch_id=t.dispatch_id) nulls first,t.dispatch_id limit 20 loop
  seed:=private.sales_followup_research_seed(c.dispatch_id);if seed is null then continue;end if;
  hash:=encode(sha256(convert_to(seed::text,'UTF8')),'hex');
  if exists(select 1 from private.sales_followup_research_jobs where dispatch_id=c.dispatch_id and seed_hash=hash and state='done' and finished_at>now()-interval '24 hours' and result->>'status' in ('complete','partial','blocked') and not exists(select 1 from jsonb_array_elements(result->'pages') p where p->>'status'='failed')) then continue;end if;
  insert into private.sales_followup_research_jobs(dispatch_id,seed,seed_hash,questions) values(c.dispatch_id,seed,hash,case when jsonb_array_length(c.plan->'missing')>0 then c.plan->'missing' else jsonb_build_array(left(c.plan->>'next_action',300)) end) returning id,token into run,key;
  begin
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-followup-research',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',run,'token',key),timeout_milliseconds:=10000);
  exception when others then update private.sales_followup_research_jobs set state='expired',finished_at=now() where id=run;end;
  started:=started+1;if started>=3 or daily_count+started>=12 then exit;end if;
 end loop;
end $$;
create function public.sales_followup_research_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_followup_research_jobs;
begin
 select * into j from private.sales_followup_research_jobs where id=p_id and token=p_token and state='queued' and created_at>now()-interval '3 minutes' for update;if j.id is null then return null;end if;
 if j.seed is distinct from private.sales_followup_research_seed(j.dispatch_id) then update private.sales_followup_research_jobs set state='expired',finished_at=now() where id=p_id;return null;end if;
 update private.sales_followup_research_jobs set state='claimed' where id=p_id;
 return jsonb_build_object('website',j.seed->'company'->>'website','questions',j.questions);
end $$;
create function public.sales_followup_research_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_followup_research_jobs;p jsonb;origin text;urls text[]:='{}';
begin
 select * into j from private.sales_followup_research_jobs where id=p_id for update;
 if j.id is not null and j.state='done' and j.result=p_result then return;end if;
 if j.id is null or j.state<>'claimed' or j.created_at<=now()-interval '3 minutes' then raise exception 'Research lease expired' using errcode='PT409';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-array['status','pages','limited']<>'{}' or pg_column_size(p_result)>30000 or coalesce(p_result->>'status','') not in ('complete','partial','blocked','unavailable') or jsonb_typeof(p_result->'limited') is distinct from 'boolean' or jsonb_typeof(p_result->'pages') is distinct from 'array' or jsonb_array_length(p_result->'pages')>3 then raise exception 'Invalid research result';end if;
 origin:='https://'||split_part(j.seed->'company'->>'website','/',3);
 for p in select value from jsonb_array_elements(p_result->'pages') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['url','status','excerpt']<>'{}' or coalesce(p->>'status','') not in ('read','blocked','failed') or jsonb_typeof(p->'url') is distinct from 'string' or length(p->>'url')>1500 or left(p->>'url',length(origin)+1)<>origin||'/' or p->>'url' ~ '[[:space:]?#\\]' or p->>'url'=any(urls) or jsonb_typeof(p->'excerpt') is distinct from 'string' or length(p->>'excerpt')>1200 or (p->>'status'<>'read' and p->>'excerpt'<>'') then raise exception 'Invalid research page';end if;
  urls:=array_append(urls,p->>'url');
 end loop;
 if (p_result->>'status' in ('complete','partial') and not exists(select 1 from jsonb_array_elements(p_result->'pages') item where item->>'status'='read')) or (p_result->>'status' in ('blocked','unavailable') and exists(select 1 from jsonb_array_elements(p_result->'pages') item where item->>'status'='read')) or (p_result->>'status'='complete' and ((p_result->>'limited')::boolean or exists(select 1 from jsonb_array_elements(p_result->'pages') item where item->>'status'<>'read'))) then raise exception 'Inconsistent research result';end if;
 if j.seed is distinct from private.sales_followup_research_seed(j.dispatch_id) then update private.sales_followup_research_jobs set state='expired',finished_at=now() where id=p_id;return;end if;
 update private.sales_followup_research_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
 -- Enrichment changes the next bounded AI input. Existing budget/daily caps remain authoritative.
 begin perform private.sales_followup_tick(); exception when others then null; end; -- Existing cron retries preparation; preserve collected evidence.
end $$;
create function private.sales_followup_input(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare base jsonb;current_seed jsonb;research jsonb;
begin
 base:=private.sales_followup_input_before_research(p_id);if base is null then return null;end if;
 current_seed:=private.sales_followup_research_seed(p_id);
 select jsonb_build_object('scope','저장 회사 사이트의 공개 내용 일부 · 회사 소유·사적 예산·구매 의향·수신 자격 미확인','pages',coalesce((select jsonb_agg(jsonb_build_object('url',p->>'url','excerpt',p->>'excerpt') order by n) from jsonb_array_elements(j.result->'pages') with ordinality x(p,n) where p->>'status'='read' and length(btrim(p->>'excerpt'))>0),'[]')) into research
 from private.sales_followup_research_jobs j where dispatch_id=p_id and j.seed=current_seed and j.state='done' and j.finished_at>now()-interval '24 hours' and exists(select 1 from jsonb_array_elements(j.result->'pages') p where p->>'status'='read' and length(btrim(p->>'excerpt'))>0) order by j.created_at desc,j.sequence desc limit 1;
 return case when research is null then base else base||jsonb_build_object('research',research) end;
end $$;
-- Additional page citations must be exact excerpts from the frozen research input.
alter function public.sales_followup_finish(uuid,jsonb,text) rename to sales_followup_finish_before_research;
create function public.sales_followup_finish(p_id uuid,p_plan jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_followup_jobs;e jsonb;
begin
 select * into j from private.sales_followup_jobs where id=p_id for update;
 if j.state='done' and j.plan is not distinct from p_plan and coalesce(p_error,'')='' then return;end if;
 if p_plan ? 'research_evidence' then
  if jsonb_typeof(p_plan->'research_evidence') is distinct from 'array' or jsonb_array_length(p_plan->'research_evidence')>3 then raise exception 'Invalid research citations';end if;
  for e in select value from jsonb_array_elements(p_plan->'research_evidence') loop
   if jsonb_typeof(e) is distinct from 'object' or e-array['url','quote']<>'{}' or jsonb_typeof(e->'url') is distinct from 'string' or jsonb_typeof(e->'quote') is distinct from 'string' or length(btrim(e->>'quote')) not between 1 and 400 or not exists(select 1 from jsonb_array_elements(j.input->'research'->'pages') p where p->>'url'=e->>'url' and strpos(p->>'excerpt',e->>'quote')>0) then raise exception 'Unverified research quotation';end if;
  end loop;
 end if;
 perform public.sales_followup_finish_before_research(p_id,p_plan-'research_evidence',p_error);
 if p_plan ? 'research_evidence' then update private.sales_followup_jobs set plan=p_plan where id=p_id and state='done';end if;
end $$;
create function private.sales_followup_research_report(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare j private.sales_followup_research_jobs;seed jsonb;attempts integer;note text;current boolean;
begin
 seed:=private.sales_followup_research_seed(p_id);
 select * into j from private.sales_followup_research_jobs where dispatch_id=p_id order by created_at desc,sequence desc limit 1;
 select count(*) into attempts from private.sales_followup_research_jobs where dispatch_id=p_id and created_at>now()-interval '24 hours';
 current:=j.seed=seed and j.state='done' and j.finished_at>now()-interval '24 hours';
 note:=case when seed is null then '조회 가능한 회사 사이트 또는 유효한 영업 연결 없음 · 시스템 자료 확보 대상. 사람에게 검색 업무를 넘기지 않습니다.'
 when current and j.result->>'status'='blocked' then '사이트 접근 제한 준수 · 우회 조회하지 않음. 다른 허용 출처 확보 대상.'
 when current and j.result->>'status'='unavailable' then case when attempts>=2 then '조회 실패 · 24시간 한도 후 시스템이 재시도' else '조회 실패 · 최소 15분 후 시스템이 재시도' end
 when current and not exists(select 1 from jsonb_array_elements(j.result->'pages') p where length(btrim(p->>'excerpt'))>0) then '조회한 범위에 활용할 원문 없음 · 시스템의 다른 허용 출처 확보 대상'
 when current then '공개 페이지 조회 결과 저장 · 확인된 범위로 후속안 자동 재준비. 공개되지 않은 예산·구매 의향은 미확인 유지.'
 when attempts>=2 then '24시간 조회 한도 · 다음 허용 시각에 시스템이 자동 재확인'
 when j.state in ('queued','claimed') and j.created_at>now()-interval '3 minutes' then '회사 사이트 자동 조회 대기·처리 중'
 else '추가 근거가 필요한 후속안을 시스템이 조회 · 실패 시 최소 15분 간격으로 자동 재시도' end;
 return jsonb_build_object('state',case when seed is null then 'unavailable' when current then j.result->>'status' else coalesce(j.state,'waiting') end,'attempts',attempts,'checked_at',j.finished_at,'note',note,'pages',case when current then j.result->'pages' else '[]'::jsonb end);
end $$;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_research;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;
begin
 result:=public.sales_execution_get_before_research(p_id);if result is null then return null;end if;
 select coalesce(jsonb_agg(jsonb_set(t,'{followup,note}',to_jsonb('시스템이 공개 근거를 조사하고 후속안을 준비합니다. 초안은 발송 승인이 아니며 다음 실행안 승인·전송 연결은 준비 중입니다.'::text))||jsonb_build_object('research',private.sales_followup_research_report((t->>'dispatch_id')::uuid)) order by n),'[]') into rows from jsonb_array_elements(result->'crm'->'threads') with ordinality x(t,n);
 return jsonb_set(result,'{crm,threads}',rows);
end $$;
revoke all on function private.sales_followup_input_before_research(uuid),private.sales_followup_input(uuid),private.sales_followup_research_seed(uuid),private.sales_followup_research_tick(),private.sales_followup_research_report(uuid),public.sales_followup_finish_before_research(uuid,jsonb,text),public.sales_execution_get_before_research(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_followup_research_claim(uuid,uuid),public.sales_followup_research_finish(uuid,jsonb),public.sales_followup_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_followup_research_claim(uuid,uuid),public.sales_followup_research_finish(uuid,jsonb),public.sales_followup_finish(uuid,jsonb,text) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
select cron.schedule('wkly_sales_followup_research','*/5 * * * *','select private.sales_followup_research_tick()');
notify pgrst,'reload schema';
commit;
