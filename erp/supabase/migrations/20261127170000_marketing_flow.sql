-- 마케팅 자동화 한 화면 흐름 (2026-11-27 대표 지시 '마케팅 자동화 프로그램 · 자동화 기획서를 바탕으로 제작')
--  분석 → 제작 → 승인 · 배포 → 광고 → 문의 → 수주 를 한 번에 읽는 숫자 (읽기만 · 호출한 사람 권한으로 · AI 없음)
create or replace function public.marketing_flow()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'at', now(),
    'analyze', jsonb_build_object(
      'competitor_posts_7d', (select count(*) from public.ad_competitor_posts where published_at > now() - interval '7 days'),
      'competitors', (select count(*) from public.ad_competitors),
      'research_7d', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.research_items where created_at > now() - interval '7 days' and kind in ('트렌드·밈', '콘텐츠 소재', '팝업 정보', '시장조사', '경쟁사 분석') group by kind) r),
      'latest_trend', (select jsonb_build_object('id', id, 'title', title, 'at', created_at) from public.research_items where kind = '트렌드·밈' order by created_at desc limit 1)
    ),
    'create', jsonb_build_object(
      'campaigns_14d', (select count(*) from public.marketing_campaigns where updated_at > now() - interval '14 days'),
      'campaign_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select coalesce(document->>'status', '미정') s, count(*) n from public.marketing_campaigns group by 1) c),
      'ai_drafts', (select count(*) from public.marketing_campaigns where document->>'name' like '[AI 초안]%' and updated_at > now() - interval '30 days'),
      'video', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.video_edit_jobs where created_at > now() - interval '14 days' group by status) v)
    ),
    'publish', jsonb_build_object(
      'content_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.growth_items where kind = 'content' group by status) g),
      'content_14d', (select count(*) from public.growth_items where kind = 'content' and updated_at > now() - interval '14 days')
    ),
    'ads', jsonb_build_object(
      'settings', (select jsonb_build_object('mode', mode, 'monthly_cap', monthly_cap, 'daily_cap', daily_cap, 'kill_switch', kill_switch) from public.ad_autopilot_settings limit 1),
      'proposals', (select count(*) from public.ad_autopilot_actions where status = '제안'),
      'meta_drafts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.ad_meta_drafts group by status) d)
    ),
    'inquiries', (select jsonb_build_object(
        'total_30d', count(*) filter (where received_at > now() - interval '30 days'),
        'new', count(*) filter (where status = '신규'),
        'from_ads_30d', count(*) filter (where is_ad and received_at > now() - interval '30 days'),
        'tagged_30d', count(*) filter (where coalesce(utm_campaign, '') <> '' and received_at > now() - interval '30 days'),
        'direct_30d', count(*) filter (where kind = '문의' and received_at > now() - interval '30 days'))
      from public.web_inquiries where not coalesce(is_test, false)),
    'deals', (select jsonb_build_object(
        'linked_90d', count(*),
        'by_status', coalesce((select jsonb_object_agg(s, n) from (select p.status s, count(*) n from public.web_inquiries w join public.projects p on p.id = w.project_id where not coalesce(w.is_test, false) and w.received_at > now() - interval '90 days' group by p.status) x), '{}'::jsonb))
      from public.web_inquiries where project_id is not null and not coalesce(is_test, false) and received_at > now() - interval '90 days'),
    'by_campaign', (select coalesce(jsonb_agg(to_jsonb(t) order by t.inquiries desc), '[]'::jsonb) from (
        select coalesce(nullif(w.utm_campaign, ''), '(꼬리표 없음)') campaign, coalesce(nullif(w.utm_source, ''), '–') source,
               count(*) inquiries, count(*) filter (where w.kind = '문의') direct, count(w.project_id) projects,
               count(*) filter (where p.status in ('진행', '완료')) won
          from public.web_inquiries w left join public.projects p on p.id = w.project_id
         where not coalesce(w.is_test, false) and w.received_at > now() - interval '90 days'
         group by 1, 2 order by count(*) desc limit 12) t)
  )
$$;
revoke all on function public.marketing_flow() from public, anon;
grant execute on function public.marketing_flow() to authenticated;
