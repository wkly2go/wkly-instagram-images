-- 0064 정기 출금 (대표 지시 2026-10-28 "정기적인 출금일과 금액을 한번에 볼 수 있는 대시보드")
-- 입출금 장부와 같은 잠금: 관리자 + 장부 비밀번호로 연 동안만 (public.ledger_open)
create table if not exists public.cash_recurring (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 60),
  amount bigint not null check (amount > 0 and amount < 100000000000),
  day_of_month int not null check (day_of_month between 1 and 31),
  category text not null default '기타 출금' check (char_length(category) between 1 and 40),
  counterparty text check (counterparty is null or char_length(counterparty) <= 100),
  method text not null default '계좌' check (method in ('계좌', '카드', '현금', '기타')),
  memo text check (memo is null or char_length(memo) <= 500),
  active boolean not null default true,
  start_month text check (start_month is null or start_month ~ '^\d{4}-\d{2}$'),
  end_month text check (end_month is null or end_month ~ '^\d{4}-\d{2}$'),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cash_recurring_created_by_ix on public.cash_recurring (created_by);
alter table public.cash_recurring enable row level security;
create policy cash_recurring_admin on public.cash_recurring for all to authenticated
  using ((select public.ledger_open())) with check ((select public.ledger_open()));
create or replace trigger cash_recurring_updated before update on public.cash_recurring for each row execute function private.cash_ledger_touch();

-- 장부 기록이 어느 정기 출금에서 왔는지 (이번 달 기록 여부 확인용)
alter table public.cash_ledger add column if not exists recurring_id bigint; -- 정기 출금 id (지워져도 기록은 남음)
create index if not exists cash_ledger_recurring_ix on public.cash_ledger (recurring_id);
