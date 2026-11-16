-- Event research targets real event sources only (city cultural events and collected event listings), not research
-- articles that were filed as opportunities, and may read event pages addressed by a short plain query string.
begin;
create or replace function private.sales_event_brand_seed(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('event_id',id,'title',name,'url',btrim(source_url),'seed_hash',encode(sha256(convert_to(jsonb_build_array(id,name,btrim(source_url))::text,'UTF8')),'hex'))
 from public.sales_prospects where id=p_id and coalesce(reviewed_kind,entity_kind)='영업 기회' and source in ('서울시 문화행사','event_listing') and not blocked
 and coalesce(reviewed_assessment,assessment)<>'제외' and (end_date is null or end_date>=(now() at time zone 'Asia/Seoul')::date)
 and length(btrim(source_url))<=1500 and btrim(source_url) ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(/[^[:space:]?#]*)?([?][A-Za-z0-9_=&%.+-]{1,255})?$' and btrim(source_url) !~ '[\\]'
$$;
create or replace function public.sales_event_brands_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job private.sales_event_brand_jobs;origin text;page jsonb;b jsonb;urls text[]:='{}';keys text[]:='{}';ev public.sales_prospects;cid uuid;
begin
 select * into job from private.sales_event_brand_jobs where id=p_id for update;
 if job.id is null or job.state<>'claimed' or job.created_at<=now()-interval '3 minutes' then raise exception 'Event research lease expired' using errcode='PT409';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['status','pages','brands','limited']<>'{}' or coalesce(p_result->>'status','') not in ('complete','partial','blocked','unavailable','no_list') or jsonb_typeof(p_result->'limited') is distinct from 'boolean' or jsonb_typeof(p_result->'pages') is distinct from 'array' or jsonb_typeof(p_result->'brands') is distinct from 'array' or pg_column_size(p_result)>60000 then raise exception 'Invalid event research result';end if;
 if jsonb_array_length(p_result->'pages')>3 or jsonb_array_length(p_result->'brands')>60 then raise exception 'Event research bounds exceeded';end if;
 origin:='https://'||split_part(job.url,'/',3);
 for page in select value from jsonb_array_elements(p_result->'pages') loop
  if jsonb_typeof(page) is distinct from 'object' or page-ARRAY['url','status']<>'{}' or coalesce(page->>'status','') not in ('read','blocked','failed') or jsonb_typeof(page->'url') is distinct from 'string' or length(page->>'url')>1500 or left(page->>'url',length(origin)+1)<>origin||'/' or page->>'url' ~ '[[:space:]#\\]' or page->>'url' !~ '^[^?]*([?][A-Za-z0-9_=&%.+-]{1,255})?$' or page->>'url'=any(urls) then raise exception 'Invalid source page';end if;
  urls:=array_append(urls,page->>'url');
 end loop;
 for b in select value from jsonb_array_elements(p_result->'brands') loop
  if jsonb_typeof(b) is distinct from 'object' or b-ARRAY['name','role','url','excerpt']<>'{}' or jsonb_typeof(b->'name') is distinct from 'string' or length(b->>'name') not between 2 and 40 or b->>'name' ~ '[<>{}\\]|https?:|@' or coalesce(b->>'role','') not in ('participant','sponsor') or jsonb_typeof(b->'excerpt') is distinct from 'string' or length(b->>'excerpt')>220
  or length(private.sales_brand_key(b->>'name'))<2 or private.sales_brand_key(b->>'name')=any(keys) or not exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'url'=b->>'url' and p->>'status'='read') then raise exception 'Invalid brand';end if;
  keys:=array_append(keys,private.sales_brand_key(b->>'name'));
 end loop;
 if (p_result->>'status' in ('complete','partial','no_list') and not exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'status'='read')) or (p_result->>'status' in ('blocked','unavailable','no_list') and jsonb_array_length(p_result->'brands')>0) or (p_result->>'status'='complete' and (jsonb_array_length(p_result->'brands')=0 or (p_result->>'limited')::boolean or exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'status'<>'read'))) then raise exception 'Inconsistent event research result';end if;
 if job.seed_hash is distinct from private.sales_event_brand_seed(job.event_id)->>'seed_hash' then update private.sales_event_brand_jobs set state='expired',finished_at=now() where id=p_id;return;end if;
 select * into ev from public.sales_prospects where id=job.event_id;
 for b in select value from jsonb_array_elements(p_result->'brands') loop
  -- Link to an existing client only on one exact normalized-name match; similar names are never merged.
  select case when count(*)=1 then (array_agg(id))[1] end into cid from public.clients c where private.sales_brand_key(c.name)=private.sales_brand_key(b->>'name');
  insert into public.sales_prospects(source,source_key,name,entity_kind,organization,source_url,evidence,client_id,end_date,next_action,event_data)
  values('event_participant',job.event_id::text||':'||private.sales_brand_key(b->>'name'),b->>'name','회사',left(ev.name,300),b->>'url',
   left('「'||ev.name||'」 공식 페이지의 '||case b->>'role' when 'sponsor' then '후원 · 협찬' else '참가' end||' 목록에서 확인: '||(b->>'excerpt'),1000),cid,ev.end_date,
   '시스템이 브랜드 공식 사이트 · 연락 창구를 추가 조사',jsonb_build_object('event_prospect_id',job.event_id,'event_title',ev.name,'event_role',b->>'role'))
  on conflict(source,source_key) do update set evidence=excluded.evidence,source_url=excluded.source_url,collected_at=now(),end_date=excluded.end_date,client_id=coalesce(public.sales_prospects.client_id,excluded.client_id);
 end loop;
 update private.sales_event_brand_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
