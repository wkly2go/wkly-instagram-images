-- 2026-11-16 대표 지시: 나라장터보다 민간 영업이 더 필요하다.
-- 자동 기획 6회 가운데 5회는 민간 브랜드(팝업 · 매장 오픈 · 행사 참가) 대상으로, 1회(세 번째)만 공공 입찰로 지시한다.
begin;
do $$
declare def text; old text:='''서로 다른 고객군·상품 조합·접근 방식으로 오늘의 새로운 영업 기회를 기획해 주세요.''';
 new text:='case when slot=3 then ''참여 가능한 공공 용역 공고 가운데 팝업·행사 기획·대행에 맞는 한 건을 골라 입찰 준비 기획을 해 주세요.'' else ''민간 브랜드를 대상으로 기획해 주세요. 팝업·매장 오픈·행사 참가 소식이 보도된 브랜드나 기존 거래처 가운데, 오늘 앞선 기획과 다른 대상·다른 영업 방법을 고릅니다. 공공 입찰 공고는 이번 기획의 대상이 아닙니다.'' end';
begin
 def:=pg_get_functiondef('private.sales_strategy_schedule()'::regprocedure);
 if position('공공 입찰 공고는 이번 기획의 대상이 아닙니다' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner schedule'; end if;
 execute replace(def,old,new);
end $$;
commit;
