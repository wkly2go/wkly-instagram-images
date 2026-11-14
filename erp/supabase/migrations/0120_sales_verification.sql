-- Make the proposed business and its evidence reviewable before pipeline creation.
-- Additive: no source, candidate, contact, or existing opportunity is removed.
begin;
alter table public.sales_prospects add column verification jsonb not null default '{}'::jsonb;

create function private.sales_prospect_signature(p public.sales_prospects) returns text
language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(p.source,p.source_key,p.name,p.organization,p.contact,p.evidence,p.source_url,p.end_date,p.client_id,p.contact_id)::text)
$$;
create function private.sales_prospect_blocked(p public.sales_prospects) returns boolean
language sql stable set search_path='' as $$
 select p.blocked or exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0)
 or exists(select 1 from public.growth_items g where g.id::text=p.source_key and p.source in ('민간 영업 후보','나라장터 보관 공고') and (g.status in ('제외','취소') or g.document->>'qualification'='불충족'))
$$;
create function private.sales_prospect_verified(p public.sales_prospects) returns boolean
language sql stable set search_path='' as $$
 select coalesce(p.verification->>'status'='확인' and p.verification->>'role' in ('발주처','협력사','소개·제휴')
 and p.verification->>'signature'=private.sales_prospect_signature(p) and not private.sales_prospect_blocked(p),false)
$$;
create function public.sales_prospect_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.sales_prospects;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into p from public.sales_prospects where id=p_id;
 if p.id is null then raise exception '자료를 찾을 수 없습니다.'; end if;
 return to_jsonb(p)||jsonb_build_object('verification_current',private.sales_prospect_verified(p),'blocked',private.sales_prospect_blocked(p));
