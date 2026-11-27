-- 소재별 성과 (2026-11-27 마케팅 자동화 — 어떤 콘텐츠 · 광고에서 온 문의가 프로젝트가 되었나)
--  문의에 붙은 꼬리표(utm_campaign · utm_source)별 숫자와, 꼬리표를 소재와 잇는 데 필요한 콘텐츠 · 캠페인 목록을 한 번에 준다.
--  꼬리표 ↔ 소재 잇기는 화면이 한다 (lib/creativeReport.ts — 꼬리표 이름을 만드는 규칙 lib/utmLinks.ts campaignSlug 와 같은 규칙을 써야 해서).
--  읽기만 · 호출한 사람 권한 · AI 없음 · 시험 문의 제외 · 문의한 사람 정보는 주지 않는다(건수만).
create or replace function public.marketing_creative_report()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with w as (
    select i.utm_campaign, i.utm_source, i.kind, i.project_id, i.received_at, p.status as project_status
      from public.web_inquiries i left join public.projects p on p.id = i.project_id
     where not coalesce(i.is_test, false) and i.received_at > now() - interval '180 days'
  )
  select jsonb_build_object(
    'days', 180,
    'tags', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select utm_campaign as campaign, coalesce(nullif(utm_source, ''), '') as source,
               count(*) as inquiries, count(*) filter (where kind = '문의') as direct,
               count(project_id) as projects, count(*) filter (where project_status in ('진행', '완료')) as won,
               max(received_at) as last_at
          from w where coalesce(utm_campaign, '') <> ''
         group by 1, 2 order by count(*) desc limit 300) t),
    'untagged', (select jsonb_build_object('inquiries', count(*), 'direct', count(*) filter (where kind = '문의'),
               'projects', count(project_id), 'won', count(*) filter (where project_status in ('진행', '완료')))
          from w where coalesce(utm_campaign, '') = ''),
    'contents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (
        select g.id::text as id, g.title, g.status, g.updated_at,
               (select coalesce(jsonb_agg(jsonb_build_object('channel', v->>'channel', 'status', v->>'status', 'url', coalesce(v->>'publication_url', ''))), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(g.document->'versions', '[]'::jsonb)) v where coalesce(v->>'body', '') <> '') as channels
          from public.growth_items g where g.kind = 'content' order by g.updated_at desc limit 200) c),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
        select id::text as id, coalesce(document->>'title', '') as title, coalesce(document->>'platform', '') as platform, coalesce(document->>'status', '') as status
          from public.marketing_campaigns order by updated_at desc limit 100) m)
  )
$$;
revoke all on function public.marketing_creative_report() from public, anon;
grant execute on function public.marketing_creative_report() to authenticated;
