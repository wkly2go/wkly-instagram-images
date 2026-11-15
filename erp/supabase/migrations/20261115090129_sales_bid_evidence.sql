-- 기획 근거에 참가 자격 판정을 함께 넘긴다: 공공 입찰 기획이 '참여 가능' 공고와 확인이 필요한 조건을 구분해 쓰도록.
begin;
do $$
declare def text; old text:='left(evidence,1200) evidence';
 new text:='left(evidence,1200)||coalesce('' · 참가 자격 판정: ''||(event_data->''eligibility''->>''verdict'')||'' (''||(event_data->''eligibility''->>''note'')||'')'','''') evidence';
begin
 def:=pg_get_functiondef('private.sales_strategy_queue(uuid,uuid,text,integer)'::regprocedure);
 if position('참가 자격 판정' in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner evidence query'; end if;
 execute replace(def,old,new);
end $$;
commit;