end $$;
create function public.sales_prospect_verify(p_id uuid,p_revision integer,p_role text,p_need text,p_scope text,p_evidence text,p_status text,p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.sales_prospects;
begin
 if not public.is_admin() then raise exception '관리자만 공용 영업망의 검증 결과를 저장할 수 있습니다.' using errcode='42501'; end if;
 if p_role is null or p_role not in ('미확인','발주처','협력사','소개·제휴') or p_status is null or p_status not in ('확인','추가 확인','보류','제외')
 or p_kind is null or p_kind not in ('회사','사람','영업 기회','미분류')
 or p_evidence is null or char_length(btrim(p_evidence)) not between 1 and 2000
 or p_need is null or char_length(p_need)>2000 or p_scope is null or char_length(p_scope)>2000 then raise exception '역할·검증 결과·근거를 올바르게 입력해 주세요.'; end if;
 if p_status='확인' and (p_role='미확인' or btrim(p_need)='' or btrim(p_scope)='') then raise exception '실제 수요·업무 범위·상대 역할을 확인해 주세요.'; end if;
 select * into p from public.sales_prospects where id=p_id for update;
 if p.id is null or p.revision is distinct from p_revision then raise exception '자료가 변경됐습니다. 다시 불러와 검증해 주세요.' using errcode='40001'; end if;
 if p_status='확인' and private.sales_prospect_blocked(p) then raise exception '수신 거부·원본 제외 상태를 먼저 확인해 주세요.'; end if;
 update public.sales_prospects set
 verification=jsonb_build_object('role',p_role,'need',btrim(p_need),'scope',btrim(p_scope),'evidence',btrim(p_evidence),'status',p_status,'signature',private.sales_prospect_signature(p),'verified_by',auth.uid(),'verified_at',now()),
 reviewed_kind=p_kind,reviewed_assessment=case when private.sales_prospect_blocked(p) or p_status='제외' then '제외' when p_status='확인' then '우선 검토' when p_status='보류' then '보류' else '확인 필요' end,
 review_note=btrim(p_evidence),reviewed_by=auth.uid(),reviewed_at=now(),revision=revision+1 where id=p_id;
 return public.sales_prospect_get(p_id);
end $$;

create or replace function private.sales_assess(p public.sales_prospects) returns public.sales_prospects
language plpgsql set search_path='' as $$
declare relevant boolean; fresh boolean; supplier boolean; informational boolean; demand boolean; corpus text;
begin
 corpus:=coalesce(p.name,'')||' '||coalesce(p.organization,'')||' '||coalesce(p.evidence,'');
 relevant:=corpus ~* '(팝업|전시|박람회|브랜드|매장|쇼룸|리뉴얼|행사|캠페인|공간|인테리어|festival|exhibition|popup)';
 fresh:=p.source_updated_at is not null and p.source_updated_at>=now()-interval '90 days';
 supplier:=corpus ~ '(협력사|공급업체|납품업체|협력 제안|협업 제안|크루 참여|크루 제안|패키지 제작 크루)';
 informational:=coalesce(p.source,'') in ('서울시 문화행사','코엑스 행사') or corpus ~ '(뉴스레터|구독 안내)';
 demand:=coalesce(p.evidence,'') ~ '(견적.{0,8}요청|제안.{0,4}요청|시공.{0,8}문의|팝업.{0,12}문의|의뢰|입찰공고|과업지시서|공고번호)' or coalesce(p.source,'')='나라장터 보관 공고';
 p.score:=(case when relevant then 30 else 0 end)+(case when p.contact<>'' then 10 else 0 end)+(case when p.source_url<>'' then 10 else 0 end)+(case when fresh then 10 else 0 end)+(case when demand and not supplier and not informational then 30 else 0 end)+(case when p.client_id is not null then 10 else 0 end);
 if supplier or informational then p.score:=least(p.score,40); end if;
 p.assessment:=case when p.blocked then '제외' when p.end_date<(now() at time zone 'Asia/Seoul')::date then '보류' when demand and relevant and fresh and not supplier and not informational and p.score>=65 then '우선 검토' else '확인 필요' end;
 if p.assessment in ('제외','보류') then p.score:=0; end if;
 p.reasons:=concat_ws(' · ',case when supplier then '공급·협력 제안 단서: 직접 발주 수요 미확인' when informational then '공개 안내 자료: 발주 공고로 확인되지 않음' when demand then '문의·요청 관련 단서: 원문 내용 검증 필요' else '구체적인 요청·발주 근거 미확인' end,case when relevant then '팝업·공간·행사 관련' else '수행 분야 적합성 미확인' end,case when fresh then '최근 자료' else '자료 시점 재확인 필요' end,case when p.blocked then '수신 거부 또는 원본 제외 상태' end,case when p.end_date<(now() at time zone 'Asia/Seoul')::date then '일정 종료' end);
 p.next_action:=case when p.blocked then '신규 제안 제외·수신 거부 유지' when p.end_date<(now() at time zone 'Asia/Seoul')::date then '다음 회차의 실제 수요 확인' when supplier then '발주처·공급 파트너 역할과 실제 공동 고객 건 확인' when informational then '공식 사업 담당 부서와 미발주 과업 존재 여부 확인' when demand then '원문 요청 내용·미발주 범위·결정 일정 검증' else '원문에서 회사 역할과 실제 영업 과업 확인' end;
 return p;
end $$;

create or replace function private.sales_index(p_source text,p_key text,p_data jsonb) returns void
language plpgsql set search_path='' as $$
declare p public.sales_prospects;
begin
 p:=jsonb_populate_record(null::public.sales_prospects,p_data);
 p.source:=p_source;
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

create function private.sales_brief_actions() returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select p.id,p.name,p.organization,coalesce(p.reviewed_assessment,p.assessment) assessment,p.score,p.next_action,p.source,p.source_url,p.evidence,p.verification,private.sales_prospect_verified(p) verification_current
 from public.sales_prospects p where not private.sales_prospect_blocked(p) and coalesce(p.reviewed_assessment,p.assessment) not in ('제외','보류') and p.linked_sales_id is null
 order by private.sales_prospect_verified(p) desc,(coalesce(p.reviewed_assessment,p.assessment)='우선 검토') desc,p.score desc,p.created_at desc,p.id limit 5
 ) x
$$;

