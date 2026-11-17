-- 물가 기준 단가 (2026-11-17 대표 지시 '설계에서 단가정보는 물가 정보지를 학습해')
-- 조달청 나라장터 가격정보현황서비스(무료 공공데이터: 시설공통자재 · 시장시공가격)를 design.price_refs 에 쌓고,
-- 우리 판매 단가(design.unit_prices) 옆에 '물가 기준'으로 비교해 보여 준다. 우리 단가는 바꾸지 않는다.
-- 수집은 함수 design-price-refs 가 1회용 토큰으로만 (private.design_run_price_refs · 15분마다 할 일 있으면 이어서 · 한 번 다 받으면 30일 뒤 갱신).
create extension if not exists pg_trgm with schema extensions;

create table if not exists design.price_refs (
  id bigint generated always as identity primary key,
  source text not null,
  source_name text not null,
  ref_key text not null,
  category text not null default '',
  item text not null,
  spec text not null default '',
  unit text not null default '',
  unit_std text not null default '',
  price numeric(16,2) not null check (price >= 0),
  material numeric(16,2),
  labor numeric(16,2),
  expense numeric(16,2),
  region text not null default '',
  notice_date date,
  raw jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  unique (source, ref_key)
);
create index if not exists price_refs_text_trgm on design.price_refs using gin ((item || ' ' || spec) extensions.gin_trgm_ops);
create index if not exists price_refs_unit on design.price_refs (unit_std);
alter table design.price_refs enable row level security;
drop policy if exists price_refs_read on design.price_refs;
create policy price_refs_read on design.price_refs for select to authenticated using ((select public.is_active_member()));
grant select on design.price_refs to authenticated;
grant all on design.price_refs to service_role;

create table if not exists private.design_price_ref_sync (
  source text primary key,
  next_page integer not null default 1,
  total integer,
  done_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table private.design_price_ref_sync enable row level security;
revoke all on private.design_price_ref_sync from public, anon, authenticated;

-- 단위 맞추기: 조달청 표기(㎡ · M2 · 개 …) → 우리 단위(m2 · EA …)
create or replace function design.norm_unit(u text) returns text language sql immutable set search_path = '' as $$
  select case
    when x in ('m2', '㎡', 'sqm') then 'm2'
    when x in ('m3', '㎥') then 'm3'
    when x in ('m', 'ｍ', '미터') then 'm'
    when x in ('ea', '개', '조', '대', '본', '매', '장', '세트', 'set', '틀') then 'EA'
    when x in ('kg', '㎏') then 'kg'
    when x in ('식', '일식') then '식'
    when x in ('인', '인일') then '인'
    when x in ('일') then '일'
    when x in ('회') then '회'
    when x in ('평') then '평'
    else x end
  from (select lower(replace(btrim(coalesce(u, '')), ' ', '')) x) t
$$;

create or replace view public.design_price_refs with (security_invoker = true) as
  select id, source_name, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, fetched_at
  from design.price_refs;
grant select on public.design_price_refs to authenticated;

-- 수집 상태: 어떤 출처를 몇 쪽부터 이어 받을지 (함수 전용)
create or replace function public.design_price_refs_plan() returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('source', source, 'next_page', next_page, 'total', total, 'done_at', done_at, 'last_error', last_error, 'updated_at', updated_at)), '[]'::jsonb)
  from private.design_price_ref_sync
$$;

-- 한 쪽 저장: 행 넣기(같은 출처 · 같은 키면 새 값으로) + 진행 상태
create or replace function public.design_price_refs_save(p_source text, p_name text, p_rows jsonb, p_next_page integer, p_total integer, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'rows'; end if;
  insert into design.price_refs (source, source_name, ref_key, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, raw, fetched_at)
  select p_source, p_name, left(r->>'ref_key', 300), left(coalesce(r->>'category', ''), 200), left(r->>'item', 300), left(coalesce(r->>'spec', ''), 500),
         left(coalesce(r->>'unit', ''), 30), design.norm_unit(r->>'unit'), (r->>'price')::numeric,
         nullif(r->>'material', '')::numeric, nullif(r->>'labor', '')::numeric, nullif(r->>'expense', '')::numeric,
         left(coalesce(r->>'region', ''), 100), nullif(r->>'notice_date', '')::date, coalesce(r->'raw', '{}'::jsonb), now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'ref_key', '') <> '' and coalesce(r->>'item', '') <> '' and (r->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
  on conflict (source, ref_key) do update set
    source_name = excluded.source_name, category = excluded.category, item = excluded.item, spec = excluded.spec, unit = excluded.unit,
    unit_std = excluded.unit_std, price = excluded.price, material = excluded.material, labor = excluded.labor, expense = excluded.expense,
    region = excluded.region, notice_date = excluded.notice_date, raw = excluded.raw, fetched_at = excluded.fetched_at;
  get diagnostics n = row_count;
  insert into private.design_price_ref_sync (source, next_page, total, done_at, last_error, updated_at)
  values (p_source, case when p_done then 1 else greatest(p_next_page, 1) end, p_total, case when p_done then now() end, left(p_error, 500), now())
  on conflict (source) do update set next_page = excluded.next_page, total = coalesce(excluded.total, design_price_ref_sync.total),
    done_at = case when p_done then now() else design_price_ref_sync.done_at end, last_error = excluded.last_error, updated_at = now();
  return n;
end $$;

-- 우리 판매 단가 ↔ 물가 기준 짝짓기: 단위가 같고 품목 · 규격 글이 가장 비슷한 것 (비슷함 0.3 이상)
create or replace function public.design_price_ref_compare(p_ids uuid[])
returns table (unit_price_id uuid, ref_id bigint, score real, source_name text, item text, spec text, unit text, price numeric, notice_date date)
language sql stable security invoker set search_path = '' as $$
  select u.id, r.id, r.score, r.source_name, r.item, r.spec, r.unit, r.price, r.notice_date
  from design.unit_prices u
  cross join lateral (
    select p.id, extensions.similarity(p.item || ' ' || p.spec, u.item || ' ' || u.spec) as score, p.source_name, p.item, p.spec, p.unit, p.price, p.notice_date
    from design.price_refs p
    where p.unit_std = design.norm_unit(u.unit)
      and (p.item || ' ' || p.spec) operator(extensions.%) (u.item || ' ' || u.spec)
    order by score desc, p.notice_date desc nulls last
    limit 1
  ) r
  where u.id = any (p_ids[1:400]) and r.score >= 0.3
$$;

create or replace function private.design_run_price_refs(payload jsonb default '{"mode":"sync"}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare t uuid; req bigint;
begin
  delete from private.design_fn_run_tokens where created_at < now() - interval '1 hour';
  insert into private.design_fn_run_tokens default values returning token into t;
  select net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/design-price-refs',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-run-token', t::text),
    body := payload, timeout_milliseconds := 150000) into req;
  return req;
end $$;

revoke all on function public.design_price_refs_plan() from public, anon, authenticated;
revoke all on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.design_price_refs_plan() to service_role;
grant execute on function public.design_price_refs_save(text, text, jsonb, integer, integer, boolean, text) to service_role;
revoke all on function public.design_price_ref_compare(uuid[]) from public, anon;
grant execute on function public.design_price_ref_compare(uuid[]) to authenticated;
revoke all on function private.design_run_price_refs(jsonb) from public, anon, authenticated;

select cron.unschedule('design_price_refs') where exists (select 1 from cron.job where jobname = 'design_price_refs');
select cron.schedule('design_price_refs', '7,22,37,52 * * * *', $c$select private.design_run_price_refs()$c$);
notify pgrst, 'reload schema';
