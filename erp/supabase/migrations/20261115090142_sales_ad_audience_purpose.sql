-- 광고 고객 목록을 목적별로 나눈다 (2026-11-16 대표 지시: 팝업 스케줄 · 공간 대관 · 팝업 대행).
-- 주고받은 메일 제목 · 거래 기록에 적힌 낱말로 가른다. 여러 목적에 걸치면 각 목록에 모두 넣고, 낱말이 없으면 어느 목록에도 넣지 않는다.
begin;
create function public.sales_ad_audience_by_purpose() returns table(purpose text,email text,phone text) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception '관리자만 받을 수 있습니다.' using errcode='42501'; end if;
 return query
 with ev as (
  select lower(substring(p.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) e,string_agg(coalesce(p.name,'')||' '||coalesce(p.organization,'')||' '||coalesce(p.evidence,''),' ') t
  from public.sales_prospects p where p.source in ('거래처','담당자','민간 영업 후보','홈페이지 문의','브랜드 연락처') and p.contact ~ '@' group by 1),
 tagged as (
  select a.email,a.phone,v.purpose from public.sales_ad_audience() a join ev on ev.e=a.email
  cross join lateral (values
   ('공간 대관',ev.t ~* '(대관|공간 ?제휴|공간 ?임대|공간 ?운영|갤러리|스튜디오 ?대여|렌탈 ?스튜디오|쇼룸 ?대여|장소 ?제공|임대 ?문의|오픈스튜디오|팝업 ?공간)'),
   ('팝업 대행',ev.t ~* '(팝업 ?(스토어 ?)?(제작|시공|디자인|견적|대행|운영|기획|부스)|부스 ?(제작|디자인|시공)|견적 ?(요청|문의)|행사 ?(대행|기획|운영)|진열대|집기 ?제작|전시 ?(부스|디자인)|인테리어|시공|설치|프로모션|브랜드 ?행사)'),
   ('팝업 스케줄',ev.t ~* '(인터뷰|취재|매거진|콘텐츠|릴스|큐레이션|팝업 ?(일정|스케줄|소식|정보)|게재|보도자료|리포트 ?신청|이미지 ?사용|EP\.)')
  ) v(purpose,hit) where v.hit)
 select t.purpose,t.email,t.phone from tagged t order by t.purpose,t.email;
end $$;
revoke all on function public.sales_ad_audience_by_purpose() from public,anon;
grant execute on function public.sales_ad_audience_by_purpose() to authenticated;
notify pgrst,'reload schema';
commit;
