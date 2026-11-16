-- 뉴스 검색어를 실제 성과로 조정한다. 2026-11-16 운영 판별 결과: 브랜드 체험존 22/30 · 브랜드 팝업 14/19 ·
-- 플래그십스토어 오픈 14/19 건이 영업 관련이었고, 페스티벌 개최 0/30 · 박람회 참가기업 모집 0/21 ·
-- 전시회 참가업체 모집 0건 저장이었다. 성과 없는 세 검색어를 브랜드가 직접 여는 팝업·공간 소식 검색어로 바꾼다.
begin;
do $$
declare def text; old text:='''페스티벌 개최'',''박람회 참가기업 모집'',''전시회 참가업체 모집''';
 new text:='''체험형 팝업'',''팝업 부스 운영'',''브랜드 쇼룸 오픈''';
begin
 def:=pg_get_functiondef('private.sales_news_queue()'::regprocedure);
 if position('체험형 팝업' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected news keyword list'; end if;
 execute replace(def,old,new);
end $$;
commit;
