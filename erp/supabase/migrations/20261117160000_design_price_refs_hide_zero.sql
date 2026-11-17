-- 물가 기준: 가격 0(미공개 · 단종 공고 95건)은 목록 · 비교에서 뺀다 (2026-11-17 · 운영 적용)
create or replace view public.design_price_refs with (security_invoker = true) as
  select id, source_name, category, item, spec, unit, unit_std, price, material, labor, expense, region, notice_date, fetched_at
  from design.price_refs where price > 0;
grant select on public.design_price_refs to authenticated;

create or replace function public.design_price_ref_compare(p_ids uuid[])
returns table (unit_price_id uuid, ref_id bigint, score real, source_name text, item text, spec text, unit text, price numeric, notice_date date)
language sql stable security invoker set search_path = '' as $$
  select u.id, r.id, r.score, r.source_name, r.item, r.spec, r.unit, r.price, r.notice_date
  from design.unit_prices u
  cross join lateral (
    select p.id, extensions.similarity(p.item || ' ' || p.spec, u.item || ' ' || u.spec) as score, p.source_name, p.item, p.spec, p.unit, p.price, p.notice_date
    from design.price_refs p
    where p.price > 0 and p.unit_std = design.norm_unit(u.unit)
      and (p.item || ' ' || p.spec) operator(extensions.%) (u.item || ' ' || u.spec)
    order by score desc, p.notice_date desc nulls last
    limit 1
  ) r
  where u.id = any (p_ids[1:400]) and r.score >= 0.3
$$;
revoke all on function public.design_price_ref_compare(uuid[]) from public, anon;
grant execute on function public.design_price_ref_compare(uuid[]) to authenticated;
