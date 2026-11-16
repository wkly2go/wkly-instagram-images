-- 2026-11-16 대표 지시 '처음 메일인데 너무 딥하고 건조해, 친근하게': 후속 연락 문안도 같은 말투로 부드럽게 바꾼다.
-- 회신·수신 거부 시 자동 취소, 4·10영업일 일정은 그대로다.
begin;
create or replace function private.sales_followup_texts(p_title text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(
  jsonb_build_object('seq',1,'after_business_days',4,'body',
   '담당자님, 안녕하세요!'||E'\n\n'||'지난번에 보내드린 '''||left(p_title,80)||''' 아이디어, 혹시 보셨을까요? 바쁘신 시기라 메일이 묻혔을 것 같아 한 번 더 인사드려요.'||E'\n\n'||
   '마음에 드는 아이디어가 있으면 20분 정도 편하게 통화하면서 더 구체적으로 그려 드릴게요. 담당하시는 분이 따로 계시면 알려 주셔도 좋아요.'||E'\n\n'||
   '원치 않으시면 편하게 답장으로 알려 주세요.'||E'\n\n'||'더위클리 드림'),
  jsonb_build_object('seq',2,'after_business_days',10,'body',
   '담당자님, 안녕하세요!'||E'\n\n'||''''||left(p_title,80)||''' 건으로 마지막 인사 드려요.'||E'\n\n'||
   '지금은 시기가 맞지 않으셔도 괜찮아요. 나중에 팝업이나 행사, 공간 연출이 필요해지시면 언제든 답장 주세요. 더위클리와 크루가 반갑게 일정과 견적을 준비해 드릴게요. 이후에는 먼저 연락드리지 않을게요.'||E'\n\n'||'더위클리 드림'))
$$;
revoke all on function private.sales_followup_texts(text) from public,anon,authenticated,service_role;
commit;
