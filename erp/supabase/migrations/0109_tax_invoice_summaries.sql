-- 홈택스 '세금계산서 합계표'(매출처별 · 매입처별) 저장 (대표 지시 2026-11-12 "인트라넷이 이 자료를 못 읽는 이유를 분석하고 학습시켜")
--  합계표는 거래 하나하나가 아니라 기간 · 거래처별 합계라 입출금 장부에 넣지 않고,
--  인트라넷 세금계산서 대장(tax_invoices)이 빠짐없이 들어왔는지 대조하는 데 씀
create table if not exists public.tax_invoice_summaries (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('매출', '매입')),
  period_from date not null,
  period_to date not null,
  partner_biz_no text not null,
  partner_name text,
  count integer not null default 0,
  supply bigint not null default 0,
  vat bigint not null default 0,
  total bigint not null default 0,
  file_name text,
  uploaded_at timestamptz not null default now(),
  unique (direction, period_from, period_to, partner_biz_no)
);
comment on table public.tax_invoice_summaries is '홈택스 세금계산서 합계표 (기간 · 거래처별 매수 · 금액) · 계산서 대장 누락 대조용 · 관리자 전용';
alter table public.tax_invoice_summaries enable row level security;
drop policy if exists tax_invoice_summaries_admin on public.tax_invoice_summaries;
create policy tax_invoice_summaries_admin on public.tax_invoice_summaries for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.tax_invoice_summaries to authenticated;
