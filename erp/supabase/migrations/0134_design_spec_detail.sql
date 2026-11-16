-- 0134 spec book detail fields, following the sample spec books (CODE LIST + SPEC card per item):
-- FINISH · SIZE · DISTRIBUTOR · CONNECT NO. · DELIVERY · STOCK. Additive only; view picks the new columns up.
begin;
alter table design.spec_items
  add column if not exists finish text,
  add column if not exists size text,
  add column if not exists distributor text,
  add column if not exists contact text,
  add column if not exists delivery text,
  add column if not exists stock text;
create or replace view public.design_spec_items with (security_invoker = true) as select * from design.spec_items;
notify pgrst, 'reload schema';
commit;
