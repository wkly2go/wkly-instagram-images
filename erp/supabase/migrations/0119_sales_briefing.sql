-- One report, additive source registry, daily collection and evidence-based review.
-- Existing clients, contacts, growth documents and opportunities remain authoritative.
begin;
create table public.sales_prospects (
 id uuid primary key default gen_random_uuid(), source text not null, source_key text not null,
 name text not null, entity_kind text not null check(entity_kind in ('회사','사람','영업 기회','미분류')),
 organization text not null default '', contact text not null default '', source_url text not null default '',
 evidence text not null default '', source_updated_at timestamptz, collected_at timestamptz not null default now(),
 client_id uuid references public.clients(id), contact_id uuid references public.contacts(id),
 linked_sales_id uuid references public.sales_opportunities(id),
 assessment text not null default '확인 필요' check(assessment in ('우선 검토','확인 필요','보류','제외')),
 score integer not null default 0 check(score between 0 and 100), reasons text not null default '', next_action text not null default '',
 blocked boolean not null default false, end_date date, event_data jsonb not null default '{}'::jsonb,
 reviewed_kind text check(reviewed_kind in ('회사','사람','영업 기회','미분류')),
 reviewed_assessment text check(reviewed_assessment in ('우선 검토','확인 필요','보류','제외')),
 review_note text not null default '', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 revision integer not null default 1, created_at timestamptz not null default now(), unique(source,source_key)
);
create index sales_prospects_rank on public.sales_prospects(score desc,created_at desc,id);
create table public.sales_collection_runs (
 id uuid primary key default gen_random_uuid(), report_date date not null default (now() at time zone 'Asia/Seoul')::date,
 source text not null, status text not null check(status in ('수집 중','완료','일부 수집','실패')),
 count integer not null default 0, scanned integer, total integer, source_at timestamptz, note text not null default '',
 started_at timestamptz not null default now(), finished_at timestamptz
);
create table private.sales_collection_requests (
 run_id uuid primary key references public.sales_collection_runs(id), request_id bigint not null, fallback boolean not null default false
);
create table private.sales_seoul_jobs (run_id uuid primary key references public.sales_collection_runs(id), token uuid not null, claimed boolean not null default false);
alter table private.sales_seoul_jobs enable row level security;
alter table private.sales_collection_requests enable row level security;
revoke all on private.sales_seoul_jobs from public,anon,authenticated;
create table public.sales_briefings (
 report_date date primary key, title text not null, summary text not null, direction text not null,
 actions jsonb not null, source_status jsonb not null, pipeline jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.sales_prospects enable row level security;
alter table public.sales_collection_runs enable row level security;
alter table public.sales_briefings enable row level security;
create policy sales_prospects_read on public.sales_prospects for select to authenticated using((select public.is_active_member()));
create policy sales_collection_read on public.sales_collection_runs for select to authenticated using((select public.is_active_member()));
create policy sales_briefing_read on public.sales_briefings for select to authenticated using((select public.is_active_member()));
revoke all on public.sales_prospects,public.sales_collection_runs,public.sales_briefings from anon,authenticated;
revoke all on private.sales_collection_requests from public,anon,authenticated;
grant select on public.sales_prospects,public.sales_collection_runs,public.sales_briefings to authenticated;

create function private.sales_assess(p public.sales_prospects) returns public.sales_prospects
language plpgsql set search_path='' as $$
declare relevant boolean; fresh boolean;
begin
 relevant := (p.name||' '||p.organization||' '||p.evidence) ~* '(팝업|전시|박람회|브랜드|매장|쇼룸|리뉴얼|행사|캠페인|공간|인테리어|festival|exhibition|popup)';
 fresh := p.source_updated_at is not null and p.source_updated_at >= now()-interval '90 days';
 p.score := (case when relevant then 35 else 0 end)+(case when p.contact<>'' then 20 else 0 end)+(case when p.source_url<>'' then 15 else 0 end)+(case when fresh then 15 else 0 end)+(case when p.client_id is not null then 15 else 0 end);
 p.assessment := case when p.blocked then '제외' when p.end_date < (now() at time zone 'Asia/Seoul')::date then '보류' when relevant and fresh and p.score>=65 then '우선 검토' else '확인 필요' end;
 p.reasons := concat_ws(' · ',case when relevant then '팝업·공간·행사 관련 단서' else '수행 분야 적합성 미확인' end,case when p.contact<>'' then '연락 창구 있음' else '담당자·연락 창구 미확인' end,case when fresh then '최근 자료' else '자료 시점 재확인 필요' end,case when p.blocked then '수신 거부 또는 원본 제외 상태' end,case when p.end_date < (now() at time zone 'Asia/Seoul')::date then '일정 종료' end,'발주 의사·예산은 별도 확인');
 p.next_action := case when p.blocked then '신규 제안 대상에서 제외하고 수신 거부 유지' when p.end_date < (now() at time zone 'Asia/Seoul')::date then '다음 회차 일정과 새 발주 여부 확인' when p.contact='' then '공식 홈페이지에서 담당 부서와 문의 창구 확인' else '기존 접촉 이력 확인 후 일정·예산·미발주 범위 확인' end;
 return p;
end $$;

create function private.sales_index(p_source text,p_key text,p_data jsonb) returns void
language plpgsql set search_path='' as $$
declare p public.sales_prospects;
begin
 p:=jsonb_populate_record(null::public.sales_prospects,p_data);
 p.name:=left(coalesce(nullif(btrim(p.name),''),'이름 확인 필요'),300);
 p.organization:=left(coalesce(p.organization,''),300); p.contact:=left(coalesce(p.contact,''),1000);
 p.evidence:=left(coalesce(p.evidence,''),6000); p.source_url:=coalesce(p.source_url,'');
 if not public.growth_safe_url(p.source_url) then p.source_url:=''; end if;
 p.blocked:=coalesce(p.blocked,false) or exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0); p.entity_kind:=coalesce(p.entity_kind,'미분류');
 p:=private.sales_assess(p);
 insert into public.sales_prospects(source,source_key,name,entity_kind,organization,contact,evidence,source_url,source_updated_at,client_id,contact_id,linked_sales_id,blocked,end_date,event_data,assessment,score,reasons,next_action)
 values(p_source,p_key,p.name,p.entity_kind,p.organization,p.contact,p.evidence,p.source_url,p.source_updated_at,p.client_id,p.contact_id,p.linked_sales_id,p.blocked,p.end_date,coalesce(p.event_data,'{}'::jsonb),p.assessment,p.score,p.reasons,p.next_action)
 on conflict(source,source_key) do update set name=excluded.name,entity_kind=excluded.entity_kind,organization=excluded.organization,contact=excluded.contact,evidence=excluded.evidence,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,client_id=excluded.client_id,contact_id=excluded.contact_id,linked_sales_id=coalesce(sales_prospects.linked_sales_id,excluded.linked_sales_id),blocked=excluded.blocked,end_date=excluded.end_date,event_data=excluded.event_data,assessment=excluded.assessment,score=excluded.score,reasons=excluded.reasons,next_action=excluded.next_action,collected_at=now(),revision=sales_prospects.revision+1;
