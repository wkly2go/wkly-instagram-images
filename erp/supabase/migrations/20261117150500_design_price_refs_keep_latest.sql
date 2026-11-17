-- 물가 기준: 같은 품목이 여러 공고(반기별)에 나오면 가장 최근 공고 가격만 남긴다 (2026-11-17 · 첫 수집에서 2024 공고가 섞여 나와 보강)
create or replace function public.design_price_refs_save(p_source text, p_name text, p_rows jsonb, p_next_page integer, p_total integer, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'rows'; end if;
  insert into design.price_refs (source, source_name, ref_key, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, raw, fetched_at)
  select distinct on (left(r->>'ref_key', 300))
         p_source, p_name, left(r->>'ref_key', 300), left(coalesce(r->>'category', ''), 200), left(r->>'item', 300), left(coalesce(r->>'spec', ''), 500),
         left(coalesce(r->>'unit', ''), 30), design.norm_unit(r->>'unit'), (r->>'price')::numeric,
         nullif(r->>'material', '')::numeric, nullif(r->>'labor', '')::numeric, nullif(r->>'expense', '')::numeric,
         left(coalesce(r->>'region', ''), 100), nullif(r->>'notice_date', '')::date, coalesce(r->'raw', '{}'::jsonb), now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'ref_key', '') <> '' and coalesce(r->>'item', '') <> '' and (r->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
  order by left(r->>'ref_key', 300), nullif(r->>'notice_date', '')::date desc nulls last
  on conflict (source, ref_key) do update set
    source_name = excluded.source_name, category = excluded.category, item = excluded.item, spec = excluded.spec, unit = excluded.unit,
    unit_std = excluded.unit_std, price = excluded.price, material = excluded.material, labor = excluded.labor, expense = excluded.expense,
    region = excluded.region, notice_date = excluded.notice_date, raw = excluded.raw, fetched_at = excluded.fetched_at
  where design.price_refs.notice_date is null or excluded.notice_date is null or excluded.notice_date >= design.price_refs.notice_date;
  get diagnostics n = row_count;
  insert into private.design_price_ref_sync (source, next_page, total, done_at, last_error, updated_at)
  values (p_source, case when p_done then 1 else greatest(p_next_page, 1) end, p_total, case when p_done then now() end, left(p_error, 500), now())
  on conflict (source) do update set next_page = excluded.next_page, total = coalesce(excluded.total, design_price_ref_sync.total),
    done_at = case when p_done then now() else design_price_ref_sync.done_at end, last_error = excluded.last_error, updated_at = now();
  return n;
end $$;
revoke all on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) to service_role;
