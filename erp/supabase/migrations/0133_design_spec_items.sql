-- 0133 spec book items per project. Five books per the learned standard (Materials, Lighting, Hardware, Sanitary Ware, Appliance & etc).
-- Design area only; no existing table changes. No prices here (prices live in unit_prices / unit_costs).
begin;
create table design.spec_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  book text not null default 'materials' check (book in ('materials', 'lighting', 'hardware', 'sanitary', 'appliance')),
  code text,                         -- material code on drawings, e.g. PT-01
  name text not null,
  spec text,
  location text,                     -- room / zone
  maker text,
  material_id uuid references design.materials(id) on delete set null,
  qty numeric(14,3),
  unit text,
  product_url text,
  note text,
  status text not null default 'review' check (status in ('review', 'selected', 'confirmed', 'dropped')),
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index spec_items_project on design.spec_items (project_id, book, sort);
alter table design.spec_items enable row level security;
revoke all on design.spec_items from public, anon;
grant select, insert, update, delete on design.spec_items to authenticated, design_worker;
grant all on design.spec_items to service_role;
create policy spec_items_member on design.spec_items for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create view public.design_spec_items with (security_invoker = true) as select * from design.spec_items;
revoke all on public.design_spec_items from public, anon;
grant select, insert, update, delete on public.design_spec_items to authenticated;
grant all on public.design_spec_items to service_role;
notify pgrst, 'reload schema';
commit;