end $$;

create function private.sales_collect_internal() returns integer language plpgsql set search_path='' as $$
declare r record; n integer:=0;
begin
 for r in select * from public.clients loop
  perform private.sales_index('거래처',r.id::text,jsonb_build_object('name',r.name,'entity_kind','회사','organization',r.name,'contact',concat_ws(' · ',r.email,r.phone),'evidence',concat_ws(' · ',r.category,r.memo),'source_url',r.website,'source_updated_at',r.updated_at,'client_id',r.id)); n:=n+1;
 end loop;
 for r in select c.*,cl.name organization from public.contacts c join public.clients cl on cl.id=c.client_id loop
  perform private.sales_index('담당자',r.id::text,jsonb_build_object('name',r.name,'entity_kind','사람','organization',r.organization,'contact',concat_ws(' · ',r.email,r.phone),'evidence',concat_ws(' · ',r.title,r.memo),'source_updated_at',r.created_at,'client_id',r.client_id,'contact_id',r.id)); n:=n+1;
 end loop;
 for r in select * from public.brand_contacts loop
  perform private.sales_index('브랜드 연락처',r.id::text,jsonb_build_object('name',coalesce(nullif(r.contact_name,''),r.brand_name),'entity_kind',case when coalesce(r.contact_name,'')<>'' then '사람' else '회사' end,'organization',r.brand_name,'contact',concat_ws(' · ',r.email,r.phone),'evidence',concat_ws(' · ',r.source_note,r.memo),'source_url',r.source_url,'source_updated_at',r.updated_at,'client_id',r.client_id,'blocked',r.opt_out)); n:=n+1;
 end loop;
 for r in select * from public.growth_items where kind in ('contact','tender') loop
  perform private.sales_index(case when r.kind='tender' then '나라장터 보관 공고' else '민간 영업 후보' end,r.id::text,jsonb_build_object('name',r.title,'entity_kind',case when r.kind='tender' then '영업 기회' when coalesce(r.document->>'name','')<>'' and coalesce(r.document->>'brand','')<>'' and r.document->>'name'<>r.document->>'brand' then '사람' else '미분류' end,'organization',coalesce(r.document->>'brand',r.document->>'agency'),'contact',concat_ws(' · ',nullif(r.document->>'email',''),nullif(r.document->>'instagram','')),'evidence',concat_ws(' · ',r.document->>'segment',r.document->>'note',r.document->>'evidence'),'source_url',r.document->>'source_url','source_updated_at',r.updated_at,'linked_sales_id',r.linked_sales_id,'blocked',r.status in ('제외','취소') or coalesce(r.document->>'qualification','')='불충족')); n:=n+1;
 end loop;
 for r in select * from public.research_items where status<>'보관' loop
  perform private.sales_index('리서치',r.id::text,jsonb_build_object('name',r.title,'entity_kind','영업 기회','organization',r.brand_name,'evidence',concat_ws(' · ',r.summary,r.body),'source_url',r.source_url,'source_updated_at',r.updated_at,'client_id',r.client_id)); n:=n+1;
 end loop;
 return n;
