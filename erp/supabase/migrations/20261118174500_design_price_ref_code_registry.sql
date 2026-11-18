-- 물가 기준 기호를 '품목 · 규격 · 단위' 기준으로 (2026-11-18)
-- 같은 품목이 고시 때마다 다른 줄(지역 표기 · 식별번호가 바뀜)로 들어와 줄마다 기호가 달라지는 것을 막는다.
-- 기호는 design.price_ref_codes 에 품목 · 규격 · 단위마다 하나. price_refs.code 는 그중 가장 최근 고시 줄에만 붙는다(= 지금 쓰는 가격).
-- 지난 고시 줄은 기호 없이 이력으로 남는다. 지우는 것 없음.
create table if not exists design.price_ref_codes (
  source text not null,
  item text not null,
  spec text not null default '',
  unit text not null default '',
  code text not null unique,
  created_at timestamptz not null default now(),
  primary key (source, item, spec, unit)
);
alter table design.price_ref_codes enable row level security;
revoke all on design.price_ref_codes from public, anon, authenticated;
grant all on design.price_ref_codes to service_role;

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
  select p_source, w.item, w.spec, w.unit, w.head || case when w.seq > 999 then w.seq::text else lpad(w.seq::text, 3, '0') end
  from (
    select x.item, x.spec, x.unit, pre || case when g.no > 999 then g.no::text else lpad(g.no::text, 3, '0') end || '-' as head,
           coalesce((select max(split_part(c.code, '-', 2)::integer) from design.price_ref_codes c where c.source = p_source and c.item = x.item), 0)
             + row_number() over (partition by x.item order by x.spec, x.unit) as seq
    from (select distinct r.item, r.spec, r.unit from design.price_refs r
          where r.source = p_source and r.price > 0
            and not exists (select 1 from design.price_ref_codes c where c.source = p_source and c.item = r.item and c.spec = r.spec and c.unit = r.unit)) x
    join design.price_ref_groups g on g.source = p_source and g.item = x.item
  ) w;
  -- 기호는 가장 최근 고시 줄 하나에만: 먼저 다른 줄에서 떼고, 그다음 붙인다 (기호는 줄마다 하나뿐이어야 하므로 두 번에 나눔)
  update design.price_refs r set code = null
  where r.source = p_source and r.code is not null
    and r.id not in (select distinct on (o.item, o.spec, o.unit) o.id from design.price_refs o
                     where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc);
  update design.price_refs r set code = c.code
  from (select distinct on (o.item, o.spec, o.unit) o.id, o.item, o.spec, o.unit from design.price_refs o
        where o.source = p_source and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc) w
  join design.price_ref_codes c on c.source = p_source and c.item = w.item and c.spec = w.spec and c.unit = w.unit
  where r.id = w.id and r.code is distinct from c.code;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function design.price_refs_assign_codes(text) from public, anon, authenticated;
grant execute on function design.price_refs_assign_codes(text) to service_role;

-- 방금 줄마다 붙였던 기호는 아직 쓰인 곳이 없으므로 비우고 새 기준으로 다시 붙인다
select pg_advisory_xact_lock(hashtext('design.price_ref_codes'));
update design.price_refs set code = null where code is not null;
select design.price_refs_assign_codes(s) from (select distinct source s from design.price_refs) t;
