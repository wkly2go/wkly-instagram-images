-- 마케팅 대시보드 추이 (2026-11-27 대표 지시 '그냥 개발해' · 자동화 흐름 화면을 숫자 띠 + 추이 그래프 + 출처 표로)
--  읽기만 · 호출한 사람 권한 · AI 없음 · 시험 문의 제외 · 날짜는 한국 시각
create or replace function public.marketing_flow_trend()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with w as (
    select (received_at at time zone 'Asia/Seoul')::date d, kind, is_ad, utm_source, utm_campaign, project_id, received_at
      from public.web_inquiries where not coalesce(is_test, false) and received_at > now() - interval '90 days'
  ), today as (select (now() at time zone 'Asia/Seoul')::date t)
  select jsonb_build_object(
    'daily', (select jsonb_agg(jsonb_build_object('d', g.d::date,
          'total', (select count(*) from w where w.d = g.d::date),
          'direct', (select count(*) from w where w.d = g.d::date and w.kind = '문의'),
          'ads', (select count(*) from w where w.d = g.d::date and w.is_ad)) order by g.d)
        from today, generate_series(today.t - 29, today.t, interval '1 day') g(d)),
    'prev', (select jsonb_build_object(
          'total', count(*), 'direct', count(*) filter (where kind = '문의'), 'ads', count(*) filter (where is_ad),
          'tagged', count(*) filter (where coalesce(utm_campaign, '') <> ''))
        from w where received_at <= now() - interval '30 days' and received_at > now() - interval '60 days'),
    'by_source', (select coalesce(jsonb_agg(to_jsonb(s) order by s.inquiries desc), '[]'::jsonb) from (
          select coalesce(nullif(utm_source, ''), case when is_ad then '광고 (출처 미표시)' else '직접 · 출처 모름' end) source,
                 count(*) inquiries, count(project_id) projects
            from w where received_at > now() - interval '30 days' group by 1 order by count(*) desc limit 8) s),
    'by_kind', (select coalesce(jsonb_agg(to_jsonb(k) order by k.inquiries desc), '[]'::jsonb) from (
          select coalesce(nullif(kind, ''), '기타') kind, count(*) inquiries
            from w where received_at > now() - interval '30 days' group by 1 order by count(*) desc limit 8) k),
    -- 이번 주(월~일) 만든 것 · 고친 것: 콘텐츠와 영상 편집 (달력 칸에 놓음)
    'week_start', (select today.t - ((extract(isodow from today.t))::int - 1) from today),
    'week', (select coalesce(jsonb_agg(to_jsonb(x) order by x.at), '[]'::jsonb) from (
          select g.id::text id, 'content' type, g.title, g.status, g.updated_at at,
                 (select coalesce(jsonb_agg(v->>'channel'), '[]'::jsonb) from jsonb_array_elements(coalesce(g.document->'versions', '[]'::jsonb)) v where coalesce(v->>'body', '') <> '') channels
            from public.growth_items g, today
           where g.kind = 'content' and (g.updated_at at time zone 'Asia/Seoul')::date >= today.t - ((extract(isodow from today.t))::int - 1)
          union all
          select j.id::text, 'video', j.title, j.status, coalesce(j.finished_at, j.created_at), '["영상"]'::jsonb
            from public.video_edit_jobs j, today
           where j.status <> '취소' and (coalesce(j.finished_at, j.created_at) at time zone 'Asia/Seoul')::date >= today.t - ((extract(isodow from today.t))::int - 1)
          limit 60) x)
  )
$$;
revoke all on function public.marketing_flow_trend() from public, anon;
grant execute on function public.marketing_flow_trend() to authenticated;
