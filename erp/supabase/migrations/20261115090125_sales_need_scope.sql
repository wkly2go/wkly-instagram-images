-- 2026-11-15 대표 지시: 우리는 팝업·행사의 기획과 대행을 한다. 그 서비스가 필요한 곳만 영업 대상으로 삼는다.
-- 기획에 쓰는 근거를 '수요 신호'가 있는 자료로 한정한다: 팝업·행사를 여는 브랜드, 행사 참가 브랜드, 용역 공고, 들어온 문의,
-- 그리고 팝업·행사 단서가 있는 거래처·민간 후보·박람회. 일반 문화행사 목록, 트렌드 리서치, 사람 목록, 판별 전 기사는 근거에서 뺀다.
begin;
do $$
declare def text; old text:='from public.sales_prospects p where not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in (''보류'',''제외'')';
 new text:='from public.sales_prospects p where not p.blocked and coalesce(p.reviewed_assessment,p.assessment) not in (''보류'',''제외'') and (p.source in (''news_brand'',''행사 참여 브랜드'',''event_participant'',''홈페이지 문의'') or (p.source in (''나라장터 공식 공고'',''나라장터 공식 API'',''나라장터 보관 공고'',''민간 영업 후보'',''거래처'',''브랜드 연락처'',''코엑스 행사'') and (p.name||'' ''||p.evidence) ~ ''(팝업|행사|페스티벌|축제|박람회|전시|프로모션|런칭|론칭|쇼룸|플래그십|체험|부스|컨퍼런스|포럼|기념식|시상식|로드쇼)''))';
begin
 def:=pg_get_functiondef('private.sales_strategy_queue(uuid,uuid,text,integer)'::regprocedure);
 if position('''event_participant'',''홈페이지 문의''' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner source query'; end if;
 execute replace(def,old,new);
end $$;
commit;
