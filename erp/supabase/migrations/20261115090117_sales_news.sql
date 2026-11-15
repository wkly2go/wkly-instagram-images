-- News discovery for pop-ups, festivals and fairs through the official NAVER API HUB search.
-- Articles are saved as unverified leads; outreach still requires the approved package flow.
begin;
create table private.sales_news_jobs (
 run_id uuid primary key references public.sales_collection_runs(id), token uuid not null default gen_random_uuid(),
 claimed boolean not null default false, keyword text not null, days integer not null default 3 check(days between 1 and 14), saved boolean not null default false
);
alter table private.sales_news_jobs enable row level security;
revoke all on private.sales_news_jobs from public,anon,authenticated;

create function private.sales_news_queue() returns integer language plpgsql security definer set search_path='' as $$
declare word text; source_name text; run uuid; job_token uuid; gateway_key text; day date:=(now() at time zone 'Asia/Seoul')::date; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_news_collection',0)) then return 0; end if;
 update public.sales_collection_runs r set status='실패',finished_at=now(),note='네이버 뉴스 수집 시간 초과 · 기존 자료 보존 · 다음 예약에서 다시 수집'
 where r.status='수집 중' and r.started_at<now()-interval '10 minutes' and exists(select 1 from private.sales_news_jobs j where j.run_id=r.id);
 -- Old articles stop being leads; keep the record and any human review.
 update public.sales_prospects set assessment='보류',score=0,reasons='보도 후 60일 경과 · 새 소식 확인 필요',next_action='시스템이 새 보도와 다음 회차를 재탐색',revision=revision+1
 where source='네이버 뉴스' and source_updated_at<now()-interval '60 days' and not blocked and assessment not in ('보류','제외');
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 foreach word in array array['팝업스토어 오픈','팝업스토어 예정','브랜드 팝업','플래그십스토어 오픈','브랜드 체험존','페스티벌 개최','박람회 참가기업 모집','전시회 참가업체 모집'] loop
  source_name:='네이버 뉴스 · '||word;
  if exists(select 1 from public.sales_collection_runs where source=source_name and (status='수집 중' or (report_date=day and status in ('완료','일부 수집')) or started_at>now()-interval '15 minutes')) then continue; end if;
  if (select count(*) from public.sales_collection_runs where source=source_name and report_date=day)>=3 then continue; end if;
  insert into public.sales_collection_runs(source,status,note) values(source_name,'수집 중','네이버 뉴스 검색 · 최근 3일 · 지정 검색어 자동 조회 중') returning id into run;
  if coalesce(gateway_key,'')='' then
   update public.sales_collection_runs set status='실패',finished_at=now(),note='뉴스 수집 서버 인증 연결 필요 · 기존 자료 보존' where id=run;continue;
  end if;
  begin
   insert into private.sales_news_jobs(run_id,keyword) values(run,word) returning token into job_token;
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-news',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway_key,'apikey',gateway_key),body:=jsonb_build_object('id',run,'token',job_token),timeout_milliseconds:=10000);
   n:=n+1;
  exception when others then update public.sales_collection_runs set status='실패',finished_at=now(),note='뉴스 수집 서버 요청 실패 · 기존 자료 보존' where id=run;end;
 end loop;
 return n;
