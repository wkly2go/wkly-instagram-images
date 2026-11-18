-- 나라장터 쇼핑몰 계약 단가 (2026-11-18 대표 지시 '마감자재 먼저 넣어')
-- 조달청 쇼핑몰 품목정보(품목 등록 내역)를 하루씩 훑어 건자재(30 · 외장 · 내장 마감재 포함)와 조명(3911)의 계약 단가를
-- design.price_refs 에 source 'g2b_mall' 로 쌓고 기호 SM 을 붙인다. 진행 위치는 private.design_g2b_sync 의 'mall' 줄.
-- 서버가 Pro(디스크 8GB)라 품목 한도는 30만 → 200만 줄로 올린다. 지우는 것 없음.
create or replace function design.price_ref_prefix(p_source text) returns text language sql immutable set search_path = '' as $$
  select case p_source
    when 'pps_mtril_bildng' then 'BM' when 'pps_mtril_elcty' then 'EM' when 'pps_mtril_mchn' then 'MM' when 'pps_mtril_engrk' then 'CM'
    when 'pps_mrkt_bildng' then 'BC' when 'pps_mrkt_mchn' then 'MC' when 'pps_mrkt_engrk' then 'CC'
    when 'mkt_lighting' then 'LT' when 'g2b_mall' then 'SM' else 'ZZ' end
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
    if (select reltuples from pg_class where oid = 'design.g2b_items'::regclass) >= 2000000 then
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
  elsif p_kind = 'mall' then
    n := 0;  -- 진행 위치만 적는다 (가격 줄은 design_price_refs_save 가 넣음)
  else
    raise exception 'kind';
  end if;
  insert into private.design_g2b_sync (kind, state, done_at, last_error, updated_at)
  values (p_kind, case when (p_done and p_kind <> 'mall') or capped then '{}'::jsonb else coalesce(p_state, '{}'::jsonb) end, case when p_done or capped then now() end,
          case when capped then '품목 200만 줄 한도에 닿아 멈춤' else left(p_error, 500) end, now())
  on conflict (kind) do update set state = excluded.state, done_at = case when p_done or capped then now() else design_g2b_sync.done_at end,
    last_error = excluded.last_error, updated_at = now();
  return case when capped then -1 else n end;
end $$;
revoke all on function public.design_g2b_save(text, jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.design_g2b_save(text, jsonb, jsonb, boolean, text) to service_role;

-- 예약: 자재목록 · 계약 단가를 5분마다 조금씩 (함수가 바로 답하고 뒤에서 돌며, 하루 호출 한도에 걸린 날은 스스로 쉰다)
select cron.schedule('design_g2b_catalog', '3-58/5 * * * *', $c$select private.design_run_price_refs('{"mode":"catalog"}'::jsonb) where not exists (select 1 from private.design_g2b_sync where kind = 'items' and ((state = '{}'::jsonb and done_at > now() - interval '25 days') or (last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)))$c$);
select cron.schedule('design_g2b_mall', '1-56/5 * * * *', $c$select private.design_run_price_refs('{"mode":"mall"}'::jsonb) where not exists (select 1 from private.design_g2b_sync where kind = 'mall' and last_error like 'LIMITED_NUMBER%' and (updated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)$c$);
