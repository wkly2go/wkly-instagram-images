-- 디스크 입출력 절약 (2026-11-18 대표 '서버에서 디스크 예산이 부족하다고 나와 현황 파악해'): 나라장터 자재목록 수집이 5분마다
--  같은 품목을 다시 써서(23,119줄에 6시간 18만 번 갱신) 디스크 입출력 예산을 씀 → 내용이 같은 줄은 건너뜀. 함수 모양 · 결과는 그대로.
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
    on conflict (code) do update set name = excluded.name, name_en = excluded.name_en, level = excluded.level, use_yn = excluded.use_yn, updated_at = now()
      where (design.g2b_classes.name, design.g2b_classes.name_en, design.g2b_classes.level, design.g2b_classes.use_yn) is distinct from (excluded.name, excluded.name_en, excluded.level, excluded.use_yn);
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
      on conflict (ident_no) do update set class_no = excluded.class_no, dtil_class_no = excluded.dtil_class_no, name = excluded.name, maker = excluded.maker, kind = excluded.kind, chg_date = excluded.chg_date, updated_at = now()
        where (design.g2b_items.class_no, design.g2b_items.dtil_class_no, design.g2b_items.name, design.g2b_items.maker, design.g2b_items.kind, design.g2b_items.chg_date) is distinct from (excluded.class_no, excluded.dtil_class_no, excluded.name, excluded.maker, excluded.kind, excluded.chg_date);
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
