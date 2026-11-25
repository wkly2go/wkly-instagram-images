-- 2026-11-25 대표 지시 '스몰로 사용하는 최적의 방법을 찾아' — 같은 사양에서 버리는 계산을 줄임 (결과는 그대로)
-- ① 영업 기획 대상 목록: 영업 후보(약 8천 줄)를 기획마다 통째로 훑던 연결을 기본 키로 바로 찾게 (원래 조건은 그대로 함께 둠)
create or replace function private.sales_strategy_targets(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',p.id,'name',p.name,'kind',coalesce(p.reviewed_kind,p.entity_kind),'source',p.source,'source_url',p.source_url,
 'company_id',c.id,'company',coalesce(c.name,p.organization,''),'person_id',h.id,'person',coalesce(h.name,b.contact_name,''),
 'email',e.email,'email_origin',e.origin,'source_signature',private.sales_prospect_signature(p),
 'status',case when private.sales_prospect_blocked(p) or coalesce(p.reviewed_assessment,p.assessment) in ('보류','제외') or p.end_date<(now() at time zone 'Asia/Seoul')::date or exists(select 1 from public.brand_contacts x where x.opt_out and lower(btrim(x.email))=e.email and e.email<>'') then '접촉 제외'
 when e.email='' then '연락처 자동 보완 대상' when e.origin='공식 사이트 공개 주소' then '공식 공개 창구 확보' else '저장 연락처 연결' end,
 'next_action',case when e.email='' then '시스템의 공식 창구 추가 탐색 대상' else '시스템의 담당 역할·수신 자격·제안 적합성 검증 대상' end,
 'outreach_ready',false) order by p.id),'[]'::jsonb)
 from public.sales_strategies s join public.sales_prospects p
   on p.id = any(array(select v::uuid from jsonb_array_elements_text(case when jsonb_typeof(s.plan->'evidence_ids')='array' then s.plan->'evidence_ids' else '[]'::jsonb end) v
                       where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  and s.plan->'evidence_ids' ? p.id::text
 left join public.contacts h on h.id=p.contact_id and (p.client_id is null or h.client_id=p.client_id)
 left join public.clients c on c.id=coalesce(p.client_id,h.client_id)
 left join public.brand_contacts b on p.source='브랜드 연락처' and b.id::text=p.source_key
 cross join lateral (select lower(btrim(case when p.contact_id is not null then coalesce(h.email,'') when b.id is not null then coalesce(b.email,'') else coalesce(nullif(btrim(c.email),''),case when p.source in ('news_brand','행사 참여 브랜드') then private.sales_public_inquiry_email(p.event_data) end,'') end)) raw_email,
 case when p.contact_id is not null then '담당자 DB' when b.id is not null then '브랜드 연락처 DB' when c.id is not null and coalesce(btrim(c.email),'')<>'' then '거래처 DB' when p.source in ('news_brand','행사 참여 브랜드') and private.sales_public_inquiry_email(p.event_data) is not null then '공식 사이트 공개 주소' when c.id is not null then '거래처 DB' else '연결 없음' end origin) raw
 cross join lateral (select case when char_length(raw_email)<=254 and raw_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then raw_email else '' end email,origin) e
 where s.id=p_id
$function$;

-- ② 드라이브 수신방 정리가 파일 이름으로 찾을 때 표 전체를 훑던 것 (5분마다)
create index if not exists drive_index_name_idx on public.drive_index (name);
-- ③ 브랜드 공식 사이트 찾기가 후보마다 작업 기록을 통째로 훑던 것
create index if not exists sales_brand_site_jobs_prospect_idx on private.sales_brand_site_jobs (prospect_id, created_at desc);
