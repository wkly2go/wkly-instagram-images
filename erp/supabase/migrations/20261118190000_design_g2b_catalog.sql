-- 나라장터 자재목록 (2026-11-18 대표 지시 '모든 물가정보와 나라장터 자재목록을 데이터에 · 외장재와 내장재를 포함한 모든 자재')
-- 조달청 물품목록정보서비스(무료 공공데이터)에서 받는다. 인증키는 Edge Function 비밀값 DATA_GO_KR_SERVICE_KEY.
--  design.g2b_classes : 물품 분류 전체 (2 · 4 · 6 · 8 · 10단위)
--  design.g2b_items   : 품목(물품식별번호) 목록 — 건자재(30 · 외장마감재 3015 · 내장마감재 3016 포함) · 전기·조명(39) · 배관·설비(40) · 가구(56)
-- 가격은 없다(가격은 design.price_refs). 무료 DB 용량을 지키려고 품목은 30만 줄에서 멈춘다. 지우는 것 없음.
create table if not exists design.g2b_classes (
  code text primary key,
  name text not null,
  name_en text not null default '',
  level smallint not null,
  use_yn boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists g2b_classes_level on design.g2b_classes (level, code);
create table if not exists design.g2b_items (
  ident_no text primary key,
  class_no text not null,
  dtil_class_no text not null default '',
  name text not null,
  maker text not null default '',
  kind text not null default '',
  chg_date date,
  updated_at timestamptz not null default now()
);
create index if not exists g2b_items_class on design.g2b_items (class_no);
create index if not exists g2b_items_name_trgm on design.g2b_items using gin (name extensions.gin_trgm_ops);
alter table design.g2b_classes enable row level security;
alter table design.g2b_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'design' and tablename = 'g2b_classes' and policyname = 'g2b_classes_read') then
    create policy g2b_classes_read on design.g2b_classes for select to authenticated using ((select public.is_active_member()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'design' and tablename = 'g2b_items' and policyname = 'g2b_items_read') then
    create policy g2b_items_read on design.g2b_items for select to authenticated using ((select public.is_active_member()));
  end if;
end $$;
grant select on design.g2b_classes, design.g2b_items to authenticated;
grant all on design.g2b_classes, design.g2b_items to service_role;

create table if not exists private.design_g2b_sync (
  kind text primary key,
  state jsonb not null default '{}',
  done_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table private.design_g2b_sync enable row level security;
revoke all on private.design_g2b_sync from public, anon, authenticated;

create or replace function public.design_g2b_plan() returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'state', state, 'done_at', done_at, 'last_error', last_error, 'updated_at', updated_at)), '[]'::jsonb)
  from private.design_g2b_sync
$$;

-- 품목을 받을 분류(8단위) 다음 몇 개: 건자재 30 → 전기·조명 39 → 배관·설비 40 → 가구 56 (번호 순)
create or replace function public.design_g2b_item_classes(p_after text, p_limit integer) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(code order by code), '{}') from (
    select c.code from design.g2b_classes c
    where c.level = 8 and c.use_yn and c.code ~ '^(30|39|40|56)' and c.code > coalesce(p_after, '')
    order by c.code limit least(greatest(coalesce(p_limit, 6), 1), 20)) t
$$;

create or replace function public.design_g2b_save(p_kind text, p_rows jsonb, p_state jsonb, p_done boolean, p_error text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; capped boolean := false;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'rows'; end if;
  if p_kind like 'class%' then
    insert into design.g2b_classes (code, name, name_en, level, use_yn, updated_at)
    select distinct on (r->>'code') r->>'code', left(r->>'name', 200), left(coalesce(r->>'name_en', ''), 200), (r->>'level')::smallint, coalesce((r->>'use_yn')::boolean, true), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where (r->>'code') ~ '^[0-9]{2,10}$' and coalesce(r->>'name', '') <> '' and (r->>'level') ~ '^(2|4|6|8|10)$'
    order by r->>'code'
    on conflict (code) do update set name = excluded.name, name_en = excluded.name_en, level = excluded.level, use_yn = excluded.use_yn, updated_at = now();
    get diagnostics n = row_count;
  elsif p_kind = 'items' then
    if (select count(*) from design.g2b_items) >= 300000 then
      capped := true;
    else
      insert into design.g2b_items (ident_no, class_no, dtil_class_no, name, maker, kind, chg_date, updated_at)
      select distinct on (r->>'ident_no') r->>'ident_no', left(r->>'class_no', 10), left(coalesce(r->>'dtil_class_no', ''), 12), left(r->>'name', 400), left(coalesce(r->>'maker', ''), 120), left(coalesce(r->>'kind', ''), 20),
             case when (r->>'chg_date') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'chg_date')::date end, now()
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
      where (r->>'ident_no') ~ '^[0-9]{6,12}$' and (r->>'class_no') ~ '^[0-9]{8}$' and coalesce(r->>'name', '') <> ''
      order by r->>'ident_no'
      on conflict (ident_no) do update set class_no = excluded.class_no, dtil_class_no = excluded.dtil_class_no, name = excluded.name, maker = excluded.maker, kind = excluded.kind, chg_date = excluded.chg_date, updated_at = now();
      get diagnostics n = row_count;
    end if;
  else
    raise exception 'kind';
  end if;
  insert into private.design_g2b_sync (kind, state, done_at, last_error, updated_at)
  values (p_kind, case when p_done or capped then '{}'::jsonb else coalesce(p_state, '{}'::jsonb) end, case when p_done or capped then now() end,
          case when capped then '품목 30만 줄 한도에 닿아 멈춤' else left(p_error, 500) end, now())
  on conflict (kind) do update set state = excluded.state, done_at = case when p_done or capped then now() else design_g2b_sync.done_at end,
    last_error = excluded.last_error, updated_at = now();
  return case when capped then -1 else n end;
end $$;

revoke all on function public.design_g2b_plan() from public, anon, authenticated;
revoke all on function public.design_g2b_item_classes(text, integer) from public, anon, authenticated;
revoke all on function public.design_g2b_save(text, jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.design_g2b_plan() to service_role;
grant execute on function public.design_g2b_item_classes(text, integer) to service_role;
grant execute on function public.design_g2b_save(text, jsonb, jsonb, boolean, text) to service_role;

create or replace view public.design_g2b_classes with (security_invoker = true) as
  select code, name, name_en, level, use_yn from design.g2b_classes;
create or replace view public.design_g2b_items with (security_invoker = true) as
  select i.ident_no, i.class_no, c.name as class_name, i.dtil_class_no, i.name, i.maker, i.kind, i.chg_date
  from design.g2b_items i left join design.g2b_classes c on c.code = i.class_no;
grant select on public.design_g2b_classes, public.design_g2b_items to authenticated;
notify pgrst, 'reload schema';

-- 품목을 다 받을 때까지 2분마다 이어서 받는다 (다 받으면 25일 동안 쉼 · 그 뒤 30일 주기로 다시)
select cron.schedule('design_g2b_catalog', '*/2 * * * *', $c$select private.design_run_price_refs('{"mode":"catalog"}'::jsonb) where not exists (select 1 from private.design_g2b_sync where kind = 'items' and state = '{}'::jsonb and done_at > now() - interval '25 days')$c$);
