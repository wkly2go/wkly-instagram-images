-- 검색 노출 AI (2026-11-27 대표 지시 '홈페이지 검색 순위와 seo, geo, aeo 관리도 같이 · 하루에 한번씩 주기적으로'
--   · 'ai들은 모두 인트라넷용으로 클로드 콘솔에 만들고 운영')
--  API 에이전트 SEO(Console · 매일 06:17 KST)가 지난 측정 항목을 읽고(agent_seo_context) → 웹 검색으로 다시 재서
--  → seo_checks 에 오늘 날짜로 적고 일지를 남긴다(agent_seo_save · agent_reports job 'SEO 검색 노출').
--  홈페이지 · 광고 · 게시물을 고치거나 만들지 않는다 (제작은 사람이 원할 때만). 고칠 것은 일지의 '사람이 할 일'로만.
--  예전 예약 작업 때의 지시(agent_directives · 2026-11-22 전)는 넘기지 않는다 — 없어진 보고 체계를 가리킴.
create or replace function public.agent_seo_context(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_last date; v_prev date;
begin
  perform public.agent_token_check(p_token, 'task');
  select max(checked_on) into v_last from public.seo_checks;
  select max(checked_on) into v_prev from public.seo_checks where checked_on < v_last;
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Seoul')::date,
    'sites', jsonb_build_array(
      jsonb_build_object('name', '더위클리', 'url', 'https://www.thewklyn.com', 'main', true),
      jsonb_build_object('name', '아트리어', 'url', 'https://arteriors.co.kr', 'main', false)),
    'last_checked_on', v_last,
    'last', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'item', item, 'score', score, 'status', status, 'value', left(value, 200), 'target', left(target, 120)) order by kind, item), '[]'::jsonb) from public.seo_checks where checked_on = v_last),
    'previous', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'item', item, 'score', score, 'status', status)), '[]'::jsonb) from public.seo_checks where checked_on = v_prev),
    'last_log', (select jsonb_build_object('date', report_date, 'summary', summary) from public.agent_reports where job_name = 'SEO 검색 노출' order by run_at desc limit 1),
    'directives', (select coalesce(jsonb_agg(jsonb_build_object('directive', d.directive, 'priority', d.priority)), '[]'::jsonb) from public.agent_directives d where d.agent_code = 'SEO' and d.active and (d.expires_at is null or d.expires_at > now()) and d.created_at >= '2026-11-22')
  );
end $$;
revoke all on function public.agent_seo_context(text) from public, anon, authenticated;
grant execute on function public.agent_seo_context(text) to service_role;

create or replace function public.agent_seo_save(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_summary text := left(coalesce(p->>'summary', ''), 600);
  v_body text := coalesce(p->>'body', '');
  v_n int := 0; v_worse int; v_id uuid; v_ceo uuid;
begin
  perform public.agent_token_check(p_token, 'task');
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 80 then raise exception 'items 는 80개 이하의 목록이어야 합니다.'; end if;
  if char_length(v_summary) < 10 or char_length(v_body) < 50 then raise exception 'summary 와 body 를 채워 주세요.'; end if;

  insert into public.seo_checks (checked_on, kind, item, score, status, value, target, note, source, updated_at)
  select v_today, i->>'kind', left(i->>'item', 120),
         case when (i->>'score') ~ '^\d{1,3}$' and (i->>'score')::int between 0 and 100 then (i->>'score')::int end,
         case when i->>'status' in ('양호', '주의', '미흡', '미측정') then i->>'status' else '미측정' end,
         left(i->>'value', 500), left(i->>'target', 200), left(i->>'note', 800), left(coalesce(i->>'source', '검색 노출 AI'), 300), now()
    from jsonb_array_elements(v_items) i
   where i->>'kind' in ('SEO', 'AEO', 'GEO') and char_length(coalesce(i->>'item', '')) between 1 and 120
  on conflict (checked_on, kind, item) do update set score = excluded.score, status = excluded.status, value = excluded.value,
    target = excluded.target, note = excluded.note, source = excluded.source, updated_at = now();
  get diagnostics v_n = row_count;

  insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
  values ('SEO 검색 노출', v_today, now(), '완료', '검색 노출 일지 · ' || v_today, v_summary, left(v_body, 30000))
  on conflict (job_name, report_date, title) do update set run_at = excluded.run_at, verdict = excluded.verdict, summary = excluded.summary, body = excluded.body
  returning id into v_id;

  -- 어제보다 나빠진 항목(양호 → 주의 · 미흡, 주의 → 미흡)이 있을 때만 대표에게 알림 (20시간에 한 번 · 제목 고정)
  select count(*) into v_worse from public.seo_checks t
    join public.seo_checks y on y.kind = t.kind and y.item = t.item and y.checked_on = (select max(checked_on) from public.seo_checks where checked_on < v_today)
   where t.checked_on = v_today and ((y.status = '양호' and t.status in ('주의', '미흡')) or (y.status = '주의' and t.status = '미흡'));
  if v_worse > 0 then
    select id into v_ceo from public.profiles where role = 'admin' and active and not coalesce(is_agent, false) order by created_at limit 1;
    if v_ceo is not null and not exists (select 1 from public.notifications where user_id = v_ceo and title = '검색 노출 · 나빠진 항목이 있습니다' and created_at > now() - interval '20 hours') then
      perform public.notify(v_ceo, '시스템', '검색 노출 · 나빠진 항목이 있습니다', v_worse || '개 항목 · ' || left(v_summary, 120), '/ads?tab=seo');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'saved', v_n, 'worse', v_worse, 'report_id', v_id);
end $$;
revoke all on function public.agent_seo_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_seo_save(text, jsonb) to service_role;

-- 지시문 원문은 운영 DB api_agents(code 'SEO')에 있다 (화면 AI 팀·비용 › API 에이전트에서 고침). 여기에는 틀만.
insert into public.api_agents (code, name, group_name, model, effort, instructions, rpcs, web_search, web_max, times, enabled)
values ('SEO', '검색 노출 AI', '광고 운영', 'claude-sonnet-5-5', 'medium',
  'Daily search-visibility check. Read agent_seo_context once, re-measure with web search, save with agent_seo_save. Measure and report only — never change sites or create content.',
  array['agent_seo_context', 'agent_seo_save'], true, 12, array['06:17'], true)
on conflict (code) do nothing;
