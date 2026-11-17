-- 견적의 '단가 없음' 줄에 물가 기준(조달청) 후보 3개를 보여 준다 (2026-11-17 대표 지시 '단가정보는 물가 정보지를 학습해' 후속)
-- 단위가 같고, 품목 이름이 조달청 품명 · 규격 안에 들어 있거나 글이 비슷한 것 · 재료/노무/경비가 나뉜 시장시공가격을 먼저.
-- 관리자가 고르면 화면이 판매 단가(design.unit_prices)로 넣고 출처에 '조달청 물가 기준'을 남긴다.
create or replace function public.design_price_ref_suggest(p_item text, p_spec text, p_unit text)
returns table (ref_id bigint, source_name text, item text, spec text, unit text, price numeric, material numeric, labor numeric, expense numeric, notice_date date, score real)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.source_name, p.item, p.spec, p.unit, p.price, p.material, p.labor, p.expense, p.notice_date,
         greatest(extensions.word_similarity(btrim(p_item), p.item || ' ' || p.spec),
                  extensions.similarity(p.item || ' ' || p.spec, btrim(p_item) || ' ' || coalesce(p_spec, ''))) as score
  from design.price_refs p
  where p.price > 0 and p.unit_std = design.norm_unit(p_unit) and char_length(btrim(coalesce(p_item, ''))) >= 2
    and (btrim(p_item) operator(extensions.<%) (p.item || ' ' || p.spec)
         or (p.item || ' ' || p.spec) operator(extensions.%) (btrim(p_item) || ' ' || coalesce(p_spec, '')))
  order by score desc, extensions.similarity(p.spec, coalesce(p_spec, '')) desc, (p.labor is not null) desc, p.notice_date desc nulls last
  limit 3
$$;
revoke all on function public.design_price_ref_suggest(text, text, text) from public, anon;
grant execute on function public.design_price_ref_suggest(text, text, text) to authenticated;