end $$;

create function private.sales_collect() returns void language plpgsql security definer set search_path='' as $$
declare n integer; s text; run uuid; req bigint; token uuid;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('sales_daily_collect',0)) then return; end if;
 -- Manual retries cannot overlap or create a request storm.
 if exists(select 1 from public.sales_collection_runs where started_at>now()-interval '5 minutes') then return; end if;
 -- Ended events disappear from fresh API pages; age the saved assessment too.
 -- Keep the original record and explicit human review for next-edition follow-up.
 update public.sales_prospects set assessment='보류',score=0,reasons='행사 종료 · 다음 회차 또는 후속 수요 확인 필요',next_action='다음 행사 일정과 미발주 범위를 확인한 뒤 다시 검토',revision=revision+1
 where source in ('서울시 문화행사','코엑스 행사') and end_date<(now() at time zone 'Asia/Seoul')::date and not blocked and assessment not in ('보류','제외');
 n:=private.sales_collect_internal();
 insert into public.sales_collection_runs(source,status,count,source_at,finished_at,note) values('사내 영업 자료','완료',n,now(),now(),'거래처·담당자·브랜드 연락처·민간 후보·보관 공고·리서치 통합. 진행 영업은 실시간 집계.');
 foreach s in array array['서울시 문화행사','코엑스 행사'] loop
  if exists(select 1 from public.sales_collection_runs where source=s and status='완료' and report_date=(now() at time zone 'Asia/Seoul')::date) then continue; end if;
  insert into public.sales_collection_runs(source,status,note) values(s,'수집 중','공식 공개 목록 조회 중') returning id into run;
  if s='서울시 문화행사' then
   token:=gen_random_uuid();
   insert into private.sales_seoul_jobs(run_id,token) values(run,token);
   perform net.http_post(url:='https://hophgcpszenrvchvbkav.supabase.co/functions/v1/sales-seoul',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcGhnY3BzemVucnZjaHZia2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4Mjk5MzgsImV4cCI6MjEwNzQwNTkzOH0.PN42_knCXZUcbAV7tCnGAtpp_0lMSuf9NgYVBxgDOwI'),body:=jsonb_build_object('runId',run,'token',token),timeout_milliseconds:=120000);
  else
   req:=net.http_get(url:='https://wkly-erp.pages.dev/api/prospect-events',timeout_milliseconds:=25000);
   insert into private.sales_collection_requests(run_id,request_id) values(run,req);
  end if;
 end loop;
end $$;

create function private.sales_receive() returns void language plpgsql security definer set search_path='' as $$
declare r record; response record; payload jsonb; rows jsonb; item jsonb; stamp timestamptz; req bigint; n integer; key text; limited boolean;
begin
 update public.sales_collection_runs set status='실패',finished_at=now(),note='서울시 공식 API 작업 미완료 · 함수 배포·API 승인 상태 확인 필요' where source='서울시 문화행사' and status='수집 중' and started_at<now()-interval '15 minutes';
 for r in select q.*,c.source,c.started_at from private.sales_collection_requests q join public.sales_collection_runs c on c.id=q.run_id where c.status='수집 중' for update of c skip locked loop
  select * into response from net._http_response where id=r.request_id;
  if response.id is null and r.started_at>now()-interval '10 minutes' then continue; end if;
  begin
   if response.id is null or response.status_code<>200 or response.error_msg is not null or response.timed_out then raise exception '제공기관 응답 실패'; end if;
   if octet_length(response.content)>150000 then raise exception '허용 크기 초과'; end if;
   payload:=response.content::jsonb; rows:=coalesce(payload->'events',payload->'rows');
   if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>1000 then raise exception '목록 형식 오류'; end if;
   stamp:=(payload->>'fetchedAt')::timestamptz;
   if stamp is null or stamp>now()+interval '5 minutes' then raise exception '수집 시각 오류'; end if;
   limited:=coalesce((payload->>'limited')::boolean,true); n:=0;
   for item in select * from jsonb_array_elements(rows) loop
    if coalesce(item->>'id','')='' or coalesce(item->>'title','')='' then raise exception '식별자 오류'; end if;
    key:=item->>'id';
    perform private.sales_index(r.source,key,jsonb_build_object('name',item->>'title','entity_kind','영업 기회','organization',item->>'organization','source_url',item->>'url','source_updated_at',stamp,'end_date',nullif(item->>'end',''),'evidence',concat_ws(' · ',item->>'category',item->>'district',item->>'venue',(item->>'start')||' ~ '||(item->>'end'))));
    n:=n+1;
   end loop;
   update public.sales_collection_runs set status=case when limited or stamp<now()-interval '24 hours' then '일부 수집' else '완료' end,count=n,source_at=stamp,finished_at=now(),note=concat_ws(' · ',case when r.fallback then '공식 조회 실패 후 마지막 공개 저장본 사용' else '공식 공개 목록 조회' end,case when limited then '일부 공개 목록만 제공; 전체 영업처를 의미하지 않음' end,case when stamp<now()-interval '24 hours' then '최신 수집 아님: 저장본 시각 확인 필요' end) where id=r.run_id;
  exception when others then
   if not r.fallback then
    req:=net.http_get(url:='https://raw.githubusercontent.com/wkly2go/wkly-instagram-images/data/seoul-events/coex-events.json',timeout_milliseconds:=25000);
    update private.sales_collection_requests set request_id=req,fallback=true where run_id=r.run_id;
    update public.sales_collection_runs set note='공식 조회 실패 · 공개 저장본 확인 중' where id=r.run_id;
   else
    update public.sales_collection_runs set status='실패',finished_at=now(),note='제공기관과 공개 저장본 조회 실패. 기존 자료를 보존했습니다.' where id=r.run_id;
   end if;
  end;
 end loop;
end $$;

create function public.sales_seoul_claim(p_run uuid,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.sales_seoul_jobs j set claimed=true from public.sales_collection_runs r where j.run_id=p_run and j.token=p_token and not j.claimed and r.id=j.run_id and r.status='수집 중' and r.started_at>now()-interval '15 minutes';
 return found;
end $$;
-- An existing server-held Seoul key may be reused. No client role can read it.
create function public.sales_seoul_key() returns text language sql security definer set search_path='' as $$
 select btrim(decrypted_secret) from vault.decrypted_secrets where name='SEOUL_DATA_KEY' limit 1
$$;
revoke all on function public.sales_seoul_key() from public,anon,authenticated;
grant execute on function public.sales_seoul_key() to service_role;
create function public.sales_seoul_page(p_run uuid,p_rows jsonb,p_stamp timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 perform 1 from public.sales_collection_runs r join private.sales_seoul_jobs j on j.run_id=r.id where r.id=p_run and r.status='수집 중' and j.claimed and r.started_at>now()-interval '15 minutes' for update of r;
 if not found then raise exception '수집 작업이 만료되었습니다.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000 or p_stamp is null or p_stamp>now()+interval '5 minutes' then raise exception '수집 형식 오류'; end if;
 for item in select * from jsonb_array_elements(p_rows) loop
  if coalesce(item->>'id','')='' or coalesce(item->>'title','')='' then raise exception '행사 식별자 오류'; end if;
  perform private.sales_index('서울시 문화행사',item->>'id',jsonb_build_object('name',item->>'title','entity_kind','영업 기회','organization',item->>'organization','source_url',item->>'url','source_updated_at',p_stamp,'event_data',item,'contact',item->>'contact','end_date',nullif(item->>'end',''),'evidence',concat_ws(' · ','서울시 공식 API culturalEventInfo',item->>'category',item->>'district',item->>'venue',(item->>'start')||' ~ '||(item->>'end'))));
 end loop;
end $$;
create function public.sales_seoul_finish(p_run uuid,p_status text,p_count integer,p_scanned integer,p_total integer,p_note text,p_stamp timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('완료','일부 수집','실패') or p_count<0 or p_scanned<0 or p_total<0 or char_length(p_note)>1000 then raise exception '수집 결과 오류'; end if;
 update public.sales_collection_runs r set status=p_status,count=p_count,scanned=p_scanned,total=p_total,source_at=p_stamp,note=p_note||format(' · 조회 %s / 제공기관 전체 %s건',p_scanned,p_total),finished_at=now() where r.id=p_run and r.status='수집 중' and exists(select 1 from private.sales_seoul_jobs j where j.run_id=r.id and j.claimed);
 if not found then raise exception '완료된 작업이거나 만료되었습니다.'; end if;
end $$;
revoke all on function public.sales_seoul_claim(uuid,uuid),public.sales_seoul_page(uuid,jsonb,timestamptz),public.sales_seoul_finish(uuid,text,integer,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sales_seoul_claim(uuid,uuid),public.sales_seoul_page(uuid,jsonb,timestamptz),public.sales_seoul_finish(uuid,text,integer,integer,integer,text,timestamptz) to service_role;

create function private.sales_brief(p_notify boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare day date:=(now() at time zone 'Asia/Seoul')::date; total integer; fresh integer; due integer; ready integer; issues integer; sources jsonb; stages jsonb; actions jsonb; who record;
begin
 perform pg_advisory_xact_lock(hashtextextended('sales_brief:'||day::text,0));
 if exists(select 1 from public.sales_briefings where report_date=day) then return; end if;
 perform private.sales_receive();
 select count(*),count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=day),count(*) filter(where not blocked and coalesce(reviewed_assessment,assessment)='우선 검토') into total,fresh,ready from public.sales_prospects;
 select count(*) into due from public.sales_opportunities where stage not in ('수주','실주','보류') and next_date<=day;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into sources from (select distinct on(source) source,status,count,source_at,note,started_at from public.sales_collection_runs order by source,started_at desc) x;
 select count(*) into issues from jsonb_array_elements(sources) x where x->>'status' not in ('완료','일부 수집') or coalesce((x->>'source_at')::timestamptz,'epoch')<now()-interval '24 hours';
 if sources='[]' then issues:=1; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into stages from (select stage,count(*) count,coalesce(sum(expected_amount),0) amount from public.sales_opportunities group by stage) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into actions from (select id,name,organization,coalesce(reviewed_assessment,assessment) assessment,score,next_action,source,source_url from public.sales_prospects where not blocked and coalesce(reviewed_assessment,assessment) not in ('제외','보류') and linked_sales_id is null order by (coalesce(reviewed_assessment,assessment)='우선 검토') desc,score desc,created_at desc,id limit 5) x;
 insert into public.sales_briefings(report_date,title,summary,direction,actions,source_status,pipeline) values(day,day::text||' 영업 브리핑',format('등록 자료 %s건 · 오늘 첫 취합 %s건 · 우선 검토 %s건 · 후속 연락 %s건. %s',total,fresh,ready,due,case when issues>0 then '최신 수집을 확인하지 못한 출처가 있습니다. 출처별 상태를 확인하세요.' else '연결된 출처의 수집 시각을 확인했습니다.' end),case when due>0 then '오늘은 진행 중인 영업의 약속된 후속 연락부터 처리합니다. 기존 제안의 결정 일정과 장애 요인을 확인한 후 신규 발굴로 이어갑니다.' when ready>0 then '팝업·공간·행사 단서와 연락 창구가 있는 대상을 우선 검토합니다. 공식 일정과 미발주 범위를 확인하고, 목표·수행 범위·예산 가설을 담은 1쪽 제안을 준비합니다.' else '담당 부서와 실제 발주 수요를 확인하는 것이 우선입니다. 연락 창구가 확인된 회사부터 사업 적합성을 검토하고, 사람은 소속 회사와 의사결정 역할을 연결합니다.' end,actions,sources,stages);
 -- Internal report notification, one per day to active human sales owners/admins.
 for who in select id from public.profiles where p_notify and active and not is_agent and (role='admin' or id in(select owner_id from public.sales_opportunities)) loop
  perform public.notify(who.id,'일일 보고','09:00 영업 브리핑',format('오늘 첫 취합 %s건 · 후속 연락 %s건 · 보고서에서 오늘의 실행 순서를 확인하세요.',fresh,due),'/sales');
 end loop;
end $$;

create function public.sales_prospect_review(p_id uuid,p_revision integer,p_kind text,p_assessment text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 공용 영업망 분류를 변경할 수 있습니다.' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('회사','사람','영업 기회','미분류') or p_assessment is null or p_assessment not in ('우선 검토','확인 필요','보류','제외') or p_note is null or char_length(btrim(p_note)) not between 1 and 2000 then raise exception '분류와 판단 근거를 입력해 주세요.'; end if;
 update public.sales_prospects set reviewed_kind=p_kind,reviewed_assessment=p_assessment,review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),revision=revision+1 where id=p_id and revision=p_revision and (not blocked or p_assessment='제외');
 if not found then raise exception '자료가 변경됐거나 수신 거부 대상입니다. 다시 불러와 주세요.' using errcode='40001'; end if;
end $$;

create function public.sales_prospect_start(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.sales_prospects; saved public.sales_opportunities;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into p from public.sales_prospects where id=p_id for update;
 if p.id is null then raise exception '자료를 찾을 수 없습니다.'; end if;
 if p.linked_sales_id is not null then return p.linked_sales_id; end if;
 if p.blocked or exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0) or exists(select 1 from public.growth_items g where g.id::text=p.source_key and p.source in ('민간 영업 후보','나라장터 보관 공고') and (g.status in ('제외','취소') or g.document->>'qualification'='불충족')) or coalesce(p.reviewed_assessment,p.assessment) in ('제외','보류') then raise exception '제외·보류 사유를 먼저 검토해 주세요.'; end if;
 saved:=public.sales_save_opportunity(gen_random_uuid(),jsonb_build_object('title',left(p.name,160),'division','TW','client_id',p.client_id,'contact_id',p.contact_id,'owner_id',auth.uid(),'stage','발굴','source','직접 발굴','source_url',p.source_url,'expected_amount',null,'next_action',p.next_action,'next_date',(now() at time zone 'Asia/Seoul')::date,'description',left(concat_ws(E'\n',p.organization,p.contact,p.evidence,p.reasons,p.review_note),10000),'result_note','','project_id',null),0);
 update public.sales_prospects set linked_sales_id=saved.id,revision=revision+1 where id=p.id;
 return saved.id;
end $$;

create function public.sales_seoul_events() returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sales_collection_runs; items jsonb; n integer;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into r from public.sales_collection_runs where source='서울시 문화행사' and status in ('완료','일부 수집') order by started_at desc limit 1;
 if r.id is null then raise exception '서울시 공식 API 취합이 아직 완료되지 않았습니다. 보고서의 자료 취합 상태를 확인해 주세요.'; end if;
 select count(*) into n from public.sales_prospects where source='서울시 문화행사' and event_data<>'{}'::jsonb and end_date>=(now() at time zone 'Asia/Seoul')::date;
 select coalesce(jsonb_agg(x.event_data),'[]') into items from (select event_data from public.sales_prospects where source='서울시 문화행사' and event_data<>'{}'::jsonb and end_date>=(now() at time zone 'Asia/Seoul')::date order by event_data->>'start',id limit 10000) x;
 return jsonb_build_object('events',items,'fetchedAt',r.source_at,'total',coalesce(r.total,r.count),'scanned',coalesce(r.scanned,r.count),'limited',r.status<>'완료' or n>10000,'sourceKind','api');
end $$;
revoke all on function public.sales_seoul_events() from public,anon;
grant execute on function public.sales_seoul_events() to authenticated;

create function public.sales_collect_now() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 수집을 실행할 수 있습니다.' using errcode='42501'; end if;
 perform private.sales_collect();
end $$;

create function public.sales_report(p_search text default '',p_kind text default '',p_assessment text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb; total integer;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 or char_length(p_search)>200 then raise exception '조회 조건을 확인해 주세요.'; end if;
 select count(*) into total from public.sales_prospects p where (p_search='' or strpos(lower(p.name||' '||p.organization||' '||p.contact),lower(p_search))>0) and (p_kind='' or coalesce(p.reviewed_kind,p.entity_kind)=p_kind) and (p_assessment='' or case when blocked then '제외' else coalesce(reviewed_assessment,assessment) end=p_assessment);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (select p.* from public.sales_prospects p where (p_search='' or strpos(lower(p.name||' '||p.organization||' '||p.contact),lower(p_search))>0) and (p_kind='' or coalesce(p.reviewed_kind,p.entity_kind)=p_kind) and (p_assessment='' or case when blocked then '제외' else coalesce(reviewed_assessment,assessment) end=p_assessment) order by p.blocked,p.score desc,p.created_at desc,p.id limit 20 offset p_page*20) x;
 select jsonb_build_object('prospects',items,'total',total,'briefing',(select to_jsonb(b) from public.sales_briefings b order by report_date desc limit 1),'counts',(select jsonb_build_object('total',count(*),'companies',count(*) filter(where coalesce(reviewed_kind,entity_kind)='회사'),'people',count(*) filter(where coalesce(reviewed_kind,entity_kind)='사람'),'new',count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date),'priority',count(*) filter(where not blocked and coalesce(reviewed_assessment,assessment)='우선 검토')) from public.sales_prospects),'sources',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select distinct on(source) source,status,count,source_at,note,started_at,finished_at from public.sales_collection_runs order by source,started_at desc) x),'pipeline',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select stage,count(*) count,coalesce(sum(expected_amount),0) amount from public.sales_opportunities group by stage) x),'due',(select count(*) from public.sales_opportunities where stage not in ('수주','실주','보류') and next_date<=(now() at time zone 'Asia/Seoul')::date),'schedules',(select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)),'[]') from cron.job where jobname in ('wkly_sales_collect','wkly_sales_brief','wkly_sales_receive'))) into result;
 return result;
end $$;

revoke all on function private.sales_assess(public.sales_prospects),private.sales_index(text,text,jsonb),private.sales_collect_internal(),private.sales_collect(),private.sales_receive(),private.sales_brief(boolean) from public,anon,authenticated;
revoke all on function public.sales_prospect_review(uuid,integer,text,text,text),public.sales_prospect_start(uuid),public.sales_collect_now(),public.sales_report(text,text,text,integer) from public,anon;
grant execute on function public.sales_prospect_review(uuid,integer,text,text,text),public.sales_prospect_start(uuid),public.sales_collect_now(),public.sales_report(text,text,text,integer) to authenticated;
-- Korea: 08:00 collect, 09:00 briefing. Poll async HTTP without browser sessions.
select cron.schedule('wkly_sales_collect','0,20,40 23 * * *','select private.sales_collect()');
select cron.schedule('wkly_sales_receive','* * * * *','select private.sales_receive()');
select cron.schedule('wkly_sales_brief','0 0 * * *','select private.sales_brief()');
commit;
