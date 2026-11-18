-- 자재목록 · 계약 단가 수집을 밤에만 · 조금씩 (2026-11-18 대표 '서버에서 용량 이슈가 발생했어 · 문제없이 업데이트해')
-- 22:31~22:56 에 계약 단가를 쉬지 않고 받으면서 DB 쓰기량이 평소의 수십 배로 뛰었다(5분마다 디스크로 내려쓰는 양 0.5% → 14~22%).
-- 디스크 자체는 여유(248MB / 8GB)였지만 가장 작은 컴퓨트라 쓰기 · CPU 가 몰리면 경고가 난다.
-- → 새벽 1~6시(KST)에만, 한 번에 4쪽(계약 단가) · 15초(자재목록)씩 받는다. 15분마다 도는 가격 동기화에는 얹지 않는다(함수 v12).
select cron.schedule('design_g2b_mall', '*/5 16-20 * * *', $c$select private.design_run_price_refs('{"mode":"mall","budget_ms":40000,"max_pages":4}'::jsonb) where not exists (select 1 from private.design_g2b_sync where kind = 'mall' and last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)$c$);
select cron.schedule('design_g2b_catalog', '2-57/5 16-20 * * *', $c$select private.design_run_price_refs('{"mode":"catalog","budget_ms":15000}'::jsonb) where not exists (select 1 from private.design_g2b_sync where kind = 'items' and ((state = '{}'::jsonb and done_at > now() - interval '25 days') or (last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)))$c$);
