-- 0136 render / perspective scenes per project (learned standard: two-digit order + floor + room name, final set of ~31 scenes).
-- Keeps a small preview (data URL) and a link to the original file; originals stay in Drive. Additive; design area only.
begin;
create table if not exists design.renders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  no text not null default '',
  title text not null,
  data text check (data is null or (data like 'data:image/%' and length(data) < 400000)),
  original_url text,
  status text not null default 'draft' check (status in ('draft', 'final')),
  note text,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists renders_project on design.renders (project_id, sort);
alter table design.renders enable row level security;
revoke all on design.renders from public, anon;
grant select, insert, update, delete on design.renders to authenticated, design_worker;
grant all on design.renders to service_role;
drop policy if exists renders_member on design.renders;
create policy renders_member on design.renders for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create or replace view public.design_renders with (security_invoker = true) as select * from design.renders;
revoke all on public.design_renders from public, anon;
grant select, insert, update, delete on public.design_renders to authenticated;
grant all on public.design_renders to service_role;
notify pgrst, 'reload schema';
commit;
