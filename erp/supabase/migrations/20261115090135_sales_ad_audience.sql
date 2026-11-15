-- 광고 고객 목록(구글 고객 일치 타겟팅 · 네이버 고객 파일)용 자료. 관리자만 받는다.
-- 우리가 직접 거래하거나 연락을 주고받은 상대만 담는다: 거래처, 담당자, 직접 받은 브랜드 연락처, 메일 · 홈페이지 문의.
-- 공개 사이트에서 찾은 주소, 수신 거부, 자동 발신 · 서비스 업체 주소, 사내 주소는 넣지 않는다.
begin;
create function private.sales_ad_excluded(p_email text) returns boolean language sql immutable set search_path='' as $$
 select private.sales_mail_noise(p_email,'') is not null
  or split_part(p_email,'@',1) ~ '^(support|announcements?|community|rsvp|feedback|welcome|team|delivery|friends|notices?|bill|mailmaster|hometaxadmin|trustandsafety|googlecloud|gemini-notes|communication|letter|kosis|opendata|datalabnews|norply|ads-support|maccount|bingwb|service-mail|nice_customer|linkareer_cs|ecount|popbill)([._+-].*)?$'
  or split_part(p_email,'@',2) ~ '(^|\.)(google|openai|figma|supabase|microsoft|adobe|slack|metricool|firecrawl|unsplash|envato|webflow|stibee|tosspayments|popbill|makebill|magicbill|ecount|nicepg|hometax|anthropic|github|notion|cloudflare|buffer|resend)\.(com|co\.kr|dev|so|go\.kr|io)$|(^|\.)maily\.so$'
$$;
create function public.sales_ad_audience() returns table(email text,phone text,segment text) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 받을 수 있습니다.' using errcode='42501'; end if;
 return query
 with raw as (
  select lower(btrim(c.email)) e,c.phone p,'담당자' s,1 o from public.contacts c
  union all select lower(btrim(c.email)),c.phone,'거래처',2 from public.clients c
  union all select lower(btrim(b.email)),b.phone,'브랜드 연락처',3 from public.brand_contacts b where not b.opt_out and b.collected_by_agent is null
  union all select lower(substring(sp.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),null,'문의',4 from public.sales_prospects sp
   where sp.source in ('민간 영업 후보','홈페이지 문의') and not sp.blocked and coalesce(sp.reviewed_assessment,sp.assessment) not in ('제외','보류'))
 select r.e,coalesce(max(case when regexp_replace(coalesce(r.p,''),'[^0-9]','','g') ~ '^01[0-9]{8,9}$' then '+82'||substr(regexp_replace(r.p,'[^0-9]','','g'),2) end),max(case when regexp_replace(coalesce(r.p,''),'[^0-9]','','g') ~ '^0[0-9]{8,10}$' then '+82'||substr(regexp_replace(r.p,'[^0-9]','','g'),2) end),''),(array_agg(r.s order by r.o))[1]
 from raw r where r.e ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' and char_length(r.e)<=254
  and not private.sales_ad_excluded(r.e)
  and split_part(r.e,'@',2) not in (select distinct split_part(lower(pr.email),'@',2) from public.profiles pr where pr.email is not null and split_part(lower(pr.email),'@',2) !~ '^(gmail|naver|daum|hanmail|kakao|nate|outlook|hotmail|icloud|yahoo)\.')
  and r.e not in (select lower(pr.email) from public.profiles pr where pr.email is not null)
  and r.e not in (select lower(btrim(b.email)) from public.brand_contacts b where b.opt_out and b.email is not null)
 group by r.e order by r.e;
end $$;
revoke all on function private.sales_ad_excluded(text) from public,anon,authenticated;
revoke all on function public.sales_ad_audience() from public,anon;
grant execute on function public.sales_ad_audience() to authenticated;
notify pgrst,'reload schema';
commit;
