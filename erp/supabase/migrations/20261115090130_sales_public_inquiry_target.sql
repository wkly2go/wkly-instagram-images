-- 보도된 브랜드의 공식 사이트에서 확인한 공개 문의 주소를 실행 묶음의 수신 후보로 쓴다.
-- 개인정보 · 채용 · 자동 발신 같은 주소는 제외한다. 후보가 생겨도 수신 자격 판정은 그대로다:
-- 회사 확인과 수신 목적 확인 전에는 발송 대상이 되지 않는다.
begin;
create or replace function private.sales_public_inquiry_email(p_data jsonb) returns text language sql immutable set search_path='' as $$
 select lower(btrim(v)) from jsonb_array_elements_text(case when jsonb_typeof(p_data->'public_emails')='array' then p_data->'public_emails' else '[]'::jsonb end) with ordinality e(v,n)
 where char_length(btrim(v))<=254 and lower(btrim(v)) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  and split_part(lower(btrim(v)),'@',1) !~ '^(privacy|private|dpo|cpo|no-?reply|do-?not-?reply|abuse|postmaster|mailer-daemon|security|legal|compliance|recruit|recruiting|career|careers|jobs|hr|ir|webmaster)([._+-].*)?$'
 order by n limit 1
$$;
revoke all on function private.sales_public_inquiry_email(jsonb) from public,anon,authenticated;
do $$
declare def text;
 old_email text:='else coalesce(c.email,'''') end)) raw_email';
 new_email text:='else coalesce(nullif(btrim(c.email),''''),case when p.source=''news_brand'' then private.sales_public_inquiry_email(p.event_data) end,'''') end)) raw_email';
 old_origin text:='when c.id is not null then ''거래처 DB'' else ''연결 없음'' end origin';
 new_origin text:='when c.id is not null and coalesce(btrim(c.email),'''')<>'''' then ''거래처 DB'' when p.source=''news_brand'' and private.sales_public_inquiry_email(p.event_data) is not null then ''공식 사이트 공개 주소'' when c.id is not null then ''거래처 DB'' else ''연결 없음'' end origin';
 old_status text:='when e.email='''' then ''연락처 자동 보완 대상'' else ''저장 연락처 연결'' end';
 new_status text:='when e.email='''' then ''연락처 자동 보완 대상'' when e.origin=''공식 사이트 공개 주소'' then ''공식 공개 창구 확보'' else ''저장 연락처 연결'' end';
begin
 def:=pg_get_functiondef('private.sales_strategy_targets(uuid)'::regprocedure);
 if position('sales_public_inquiry_email' in def)>0 then return; end if;
 if position(old_email in def)=0 or position(old_origin in def)=0 or position(old_status in def)=0 then raise exception 'Unexpected target query'; end if;
 execute replace(replace(replace(def,old_email,new_email),old_origin,new_origin),old_status,new_status);
end $$;
commit;
