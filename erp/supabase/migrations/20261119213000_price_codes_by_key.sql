-- 물가 기준 기호 붙이기를 '품목'이 아니라 '품목 · 규격 · 단위'로 좁힘 (2026-11-19 · 운영 적용 뒤 재 본 결과)
-- 20261119210000 은 이번에 바뀐 품목만 훑게 했지만, 쇼핑몰 단가는 품목 하나(레미콘 · 아스팔트콘크리트 등)에 줄이 수만 개라
-- 바뀐 줄 20개를 저장하는 데 5.2초가 걸렸다(묶음 5만 3천 줄 중 3만 1천 줄을 다시 훑음) → 저장 5초 멈춤 장치에 매일 걸릴 뻔함.
-- 기호는 품목 · 규격 · 단위마다 하나이므로 바뀐 줄의 그 세 값(바뀌기 전 값 포함)만 본다. 색인 price_refs_source_ident 를 탄다.
-- 지우는 표 · 함수 없음 · 예전 함수(price_refs_assign_codes · price_refs_assign_codes_for)는 그대로 둔다.

create or replace function design.price_refs_assign_codes_keys(p_source text, p_item text[], p_spec text[], p_unit text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; pre text := design.price_ref_prefix(p_source);
begin
  if coalesce(cardinality(p_item), 0) = 0 then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('design.price_ref_codes'));
  -- 처음 보는 품목에 품명 번호
  insert into design.price_ref_groups (source, item, no)
  select p_source, x.item, coalesce((select max(g.no) from design.price_ref_groups g where g.source = p_source), 0) + row_number() over (order by x.item)
  from (select distinct t.i as item from unnest(p_item) t(i)
        where t.i is not null and not exists (select 1 from design.price_ref_groups g where g.source = p_source and g.item = t.i)) x;
  -- 처음 보는 품목 · 규격 · 단위에 규격 번호 (그 품목의 가장 큰 번호 다음부터)
  with k as materialized (
    select distinct t.i as item, t.s as spec, t.u as unit from unnest(p_item, p_spec, p_unit) t(i, s, u) where t.i is not null
  ), fresh as (
    select k.item, k.spec, k.unit, row_number() over (partition by k.item order by k.spec, k.unit) rn from k
    where exists (select 1 from design.price_refs r where r.source = p_source and r.item = k.item and r.spec = k.spec and r.unit = k.unit and r.price > 0)
      and not exists (select 1 from design.price_ref_codes c where c.source = p_source and c.item = k.item and c.spec = k.spec and c.unit = k.unit)
  ), mx as (
    select f.item, coalesce((select max(split_part(c.code, '-', 2)::integer) from design.price_ref_codes c where c.source = p_source and c.item = f.item), 0) as mx
    from (select distinct item from fresh) f
  )
  insert into design.price_ref_codes (source, item, spec, unit, code)
  select p_source, f.item, f.spec, f.unit,
         pre || case when g.no > 999 then g.no::text else lpad(g.no::text, 3, '0') end || '-' ||
         case when mx.mx + f.rn > 999 then (mx.mx + f.rn)::text else lpad((mx.mx + f.rn)::text, 3, '0') end
  from fresh f join design.price_ref_groups g on g.source = p_source and g.item = f.item join mx on mx.item = f.item;
  -- 기호는 가장 최근 고시 줄에만: 밀려난 줄에서 떼고
  with k as materialized (
    select distinct t.i as item, t.s as spec, t.u as unit from unnest(p_item, p_spec, p_unit) t(i, s, u) where t.i is not null
  ), win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id
    from design.price_refs o join k on o.item = k.item and o.spec = k.spec and o.unit = k.unit
    where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = null
  from k
  where r.source = p_source and r.item = k.item and r.spec = k.spec and r.unit = k.unit and r.code is not null
    and not exists (select 1 from win w where w.id = r.id);
  -- 가장 최근 줄에 붙임
  with k as materialized (
    select distinct t.i as item, t.s as spec, t.u as unit from unnest(p_item, p_spec, p_unit) t(i, s, u) where t.i is not null
  ), win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id, o.item, o.spec, o.unit, o.code
    from design.price_refs o join k on o.item = k.item and o.spec = k.spec and o.unit = k.unit
    where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = c.code
  from win w join design.price_ref_codes c on c.source = p_source and c.item = w.item and c.spec = w.spec and c.unit = w.unit
  where r.id = w.id and w.code is distinct from c.code;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function design.price_refs_assign_codes_keys(text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function design.price_refs_assign_codes_keys(text, text[], text[], text[]) to service_role;

-- 저장: 바뀐 줄의 품목 · 규격 · 단위(바뀌기 전 값 포함 — 규격이 바뀌면 예전 규격의 기호가 다른 줄로 넘어가야 한다)만 기호를 다시 맞춘다
create or replace function public.design_price_refs_save(p_source text, p_name text, p_rows jsonb, p_next_page integer, p_total integer, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; v_items text[]; v_specs text[]; v_units text[];
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'rows'; end if;
  with src as (
    select distinct on (left(r->>'ref_key', 300))
           left(r->>'ref_key', 300) as ref_key, left(coalesce(r->>'category', ''), 200) as category, left(r->>'item', 300) as item,
           left(coalesce(r->>'spec', ''), 500) as spec, left(coalesce(r->>'unit', ''), 30) as unit, (r->>'price')::numeric as price,
           nullif(r->>'material', '')::numeric as material, nullif(r->>'labor', '')::numeric as labor, nullif(r->>'expense', '')::numeric as expense,
           left(coalesce(r->>'region', ''), 100) as region, nullif(r->>'notice_date', '')::date as notice_date, coalesce(r->'raw', '{}'::jsonb) as raw
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where coalesce(r->>'ref_key', '') <> '' and coalesce(r->>'item', '') <> '' and (r->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
    order by left(r->>'ref_key', 300), nullif(r->>'notice_date', '')::date desc nulls last
  ), fresh as materialized (
    select s.* from src s
    where not exists (
      select 1 from design.price_refs e
      where e.source = p_source and e.ref_key = s.ref_key
        and (e.notice_date > s.notice_date
          or ((e.source_name, e.category, e.item, e.spec, e.unit, e.price, e.material, e.labor, e.expense, e.region, e.notice_date, e.raw)
              is not distinct from (p_name, s.category, s.item, s.spec, s.unit, s.price, s.material, s.labor, s.expense, s.region, s.notice_date, s.raw))))
  ), old as (
    select e.item, e.spec, e.unit from design.price_refs e join fresh f on e.source = p_source and e.ref_key = f.ref_key
  ), up as (
    insert into design.price_refs (source, source_name, ref_key, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, raw, fetched_at)
    select p_source, p_name, f.ref_key, f.category, f.item, f.spec, f.unit, design.norm_unit(f.unit), f.price, f.material, f.labor, f.expense, f.region, f.notice_date, f.raw, now()
    from fresh f
    on conflict (source, ref_key) do update set
      source_name = excluded.source_name, category = excluded.category, item = excluded.item, spec = excluded.spec, unit = excluded.unit,
      unit_std = excluded.unit_std, price = excluded.price, material = excluded.material, labor = excluded.labor, expense = excluded.expense,
      region = excluded.region, notice_date = excluded.notice_date, raw = excluded.raw, fetched_at = excluded.fetched_at
    where design.price_refs.notice_date is null or excluded.notice_date is null or excluded.notice_date >= design.price_refs.notice_date
    returning item, spec, unit
  ), ks as (
    select item, spec, unit from up union select item, spec, unit from old
  )
  select (select count(*) from up), array_agg(ks.item), array_agg(ks.spec), array_agg(ks.unit) into n, v_items, v_specs, v_units from ks;
  perform design.price_refs_assign_codes_keys(p_source, v_items, v_specs, v_units);
  insert into private.design_price_ref_sync (source, next_page, total, done_at, last_error, updated_at)
  values (p_source, case when p_done then 1 else greatest(p_next_page, 1) end, p_total, case when p_done then now() end, left(p_error, 500), now())
  on conflict (source) do update set next_page = excluded.next_page, total = coalesce(excluded.total, design_price_ref_sync.total),
    done_at = case when p_done then now() else design_price_ref_sync.done_at end, last_error = excluded.last_error, updated_at = now();
  return n;
end $$;
