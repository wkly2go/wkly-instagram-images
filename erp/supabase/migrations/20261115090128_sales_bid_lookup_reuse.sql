-- 참가 조건 조회를 새 공고에만 쓴다: 이미 업종 · 지역을 확인한 공고는 다시 조회하지 않고 저장된 값을 이어 쓴다.
begin;
create or replace function private.sales_license_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if new.source not like '나라장터%' then return new; end if;
 -- A notice collected again without a fresh lookup keeps the licence and region names found earlier.
 if tg_op='UPDATE' and new.event_data ? 'terms' and old.event_data ? 'terms' then
  new.event_data:=jsonb_set(new.event_data,'{terms}',(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(old.event_data->'terms') where key in ('licenses','regions'))||(new.event_data->'terms'));
 end if;
 if new.event_data ? 'terms' then
  v:=private.sales_bid_verdict(new.event_data->'terms');
  if v is not null then new.event_data:=new.event_data||jsonb_build_object('eligibility',v); end if;
 end if;
 if new.reviewed_assessment is not null then return new; end if;
 if new.event_data->>'category'='construction' or new.name ~ '(실내건축|인테리어 ?공사|건축 ?공사|리모델링 ?공사|시설 ?공사|전문건설|건설업)' then
  new.assessment:='제외';new.score:=0;
  new.reasons:='참여 불가: 실내건축공사업 등 건설업 면허가 필요한 공사 공고';
  new.next_action:='조치 없음 · 면허가 필요 없는 용역 공고만 검토';
 elsif v->>'verdict'='참여 불가' then
  new.assessment:='제외';new.score:=0;
  new.reasons:=left('참여 불가: '||(v->>'note'),500);
  new.next_action:='조치 없음 · 참가 자격이 맞는 공고만 검토';
 elsif v->>'verdict'='자격 확인 필요' then
  new.next_action:=left('참가 자격 확인: '||(v->>'note'),500);
 end if;
 return new;
end $$;

create or replace function public.sales_g2b_claim(p_run uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.sales_g2b_jobs;
begin
 perform 1 from public.sales_collection_runs where id=p_run and status='수집 중' and started_at>now()-interval '15 minutes' for update;
 if not found then return null; end if;
 update private.sales_g2b_jobs set claimed=true where run_id=p_run and token=p_token and not claimed returning * into j;
 if not found then return null; end if;
 return jsonb_build_object('category',j.category,'keyword',j.keyword,'startDate',j.start_date,'endDate',j.end_date,
  'known',(select coalesce(jsonb_agg(k),'[]'::jsonb) from (select (event_data->>'number')||':'||(event_data->>'round') k from public.sales_prospects
   where source='나라장터 공식 API' and collected_at>now()-interval '30 days' and event_data ? 'terms' and event_data ? 'number' and event_data ? 'round'
    and (not coalesce((event_data->'terms'->>'industry_limited')::boolean,false) or event_data->'terms' ? 'licenses')
    and (not coalesce((event_data->'terms'->>'region_limited')::boolean,false) or event_data->'terms' ? 'regions')
   order by collected_at desc limit 600) s));
end $$;
revoke all on function private.sales_license_gate() from public,anon,authenticated;
revoke all on function public.sales_g2b_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_g2b_claim(uuid,uuid) to service_role;
commit;
