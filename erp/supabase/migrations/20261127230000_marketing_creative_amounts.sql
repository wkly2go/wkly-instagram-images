-- 소재별 성과에 견적 · 수주 금액 (2026-11-27 마케팅 자동화 기획표 '소재별 수주 금액 — 우리만의 강점')
--  20261127213000_marketing_creative_report 의 함수에 두 가지를 더한다(나머지는 그대로).
--   ① 꼬리표 줄마다 이어진 프로젝트 번호(project_ids) — 같은 프로젝트를 두 번 세지 않도록 화면이 번호로 묶는다
--   ② 이어진 프로젝트 목록(projects): 상태 · 계약 금액(project_finances · 팀원이 프로젝트 화면에서 이미 보는 값) · 인트라넷 견적이 있는지
--  읽기만 · 호출한 사람 권한(security invoker · 각 표의 RLS 그대로) · AI 없음 · 시험 문의 제외 · 문의한 사람 정보는 주지 않는다.
create or replace function public.marketing_creative_report()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with w as (
    select i.utm_campaign, i.utm_source, i.kind, i.project_id, i.received_at, p.status as project_status
      from public.web_inquiries i left join public.projects p on p.id = i.project_id
     where not coalesce(i.is_test, false) and i.received_at > now() - interval '180 days'
  ),
  pj as (
    select p.id, p.status, f.contract_amount as amount,
           exists (select 1 from public.design_estimates e where e.project_id = p.id) as quoted
      from public.projects p left join public.project_finances f on f.project_id = p.id
     where p.id in (select project_id from w where project_id is not null)
  )
  select jsonb_build_object(
    'days', 180,
    'tags', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select utm_campaign as campaign, coalesce(nullif(utm_source, ''), '') as source,
               count(*) as inquiries, count(*) filter (where kind = '문의') as direct,
               count(project_id) as projects, count(*) filter (where project_status in ('진행', '완료')) as won,
               max(received_at) as last_at,
               coalesce(jsonb_agg(distinct project_id) filter (where project_id is not null), '[]'::jsonb) as project_ids
          from w where coalesce(utm_campaign, '') <> ''
         group by 1, 2 order by count(*) desc limit 300) t),
    'untagged', (select jsonb_build_object('inquiries', count(*), 'direct', count(*) filter (where kind = '문의'),
               'projects', count(project_id), 'won', count(*) filter (where project_status in ('진행', '완료')),
               'project_ids', coalesce(jsonb_agg(distinct project_id) filter (where project_id is not null), '[]'::jsonb))
          from w where coalesce(utm_campaign, '') = ''),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'amount', amount, 'quoted', quoted)), '[]'::jsonb) from pj),
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
