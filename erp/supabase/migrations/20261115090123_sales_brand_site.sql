-- Finds each newly reported brand's own website and the contact route it publishes.
-- Found addresses are evidence for planning and drafts; they do not make a recipient eligible for sending.
begin;
create table private.sales_brand_site_jobs(
 id uuid primary key default gen_random_uuid(),token uuid not null default gen_random_uuid(),prospect_id uuid not null references public.sales_prospects(id) on delete cascade,brand text not null,
 state text not null default 'queued' check(state in ('queued','claimed','done','expired')),created_at timestamptz not null default now(),finished_at timestamptz,result jsonb
);
create unique index sales_brand_site_single on private.sales_brand_site_jobs(prospect_id) where state in ('queued','claimed');
alter table private.sales_brand_site_jobs enable row level security;
revoke all on private.sales_brand_site_jobs from public,anon,authenticated;
create function private.sales_brand_site_tick() returns integer language plpgsql security definer set search_path='' as $$
declare gateway text; b record; job private.sales_brand_site_jobs; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_brand_site',0)) then return 0; end if;
 update private.sales_brand_site_jobs set state='expired',finished_at=now() where state in ('queued','claimed') and created_at<now()-interval '3 minutes';
 -- Repeated outages (missing key, quota) pause the search instead of spending the monthly allowance on failures.
 if (select count(*) from private.sales_brand_site_jobs where created_at>now()-interval '1 hour' and (state='expired' or result->>'status'='unavailable'))>=3 then return 0; end if;
 select btrim(decrypted_secret) into gateway from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;if coalesce(gateway,'')='' then return 0; end if;
 for b in select p.id,p.name from public.sales_prospects p where p.source='news_brand' and not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in ('보류','제외') and not (p.event_data ? 'site_checked')
  and not exists(select 1 from private.sales_brand_site_jobs j where j.prospect_id=p.id and (j.state in ('queued','claimed') or j.created_at>now()-interval '6 hours'))
  and (select count(*) from private.sales_brand_site_jobs j where j.prospect_id=p.id)<3 order by p.source_updated_at desc nulls last,p.id limit 2 loop
  insert into private.sales_brand_site_jobs(prospect_id,brand) values(b.id,b.name) returning * into job;
  perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-brand-site',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,'apikey',gateway),body:=jsonb_build_object('id',job.id,'token',job.token),timeout_milliseconds:=10000);
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.sales_brand_site_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_brand_site_jobs;
begin
 update private.sales_brand_site_jobs set state='claimed' where id=p_id and token=p_token and state='queued' and created_at>now()-interval '3 minutes' returning * into j;
 if j.id is null then return null; end if;
 return jsonb_build_object('id',j.id,'brand',j.brand);
end $$;
create function public.sales_brand_site_finish(p_id uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_brand_site_jobs; e text; host text; addresses text[]:='{}';
begin
 select * into j from private.sales_brand_site_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed' then return; end if;
 if jsonb_typeof(p_result) is distinct from 'object' or p_result-ARRAY['status','homepage','contact_page','emails','note']<>'{}' or coalesce(p_result->>'status','') not in ('found','not_found','unavailable')
  or jsonb_typeof(p_result->'homepage') is distinct from 'string' or jsonb_typeof(p_result->'contact_page') is distinct from 'string' or jsonb_typeof(p_result->'note') is distinct from 'string' or length(p_result->>'note')>200
  or jsonb_typeof(p_result->'emails') is distinct from 'array' or jsonb_array_length(p_result->'emails')>3 then raise exception 'Invalid brand site result'; end if;
 if p_result->>'status'='found' then
  if p_result->>'homepage' !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/$' or length(p_result->>'homepage')>255 then raise exception 'Invalid homepage'; end if;
  host:=regexp_replace(split_part(p_result->>'homepage','/',3),'^www\.','');
  if p_result->>'contact_page'<>'' and (length(p_result->>'contact_page')>500 or p_result->>'contact_page' ~ '[[:space:]<>"\\]' or regexp_replace(split_part(p_result->>'contact_page','/',3),'^www\.','')<>host or left(p_result->>'contact_page',8)<>'https://') then raise exception 'Invalid contact page'; end if;
  for e in select jsonb_array_elements_text(p_result->'emails') loop
   if length(e)>254 or e !~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' or e=any(addresses) then raise exception 'Invalid address'; end if;
   addresses:=array_append(addresses,e);
  end loop;
  update public.sales_prospects set contact=left(concat_ws(' · ',nullif(array_to_string(addresses,', '),''),nullif(p_result->>'contact_page','')),1000),
   evidence=left(evidence||' · 자체 사이트 확인: '||(p_result->>'homepage'),6000),next_action='기획·제안 초안에 공개 문의 창구를 근거로 사용 · 발송 자격은 별도 확인',
   event_data=event_data||jsonb_build_object('site_checked',now(),'homepage',p_result->>'homepage','contact_page',p_result->>'contact_page','public_emails',p_result->'emails'),revision=revision+1 where id=j.prospect_id;
 elsif p_result->>'status'='not_found' then
  if p_result->>'homepage'<>'' or p_result->>'contact_page'<>'' or jsonb_array_length(p_result->'emails')>0 then raise exception 'Inconsistent brand site result'; end if;
  update public.sales_prospects set event_data=event_data||jsonb_build_object('site_checked',now(),'homepage',''),revision=revision+1 where id=j.prospect_id;
 end if;
 update private.sales_brand_site_jobs set state='done',finished_at=now(),result=p_result where id=p_id;
end $$;
revoke all on function private.sales_brand_site_tick() from public,anon,authenticated;
revoke all on function public.sales_brand_site_claim(uuid,uuid),public.sales_brand_site_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_brand_site_claim(uuid,uuid),public.sales_brand_site_finish(uuid,jsonb) to service_role;
-- Two brands every ten minutes, well inside the free monthly search allowance. Created switched off until the search key is set.
select cron.schedule('wkly_sales_brand_site','*/10 * * * *','select private.sales_brand_site_tick()');
select cron.alter_job((select jobid from cron.job where jobname='wkly_sales_brand_site'),active:=false);
commit;
