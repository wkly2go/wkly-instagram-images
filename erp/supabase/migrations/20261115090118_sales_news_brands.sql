-- Turns saved news articles into sales targets: an AI pass names the brand and occasion each
-- article reports. A name is kept only when it is written in the article itself.
begin;
create table private.sales_news_brand_jobs (
 id uuid primary key default gen_random_uuid(), token uuid not null default gen_random_uuid(), actor uuid not null references public.profiles(id),
 state text not null default 'queued' check(state in ('queued','claimed','done','failed')), items jsonb not null,
 created_at timestamptz not null default now(), finished_at timestamptz, note text not null default ''
);
alter table private.sales_news_brand_jobs enable row level security;
revoke all on private.sales_news_brand_jobs from public,anon,authenticated;

create function private.sales_news_brands_tick() returns integer language plpgsql security definer set search_path='' as $$
declare gateway_key text; who uuid; batch jsonb; job private.sales_news_brand_jobs;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_news_brands',0)) then return 0; end if;
 update private.sales_news_brand_jobs set state='failed',finished_at=now(),note='판별 시간 초과' where state in ('queued','claimed') and created_at<now()-interval '5 minutes';
 if exists(select 1 from private.sales_news_brand_jobs where state in ('queued','claimed')) then return 0; end if;
 -- Three failures in an hour pause the pass instead of repeating a paid call that keeps failing.
 if (select count(*) from private.sales_news_brand_jobs where state='failed' and created_at>now()-interval '1 hour')>=3 then return 0; end if;
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 select id into who from public.profiles where active and role='admin' and not is_agent order by id limit 1;
 if coalesce(gateway_key,'')='' or who is null then return 0; end if;
 select jsonb_agg(jsonb_build_object('n',n,'id',id,'title',name,'summary',coalesce(event_data->>'summary','')) order by n) into batch
 from (select p.*,row_number() over(order by p.source_updated_at desc nulls last,p.id) n from public.sales_prospects p
  where p.source='네이버 뉴스' and not p.blocked and not (p.event_data ? 'ai_checked') and coalesce(p.event_data->>'ai_tries','0')::integer<2 and p.source_updated_at>now()-interval '14 days' limit 12) x;
 if batch is null then return 0; end if;
 update public.sales_prospects p set event_data=p.event_data||jsonb_build_object('ai_tries',coalesce(p.event_data->>'ai_tries','0')::integer+1) where p.id in (select (v->>'id')::uuid from jsonb_array_elements(batch) v);
 insert into private.sales_news_brand_jobs(actor,items) values(who,batch) returning * into job;
 perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-news-brands',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',job.id,'token',job.token),timeout_milliseconds:=10000);
 return jsonb_array_length(batch);
end $$;
create function public.sales_news_brands_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_news_brand_jobs; model text;
begin
 update private.sales_news_brand_jobs set state='claimed' where id=p_id and token=p_token and state='queued' and created_at>now()-interval '5 minutes' returning * into j;
 if j.id is null then return null; end if;
 select key into model from public.growth_ai_models where enabled order by case key when 'fast' then 0 when 'standard' then 1 else 2 end limit 1;
 return jsonb_build_object('id',j.id,'actor',j.actor,'model',coalesce(model,'fast'),'items',(select jsonb_agg(v-'id' order by (v->>'n')::integer) from jsonb_array_elements(j.items) v));
end $$;
create function public.sales_news_brands_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_task is distinct from 'classify' or not exists(select 1 from private.sales_news_brand_jobs j where j.id=p_id and j.actor=p_user and j.state='claimed' and j.created_at>now()-interval '5 minutes') then raise exception 'News claim required' using errcode='42501'; end if;
 return public.growth_ai_reserve(p_id,p_user,p_task,p_signature,p_model,p_input_tokens);
