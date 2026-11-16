-- 2026-11-16 대표 지시 '더위클리의 크루업무로 소개해': 영업 메일은 더위클리 이름으로 보내고, 공간 디자인·제작은 '더위클리 크루' 업무로 소개한다.
-- 후속 연락 문안의 서명을 '더위클리 드림'으로 바꾼다(아직 승인·발송된 후속 없음).
begin;
create or replace function private.sales_followup_texts(p_title text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(
  jsonb_build_object('seq',1,'after_business_days',4,'body',
   '담당자님께'||E'\n\n'||'앞서 보내드린 '''||left(p_title,80)||''' 수행 계획을 검토하실 시간이 있으셨는지 여쭙고자 다시 연락드립니다.'||E'\n\n'||
   '일정이 맞으시면 20~30분 온라인 미팅으로 진행 방식과 견적 조건을 설명드리겠습니다. 담당 부서가 따로 있으시면 안내 부탁드립니다.'||E'\n\n'||
   '원치 않으시면 회신으로 알려 주시기 바랍니다. 이후 연락드리지 않겠습니다.'||E'\n\n'||'더위클리 드림'),
  jsonb_build_object('seq',2,'after_business_days',10,'body',
   '담당자님께'||E'\n\n'||''''||left(p_title,80)||''' 관련해 마지막으로 한 번 더 연락드립니다.'||E'\n\n'||
   '지금은 시기가 맞지 않으시더라도, 팝업·행사·공간 연출이 필요하실 때 회신 주시면 더위클리와 크루가 바로 일정과 견적을 준비하겠습니다. 이후에는 먼저 연락드리지 않겠습니다.'||E'\n\n'||'더위클리 드림'))
$$;
revoke all on function private.sales_followup_texts(text) from public,anon,authenticated,service_role;
commit;
