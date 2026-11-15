-- Planning starts from the brands found in recent news: up to five of the ten sources handed to the
-- planner are newly reported brands, the rest stay a mix of the other source types.
begin;
do $$
declare def text; old text:='pool where n<=8 order by md5(id::text||p_id::text) limit 10'; new text:='pool where n<=8 order by case when source=''news_brand'' and n<=5 then 0 else 1 end,md5(id::text||p_id::text) limit 10';
begin
 def:=pg_get_functiondef('private.sales_strategy_queue(uuid,uuid,text,integer)'::regprocedure);
 if position(new in def)>0 then return; end if;
 if position(old in def)=0 then raise exception 'Unexpected planner source query'; end if;
 execute replace(def,old,new);
end $$;
-- Performers, local governments and public agencies named in an article are not buyers of a pop-up build.
update public.sales_prospects set assessment='보류',score=0,reasons='자동 정리: 연예인·지자체·공공기관은 팝업·공간 영업 대상이 아님',next_action='조치 없음',revision=revision+1
where source='news_brand' and reviewed_assessment is null and assessment<>'보류' and (name ~ '(군|시청|구청|도청|재단|공사|공단|협회|지구)$' or name in ('KOTRA','이세계아이돌','투모로우바이투게더','조은해'));
commit;