end $$;
create function public.sales_news_brands_finish(p_id uuid,p_rows jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_news_brand_jobs; r jsonb; item jsonb; art public.sales_prospects; cid uuid; key text; nums integer[]:='{}';
begin
 select * into j from private.sales_news_brand_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed' then return; end if;
 if p_rows is null then
  if p_error is null or char_length(p_error) not between 1 and 300 then raise exception 'Invalid news result'; end if;
  update private.sales_news_brand_jobs set state='failed',finished_at=now(),note=p_error where id=p_id; return;
 end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>jsonb_array_length(j.items) or pg_column_size(p_rows)>20000 then raise exception 'Invalid news result'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or r-ARRAY['n','relevant','brand','event','when','where']<>'{}' or jsonb_typeof(r->'n') is distinct from 'number' or jsonb_typeof(r->'relevant') is distinct from 'boolean'
   or jsonb_typeof(r->'brand') is distinct from 'string' or jsonb_typeof(r->'event') is distinct from 'string' or jsonb_typeof(r->'when') is distinct from 'string' or jsonb_typeof(r->'where') is distinct from 'string'
   or length(r->>'brand')>40 or length(r->>'event')>40 or length(r->>'when')>40 or length(r->>'where')>40 or (r->>'brand')||(r->>'event')||(r->>'when')||(r->>'where') ~ '[<>{}\\]|https?:|@' or (r->>'n')::integer=any(nums) then raise exception 'Invalid news row'; end if;
  select v into item from jsonb_array_elements(j.items) v where (v->>'n')::integer=(r->>'n')::integer;
  if item is null then raise exception 'Unknown news row'; end if;
  nums:=array_append(nums,(r->>'n')::integer);
  -- The brand has to be written in the stored article text; an invented name is rejected outright.
  if (r->>'relevant')::boolean and (length(private.sales_brand_key(r->>'brand'))<2 or strpos(regexp_replace(lower((item->>'title')||' '||(item->>'summary')),'[[:space:]]','','g'),regexp_replace(lower(r->>'brand'),'[[:space:]]','','g'))=0) then raise exception 'Brand not in article'; end if;
 end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  select v into item from jsonb_array_elements(j.items) v where (v->>'n')::integer=(r->>'n')::integer;
  select * into art from public.sales_prospects where id=(item->>'id')::uuid and source='네이버 뉴스' for update;
  if art.id is null then continue; end if;
  if not (r->>'relevant')::boolean then
   update public.sales_prospects set assessment=case when reviewed_assessment is null and not blocked then '보류' else assessment end,score=0,reasons='자동 판별: 공간·행사 영업과 관련이 낮은 보도',next_action='추가 조치 없음 · 필요하면 대화에서 다시 검토 요청',
    event_data=event_data||jsonb_build_object('ai_checked',now(),'ai_relevant',false),revision=revision+1 where id=art.id;
   continue;
  end if;
  update public.sales_prospects set organization=r->>'brand',next_action='시스템이 브랜드 공식 사이트 · 연락 창구를 추가 조사',
   event_data=event_data||jsonb_build_object('ai_checked',now(),'ai_relevant',true,'brand',r->>'brand','occasion',r->>'event','when',r->>'when','where',r->>'where'),revision=revision+1 where id=art.id;
  key:=private.sales_brand_key(r->>'brand');
  -- Link to an existing client only on one exact normalized-name match; similar names are never merged.
  select case when count(*)=1 then (array_agg(id))[1] end into cid from public.clients c where private.sales_brand_key(c.name)=key;
  insert into public.sales_prospects(source,source_key,name,entity_kind,organization,source_url,evidence,source_updated_at,client_id,next_action,event_data)
  values('news_brand',key,r->>'brand','회사',r->>'brand',art.source_url,
   left(concat_ws(' · ','보도에서 확인: 「'||art.name||'」',nullif(r->>'event',''),nullif(r->>'when',''),nullif(r->>'where',''),'보도 '||to_char(art.source_updated_at at time zone 'Asia/Seoul','YYYY-MM-DD'),'일정·담당 부서는 원문과 공식 사이트로 확인 필요'),1000),
   art.source_updated_at,cid,'시스템이 브랜드 공식 사이트 · 연락 창구를 추가 조사',jsonb_build_object('article_id',art.id,'article_title',art.name,'occasion',r->>'event','when',r->>'when','where',r->>'where','articles',1))
  -- The newest article stays as the evidence; every further article about the brand is counted.
  on conflict(source,source_key) do update set
   evidence=case when excluded.source_updated_at>=public.sales_prospects.source_updated_at then excluded.evidence else public.sales_prospects.evidence end,
   source_url=case when excluded.source_updated_at>=public.sales_prospects.source_updated_at then excluded.source_url else public.sales_prospects.source_url end,
   source_updated_at=greatest(excluded.source_updated_at,public.sales_prospects.source_updated_at),collected_at=now(),client_id=coalesce(public.sales_prospects.client_id,excluded.client_id),
   event_data=(case when excluded.source_updated_at>=public.sales_prospects.source_updated_at then excluded.event_data else public.sales_prospects.event_data end)
    ||jsonb_build_object('articles',coalesce((public.sales_prospects.event_data->>'articles')::integer,1)+case when public.sales_prospects.event_data->>'article_id'=excluded.event_data->>'article_id' then 0 else 1 end);
 end loop;
 update private.sales_news_brand_jobs set state='done',finished_at=now() where id=p_id;
end $$;
revoke all on function private.sales_news_brands_tick() from public,anon,authenticated;
revoke all on function public.sales_news_brands_claim(uuid,uuid),public.sales_news_brands_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_news_brands_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_news_brands_claim(uuid,uuid),public.sales_news_brands_ai_reserve(uuid,uuid,text,text,text,integer),public.sales_news_brands_finish(uuid,jsonb,text) to service_role;
-- One batch of 12 articles every ten minutes. Created switched off; it is enabled after a verified first run.
select cron.schedule('wkly_sales_news_brands','*/10 * * * *','select private.sales_news_brands_tick()');
select cron.alter_job((select jobid from cron.job where jobname='wkly_sales_news_brands'),active:=false);
notify pgrst,'reload schema';
commit;
