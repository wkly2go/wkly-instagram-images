-- 나라장터 자료를 매일 조금씩 (2026-11-19 대표 '나라장터 자료 수집을 최소로 매일 조금씩 하면 어떨까?' → '제안을 승인해')
-- 같은 날 새벽 장애의 원인은 받는 양보다 '저장할 때마다 하는 일'이었다:
--   ⓐ 한 쪽(999줄)을 저장할 때마다 그 묶음 전체(쇼핑몰 단가 약 5만 줄)를 세 번 훑어 기호를 다시 붙임
--   ⓑ 바뀐 것이 없는 줄도 매번 고쳐 써서(색인 · 검색용 색인까지) 디스크 쓰기가 몰림
-- 그래서: 기호는 이번에 들어온 품목만 · 바뀌지 않은 줄은 건너뜀 · 하루 한 번 새벽 03:10(KST) 8쪽 · 자재목록은 03:40 에 20초만
--         · DB 가 바쁘면 그날은 건너뜀(db_calm) · 저장이 5초를 넘기면 그날은 멈춤(SLOW) · 서버 지킴이가 이상을 보면 하루 쉼(brake_until)
-- 지우는 표 · 함수 없음 · 예전 함수 design.price_refs_assign_codes(p_source) 는 그대로 둔다(묶음 전체를 다시 맞출 때 손으로 씀).

-- ⓐ 이번에 들어온 품목만 기호 붙이기 (규칙은 price_refs_assign_codes 와 같음: 품목 · 규격 · 단위마다 하나 · 가장 최근 고시 줄에만)
create or replace function design.price_refs_assign_codes_for(p_source text, p_items text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; pre text := design.price_ref_prefix(p_source);
begin
  if coalesce(cardinality(p_items), 0) = 0 then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('design.price_ref_codes'));
  insert into design.price_ref_groups (source, item, no)
  select p_source, x.item, coalesce((select max(g.no) from design.price_ref_groups g where g.source = p_source), 0) + row_number() over (order by x.item)
  from (select distinct i.item from unnest(p_items) i(item)
        where i.item is not null and not exists (select 1 from design.price_ref_groups g where g.source = p_source and g.item = i.item)) x;
  insert into design.price_ref_codes (source, item, spec, unit, code)
  select p_source, x.item, x.spec, x.unit,
         pre || case when g.no > 999 then g.no::text else lpad(g.no::text, 3, '0') end || '-' ||
         case when m.mx + x.rn > 999 then (m.mx + x.rn)::text else lpad((m.mx + x.rn)::text, 3, '0') end
  from (select d.item, d.spec, d.unit, row_number() over (partition by d.item order by d.spec, d.unit) rn
        from (select distinct r.item, r.spec, r.unit from design.price_refs r
              where r.source = p_source and r.item = any(p_items) and r.price > 0
                and not exists (select 1 from design.price_ref_codes c where c.source = p_source and c.item = r.item and c.spec = r.spec and c.unit = r.unit)) d) x
  join design.price_ref_groups g on g.source = p_source and g.item = x.item
  join lateral (select coalesce(max(split_part(c.code, '-', 2)::integer), 0) mx from design.price_ref_codes c where c.source = p_source and c.item = x.item) m on true;
  with win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id from design.price_refs o
    where o.source = p_source and o.item = any(p_items) and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = null
  where r.source = p_source and r.item = any(p_items) and r.code is not null and not exists (select 1 from win w where w.id = r.id);
  with win as materialized (
    select distinct on (o.item, o.spec, o.unit) o.id, o.item, o.spec, o.unit, o.code from design.price_refs o
    where o.source = p_source and o.item = any(p_items) and o.price > 0 order by o.item, o.spec, o.unit, o.notice_date desc nulls last, o.id desc)
  update design.price_refs r set code = c.code
  from win w join design.price_ref_codes c on c.source = p_source and c.item = w.item and c.spec = w.spec and c.unit = w.unit
  where r.id = w.id and w.code is distinct from c.code;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function design.price_refs_assign_codes_for(text, text[]) from public, anon, authenticated;
grant execute on function design.price_refs_assign_codes_for(text, text[]) to service_role;

