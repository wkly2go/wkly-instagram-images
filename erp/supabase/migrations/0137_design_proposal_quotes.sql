-- 0137 quoted insights per proposal section (e.g. THE WKLY homepage insights): [{text, source, url}]. Additive.
begin;
alter table design.proposal_sections add column if not exists quotes jsonb not null default '[]'::jsonb;
create or replace view public.design_proposal_sections with (security_invoker = true) as select * from design.proposal_sections;
notify pgrst, 'reload schema';
commit;
