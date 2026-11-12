-- 세금계산서 ↔ 은행 거래 대사 결과 저장 (대표 지시 2026-11-12 "계산서와 은행거래장부와 대조해서 장부 완성해")
--  settled    : 이 계산서에 대해 실제로 받은 · 낸 돈 (부가세 포함 · 원)
--  ledger_ids : 짝지어진 입출금 장부 줄 (cash_ledger.id)
--  settle_how : 한 번에 · 나눠서 · 여러 계산서 한 번에 · 카드 · 수정 발행 취소 · 수기
alter table public.tax_invoices
  add column if not exists settled bigint,
  add column if not exists ledger_ids bigint[],
  add column if not exists settle_how text check (settle_how is null or char_length(settle_how) <= 40),
  add column if not exists settled_at timestamptz;
