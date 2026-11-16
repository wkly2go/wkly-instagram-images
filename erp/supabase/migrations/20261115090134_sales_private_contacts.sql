-- 2026-11-16 대표 지시: 연락처 없는 대상이 너무 많다 · 나라장터보다 민간 영업이 더 필요하다.
-- ① 브랜드 자체 사이트 찾기를 행사 참가 브랜드에도 적용하고 한 번에 3곳씩 확인한다. 새 읽기 방식(같은 사이트 안
--    이동 따라가기 · 문의 페이지 읽기)으로 다시 찾도록, 사이트를 못 찾았던 기록과 예전 작업 이력을 비운다.
-- ② 행사 참가 브랜드의 공개 문의 주소도 실행 묶음의 수신 후보로 쓴다.
-- ③ 나라장터 공고에 적힌 담당자 이름 · 전화 · 메일을 연락처 칸에 적는다(공고가 문의용으로 공개한 정보).
begin;
do $$
declare def text;
begin
 def:=pg_get_functiondef('private.sales_brand_site_tick()'::regprocedure);
 if position('행사 참여 브랜드' in def)=0 then
  if position('p.source=''news_brand'' and not p.blocked' in def)=0 or position('limit 2 loop' in def)=0 then raise exception 'Unexpected site queue'; end if;
  execute replace(replace(def,'p.source=''news_brand'' and not p.blocked','p.source in (''news_brand'',''행사 참여 브랜드'') and not p.blocked'),'limit 2 loop','limit 3 loop');
 end if;
 def:=pg_get_functiondef('private.sales_strategy_targets(uuid)'::regprocedure);
 if position('p.source in (''news_brand'',''행사 참여 브랜드'')' in def)=0 then
  if position('p.source=''news_brand''' in def)=0 then raise exception 'Unexpected target query'; end if;
  execute replace(def,'p.source=''news_brand''','p.source in (''news_brand'',''행사 참여 브랜드'')');
 end if;
end $$;
delete from private.sales_brand_site_jobs j using public.sales_prospects p where p.id=j.prospect_id and p.source in ('news_brand','행사 참여 브랜드') and coalesce(p.event_data->>'homepage','')='';
update public.sales_prospects set event_data=event_data-'site_checked'-'homepage'-'contact_page'-'public_emails',revision=revision+1
 where source in ('news_brand','행사 참여 브랜드') and event_data ? 'site_checked' and coalesce(event_data->>'homepage','')='';

create or replace function private.sales_bid_officer_contact() returns trigger language plpgsql set search_path='' as $$
declare o jsonb:=new.event_data->'officer'; line text;
begin
 if new.source<>'나라장터 공식 API' or jsonb_typeof(o) is distinct from 'object' or coalesce(new.contact,'')<>'' then return new; end if;
 line:=concat_ws(' · ',nullif('공고 담당 '||left(coalesce(o->>'name',''),40),'공고 담당 '),nullif(left(coalesce(o->>'phone',''),20),''),
  case when coalesce(o->>'email','') ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then o->>'email' end);
 if line<>'' then new.contact:=left(line,300); end if;
 return new;
end $$;
drop trigger if exists sales_bid_officer_contact on public.sales_prospects;
create trigger sales_bid_officer_contact before insert or update on public.sales_prospects for each row execute function private.sales_bid_officer_contact();
revoke all on function private.sales_bid_officer_contact() from public,anon,authenticated;
commit;
