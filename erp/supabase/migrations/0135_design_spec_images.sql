-- 0135 sample image per spec item (SAMPLE / IMAGE cell of the sample spec card). Small preview only (data URL, <= ~300KB),
-- kept apart from spec_items so lists stay light. Additive; design area only.
begin;
create table if not exists design.spec_images (
  item_id uuid primary key references design.spec_items(id) on delete cascade,
  project_id uuid not null references design.projects(id) on delete cascade,
  data text not null check (data like 'data:image/%' and length(data) < 400000),
  created_at timestamptz not null default now()
);
create index if not exists spec_images_project on design.spec_images (project_id);
alter table design.spec_images enable row level security;
revoke all on design.spec_images from public, anon;
grant select, insert, update, delete on design.spec_images to authenticated, design_worker;
grant all on design.spec_images to service_role;
drop policy if exists spec_images_member on design.spec_images;
create policy spec_images_member on design.spec_images for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create or replace view public.design_spec_images with (security_invoker = true) as select * from design.spec_images;
revoke all on public.design_spec_images from public, anon;
grant select, insert, update, delete on public.design_spec_images to authenticated;
grant all on public.design_spec_images to service_role;
notify pgrst, 'reload schema';
commit;