create or replace function private.sales_brief(p_notify boolean default true) returns void language plpgsql security definer set search_path='' as $$
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
 actions:=private.sales_brief_actions();
 insert into public.sales_briefings(report_date,title,summary,direction,actions,source_status,pipeline) values(day,day::text||' 영업 브리핑',format('등록 자료 %s건 · 오늘 첫 취합 %s건 · 우선 검토 %s건 · 후속 연락 %s건. %s',total,fresh,ready,due,case when issues>0 then '최신 수집을 확인하지 못한 출처가 있습니다. 출처별 상태를 확인하세요.' else '연결된 출처의 수집 시각을 확인했습니다.' end),case when due>0 then '오늘은 진행 중인 영업의 약속된 후속 연락부터 처리합니다. 기존 제안의 결정 일정과 장애 요인을 확인한 후 신규 발굴로 이어갑니다.' when ready>0 then '문의·요청의 원문부터 검증합니다. 발주처·협력사를 구분하고 실제 수요·수행 범위·근거를 확인한 뒤 상황에 맞는 영업 방법으로 연결합니다.' else '담당 부서와 실제 발주 수요를 확인하는 것이 우선입니다. 연락 창구가 확인된 회사부터 사업 적합성을 검토하고, 사람은 소속 회사와 의사결정 역할을 연결합니다.' end,actions,sources,stages);
 -- Internal report notification, one per day to active human sales owners/admins.
 for who in select id from public.profiles where p_notify and active and not is_agent and (role='admin' or id in(select owner_id from public.sales_opportunities)) loop
  perform public.notify(who.id,'일일 보고','09:00 영업 브리핑',format('오늘 첫 취합 %s건 · 후속 연락 %s건 · 보고서에서 오늘의 실행 순서를 확인하세요.',fresh,due),'/sales');
 end loop;
end $$;

create or replace function public.sales_prospect_start(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.sales_prospects; saved public.sales_opportunities;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 select * into p from public.sales_prospects where id=p_id for update;
 if p.id is null then raise exception '자료를 찾을 수 없습니다.'; end if;
 if p.linked_sales_id is not null then return p.linked_sales_id; end if;
 if p.blocked or exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(lower(p.contact),lower(b.email))>0) or exists(select 1 from public.growth_items g where g.id::text=p.source_key and p.source in ('민간 영업 후보','나라장터 보관 공고') and (g.status in ('제외','취소') or g.document->>'qualification'='불충족')) or coalesce(p.reviewed_assessment,p.assessment) in ('제외','보류') then raise exception '제외·보류 사유를 먼저 검토해 주세요.'; end if;
 if not private.sales_prospect_verified(p) then raise exception '영업 내용 검증이 필요합니다. 역할·실제 수요·업무 범위·근거를 확인으로 저장해 주세요.'; end if;
 saved:=public.sales_save_opportunity(gen_random_uuid(),jsonb_build_object('title',left(p.name||' · '||(p.verification->>'need'),160),'division','TW','client_id',p.client_id,'contact_id',p.contact_id,'owner_id',auth.uid(),'stage','발굴','source','직접 발굴','source_url',p.source_url,'expected_amount',null,'next_action',case when p.verification->>'role' in ('협력사','소개·제휴') then '확인된 고객 건의 공동 수행 범위·역할·견적 협의' else '확인한 요청 범위에 대한 제안 검토 일정 협의' end,'next_date',(now() at time zone 'Asia/Seoul')::date,'description',left(concat_ws(E'\n','확인한 역할: '||(p.verification->>'role'),'실제 수요: '||(p.verification->>'need'),'수행 범위: '||(p.verification->>'scope'),'검증 근거: '||(p.verification->>'evidence'),p.organization,p.contact,p.evidence,p.reasons),10000),'result_note','','project_id',null),0);
 update public.sales_prospects set linked_sales_id=saved.id,revision=revision+1 where id=p.id;
 return saved.id;
end $$;