end $$;
create function public.sales_news_claim(p_run uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_news_jobs;
begin
 perform 1 from public.sales_collection_runs where id=p_run and status='수집 중' and started_at>now()-interval '10 minutes' for update;
 if not found then return null; end if;
 update private.sales_news_jobs set claimed=true where run_id=p_run and token=p_token and not claimed returning * into j;
 if not found then return null; end if;
 return jsonb_build_object('keyword',j.keyword,'days',j.days);
end $$;
create function public.sales_news_save(p_run uuid,p_rows jsonb,p_total integer,p_stamp timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_news_jobs; r public.sales_collection_runs; item jsonb; existing public.sales_prospects; n integer:=0;
begin
 select * into r from public.sales_collection_runs where id=p_run and status='수집 중' and started_at>now()-interval '10 minutes' for update;
 select * into j from private.sales_news_jobs where run_id=p_run and claimed and not saved;
 if r.id is null or j.run_id is null then raise exception '수집 작업이 만료되었거나 인증되지 않았습니다.'; end if;
 if p_total is null or p_total<0 or p_stamp is null or p_stamp>now()+interval '1 minute' or p_stamp<r.started_at-interval '5 minutes' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>30 or octet_length(p_rows::text)>300000 then raise exception '수집 자료 형식 오류'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','')!~'^[0-9a-f]{32}$' or char_length(btrim(coalesce(item->>'title',''))) not between 1 and 200 or char_length(coalesce(item->>'summary',''))>500
   or coalesce(item->>'url','')!~*'^https?://[^[:space:]]+$' or char_length(item->>'url') not between 12 and 1000 or coalesce(item->>'published','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then raise exception '보도 항목 형식 오류'; end if;
  if (item->>'published')::timestamptz>now()+interval '2 hours' or (item->>'published')::timestamptz<now()-interval '15 days' then raise exception '보도 시각 오류'; end if;
  -- The same article can match several keywords; serialize and keep earlier links and exclusions.
  perform pg_advisory_xact_lock(hashtextextended('sales_news/'||(item->>'id'),0));
  select * into existing from public.sales_prospects where source='네이버 뉴스' and source_key=item->>'id';
  perform private.sales_index('네이버 뉴스',item->>'id',jsonb_build_object('name',item->>'title','entity_kind','영업 기회','organization',coalesce(existing.organization,''),'source_url',item->>'url','source_updated_at',(item->>'published')::timestamptz,
   'contact',coalesce(existing.contact,''),'client_id',existing.client_id,'contact_id',existing.contact_id,'blocked',coalesce(existing.blocked,false),
   'evidence',concat_ws(' · ','네이버 뉴스 검색',j.keyword,'보도 '||to_char((item->>'published')::timestamptz at time zone 'Asia/Seoul','YYYY-MM-DD'),nullif(item->>'summary',''),'주최·참여 브랜드·일정은 원문 확인 필요'),
   'event_data',coalesce(existing.event_data,'{}'::jsonb)||jsonb_build_object('keyword',j.keyword,'published',item->>'published','summary',item->>'summary')));
  -- A headline alone names no buyer: it stays below the priority list until an organization is confirmed.
  update public.sales_prospects set assessment='확인 필요',score=least(score,50),next_action='원문에서 주최·참여 브랜드와 일정을 확인' where source='네이버 뉴스' and source_key=item->>'id' and organization='' and assessment='우선 검토';
  n:=n+1;
 end loop;
 update private.sales_news_jobs set saved=true where run_id=p_run;
 update public.sales_collection_runs set count=n,scanned=n,total=p_total,source_at=p_stamp,note='보도 저장 완료 · 결과 기록 전' where id=p_run;
end $$;
create function public.sales_news_finish(p_run uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare j private.sales_news_jobs; r public.sales_collection_runs;
begin
 select * into r from public.sales_collection_runs where id=p_run for update;
 if r.id is null or r.status<>'수집 중' then return; end if;
 select * into j from private.sales_news_jobs where run_id=p_run and claimed;
 if j.run_id is null then raise exception '인증된 수집 작업이 아닙니다.'; end if;
 if p_status is null or p_status not in ('완료','일부 수집','실패') or p_note is null or char_length(p_note)>1000 then raise exception '수집 결과 형식 오류'; end if;
 if p_status<>'실패' and not j.saved then raise exception '저장된 자료가 없습니다.'; end if;
 update public.sales_collection_runs set status=p_status,finished_at=now(),note=p_note where id=p_run;
end $$;
revoke all on function private.sales_news_queue() from public,anon,authenticated;
revoke all on function public.sales_news_claim(uuid,uuid),public.sales_news_save(uuid,jsonb,integer,timestamptz),public.sales_news_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sales_news_claim(uuid,uuid),public.sales_news_save(uuid,jsonb,integer,timestamptz),public.sales_news_finish(uuid,text,text) to service_role;
-- Twice a day (07:10 and 13:10 KST). Created switched off; it is enabled after a verified first run.
select cron.schedule('wkly_sales_news','10 22,4 * * *','select private.sales_news_queue()');
select cron.alter_job((select jobid from cron.job where jobname='wkly_sales_news'),active:=false);
notify pgrst,'reload schema';
commit;
