-- 2026-11-20 영업 파이프라인 한 화면 (기획 '메신저 협업 단순화 · 영업 별 5개' 2~4주차 마지막 · 대표 지시 '계속 개발작업해')
-- 영업 · 수주 맨 위에 흩어진 다섯 곳(문의함 · 영업 대상 · 기획안 · 실행 묶음 · 프로젝트)을 단계 하나의 줄로 보여 준다.
-- 읽기만 · 부르는 사람 권한(RLS) 그대로(security invoker) · 단계마다 건수 + 최근 5건.
create or replace function public.sales_pipeline()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with
  inq as (select * from public.web_inquiries w where w.status = '신규' and not coalesce(w.is_test, false)),
  pro as (select * from public.sales_prospects p where not p.blocked and p.linked_sales_id is null
            and coalesce(p.reviewed_assessment, p.assessment) = '우선 검토'),
  stg as (select * from public.sales_strategies s where s.status = '승인 대기'),
  pkg as (select * from public.sales_execution_packages e where e.status in ('준비 중', '재검토')),
  prj as (select * from public.projects j where j.status in ('문의', 'NIC', '진행')
            and (j.status <> 'NIC' or j.updated_at > now() - interval '60 days'))
  select jsonb_build_array(
    jsonb_build_object('key', 'inquiry', 'label', '새 문의', 'hint', '홈페이지 문의 · 리포트 신청 중 아직 안 본 것',
      'count', (select count(*) from inq),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', coalesce(nullif(i.brand, ''), nullif(i.title, ''), i.kind), 'sub', concat_ws(' · ', i.kind, i.category), 'at', i.submitted_at, 'link', '/sales?inquiry=' || i.id) x
        from inq i order by i.submitted_at desc nulls last limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'prospect', 'label', '영업 대상', 'hint', '우선 검토로 판정된 대상 (아직 영업 건으로 옮기지 않은 것)',
      'count', (select count(*) from pro),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', p.name, 'sub', concat_ws(' · ', nullif(p.organization, ''), p.source), 'at', p.collected_at, 'link', '/sales') x
        from pro p order by p.score desc nulls last, p.collected_at desc limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'strategy', 'label', '기획 승인 대기', 'hint', '대표 승인을 기다리는 영업 기획안',
      'count', (select count(*) from stg),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', coalesce(s.plan->>'title', '영업 기획안'), 'sub', to_char(s.report_date, 'MM.DD'), 'at', s.created_at, 'link', '/sales') x
        from stg s order by s.created_at desc limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'package', 'label', '실행 준비', 'hint', '승인된 기획의 메일 · DM 묶음 (준비 중 · 재검토)',
      'count', (select count(*) from pkg),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', coalesce(e.payload->>'title', e.payload #>> '{plan,title}', '실행 묶음'), 'sub', e.status || ' · ' || e.version || '판', 'at', e.created_at, 'link', '/sales') x
        from pkg e order by e.created_at desc limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'consult', 'label', '상담 중', 'hint', '프로젝트 상태 문의',
      'count', (select count(*) from prj where status = '문의'),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', concat_ws(' ', j.code, j.name), 'sub', j.status, 'at', j.updated_at, 'link', '/projects?id=' || j.id) x
        from prj j where j.status = '문의' order by j.updated_at desc limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'nic', 'label', '계약 전', 'hint', 'NIC · 최근 60일 안에 움직인 것',
      'count', (select count(*) from prj where status = 'NIC'),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', concat_ws(' ', j.code, j.name), 'sub', j.status, 'at', j.updated_at, 'link', '/projects?id=' || j.id) x
        from prj j where j.status = 'NIC' order by j.updated_at desc limit 5) z), '[]'::jsonb)),
    jsonb_build_object('key', 'won', 'label', '진행 (수주)', 'hint', '계약해 진행 중인 프로젝트',
      'count', (select count(*) from prj where status = '진행'),
      'items', coalesce((select jsonb_agg(x) from (select jsonb_build_object('title', concat_ws(' ', j.code, j.name), 'sub', j.status, 'at', j.updated_at, 'link', '/projects?id=' || j.id) x
        from prj j where j.status = '진행' order by j.updated_at desc limit 5) z), '[]'::jsonb))
  )
$$;
revoke all on function public.sales_pipeline() from public, anon;
grant execute on function public.sales_pipeline() to authenticated;
