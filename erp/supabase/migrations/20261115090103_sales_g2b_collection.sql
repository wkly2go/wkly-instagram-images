-- Daily procurement discovery uses existing collection/report surfaces, not manual imports.
begin;
create table private.sales_g2b_jobs (
 run_id uuid primary key references public.sales_collection_runs(id), token uuid not null default gen_random_uuid(),
 claimed boolean not null default false, category text not null check(category in ('service','construction')),
 keyword text not null, start_date date not null, end_date date not null,
 last_page integer not null default 0, provider_total integer, scanned integer not null default 0, omitted integer not null default 0
);
create table private.sales_g2b_pages(run_id uuid references private.sales_g2b_jobs(run_id),page integer,payload_hash text not null,primary key(run_id,page));
create table private.sales_g2b_items(run_id uuid references private.sales_g2b_jobs(run_id),source_key text,primary key(run_id,source_key));
alter table private.sales_g2b_jobs enable row level security;
alter table private.sales_g2b_pages enable row level security;
alter table private.sales_g2b_items enable row level security;
revoke all on private.sales_g2b_jobs,private.sales_g2b_pages,private.sales_g2b_items from public,anon,authenticated;
create index sales_collection_source_day on public.sales_collection_runs(source,report_date,started_at desc);

create function private.sales_g2b_watchdog() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.sales_collection_runs r set status=case when count>0 then '일부 수집' else '실패' end,finished_at=now(),note='나라장터 수집 시간 초과 · 저장 자료 보존 · 다음 취합에서 일일 한도 내 재수집'
 where r.status='수집 중' and r.started_at<now()-interval '15 minutes' and exists(select 1 from private.sales_g2b_jobs j where j.run_id=r.id);
 -- Expired notices can fall outside future seven-day responses; retain the source and retire its assessment.
 update public.sales_prospects set assessment='보류',score=0,reasons='입찰 마감 · 다음 공고 또는 후속 수요 확인 필요',next_action='시스템이 새 공고와 후속 수요를 재탐색',revision=revision+1
 where source='나라장터 공식 API' and (end_date<(now() at time zone 'Asia/Seoul')::date or (coalesce(event_data->>'deadline','')<>'' and (event_data->>'deadline')::timestamptz<now())) and not blocked and assessment not in ('보류','제외');
end $$;
create function private.sales_g2b_queue() returns integer language plpgsql security definer set search_path='' as $$
declare route record; source_name text; run uuid; job_token uuid; gateway_key text; day date:=(now() at time zone 'Asia/Seoul')::date; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_g2b_collection',0)) then return 0; end if;
 perform private.sales_g2b_watchdog();
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 for route in select * from (values ('service','행사'),('service','전시'),('service','축제'),('service','박람회'),('service','홍보'),('service','컨퍼런스'),('construction','전시장'),('construction','인테리어')) q(category,keyword) loop
  source_name:='나라장터 '||(case route.category when 'service' then '용역' else '공사' end)||' · '||route.keyword;
  if exists(select 1 from public.sales_collection_runs where source=source_name and (status='수집 중' or (report_date=day and status='완료') or started_at>now()-interval '15 minutes')) then continue; end if;
  if (select count(*) from public.sales_collection_runs where source=source_name and report_date=day)>=3 then continue; end if;
  insert into public.sales_collection_runs(source,status,note) values(source_name,'수집 중','공식 API · 최근 7일 · 지정 검색어 자동 조회 중') returning id into run;
  if coalesce(gateway_key,'')='' then
   update public.sales_collection_runs set status='실패',finished_at=now(),note='나라장터 수집 서버 인증 연결 필요 · 기존 자료 보존' where id=run;continue;
  end if;
  begin
   insert into private.sales_g2b_jobs(run_id,category,keyword,start_date,end_date) values(run,route.category,route.keyword,day-6,day) returning token into job_token;
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-g2b',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',run,'token',job_token),timeout_milliseconds:=10000);
   n:=n+1;
  exception when others then update public.sales_collection_runs set status='실패',finished_at=now(),note='나라장터 수집 서버 요청 실패 · 기존 자료 보존' where id=run;end;
 end loop;
 return n;