end $$;
create or replace function public.sales_event_brands_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 return (with ev as(
  select p.id,p.name,p.organization,p.source_url,p.end_date,p.score,private.sales_event_brand_seed(p.id) seed,
   (select j from private.sales_event_brand_jobs j where j.event_id=p.id order by j.created_at desc limit 1) job,
   (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.event_data->>'event_role','source_url',b.source_url,'evidence',b.evidence,'known_client',b.client_id is not null) order by b.name),'[]') from public.sales_prospects b where b.source='event_participant' and b.event_data->>'event_prospect_id'=p.id::text and not b.blocked) brands
  from public.sales_prospects p where coalesce(p.reviewed_kind,p.entity_kind)='영업 기회' and p.source in ('서울시 문화행사','event_listing') and not p.blocked and coalesce(p.reviewed_assessment,p.assessment)<>'제외'
   and (p.end_date is null or p.end_date>=(now() at time zone 'Asia/Seoul')::date) order by p.score desc,p.end_date nulls last,p.id limit 60)
 select jsonb_build_object('scope','행사 공식 페이지(최대 3쪽)의 참가 · 후원 목록에 적힌 이름만 기록. 목록을 공개하지 않은 행사는 보류로 남기며 추정으로 채우지 않음. 연락 자격 · 담당자는 검증 전.',
  'events',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',name,'organizer',organization,'url',source_url,'end_date',end_date,
   'state',case when seed is null then 'no_page' when (job).id is null then 'waiting' when (job).state in ('queued','claimed') and (job).created_at>now()-interval '3 minutes' then 'reading' when (job).state='done' then (job).result->>'status' else 'retry' end,
   'note',case when seed is null then '읽을 수 있는 공식 페이지 주소가 없음 · 시스템의 행사 페이지 추가 조사 대상' when (job).id is null then '다음 예약에서 자동 조사' when (job).state='done' and (job).result->>'status'='no_list' then '공식 페이지에 참가 · 후원 목록이 공개되어 있지 않음 · 7일 뒤 다시 확인' when (job).state='done' and (job).result->>'status'='blocked' then '사이트 접근 규칙으로 조회 보류' when (job).state='done' and (job).result->>'status' in ('complete','partial') then '참가 · 후원 브랜드 확보' else '자동 재시도 예정 (24시간 2회 한도)' end,
   'checked_at',(job).finished_at,'brands',brands)),'[]'),'brand_total',coalesce(sum(jsonb_array_length(brands)),0)) from ev);
end $$;
revoke all on function private.sales_event_brand_seed(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_event_brands_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_event_brands_finish(uuid,jsonb) to service_role;
revoke all on function public.sales_event_brands_overview() from public,anon;
grant execute on function public.sales_event_brands_overview() to authenticated;
notify pgrst,'reload schema';
commit;
