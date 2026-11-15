-- Persist sales instructions, database evidence and reports without modifying shared chat/design.
begin;
create table public.sales_desk_messages (
 id uuid primary key, sequence bigint generated always as identity unique,
 owner_id uuid not null references public.profiles(id), agent_id uuid references public.profiles(id),
 agent_name text not null, agent_context jsonb not null default '{}'::jsonb,
 instruction text not null, action text not null check(action in ('조회','보고서','수집')),
 status text not null check(status in ('처리 중','완료','실패')), reply text not null default '',
 snapshot jsonb not null, report jsonb, created_at timestamptz not null default now(), finished_at timestamptz
);
create index sales_desk_owner_sequence on public.sales_desk_messages(owner_id,sequence desc);
alter table public.sales_desk_messages enable row level security;
create policy sales_desk_read on public.sales_desk_messages for select to authenticated using(owner_id=auth.uid() and public.is_active_member());
revoke all on public.sales_desk_messages from public,anon,authenticated;
grant select on public.sales_desk_messages to authenticated;
create table private.sales_desk_jobs(id uuid primary key references public.sales_desk_messages(id),token uuid not null default gen_random_uuid(),claimed boolean not null default false);
alter table private.sales_desk_jobs enable row level security;
revoke all on private.sales_desk_jobs from public,anon,authenticated;

create function private.sales_desk_snapshot(p_instruction text) returns jsonb language plpgsql set search_path='' as $$
declare terms text[]; since_at timestamptz; sources jsonb; matched integer;
begin
 if p_instruction ~ '이번[ ]?주' then since_at:=date_trunc('week',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'; end if;
 select array_agg(distinct term) into terms from (
  select case when char_length(t)>3 then regexp_replace(t,'(에서|으로|에게|까지|부터|관련|을|를|은|는|의|에)$','') else t end term
  from regexp_split_to_table(lower(p_instruction),'[^a-z0-9가-힣]+') t
 ) q where char_length(term)>=2 and term not in ('이번주','이번','신규','영업','자료','데이터','분석','분석해줘','분석해','조회','조회해줘','보고서','만들어','작성','작성해줘','알려줘','불러와','대상','추천','계획','기획','해줘','해주세요','정리','정리해줘','관련','이번에');
 select count(*) into matched from public.sales_prospects p where not private.sales_prospect_blocked(p)
 and (since_at is null or p.created_at>=since_at)
 and (terms is null or exists(select 1 from unnest(terms) t where strpos(lower(p.name||' '||p.organization||' '||p.evidence),t)>0));
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into sources from (
  select id,name,source,organization,entity_kind,left(evidence,1000) evidence,source_url,source_updated_at from public.sales_prospects p
  where not private.sales_prospect_blocked(p) and (since_at is null or p.created_at>=since_at)
  and (terms is null or exists(select 1 from unnest(terms) t where strpos(lower(p.name||' '||p.organization||' '||p.evidence),t)>0))
  order by source_updated_at desc nulls last,created_at desc,id limit 12
 ) x;
 return jsonb_build_object('at',now(),'scope',case when since_at is null then '저장 DB · 지시문 키워드 일치 · 최신 자료 최대 12건' else '이번 주 KST 최초 등록 자료 · 지시문 키워드 일치 · 최대 12건' end,
  'matched_total',matched,'sources',sources,
  'coverage',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select distinct on(source) source,status,left(note,250) note from public.sales_collection_runs order by source,started_at desc) x),
  'pipeline',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select stage,count(*) count from public.sales_opportunities group by stage) x));
end $$;
revoke all on function private.sales_desk_snapshot(text) from public,anon,authenticated;

