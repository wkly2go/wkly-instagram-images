-- 0131 실행 내역(업체가 적힌 품목 목록): 실제 업무 방식 그대로 — 구역별 품목 · 수량 · 단가 · 업체 → 업체별 발주서 · 손익
-- 본보기: '나름대로_기자재_굿즈_리스트 - 실행가 - 261030.xlsx'. 관리자만 본다(실행 금액).
begin;
create table design.cost_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  zone text,
  item text not null,
  spec text not null default '',
  unit text,
  qty numeric(14,3) not null check (qty >= 0),
  cost_price numeric(14,0) check (cost_price >= 0),
  vendor_name text,
  note text,
  source_doc text,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index cost_lines_project on design.cost_lines (project_id, sort);
alter table design.cost_lines enable row level security;
revoke all on design.cost_lines from public, anon;
grant select, insert, update, delete on design.cost_lines to authenticated, design_worker;
grant all on design.cost_lines to service_role;
create policy cost_lines_admin on design.cost_lines for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create view public.design_cost_lines with (security_invoker = true) as select * from design.cost_lines;
revoke all on public.design_cost_lines from public, anon;
grant select, insert, update, delete on public.design_cost_lines to authenticated;
grant all on public.design_cost_lines to service_role;
notify pgrst, 'reload schema';
commit;