-- ⓑ 물가 기준 저장: 이미 같은 값으로 있는 줄 · 더 새 고시가 있는 줄은 아예 건드리지 않고(읽기만), 기호는 바뀐 줄의 품목만
--    (같은 이름 · 같은 인자로 다시 만듦. on conflict 의 where 만으로는 안 고치는 줄도 잠금 표시를 써서 쪽이 더러워지므로 넣기 전에 거른다)
create or replace function public.design_price_refs_save(p_source text, p_name text, p_rows jsonb, p_next_page integer, p_total integer, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; v_items text[];
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
  ), fresh as (
    select s.* from src s
    where not exists (
      select 1 from design.price_refs e
      where e.source = p_source and e.ref_key = s.ref_key
        and (e.notice_date > s.notice_date
          or ((e.source_name, e.category, e.item, e.spec, e.unit, e.price, e.material, e.labor, e.expense, e.region, e.notice_date, e.raw)
              is not distinct from (p_name, s.category, s.item, s.spec, s.unit, s.price, s.material, s.labor, s.expense, s.region, s.notice_date, s.raw))))
  ), up as (
    insert into design.price_refs (source, source_name, ref_key, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, raw, fetched_at)
    select p_source, p_name, f.ref_key, f.category, f.item, f.spec, f.unit, design.norm_unit(f.unit), f.price, f.material, f.labor, f.expense, f.region, f.notice_date, f.raw, now()
    from fresh f
    on conflict (source, ref_key) do update set
      source_name = excluded.source_name, category = excluded.category, item = excluded.item, spec = excluded.spec, unit = excluded.unit,
      unit_std = excluded.unit_std, price = excluded.price, material = excluded.material, labor = excluded.labor, expense = excluded.expense,
      region = excluded.region, notice_date = excluded.notice_date, raw = excluded.raw, fetched_at = excluded.fetched_at
    where design.price_refs.notice_date is null or excluded.notice_date is null or excluded.notice_date >= design.price_refs.notice_date
    returning item)
  select count(*), array_agg(distinct item) into n, v_items from up;
  perform design.price_refs_assign_codes_for(p_source, v_items);
  insert into private.design_price_ref_sync (source, next_page, total, done_at, last_error, updated_at)
  values (p_source, case when p_done then 1 else greatest(p_next_page, 1) end, p_total, case when p_done then now() end, left(p_error, 500), now())
  on conflict (source) do update set next_page = excluded.next_page, total = coalesce(excluded.total, design_price_ref_sync.total),
    done_at = case when p_done then now() else design_price_ref_sync.done_at end, last_error = excluded.last_error, updated_at = now();
  return n;
end $$;