create function public.sales_desk_submit(p_id uuid,p_agent uuid,p_action text,p_instruction text) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.sales_desk_messages; agent_name text:='영업 기획 AI'; context jsonb; v_snapshot jsonb; token uuid; gateway_key text;
begin
 if not public.is_admin() or not public.is_active_member() then raise exception '관리자만 AI 영업 업무를 지시할 수 있습니다.' using errcode='42501'; end if;
 if p_id is null or p_action is null or p_action not in ('조회','보고서','수집') or p_instruction is null or char_length(btrim(p_instruction)) not between 2 and 1200 then raise exception '업무 지시는 2~1,200자로 입력해 주세요.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sales_desk/'||auth.uid()::text,0));
 select * into prior from public.sales_desk_messages where id=p_id;
 if prior.id is not null then
  if prior.owner_id<>auth.uid() or prior.agent_id is distinct from p_agent or prior.action<>p_action or prior.instruction<>btrim(p_instruction) then raise exception '동일 요청의 내용이 다릅니다.'; end if;
  return p_id;
 end if;
 if p_agent is not null then
  select name into agent_name from public.profiles where id=p_agent and is_agent and active;
  if not found then raise exception '활성 AI 팀원을 선택해 주세요.'; end if;
  select jsonb_build_object('role',left(role,200),'instructions',left(instructions,400)) into context from public.ai_agents where profile_id=p_agent;
 end if;
 if p_action='보고서' and (select count(*) from public.sales_desk_messages where owner_id=auth.uid() and action='보고서' and created_at>=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')>=20 then raise exception '오늘의 보고서 요청 20건 한도에 도달했습니다.'; end if;
 if exists(select 1 from public.sales_desk_messages where owner_id=auth.uid() and status='처리 중' and created_at>now()-interval '5 minutes') then raise exception '처리 중인 업무 결과를 먼저 확인해 주세요.'; end if;
 v_snapshot:=private.sales_desk_snapshot(p_instruction);
 insert into public.sales_desk_messages(id,owner_id,agent_id,agent_name,agent_context,instruction,action,status,snapshot)
 values(p_id,auth.uid(),p_agent,agent_name,coalesce(context,'{}'),btrim(p_instruction),p_action,'처리 중',v_snapshot);
 if p_action='조회' then
  update public.sales_desk_messages set status='완료',reply=format('저장 자료 %s건 중 최신 %s건을 불러왔습니다. 원문과 수집 상태를 아래에서 확인할 수 있습니다. 진행 단계 집계는 전체 영업 기준입니다.',v_snapshot->>'matched_total',jsonb_array_length(v_snapshot->'sources')),finished_at=now() where id=p_id;
 elsif p_action='수집' then
  begin
   perform private.sales_collect();
   update public.sales_desk_messages set status='완료',reply='자료 취합을 요청했습니다. 중복 실행 방지로 기존 작업이 유지될 수 있으며 외부 자료 수집 완료를 뜻하지 않습니다. 잠시 후 자료 조회로 최신 수집 상태를 확인할 수 있습니다.',snapshot=private.sales_desk_snapshot(p_instruction),finished_at=now() where id=p_id;
  exception when others then update public.sales_desk_messages set status='실패',reply='취합 요청을 완료하지 못했습니다. 기존 자료는 보존했습니다. 서버 처리 상태를 확인해야 합니다.',finished_at=now() where id=p_id;end;
 else
  begin
   select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
   if coalesce(gateway_key,'')='' then raise exception 'gateway missing'; end if;
   insert into private.sales_desk_jobs(id) values(p_id) returning sales_desk_jobs.token into token;
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-desk',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',p_id,'token',token),timeout_milliseconds:=10000);
  exception when others then update public.sales_desk_messages set status='실패',reply='AI 보고서 서버 연결을 확인해야 합니다. 지시와 조회 자료는 저장했습니다.',finished_at=now() where id=p_id;end;
 end if;
 return p_id;
end $$;

create function public.sales_desk_list(p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by sequence),'[]') from (select id,sequence,owner_id,agent_name,instruction,action,status,reply,snapshot,report,created_at,finished_at from public.sales_desk_messages where owner_id=auth.uid() and (p_before is null or sequence<p_before) order by sequence desc limit 30) x);
end $$;
create function public.sales_desk_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.sales_desk_messages; model text; history jsonb;
begin
 select * into m from public.sales_desk_messages where id=p_id and status='처리 중' and action='보고서' and created_at>now()-interval '5 minutes' for update;
 if m.id is null or not exists(select 1 from public.profiles where id=m.owner_id and active and role='admin' and not is_agent) then return null; end if;
 update private.sales_desk_jobs set claimed=true where id=p_id and token=p_token and not claimed;
 if not found then return null; end if;
 select key into model from public.growth_ai_models where enabled order by case key when 'standard' then 0 when 'fast' then 1 else 2 end limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by sequence),'[]') into history from (select sequence,left(instruction,300) instruction,left(coalesce(report->>'summary',reply),400) reply from public.sales_desk_messages where owner_id=m.owner_id and sequence<m.sequence and status='완료' order by sequence desc limit 3) x;
 return jsonb_build_object('id',m.id,'actor',m.owner_id,'model',coalesce(model,'standard'),'agent',jsonb_build_object('name',m.agent_name,'role',coalesce(m.agent_context->>'role','영업 기획'),'instructions',coalesce(m.agent_context->>'instructions','')),'instruction',m.instruction,'snapshot',m.snapshot,'history',history);
