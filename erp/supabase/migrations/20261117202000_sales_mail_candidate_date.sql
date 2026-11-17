-- 영업 데이터 보정 (2026-11-17 대표 우선순위 2 '영업 첫 발송' 점검 중 발견)
-- 받은 메일에서 가져온 '민간 영업 후보'(growth_items kind contact · 346건)는 11/12 한꺼번에 들어와
-- 자료 날짜(source_updated_at)가 모두 11/12 로 찍혔다. 그래서 8월 문의도 '최근 자료'로 점수가 오르고,
-- 기획안이 '문의 접수일 11/12 · 5일 지남'처럼 틀린 근거를 썼다(실제 메일 2026-08-05 · 마감 9/17 지남).
-- Gmail 메일 · 스레드 id(16자리 16진수)의 앞 11자리는 보낸 시각(ms)이라 그 값을 자료 날짜로 쓴다.
create or replace function private.gmail_id_time(p_url text)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when t between 1420070400000 and 4102444800000 then to_timestamp(t / 1000.0) end
  from (select (('x' || lpad(substr(m[1], 1, 11), 16, '0'))::bit(64)::bigint) t
        from (select regexp_match(coalesce(p_url, ''), '#[a-z]+/([0-9a-f]{16})(?:[^0-9a-f]|$)') m) x
        where m is not null) y
$$;

create or replace function private.sales_collect_internal()
 returns integer
 language plpgsql
 set search_path to ''
as $function$
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
  perform private.sales_index(case when r.kind='tender' then '나라장터 보관 공고' else '민간 영업 후보' end,r.id::text,jsonb_build_object('name',r.title,'entity_kind',case when r.kind='tender' then '영업 기회' when coalesce(r.document->>'name','')<>'' and coalesce(r.document->>'brand','')<>'' and r.document->>'name'<>r.document->>'brand' then '사람' else '미분류' end,'organization',coalesce(r.document->>'brand',r.document->>'agency'),'contact',concat_ws(' · ',nullif(r.document->>'email',''),nullif(r.document->>'instagram','')),'evidence',concat_ws(' · ',r.document->>'segment',r.document->>'note',r.document->>'evidence'),'source_url',r.document->>'source_url','source_updated_at',case when r.kind='contact' then coalesce(private.gmail_id_time(r.document->>'source_url'),r.updated_at) else r.updated_at end,'linked_sales_id',r.linked_sales_id,'blocked',r.status in ('제외','취소') or coalesce(r.document->>'qualification','')='불충족')); n:=n+1;
 end loop;
 for r in select * from public.research_items where status<>'보관' loop
  perform private.sales_index('리서치',r.id::text,jsonb_build_object('name',r.title,'entity_kind','영업 기회','organization',r.brand_name,'evidence',concat_ws(' · ',r.summary,r.body),'source_url',r.source_url,'source_updated_at',r.updated_at,'client_id',r.client_id)); n:=n+1;
 end loop;
 return n;
end $function$;