end $$;
create function public.sales_g2b_claim(p_run uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_g2b_jobs;
begin
 perform 1 from public.sales_collection_runs where id=p_run and status='수집 중' and started_at>now()-interval '15 minutes' for update;
 if not found then return null; end if;
 update private.sales_g2b_jobs set claimed=true where run_id=p_run and token=p_token and not claimed returning * into j;
 if not found then return null; end if;
 return jsonb_build_object('category',j.category,'keyword',j.keyword,'startDate',j.start_date,'endDate',j.end_date);
end $$;
create function public.sales_g2b_page(p_run uuid,p_page integer,p_rows jsonb,p_total integer,p_omitted integer,p_stamp timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_g2b_jobs; r public.sales_collection_runs; item jsonb; expected integer; key text; signature text; previous_hash text; existing public.sales_prospects;
begin
 select * into r from public.sales_collection_runs where id=p_run and status='수집 중' and started_at>now()-interval '15 minutes' for update;
 select * into j from private.sales_g2b_jobs where run_id=p_run and claimed;
 if r.id is null or j.run_id is null then raise exception '수집 작업이 만료되었거나 인증되지 않았습니다.'; end if;
 if p_page is null or p_page not between 1 and 20 or p_total is null or p_total not between 0 and 10000000 or p_omitted is null or p_omitted not between 0 and 30 or p_stamp is null or p_stamp>now()+interval '1 minute' or p_stamp<r.started_at-interval '5 minutes' or jsonb_typeof(p_rows) is distinct from 'array' then raise exception '수집 페이지 형식 오류'; end if;
 if octet_length(p_rows::text)>100000 then raise exception '수집 페이지 크기 초과'; end if;
 expected:=least(30,greatest(p_total-(p_page-1)*30,0));
 if jsonb_array_length(p_rows)+p_omitted<>expected then raise exception '수집 페이지 개수 불일치'; end if;
 signature:=md5(jsonb_build_array(p_rows,p_total,p_omitted)::text);
 select payload_hash into previous_hash from private.sales_g2b_pages where run_id=p_run and page=p_page;
 if found then
  if signature<>previous_hash then raise exception '이미 저장한 페이지의 내용이 다릅니다.'; end if;
  return;
 end if;
 if p_page<>j.last_page+1 or (j.provider_total is not null and j.provider_total<>p_total) then raise exception '수집 순서 또는 전체 건수가 변경되었습니다.'; end if;
 for item in select value from jsonb_array_elements(p_rows) order by value->>'number',value->>'round' loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'number','')!~'^[A-Za-z0-9_-]{1,60}$' or coalesce(item->>'round','')!~'^[A-Za-z0-9_-]{1,10}$' or char_length(btrim(coalesce(item->>'title',''))) not between 1 and 160 or char_length(btrim(coalesce(item->>'agency',''))) not between 1 and 200 then raise exception '공고 필수 항목 오류'; end if;
  if coalesce(item->>'source_url','')<>'' and (item->>'source_url'!~*'^https?://([a-z0-9-]+\.)*g2b\.go\.kr(/|\?|$)' or item->>'source_url'~'[[:space:]]') then raise exception '공식 공고 URL 오류'; end if;
  if coalesce(item->>'deadline','')<>'' and item->>'deadline'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$' then raise exception '공고 마감 형식 오류'; end if;
  key:=j.category||':'||(item->>'number')||':'||(item->>'round');
  -- Cross-keyword workers serialize per notice, preserving prior exclusions and reviewed links.
  perform pg_advisory_xact_lock(hashtextextended('sales_g2b_notice/'||key,0));
  select * into existing from public.sales_prospects where source='나라장터 공식 API' and source_key=key;
  perform private.sales_index('나라장터 공식 API',key,jsonb_build_object('name',item->>'title','entity_kind','영업 기회','organization',item->>'agency','source_url',coalesce(item->>'source_url',''),'source_updated_at',nullif(item->>'notice_date','')::timestamptz,'end_date',case when coalesce(item->>'deadline','')<>'' then ((item->>'deadline')::timestamptz at time zone 'Asia/Seoul')::date end,
   'contact',coalesce(existing.contact,''),'client_id',existing.client_id,'contact_id',existing.contact_id,'blocked',coalesce(existing.blocked,false),
   'evidence',concat_ws(' · ','조달청 공식 입찰 공고',(item->>'number')||'-'||(item->>'round'),item->>'agency','마감 '||coalesce(nullif(item->>'deadline',''),'미확인'),'추정가격 '||coalesce(item->>'amount','미확인')||'원','참가 자격·과업 범위·발주 조건은 추가 검증 필요'),
   'event_data',item||jsonb_build_object('category',j.category)));
  insert into private.sales_g2b_items values(p_run,key) on conflict do nothing;
 end loop;
 insert into private.sales_g2b_pages values(p_run,p_page,signature);
 update private.sales_g2b_jobs set last_page=p_page,provider_total=p_total,scanned=scanned+expected,omitted=omitted+p_omitted where run_id=p_run;
 update public.sales_collection_runs set count=(select count(*) from private.sales_g2b_items where run_id=p_run),scanned=j.scanned+expected,total=p_total,source_at=p_stamp,note='공식 API 페이지 저장 중 · 수집 완료 전' where id=p_run;
end $$;
create function public.sales_g2b_finish(p_run uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_g2b_jobs; r public.sales_collection_runs;
begin
 select * into r from public.sales_collection_runs where id=p_run for update;
 if r.id is null or r.status<>'수집 중' then return; end if;
 select * into j from private.sales_g2b_jobs where run_id=p_run and claimed;
 if j.run_id is null then raise exception '인증된 수집 작업이 아닙니다.'; end if;
 if p_status is null or p_status not in ('완료','일부 수집','실패') or p_note is null or char_length(p_note)>1000 then raise exception '수집 결과 형식 오류'; end if;
 if p_status='완료' and (r.started_at<=now()-interval '15 minutes' or j.provider_total is null or j.scanned<>j.provider_total or j.omitted>0 or r.count<>j.scanned) then raise exception '전체 조회를 확인할 수 없습니다.'; end if;
 update public.sales_collection_runs set status=p_status,finished_at=now(),note=p_note where id=p_run;
 perform private.sales_g2b_watchdog();
end $$;
create function private.sales_g2b_after_internal() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.sales_g2b_queue();return new;end $$;
-- Existing 08:00/08:20/08:40 KST collection and chat collection requests reach this hook.
create trigger sales_g2b_after_internal after insert on public.sales_collection_runs for each row when (new.source='사내 영업 자료' and new.status='완료') execute function private.sales_g2b_after_internal();
revoke all on function private.sales_g2b_queue(),private.sales_g2b_watchdog(),private.sales_g2b_after_internal() from public,anon,authenticated;
revoke all on function public.sales_g2b_claim(uuid,uuid),public.sales_g2b_page(uuid,integer,jsonb,integer,integer,timestamptz),public.sales_g2b_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sales_g2b_claim(uuid,uuid),public.sales_g2b_page(uuid,integer,jsonb,integer,integer,timestamptz),public.sales_g2b_finish(uuid,text,text) to service_role;
select cron.schedule('wkly_sales_g2b_watchdog','* * * * *','select private.sales_g2b_watchdog()');
notify pgrst,'reload schema';
commit;
