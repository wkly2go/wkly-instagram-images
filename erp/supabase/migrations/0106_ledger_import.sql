-- 회계 자료 폴더 자동 기입 (대표 지시 2026-11-11 "은행과 홈택스 자료를 넣을 폴더 … 모든 자료를 분류하고 기입해서 자동으로")
--   · cash_ledger: 통장/카드(account) · 출처(source) · 중복 막기 열쇠(source_ref) · 공급가/부가세 · 증빙 · 거래 뒤 잔액
--     · 내 통장끼리 이체/카드대금(is_transfer: 합계에서 뺌) · 확인 필요(needs_review)
--   · cash_ledger_files: 폴더에서 처리한 파일 (다시 처리 안 함)
--   · cash_ledger_meta: 폴더 id 등 설정 · cash_ledger_opening: 연도 · 통장별 기초 잔액 (서버 저장)
--   · 고치기 · 지우기 이력 (private.cash_ledger_log)
alter table public.cash_ledger
  add column if not exists account text check (account is null or char_length(account) <= 60),
  add column if not exists source text not null default '수기' check (source in ('수기', '은행', '홈택스', '결제대장')),
  add column if not exists source_ref text,
  add column if not exists supply bigint,
  add column if not exists vat bigint,
  add column if not exists evidence text check (evidence is null or char_length(evidence) <= 20),
  add column if not exists balance_after bigint,
  add column if not exists is_transfer boolean not null default false,
  add column if not exists needs_review boolean not null default false,
  add column if not exists file_id text;
alter table public.cash_ledger add constraint cash_ledger_source_ref_key unique (source_ref); -- (NULL 은 여러 개 허용)

create table if not exists public.cash_ledger_files (
  drive_file_id text primary key,
  name text not null,
  kind text not null,
  modified_time text,
  rows integer not null default 0,
  added integer not null default 0,
  note text,
  processed_at timestamptz not null default now(),
  processed_by uuid default auth.uid() references public.profiles(id) on delete set null
);
create table if not exists public.cash_ledger_meta (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table if not exists public.cash_ledger_opening (
  year integer not null check (year between 2000 and 2100),
  account text not null default '전체',
  amount bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (year, account)
);
alter table public.cash_ledger_files enable row level security;
alter table public.cash_ledger_meta enable row level security;
alter table public.cash_ledger_opening enable row level security;
drop policy if exists cash_ledger_files_open on public.cash_ledger_files;
create policy cash_ledger_files_open on public.cash_ledger_files for all to authenticated using ((select public.ledger_open())) with check ((select public.ledger_open()));
drop policy if exists cash_ledger_meta_open on public.cash_ledger_meta;
create policy cash_ledger_meta_open on public.cash_ledger_meta for all to authenticated using ((select public.ledger_open())) with check ((select public.ledger_open()));
drop policy if exists cash_ledger_opening_open on public.cash_ledger_opening;
create policy cash_ledger_opening_open on public.cash_ledger_opening for all to authenticated using ((select public.ledger_open())) with check ((select public.ledger_open()));
grant select, insert, update, delete on public.cash_ledger_files, public.cash_ledger_meta, public.cash_ledger_opening to authenticated;

-- 고치기 · 지우기 이력 (장부는 바꾼 기록이 남아야 함)
create table if not exists private.cash_ledger_log (
  id bigint generated always as identity primary key,
  ledger_id bigint not null,
  op text not null,
  old_row jsonb,
  new_row jsonb,
  by_user uuid default auth.uid(),
  at timestamptz not null default now()
);
create or replace function private.cash_ledger_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.cash_ledger_log (ledger_id, op, old_row, new_row) values (old.id, tg_op, to_jsonb(old), case when tg_op = 'UPDATE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists cash_ledger_audit on public.cash_ledger;
create trigger cash_ledger_audit after update or delete on public.cash_ledger for each row execute function private.cash_ledger_audit();
