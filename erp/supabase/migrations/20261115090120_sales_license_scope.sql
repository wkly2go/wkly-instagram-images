-- 2026-11-15 대표 지시: 실내건축공사업 면허가 없으므로 참여할 수 있는 공고만 쓴다.
-- 공사 입찰은 더 이상 수집하지 않고, 이미 저장된 공사 공고와 면허가 필요한 공고는 영업 대상에서 제외한다.
begin;
create or replace function private.sales_g2b_queue() returns integer language plpgsql security definer set search_path='' as $$
declare route record; source_name text; run uuid; job_token uuid; gateway_key text; day date:=(now() at time zone 'Asia/Seoul')::date; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_g2b_collection',0)) then return 0; end if;
 perform private.sales_g2b_watchdog();
 select btrim(decrypted_secret) into gateway_key from vault.decrypted_secrets where name='WKLY_EDGE_ANON_KEY' limit 1;
 for route in select * from (values ('service','행사'),('service','전시'),('service','축제'),('service','박람회'),('service','홍보'),('service','컨퍼런스'),('service','팝업'),('service','부스')) q(category,keyword) loop
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

-- Applies on every save, so a re-collected notice cannot return to the list. An administrator's own review still wins.
create function private.sales_license_gate() returns trigger language plpgsql set search_path='' as $$
begin
 if new.source like '나라장터%' and new.reviewed_assessment is null and (new.event_data->>'category'='construction' or new.name ~ '(실내건축|인테리어 ?공사|건축 ?공사|리모델링 ?공사|시설 ?공사|전문건설|건설업)') then
  new.assessment:='제외';new.score:=0;
  new.reasons:='참여 불가: 실내건축공사업 등 건설업 면허가 필요한 공사 공고';
  new.next_action:='조치 없음 · 면허가 필요 없는 용역 공고만 검토';
 end if;
 return new;
end $$;
create trigger sales_license_gate before insert or update on public.sales_prospects for each row execute function private.sales_license_gate();
update public.sales_prospects set revision=revision+1 where source like '나라장터%' and reviewed_assessment is null and assessment<>'제외' and (event_data->>'category'='construction' or name ~ '(실내건축|인테리어 ?공사|건축 ?공사|리모델링 ?공사|시설 ?공사|전문건설|건설업)');
revoke all on function private.sales_license_gate() from public,anon,authenticated;
commit;
