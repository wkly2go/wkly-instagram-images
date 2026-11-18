-- 물가 기준 기호 (2026-11-18 대표 지시 '기호화해서 모든 물가정보를 인트라넷에 저장 · 견적이나 물량 산출에 사용')
-- 물가 기준(design.price_refs) 한 줄마다 바뀌지 않는 기호를 붙인다: 묶음 2글자 + 품명 번호 3자리 - 규격 번호 3자리 (예: BM012-005)
--   BM 건축 자재 · EM 전기·통신 자재 · MM 기계설비 자재 · CM 토목 자재 · BC 건축 시공 · MC 기계설비 시공 · CC 토목 시공
-- 가격이 새로 고시돼도 같은 줄(source · ref_key)은 기호가 그대로다. 새 품목 · 규격은 다음 번호를 받는다. 지우는 것 없음.
alter table design.price_refs add column if not exists code text;
create unique index if not exists price_refs_code_key on design.price_refs (code) where code is not null;

create table if not exists design.price_ref_groups (
  source text not null,
  item text not null,
  no integer not null,
  primary key (source, item),
  unique (source, no)
);
alter table design.price_ref_groups enable row level security;
revoke all on design.price_ref_groups from public, anon, authenticated;
grant all on design.price_ref_groups to service_role;

create or replace function design.price_ref_prefix(p_source text) returns text language sql immutable set search_path = '' as $$
  select case p_source
    when 'pps_mtril_bildng' then 'BM' when 'pps_mtril_elcty' then 'EM' when 'pps_mtril_mchn' then 'MM' when 'pps_mtril_engrk' then 'CM'
    when 'pps_mrkt_bildng' then 'BC' when 'pps_mrkt_mchn' then 'MC' when 'pps_mrkt_engrk' then 'CC' else 'ZZ' end
$$;

create or replace function design.price_refs_assign_codes(p_source text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; pre text := design.price_ref_prefix(p_source);
begin
  perform pg_advisory_xact_lock(hashtext('design.price_ref_codes'));
  insert into design.price_ref_groups (source, item, no)
  select p_source, x.item, coalesce((select max(g.no) from design.price_ref_groups g where g.source = p_source), 0) + row_number() over (order by x.item)
  from (select distinct r.item from design.price_refs r
        where r.source = p_source and r.code is null
          and not exists (select 1 from design.price_ref_groups g where g.source = p_source and g.item = r.item)) x;
  update design.price_refs r
     set code = k.head || case when k.seq > 999 then k.seq::text else lpad(k.seq::text, 3, '0') end
  from (
    select w.id, w.head,
           coalesce((select max(nullif(regexp_replace(split_part(o.code, '-', 2), '\D', '', 'g'), '')::integer)
                     from design.price_refs o where o.code like w.head || '%'), 0) + w.rn as seq
    from (
      select r2.id, pre || case when g.no > 999 then g.no::text else lpad(g.no::text, 3, '0') end || '-' as head,
             row_number() over (partition by r2.item order by r2.spec, r2.unit, r2.region, r2.id) as rn
      from design.price_refs r2 join design.price_ref_groups g on g.source = p_source and g.item = r2.item
      where r2.source = p_source and r2.code is null
    ) w
  ) k
  where r.id = k.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function design.price_refs_assign_codes(text) from public, anon, authenticated;
grant execute on function design.price_refs_assign_codes(text) to service_role;

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
  perform design.price_refs_assign_codes(p_source);
  insert into private.design_price_ref_sync (source, next_page, total, done_at, last_error, updated_at)
  values (p_source, case when p_done then 1 else greatest(p_next_page, 1) end, p_total, case when p_done then now() end, left(p_error, 500), now())
  on conflict (source) do update set next_page = excluded.next_page, total = coalesce(excluded.total, design_price_ref_sync.total),
    done_at = case when p_done then now() else design_price_ref_sync.done_at end, last_error = excluded.last_error, updated_at = now();
  return n;
end $$;
revoke all on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) to service_role;

-- 식별번호가 '0' 이라 단위별로 한 줄만 남았던 시장시공가격 줄: 열쇠를 품명 · 규격 기준으로 바꿔 다음 수집이 같은 줄을 고치게 한다
update design.price_refs r set ref_key = left(r.item || '|' || r.spec || '|' || r.region || '|' || r.unit, 300)
where r.ref_key ~ '^0*\|'
  and not exists (select 1 from design.price_refs o where o.source = r.source and o.id <> r.id and o.ref_key = left(r.item || '|' || r.spec || '|' || r.region || '|' || r.unit, 300));

-- 이미 받은 줄에 기호 붙이기
select design.price_refs_assign_codes(s) from (select distinct source s from design.price_refs) t;

create or replace view public.design_price_refs with (security_invoker = true) as
  select id, source_name, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, fetched_at, code, source
  from design.price_refs where price > 0;
grant select on public.design_price_refs to authenticated;
notify pgrst, 'reload schema';