create or replace function public.sales_report(p_search text default '',p_kind text default '',p_assessment text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb; total integer;
begin
 if not public.is_active_member() then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 or char_length(p_search)>200 then raise exception '조회 조건을 확인해 주세요.'; end if;
 select count(*) into total from public.sales_prospects p where (p_search='' or strpos(lower(p.name||' '||p.organization||' '||p.contact),lower(p_search))>0) and (p_kind='' or coalesce(p.reviewed_kind,p.entity_kind)=p_kind) and (p_assessment='' or case when blocked then '제외' else coalesce(reviewed_assessment,assessment) end=p_assessment);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (select p.*,private.sales_prospect_verified(p) verification_current from public.sales_prospects p where (p_search='' or strpos(lower(p.name||' '||p.organization||' '||p.contact),lower(p_search))>0) and (p_kind='' or coalesce(p.reviewed_kind,p.entity_kind)=p_kind) and (p_assessment='' or case when blocked then '제외' else coalesce(reviewed_assessment,assessment) end=p_assessment) order by p.blocked,private.sales_prospect_verified(p) desc,p.score desc,p.created_at desc,p.id limit 20 offset p_page*20) x;
 select jsonb_build_object('prospects',items,'total',total,'briefing',(select to_jsonb(b) from public.sales_briefings b order by report_date desc limit 1),'counts',(select jsonb_build_object('total',count(*),'companies',count(*) filter(where coalesce(reviewed_kind,entity_kind)='회사'),'people',count(*) filter(where coalesce(reviewed_kind,entity_kind)='사람'),'new',count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date),'priority',count(*) filter(where not blocked and coalesce(reviewed_assessment,assessment)='우선 검토')) from public.sales_prospects),'sources',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select distinct on(source) source,status,count,source_at,note,started_at,finished_at from public.sales_collection_runs order by source,started_at desc) x),'pipeline',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select stage,count(*) count,coalesce(sum(expected_amount),0) amount from public.sales_opportunities group by stage) x),'due',(select count(*) from public.sales_opportunities where stage not in ('수주','실주','보류') and next_date<=(now() at time zone 'Asia/Seoul')::date),'schedules',(select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)),'[]') from cron.job where jobname in ('wkly_sales_collect','wkly_sales_brief','wkly_sales_receive'))) into result;
 return result;
end $$;

-- Recalculate machine assessments without overwriting human review or verification.
do $$ declare p public.sales_prospects; assessed public.sales_prospects;
begin
 for p in select * from public.sales_prospects loop
  assessed:=private.sales_assess(p);
  update public.sales_prospects set assessment=assessed.assessment,score=assessed.score,reasons=assessed.reasons,next_action=assessed.next_action,revision=revision+1 where id=p.id;
 end loop;
end $$;
-- Correct today's briefing evidence in place, without duplicate notifications.
update public.sales_briefings set actions=private.sales_brief_actions(),
 summary=(select format('등록 자료 %s건 · 오늘 첫 취합 %s건 · 우선 검토 %s건. 실제 수요는 내용 검증 후 영업으로 연결합니다. 최신 수집 여부는 출처별 상태를 확인하세요.',count(*),count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date),count(*) filter(where not blocked and coalesce(reviewed_assessment,assessment)='우선 검토')) from public.sales_prospects),
 direction='진행 영업의 약속된 후속 연락을 먼저 확인하세요. 신규 후보는 원문에서 발주처·협력사를 구분하고 실제 수요·수행 범위·근거를 검증한 뒤 영업 방법을 결정합니다.'
 where report_date=(now() at time zone 'Asia/Seoul')::date;
revoke all on function private.sales_prospect_signature(public.sales_prospects),private.sales_prospect_blocked(public.sales_prospects),private.sales_prospect_verified(public.sales_prospects),private.sales_brief_actions() from public,anon,authenticated;
revoke all on function public.sales_prospect_get(uuid),public.sales_prospect_verify(uuid,integer,text,text,text,text,text,text) from public,anon;
grant execute on function public.sales_prospect_get(uuid),public.sales_prospect_verify(uuid,integer,text,text,text,text,text,text) to authenticated;
commit;
