-- Candidate research is private Sales data. It never changes shared contacts or authorizes sending.
begin;
create table private.sales_contact_discovery_jobs(
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),company_id uuid not null references public.clients(id) on delete cascade,
 company text not null,website text not null,seed_hash text not null,state text not null default 'queued' check(state in ('queued','claimed','done','expired')),
 created_at timestamptz not null default now(),finished_at timestamptz,result jsonb
);
create unique index sales_discovery_single_flight on private.sales_contact_discovery_jobs(company_id) where state in ('queued','claimed');
create index sales_discovery_history on private.sales_contact_discovery_jobs(company_id,created_at desc);
revoke all on private.sales_contact_discovery_jobs from public,anon,authenticated,service_role;
create function private.sales_discovery_seed(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('company_id',id,'company',name,'website',btrim(website),'seed_hash',encode(sha256(convert_to(jsonb_build_array(id,name,btrim(website))::text,'UTF8')),'hex'))
 from public.clients where id=p_id and length(btrim(website))<=1500 and btrim(website) ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(/[^[:space:]?#]*)?$' and btrim(website) !~ '[\\]'
$$;
create function private.sales_discovery_companies() returns setof uuid language sql stable set search_path='' as $$
 select distinct (t->>'company_id')::uuid from public.sales_strategies s cross join lateral jsonb_array_elements(private.sales_strategy_targets(s.id)) t
 where s.status in ('승인 대기','승인') and s.created_at>now()-interval '30 days' and t->>'status'<>'접촉 제외' and nullif(t->>'company_id','') is not null
$$;
create function private.sales_contact_discovery_tick() returns void language plpgsql security definer set search_path='' as $$
declare cid uuid;seed jsonb;gateway text;run uuid;key uuid;
begin
 if not pg_try_advisory_xact_lock(903150110) then return;end if;
 update private.sales_contact_discovery_jobs set state='expired',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '3 minutes';
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;if coalesce(gateway,'')='' then return;end if;
 for cid in select source.company_id from private.sales_discovery_companies() source(company_id) where private.sales_discovery_seed(source.company_id) is not null
 and not exists(select 1 from private.sales_contact_discovery_jobs j where j.company_id=source.company_id and (j.state in ('queued','claimed') or j.created_at>now()-interval '15 minutes'))
 and (select count(*) from private.sales_contact_discovery_jobs j where j.company_id=source.company_id and j.created_at>now()-interval '24 hours')<2
 and not exists(select 1 from private.sales_contact_discovery_jobs j where j.company_id=source.company_id and j.state='done' and j.result->>'status' in ('complete','partial','blocked') and not exists(select 1 from jsonb_array_elements(j.result->'pages') p where p->>'status'='failed') and j.seed_hash=private.sales_discovery_seed(source.company_id)->>'seed_hash' and j.finished_at>now()-interval '7 days')
 order by (select max(j.created_at) from private.sales_contact_discovery_jobs j where j.company_id=source.company_id) nulls first,source.company_id limit 3 loop
  seed:=private.sales_discovery_seed(cid);
  insert into private.sales_contact_discovery_jobs(company_id,company,website,seed_hash) values(cid,seed->>'company',seed->>'website',seed->>'seed_hash') returning id,token into run,key;
  begin perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-contact-discovery',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',run,'token',key),timeout_milliseconds:=10000);
  exception when others then update private.sales_contact_discovery_jobs set state='expired',finished_at=now() where id=run;end;
 end loop;
end $$;
create function public.sales_contact_discovery_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.sales_contact_discovery_jobs;
begin
 select * into job from private.sales_contact_discovery_jobs where id=p_id and token=p_token and state='queued' and created_at>now()-interval '3 minutes' for update;if job.id is null then return null;end if;
 if job.seed_hash is distinct from private.sales_discovery_seed(job.company_id)->>'seed_hash' or not exists(select 1 from private.sales_discovery_companies() id where id=job.company_id) then update private.sales_contact_discovery_jobs set state='expired',finished_at=now() where id=p_id;return null;end if;
 update private.sales_contact_discovery_jobs set state='claimed' where id=p_id;
 return jsonb_build_object('company_id',job.company_id,'company',job.company,'website',job.website);
end $$;
create function public.sales_contact_discovery_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job private.sales_contact_discovery_jobs;origin text;page jsonb;c jsonb;urls text[]:='{}';emails text[]:='{}';
begin
 select * into job from private.sales_contact_discovery_jobs where id=p_id for update;
 if job.id is null or job.state<>'claimed' or job.created_at<=now()-interval '3 minutes' then raise exception 'Discovery lease expired' using errcode='PT409';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['status','pages','candidates','limited']<>'{}' or coalesce(p_result->>'status','') not in ('complete','partial','blocked','unavailable') or jsonb_typeof(p_result->'limited') is distinct from 'boolean' or jsonb_typeof(p_result->'pages') is distinct from 'array' or jsonb_typeof(p_result->'candidates') is distinct from 'array' or pg_column_size(p_result)>50000 then raise exception 'Invalid discovery result';end if;
 if jsonb_array_length(p_result->'pages')>3 or jsonb_array_length(p_result->'candidates')>10 then raise exception 'Discovery bounds exceeded';end if;
 origin:='https://'||split_part(job.website,'/',3);
 for page in select value from jsonb_array_elements(p_result->'pages') loop
  if jsonb_typeof(page) is distinct from 'object' or page-ARRAY['url','status']<>'{}' or coalesce(page->>'status','') not in ('read','blocked','failed') or jsonb_typeof(page->'url') is distinct from 'string' or length(page->>'url')>1500 or left(page->>'url',length(origin)+1)<>origin||'/' or page->>'url' ~ '[[:space:]?#\\]' or page->>'url'=any(urls) then raise exception 'Invalid source page';end if;
  urls:=array_append(urls,page->>'url');
 end loop;
 for c in select value from jsonb_array_elements(p_result->'candidates') loop
  if jsonb_typeof(c) is distinct from 'object' or c-ARRAY['email','url','excerpt','role','domain_match']<>'{}' or jsonb_typeof(c->'email') is distinct from 'string' or length(c->>'email')>254 or c->>'email' !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or c->>'email'=any(emails) or coalesce(c->>'role','') not in ('partnership','general','non_sales') or jsonb_typeof(c->'excerpt') is distinct from 'string' or length(c->>'excerpt')>220 or jsonb_typeof(c->'domain_match') is distinct from 'boolean' or not exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'url'=c->>'url' and p->>'status'='read') then raise exception 'Invalid contact candidate';end if;
  if (c->>'domain_match')::boolean is distinct from (split_part(c->>'email','@',2)=regexp_replace(split_part(job.website,'/',3),'^www\.','')) then raise exception 'Invalid domain match';end if;
  emails:=array_append(emails,c->>'email');
 end loop;
 if (p_result->>'status' in ('complete','partial') and not exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'status'='read')) or (p_result->>'status' in ('blocked','unavailable') and jsonb_array_length(p_result->'candidates')>0) or (p_result->>'status'='complete' and ((p_result->>'limited')::boolean or exists(select 1 from jsonb_array_elements(p_result->'pages') p where p->>'status'<>'read'))) then raise exception 'Inconsistent discovery result';end if;
 if job.seed_hash is distinct from private.sales_discovery_seed(job.company_id)->>'seed_hash' or not exists(select 1 from private.sales_discovery_companies() id where id=job.company_id) then update private.sales_contact_discovery_jobs set state='expired',finished_at=now() where id=p_id;return;end if;
 update private.sales_contact_discovery_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
