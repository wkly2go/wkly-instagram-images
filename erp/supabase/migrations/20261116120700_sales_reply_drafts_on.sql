-- 2026-11-16 '실행이 부족해': 고객 회신이 오면 다음 대응 초안(회신 요약 · 제안 · 답장 초안)을 자동으로 준비한다.
-- 기존 회신 초안 작업(sales_followup_tick · 하루 6건 · 주간 AI 한도 안 · 발송 없음)을 운영 맥박에 넣어 켠다.
-- 답장은 보내지 않는다. 초안은 영업 화면 CRM 기록에서 대표가 확인한다.
begin;
insert into private.sales_ops_steps(step,label,call,every_min,grace_min) values('reply_drafts','회신 대응 초안 준비','private.sales_followup_tick()',5,5) on conflict(step) do nothing;
commit;
