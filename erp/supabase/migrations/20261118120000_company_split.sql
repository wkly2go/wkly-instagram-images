-- 회사 구분 (2026-11-18 대표 지시 '더위클리와 아트리어 회계 구분 · 업체도 각 회사 구분')
-- 지금까지 장부 · 계산서는 모두 아트리어디자인스튜디오(302-88-02334) 것 → 기본값 'AR'
-- 결제 대장은 프로젝트 연번(AR · TW · RS)으로, 세금계산서는 우리 쪽 사업자번호로 화면에서 나눔 (칸 추가 없음)
alter table public.cash_ledger add column if not exists company text not null default 'AR';
alter table public.cash_ledger drop constraint if exists cash_ledger_company_check;
alter table public.cash_ledger add constraint cash_ledger_company_check check (company in ('AR', 'TW'));
create index if not exists cash_ledger_company_date on public.cash_ledger (company, entry_date desc);

alter table public.cash_ledger_opening add column if not exists company text not null default 'AR';
alter table public.cash_ledger_opening drop constraint if exists cash_ledger_opening_company_check;
alter table public.cash_ledger_opening add constraint cash_ledger_opening_company_check check (company in ('AR', 'TW'));

-- 거래처 · 협력사가 어느 회사와 거래하는지 (비우면 프로젝트 · 계산서로 저절로 판단)
alter table public.clients add column if not exists companies text[];
alter table public.clients drop constraint if exists clients_companies_check;
alter table public.clients add constraint clients_companies_check check (companies is null or companies <@ array['AR', 'TW']::text[]);
