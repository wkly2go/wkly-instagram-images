-- 물가 기준 기호 붙이기를 빠르게 (2026-11-18)
-- 쇼핑몰 계약 단가가 들어오면서 한 번에 15초가 걸려 저장이 시간 초과로 끊겼다. 'not in (하위 조회)' 를 미리 뽑은 목록과 견주는 방식으로 바꿔 0.5초 아래로.
-- 기호 규칙은 그대로다 (품목 · 규격 · 단위마다 하나 · 가장 최근 고시 줄에만). 지우는 것 없음.
create index if not exists price_refs_source_ident on design.price_refs (source, item, spec, unit);

create or replace function design.price_refs_assign_codes(p_source text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; pre text := design.price_ref_prefix(p_source);
begin
  perform pg_advisory_xact_lock(hashtext('design.price_ref_codes'));
  insert into design.price_ref_groups (source, item, no)
  select p_source, x.item, coalesce((select max(g.no) from design.price_ref_groups g where g.source = p_source), 0) + row_number() over (order by x.item)
  from (select distinct r.item from design.price_refs r
        where r.source = p_source and not exists (select 1 from design.price_ref_groups g where g.source = p_source and g.item = r.item)) x;
  insert into design.price_ref_codes (source, item, spec, unit, code)
  select p_source, x.item, x.spec, x.unit,
         pre || case when g.no > 999 then g.no::text else lpad(g.no::text, 3, '0') end || '-' ||
         case when m.mx + x.rn > 999 then (m.mx + x.rn)::text else lpad((m.mx + x.rn)::text, 3, '0') end
  from (select d.item, d.spec, d.unit, row_number() over (partition by d.item order by d.spec, d.unit) rn
        from (select distinct r.item, r.spec, r.unit from design.price_refs r
              where r.source = p_source and r.price > 0
                and not exists (select 1 from design.price_ref_codes c where c.source = p_source and c.item = r.item and c.spec = r.spec and c.unit = r.unit)) d) x
  join design.price_ref_groups g on g.source = p_source and g.item = x.item
  join lateral (select coalesce(max(split_part(c.code, '-', 2)::integer), 0) mx from design.price_ref_codes c where c.source = p_source and c.item = x.item) m on true;
  with win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id from design.price_refs o
    where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = null
  where r.source = p_source and r.code is not null and not exists (select 1 from win w where w.id = r.id);
  with win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id, o.item, o.spec, o.unit, o.code from design.price_refs o
    where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = c.code
  from win w join design.price_ref_codes c on c.source = p_source and c.item = w.item and c.spec = w.spec and c.unit = w.unit
  where r.id = w.id and w.code is distinct from c.code;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function design.price_refs_assign_codes(text) from public, anon, authenticated;
grant execute on function design.price_refs_assign_codes(text) to service_role;
