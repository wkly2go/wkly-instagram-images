-- 광고 대시보드를 팀원 모두에게 공개 (대표 지시 2026-11-06 "광고는 노출해") — 읽기만, 쓰기는 기존대로
do $$
declare t text;
begin
  foreach t in array array['ad_campaigns', 'ad_creatives', 'ad_daily', 'ad_reports', 'seo_checks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_active_member()))', t || '_member_read', t);
  end loop;
end $$;