end $$;
create function private.sales_contact_discovery_report(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 with companies as(select distinct (t->>'company_id')::uuid id from jsonb_array_elements(private.sales_strategy_targets(p_id)) t where nullif(t->>'company_id','') is not null and t->>'status'<>'접촉 제외'),limited as(select id from companies order by id limit 20),rows as(
 select c.id,c.name,private.sales_discovery_seed(c.id) seed,case when j.state in ('queued','claimed') and j.created_at<=now()-interval '3 minutes' then 'expired' else j.state end state,j.finished_at,j.result,
 (select count(*) from private.sales_contact_discovery_jobs x where x.company_id=c.id and x.created_at>now()-interval '24 hours') attempts
 from limited l join public.clients c on c.id=l.id left join lateral(select * from private.sales_contact_discovery_jobs x where x.company_id=c.id and x.seed_hash=private.sales_discovery_seed(c.id)->>'seed_hash' and x.created_at>now()-interval '7 days' order by created_at desc limit 1) j on true)
 select jsonb_build_object('total',(select count(*) from companies),'scope','저장된 회사 웹사이트에서 최대 3페이지·10개 이메일 후보 탐색. DB의 주소는 공식 소유·담당 역할·수신 자격 검증 전이며 기존 회사·사람 연락처는 자동 덮어쓰지 않음.',
 'companies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'company',name,'website',seed->>'website','state',coalesce(state,'waiting'),'checked_at',finished_at,'attempts',attempts,
 'note',case when seed is null then '사용 가능한 HTTPS 웹사이트 미확보 · 시스템의 회사 도메인 추가 조사 대상' when state in ('queued','claimed') then '회사 웹사이트 연락 창구 자동 탐색 중' when result->>'status'='blocked' then '사이트 접근 규칙·주소 제한으로 조회 보류 · 대체 공식 출처 탐색 필요' when result->>'status' in ('complete','partial') then '연락 후보 확보 범위 확인 · 공식 소유·제안 목적 검증 전' when attempts>=2 then '24시간 2회 시도 한도 · 다음 허용 시각에 자동 재조회' else '다음 예약에서 자동 탐색 · 실패 시 최소 15분 간격으로 재시도' end,
 'limited',coalesce((result->>'limited')::boolean,false),'pages',coalesce(result->'pages','[]'),
 'candidates',(select coalesce(jsonb_agg(v||jsonb_build_object('excluded',exists(select 1 from public.brand_contacts b where b.opt_out and lower(btrim(b.email))=v->>'email'),'outreach_authorized',false)),'[]') from jsonb_array_elements(result->'candidates') v)) order by id),'[]') from rows))
$$;
alter function public.sales_execution_get(uuid) rename to sales_execution_get_before_discovery;
revoke all on function public.sales_execution_get_before_discovery(uuid) from public,anon,authenticated,service_role;
create function public.sales_execution_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin result:=public.sales_execution_get_before_discovery(p_id);if result is null then return null;end if;return result||jsonb_build_object('contact_discovery',private.sales_contact_discovery_report(p_id));end $$;
revoke all on function private.sales_discovery_seed(uuid),private.sales_discovery_companies(),private.sales_contact_discovery_tick(),private.sales_contact_discovery_report(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sales_contact_discovery_claim(uuid,uuid),public.sales_contact_discovery_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_contact_discovery_claim(uuid,uuid),public.sales_contact_discovery_finish(uuid,jsonb) to service_role;
revoke all on function public.sales_execution_get(uuid) from public,anon;
grant execute on function public.sales_execution_get(uuid) to authenticated;
select cron.schedule('wkly_sales_contact_discovery','*/10 * * * *','select private.sales_contact_discovery_tick()');
notify pgrst,'reload schema';
commit;