end $$;
create function public.sales_desk_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'write' or not exists(select 1 from public.sales_desk_messages m join private.sales_desk_jobs j on j.id=m.id where m.id=p_id and m.owner_id=p_user and m.status='처리 중' and j.claimed and m.created_at>now()-interval '5 minutes') then raise exception '인증된 영업 대화 작업이 아닙니다.' using errcode='42501'; end if;
 return public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens);
end $$;
create function public.sales_desk_finish(p_id uuid,p_report jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare m public.sales_desk_messages; finding jsonb; v jsonb; k text;
begin
 select * into m from public.sales_desk_messages where id=p_id and status='처리 중' for update;
 if m.id is null then return; end if;
 if not exists(select 1 from private.sales_desk_jobs where id=p_id and claimed) then raise exception '인증된 작업이 아닙니다.'; end if;
 if coalesce(p_error,'')<>'' then update public.sales_desk_messages set status='실패',reply=left(p_error,500),finished_at=now() where id=p_id;return;end if;
 if jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>30000 or p_report-array['title','summary','findings','recommendations','limitations']<>'{}'::jsonb then raise exception '보고서 형식 오류'; end if;
 foreach k in array array['title','summary'] loop
  if jsonb_typeof(p_report->k) is distinct from 'string' or char_length(btrim(p_report->>k)) not between 1 and (case when k='title' then 160 else 1600 end) then raise exception '보고서 필수 내용 오류'; end if;
 end loop;
 foreach k in array array['findings','recommendations','limitations'] loop
  if jsonb_typeof(p_report->k) is distinct from 'array' then raise exception '보고서 항목 오류'; end if;
  if jsonb_array_length(p_report->k) not between 1 and 8 then raise exception '보고서 항목 개수 오류'; end if;
 end loop;
 for finding in select * from jsonb_array_elements(p_report->'findings') loop
  if jsonb_typeof(finding->'text') is distinct from 'string' or char_length(btrim(finding->>'text')) not between 1 and 1000 or jsonb_typeof(finding->'evidence_ids') is distinct from 'array' then raise exception '보고서 근거 오류'; end if;
  for v in select * from jsonb_array_elements(finding->'evidence_ids') loop
   if jsonb_typeof(v) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(m.snapshot->'sources') s where s->>'id'=v#>>'{}') then raise exception '제공되지 않은 근거'; end if;
  end loop;
 end loop;
 foreach k in array array['recommendations','limitations'] loop
  for v in select * from jsonb_array_elements(p_report->k) loop if jsonb_typeof(v) is distinct from 'string' or char_length(btrim(v#>>'{}')) not between 1 and 600 then raise exception '보고서 후속 내용 오류'; end if;end loop;
 end loop;
 update public.sales_desk_messages set status='완료',reply=p_report->>'summary',report=p_report,finished_at=now() where id=p_id;
end $$;
create function private.sales_desk_watchdog() returns void language sql security definer set search_path='' as $$
 update public.sales_desk_messages set status='실패',reply='처리 시간이 초과되었습니다. 지시와 DB 자료는 보존했으며 중복 AI 호출은 하지 않았습니다. 사용 기록과 서버 상태 확인이 필요합니다.',finished_at=now() where status='처리 중' and created_at<now()-interval '5 minutes'
$$;
revoke all on function private.sales_desk_watchdog() from public,anon,authenticated;
revoke all on function public.sales_desk_submit(uuid,uuid,text,text),public.sales_desk_list(bigint) from public,anon;
grant execute on function public.sales_desk_submit(uuid,uuid,text,text),public.sales_desk_list(bigint) to authenticated;
revoke all on function public.sales_desk_claim(uuid,uuid),public.sales_desk_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_desk_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_desk_claim(uuid,uuid),public.sales_desk_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_desk_finish(uuid,jsonb,text) to service_role;
select cron.schedule('wkly_sales_desk_watchdog','* * * * *','select private.sales_desk_watchdog()');
notify pgrst,'reload schema';
commit;