-- ⓑ 자재목록 저장: 이미 같은 값으로 있는 줄은 건드리지 않음 · 사람이나 서버 지킴이가 적어 둔 멈춤(paused · brake_until)은 수집 함수가 덮어쓰지 않게 남김
create or replace function public.design_g2b_save(p_kind text, p_rows jsonb, p_state jsonb, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; capped boolean := false;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'rows'; end if;
  if p_kind like 'class%' then
    with src as (
      select distinct on (r->>'code') r->>'code' as code, left(r->>'name', 200) as name, left(coalesce(r->>'name_en', ''), 200) as name_en,
             (r->>'level')::smallint as level, coalesce((r->>'use_yn')::boolean, true) as use_yn
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
      where (r->>'code') ~ '^[0-9]{2,10}$' and coalesce(r->>'name', '') <> '' and (r->>'level') ~ '^(2|4|6|8|10)$'
      order by r->>'code')
    insert into design.g2b_classes (code, name, name_en, level, use_yn, updated_at)
    select s.code, s.name, s.name_en, s.level, s.use_yn, now() from src s
    where not exists (select 1 from design.g2b_classes e where e.code = s.code
                        and (e.name, e.name_en, e.level, e.use_yn) is not distinct from (s.name, s.name_en, s.level, s.use_yn))
    on conflict (code) do update set name = excluded.name, name_en = excluded.name_en, level = excluded.level, use_yn = excluded.use_yn, updated_at = now();
    get diagnostics n = row_count;
  elsif p_kind = 'items' then
    if (select reltuples from pg_class where oid = 'design.g2b_items'::regclass) >= 2000000 then
      capped := true;
    else
      with src as (
        select distinct on (r->>'ident_no') r->>'ident_no' as ident_no, left(r->>'class_no', 10) as class_no, left(coalesce(r->>'dtil_class_no', ''), 12) as dtil_class_no,
               left(r->>'name', 400) as name, left(coalesce(r->>'maker', ''), 120) as maker, left(coalesce(r->>'kind', ''), 20) as kind,
               case when (r->>'chg_date') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'chg_date')::date end as chg_date
        from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
        where (r->>'ident_no') ~ '^[0-9]{6,12}$' and (r->>'class_no') ~ '^[0-9]{8}$' and coalesce(r->>'name', '') <> ''
        order by r->>'ident_no')
      insert into design.g2b_items (ident_no, class_no, dtil_class_no, name, maker, kind, chg_date, updated_at)
      select s.ident_no, s.class_no, s.dtil_class_no, s.name, s.maker, s.kind, s.chg_date, now() from src s
      where not exists (select 1 from design.g2b_items e where e.ident_no = s.ident_no
                          and (e.class_no, e.dtil_class_no, e.name, e.maker, e.kind, e.chg_date) is not distinct from (s.class_no, s.dtil_class_no, s.name, s.maker, s.kind, s.chg_date))
      on conflict (ident_no) do update set class_no = excluded.class_no, dtil_class_no = excluded.dtil_class_no, name = excluded.name, maker = excluded.maker, kind = excluded.kind, chg_date = excluded.chg_date, updated_at = now();
      get diagnostics n = row_count;
    end if;
  elsif p_kind = 'mall' then
    n := 0;
  else
    raise exception 'kind';
  end if;
  insert into private.design_g2b_sync (kind, state, done_at, last_error, updated_at)
  values (p_kind, case when (p_done and p_kind <> 'mall') or capped then '{}'::jsonb else coalesce(p_state, '{}'::jsonb) - 'paused' - 'brake_until' end, case when p_done or capped then now() end,
          case when capped then '품목 200만 줄 한도에 닿아 멈춤' else left(p_error, 500) end, now())
  on conflict (kind) do update set
    state = excluded.state || jsonb_strip_nulls(jsonb_build_object('paused', design_g2b_sync.state->'paused', 'brake_until', design_g2b_sync.state->'brake_until')),
    done_at = case when p_done or capped then now() else design_g2b_sync.done_at end,
    last_error = excluded.last_error, updated_at = now();
  return case when capped then -1 else n end;
end $$;

-- 예약(대표 승인안 그대로): 하루 한 번 새벽 쇼핑몰 단가(03:10 KST · 8쪽 · 50초) · 자재목록(03:40 KST · 20초)
-- 건너뛰는 때: 그날 호출 한도에 걸림 · 하루 안에 저장이 느렸음(SLOW) · DB 가 바쁨(db_calm)
select cron.alter_job((select jobid from cron.job where jobname = 'design_g2b_mall'),
  schedule := '10 18 * * *',
  command := $c$select private.design_run_price_refs('{"mode":"mall","budget_ms":50000,"max_pages":8}'::jsonb) where private.db_calm() and not exists (select 1 from private.design_g2b_sync where kind = 'mall' and ((last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date) or (last_error like 'SLOW%' and updated_at > now() - interval '20 hours')))$c$,
  active := true)
where exists (select 1 from cron.job where jobname = 'design_g2b_mall');
select cron.alter_job((select jobid from cron.job where jobname = 'design_g2b_catalog'),
  schedule := '40 18 * * *',
  command := $c$select private.design_run_price_refs('{"mode":"catalog","budget_ms":20000}'::jsonb) where private.db_calm() and not exists (select 1 from private.design_g2b_sync where kind = 'items' and ((state - 'brake_until' = '{}'::jsonb and done_at > now() - interval '25 days') or (last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date) or (last_error like 'SLOW%' and updated_at > now() - interval '20 hours')))$c$,
  active := true)
where exists (select 1 from cron.job where jobname = 'design_g2b_catalog');

-- 아침 장애 때 걸어 둔 멈춤을 푼다 (위 예약이 새벽에만 조금씩 돌고, 이상하면 위 장치들이 다시 멈춤)
update private.design_g2b_sync set state = state - 'paused', last_error = null where kind in ('mall', 'items');
