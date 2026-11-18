-- 물가 기준에 조명 묶음 LT (2026-11-18 대표 지시 '스펙북에서 제외하고 기본 저장사항으로')
-- 조달청 가격정보에 없는 일반 LED 등기구는 시중 판매가(source 'mkt_lighting')로 물가 기준에 두고 기호 LT 를 붙인다.
-- 자재 목록 · 스펙북에 넣었던 물가 기준 품목은 뺐다(자료 정리는 운영에서 직접 · 구조 변경 없음).
create or replace function design.price_ref_prefix(p_source text) returns text language sql immutable set search_path = '' as $$
  select case p_source
    when 'pps_mtril_bildng' then 'BM' when 'pps_mtril_elcty' then 'EM' when 'pps_mtril_mchn' then 'MM' when 'pps_mtril_engrk' then 'CM'
    when 'pps_mrkt_bildng' then 'BC' when 'pps_mrkt_mchn' then 'MC' when 'pps_mrkt_engrk' then 'CC'
    when 'mkt_lighting' then 'LT' else 'ZZ' end
$$;
