-- 전자세금계산서 대장 (대표 지시 2026-11-06 "계산서 정산 내역 인트라넷에 반영")
--   홈택스 '전자(수정) 세금계산서 목록조회' 엑셀을 올리면 승인번호 기준으로 쌓음 (같은 승인번호는 한 번만)
--   프로젝트 · 결제 대장(수금/지급) 줄과 연결 · 관리자만 봄
create table if not exists public.tax_invoices (
  id uuid primary key default gen_random_uuid(),
  approval_no text not null unique,
  direction text not null default '매출' check (direction in ('매출', '매입')),
  write_date date not null,
  issue_date date,
  our_biz_no text,
  our_name text,
  partner_biz_no text,
  partner_name text not null default '',
  partner_email text,
  total bigint not null default 0,
  supply bigint not null default 0,
  vat bigint not null default 0,
  receipt_kind text,
  invoice_kind text,
  item text,
  note text,
  project_id uuid references public.projects(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  memo text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tax_invoices_date_idx on public.tax_invoices (write_date desc);
create index if not exists tax_invoices_project_idx on public.tax_invoices (project_id);
comment on table public.tax_invoices is '전자세금계산서 대장 (홈택스 목록 엑셀 가져오기) · 관리자 전용';
comment on column public.tax_invoices.receipt_kind is '영수 / 청구';
comment on column public.tax_invoices.invoice_kind is '일반 / 수정 (수정은 금액이 음수일 수 있음)';

alter table public.tax_invoices enable row level security;
drop policy if exists tax_invoices_admin on public.tax_invoices;
create policy tax_invoices_admin on public.tax_invoices for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.tax_invoices to authenticated;
