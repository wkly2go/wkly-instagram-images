-- 광고 자동화 에이전트 (2026-11-23 대표 지시 '광고가 가장 중요해 광고자동화 에이전트 만들어')
--  - 인트라넷 API 에이전트(api_agents · 서버 함수 api-agents)에 'AD 광고 자동화 AI' 한 줄을 더한다 (매일 07:23 KST · 규칙 판단 07:07 바로 뒤)
--  - 하는 일: 광고 수치 · 규칙 제안 · 경쟁사 · 문의 흐름을 읽고 → 오늘의 광고 운영 일지(제안마다 승인 · 거절 권고) + 필요할 때 캠페인 초안 한 건
--  - 못 하는 일: 메타 · 네이버를 바꾸는 것(예산 · 멈춤 · 켜기) · 발송 · 게시 · 결제 — 그런 RPC 를 주지 않는다. 실행은 규칙 엔진(광고 자동 운영)과 대표 승인이 한다
--  - 캠페인 초안은 '캠페인 준비'에 초안 상태로만 · 예산 칸은 비움(대표가 정함) · 연결 주소는 더위클리 홈페이지만 · 하루 한 건 · 안 본 AI 초안 3건이면 더 안 만듦
--  - 새 RPC 두 개는 서버(service_role)만 부를 수 있다 (실행기가 토큰을 넣어 부름 · anon · 로그인 사용자 권한 없음)
--  - 지우는 표 · 함수 없음

-- 읽기: 광고 운영 판단에 필요한 것 한 번에 (열쇠 · 계정 번호 · 개인 연락처는 주지 않음)
create or replace function public.agent_ad_ops_context(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone 'Asia/Seoul';
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_open int; v_today_drafts int;
begin
  perform public.agent_token_check(p_token, 'task');
  select count(*) filter (where m.document->>'status' = 'draft' and m.document->>'title' like '[AI 초안]%'),
         count(*) filter (where m.document->>'title' like '[AI 초안]%' and (m.created_at at time zone 'Asia/Seoul')::date = v_today)
    into v_open, v_today_drafts
  from public.marketing_campaigns m;
  return jsonb_build_object(
    'kst', to_char(v_now, 'YYYY-MM-DD HH24:MI'),
    'today', v_today,
    'dow', extract(isodow from v_now)::int,
    'scope', '자사 광고만(더위클리 중심 · 아트리어는 보조). 고객사 광고 제외. 메타 · 네이버는 직접 바꾸지 않음',
    'directives', coalesce((select jsonb_agg(jsonb_build_object('directive', d.directive, 'priority', d.priority, 'set_by', d.set_by))
      from public.agent_directives_for('AD-PLAN', '광고 운영') d), '[]'::jsonb),
    'autopilot', (select jsonb_build_object('mode', s.mode, 'kill_switch', s.kill_switch, 'monthly_cap', s.monthly_cap, 'daily_cap', s.daily_cap,
        'target_cpl', s.target_cpl, 'min_spend', s.min_spend, 'max_step_pct', s.max_step_pct,
        'meta_connected', s.meta_account_id is not null, 'naver_connected', s.naver_customer_id is not null)
      from public.ad_autopilot_settings s limit 1),
    'last_run', (select a.value from public.app_settings a where a.key = 'ad_autopilot_info'),
    'month_spend', coalesce((select sum(d.cost) from public.ad_daily d where d.date >= date_trunc('month', v_today)::date), 0),
    'ad_daily_last', (select max(d.date) from public.ad_daily d),
    'meta_campaigns', coalesce((select jsonb_agg(x) from (
      select c.name, c.status, c.effective_status, c.objective, c.daily_budget from public.ad_meta_campaigns c order by c.status, c.name limit 50) x), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(x) from (
      select d.platform, d.campaign,
        sum(d.impressions) filter (where d.date >= v_today - 7) as imp_7d, sum(d.clicks) filter (where d.date >= v_today - 7) as clk_7d,
        sum(d.cost) filter (where d.date >= v_today - 7) as cost_7d, sum(d.conversions) filter (where d.date >= v_today - 7) as conv_7d,
        sum(d.impressions) filter (where d.date < v_today - 7) as imp_prev, sum(d.clicks) filter (where d.date < v_today - 7) as clk_prev,
        sum(d.cost) filter (where d.date < v_today - 7) as cost_prev, sum(d.conversions) filter (where d.date < v_today - 7) as conv_prev
      from public.ad_daily d where d.date >= v_today - 14 and d.date < v_today
      group by d.platform, d.campaign order by sum(d.cost) desc nulls last limit 40) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x.date) from (
      select d.date, d.platform, sum(d.impressions) as imp, sum(d.clicks) as clk, sum(d.cost) as cost, sum(d.conversions) as conv
      from public.ad_daily d where d.date >= v_today - 14 group by d.date, d.platform) x), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(x) from (
      select a.id, a.day, a.platform, a.campaign_name, a.ad_name, a.kind, a.from_budget, a.to_budget, left(a.reason, 400) as reason, a.metrics,
             a.status, a.auto, left(a.result, 200) as result, a.effect, left(a.effect_note, 200) as effect_note
      from public.ad_autopilot_actions a where a.day >= v_today - 14 order by a.created_at desc limit 40) x), '[]'::jsonb),
    'drafts', coalesce((select jsonb_agg(x) from (
      select m.id, m.document->>'title' as title, m.document->>'brand' as brand, m.document->>'platform' as platform, m.document->>'goal' as goal,
             m.document->>'status' as status, m.document->>'headline' as headline, left(m.document->>'primaryText', 400) as primary_text,
             m.document->>'cta' as cta, m.document->>'landingUrl' as landing_url, m.document->>'startDate' as start_date, m.document->>'endDate' as end_date,
             (m.document->'dailyBudget') <> 'null'::jsonb as has_budget, md.status as meta_status,
             to_char(m.updated_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as updated
      from public.marketing_campaigns m left join public.ad_meta_drafts md on md.campaign_id = m.id
      order by m.updated_at desc limit 12) x), '[]'::jsonb),
    'landing_urls', (select coalesce(jsonb_agg(distinct u), '[]'::jsonb) from (
      select 'https://www.thewklyn.com/' as u union all select 'https://www.thewklyn.com/space/'
      union all select m.document->>'landingUrl' from public.marketing_campaigns m
        where m.document->>'landingUrl' ~* '^https://(www\.)?thewklyn\.com(/[^[:space:]]*)?$') z),
    'competitor_posts', coalesce((select jsonb_agg(x) from (
      select c.name, c.is_self, p.source, left(p.title, 160) as title, left(p.summary, 200) as summary,
             to_char(p.published_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as published, p.views, p.likes, p.comments
      from public.ad_competitor_posts p join public.ad_competitors c on c.id = p.competitor_id
      where p.published_at > now() - interval '10 days'
      order by coalesce(p.views, 0) + coalesce(p.likes, 0) * 10 + coalesce(p.comments, 0) * 20 desc limit 15) x), '[]'::jsonb),
    'inquiries_weekly', coalesce((select jsonb_agg(x order by x.week) from (
      select date_trunc('week', w.submitted_at at time zone 'Asia/Seoul')::date as week, count(*) as total, count(*) filter (where w.is_ad) as from_ads
      from public.web_inquiries w where not coalesce(w.is_test, false) and w.submitted_at >= now() - interval '70 days' group by 1) x), '[]'::jsonb),
    'inquiry_sources', coalesce((select jsonb_agg(y) from (
      select coalesce(w.utm_source, '(없음)') as source, coalesce(w.utm_campaign, '(없음)') as campaign, coalesce(w.category, '(없음)') as category, count(*) as n
      from public.web_inquiries w where not coalesce(w.is_test, false) and w.submitted_at >= now() - interval '28 days'
      group by 1, 2, 3 order by 4 desc limit 20) y), '[]'::jsonb),
    'my_logs', coalesce((select jsonb_agg(x) from (
      select r.report_date, r.verdict, r.summary, left(r.body, 1500) as body
      from public.agent_reports r where r.job_name = 'AD 광고 자동화' order by r.run_at desc limit 4) x), '[]'::jsonb),
    'open_ai_drafts', v_open,
    'draft_allowed', v_open < 3 and v_today_drafts = 0
  );
end $$;
revoke all on function public.agent_ad_ops_context(text) from public, anon, authenticated;
grant execute on function public.agent_ad_ops_context(text) to service_role;

-- 쓰기: 오늘의 광고 운영 일지 + (있으면) 캠페인 초안 한 건. 메타 · 네이버 · 예산은 건드리지 않는다
create or replace function public.agent_ad_ops_save(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_agent uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_title text := '광고 운영 일지 · ' || (now() at time zone 'Asia/Seoul')::date;
  v_verdict text := case when p->>'verdict' in ('완료', '변동 없음', '일부 실패', '실패') then p->>'verdict' else '완료' end;
  v_body text := coalesce(p->>'body', '');
  v_summary text := left(coalesce(p->>'summary', ''), 1000);
  c jsonb := case when jsonb_typeof(p->'campaign') = 'object' then p->'campaign' end;
  v_doc jsonb; v_camp uuid; v_skip text; v_id uuid; v_url text; v_open int; v_today_drafts int; k text; r record;
begin
  v_agent := public.agent_token_check(p_token, 'task');
  if (v_body || ' ' || coalesce(c::text, '')) ~ '\d{6}\s*-\s*[1-4]\d{6}' then
    raise exception '주민등록번호 형식이 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  if v_verdict = '완료' and length(v_body) < 200 then
    raise exception '200자 이상의 본문이 필요합니다.' using errcode = '22023';
  end if;
  insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
  values ('AD 광고 자동화', v_today, now(), v_verdict, v_title, v_summary, left(v_body, 30000))
  on conflict (job_name, report_date, title) do update set run_at = excluded.run_at, verdict = excluded.verdict, summary = excluded.summary, body = excluded.body
  returning id into v_id;

  if c is not null then
    select count(*) filter (where m.document->>'status' = 'draft' and m.document->>'title' like '[AI 초안]%'),
           count(*) filter (where m.document->>'title' like '[AI 초안]%' and (m.created_at at time zone 'Asia/Seoul')::date = v_today)
      into v_open, v_today_drafts from public.marketing_campaigns m;
    v_url := btrim(coalesce(c->>'landingUrl', ''));
    if v_today_drafts > 0 then v_skip := '오늘 이미 초안을 한 건 만들었습니다.';
    elsif v_open >= 3 then v_skip := '아직 검토하지 않은 AI 초안이 3건 있어 더 만들지 않습니다.';
    elsif btrim(coalesce(c->>'title', '')) = '' or btrim(coalesce(c->>'headline', '')) = '' or btrim(coalesce(c->>'primaryText', '')) = '' then v_skip := '캠페인 이름 · 제목 · 본문이 비어 있습니다.';
    elsif v_url <> '' and v_url !~* '^https://(www\.)?thewklyn\.com(/[^[:space:]]*)?$' then v_skip := '연결 주소는 더위클리 홈페이지 주소만 넣을 수 있습니다.';
    else
      -- 예산 · 기간 · 검토 표시는 사람이 정한다 (초안에는 비워 둠)
      v_doc := jsonb_build_object(
        'title', left('[AI 초안] ' || regexp_replace(btrim(c->>'title'), '^\[AI 초안\]\s*', ''), 160),
        'brand', case when c->>'brand' = 'arterior' then 'arterior' else 'wkly' end,
        'goal', case when c->>'goal' in ('leads', 'traffic', 'awareness') then c->>'goal' else 'leads' end,
        'platform', case when c->>'platform' in ('meta', 'naver') then c->>'platform' else 'meta' end,
        'landingUrl', v_url, 'sourceUrl', v_url,
        'audience', left(btrim(coalesce(c->>'audience', '')), 2000), 'offer', left(btrim(coalesce(c->>'offer', '')), 2000),
        'headline', left(btrim(c->>'headline'), 300), 'primaryText', left(btrim(c->>'primaryText'), 10000),
        'description', left(btrim(coalesce(c->>'description', '')), 2000), 'cta', left(btrim(coalesce(nullif(c->>'cta', ''), '문의하기')), 80),
        'startDate', '', 'endDate', '', 'dailyBudget', null, 'totalBudget', null,
        'reviews', jsonb_build_object('content', false, 'rights', false, 'budget', false), 'textAdConfirmed', false,
        'seasonNote', left(btrim(coalesce(c->>'seasonNote', '')), 3000), 'status', 'draft');
      insert into public.marketing_campaigns (id, document, created_by, updated_by) values (gen_random_uuid(), v_doc, v_agent, v_agent) returning id into v_camp;
    end if;
  end if;

  -- 대표가 오늘 볼 것이 있을 때만 알림 (제목에 금액 없음 · 같은 제목의 안 읽은 알림은 합쳐짐)
  if v_camp is not null or coalesce((p->>'notify')::boolean, false) then
    for r in select pr.id from public.profiles pr where pr.active and not pr.is_agent and pr.role = 'admin' and pr.title = '대표' loop
      perform public.notify(r.id, '일일 보고',
        case when v_camp is not null then '[광고 자동화] 새 캠페인 초안이 준비됐습니다' else '[광고 자동화] 오늘 확인할 것이 있습니다' end,
        left(v_summary, 400), case when v_camp is not null then '/ads?tab=studio' else '/ads?tab=autopilot' end);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'report_id', v_id, 'title', v_title, 'campaign_id', v_camp, 'campaign_skipped', v_skip);
end $$;
revoke all on function public.agent_ad_ops_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.agent_ad_ops_save(text, jsonb) to service_role;

-- 에이전트 등록 (이미 있으면 그대로 둠 — 화면에서 고친 지시문 · 시각을 덮어쓰지 않는다)
insert into public.api_agents (code, name, group_name, model, effort, instructions, rpcs, web_search, web_max, times, weekdays, enabled)
values ('AD', '광고 자동화 AI', '광고 운영', 'claude-sonnet-5-5', 'medium', $i$Daily ad operations for 더위클리 (all ads and marketing run under 더위클리; 아트리어 only when the data shows it).
You cannot change Meta or Naver. Budgets, pausing and launching belong to the rule engine (광고 자동 운영) and 대표's approval. Your job is judgment and preparation.

1. intranet fn agent_ad_ops_context args {} — read once. Follow context.directives first.

2. Write today's log in Korean (dry 존댓말, short). Markdown: start every section with '## ' (no ■), bullets with '- ', tables only as valid markdown (header row + |---| row). Mode names in Korean: off 끔 · suggest 제안만 · approve 승인 뒤 실행 · auto 자동 실행. Sections:
## 오늘 상태 — 연결(메타 · 네이버) · 모드 · 월/하루 한도가 들어 있는지 · 켜진 캠페인 수 · 마지막 수치 날짜
## 캠페인별 판단 — by_campaign 의 최근 7일 vs 앞 7일: 노출 · 클릭 · 클릭률 · 문의 · 문의당 비용. 노출 1,000 미만이면 '표본 부족 · 판단 보류'
## 규칙 제안 검토 — actions 중 status '제안'마다 '승인 권고 / 거절 권고 / 보류' + 근거 한 줄. 실행된 것의 effect 가 있으면 한 줄
## 소재 · 문구 — 피로 소재, 다음에 시험할 앵글 2~3개 (받는 사람의 업무 장면으로 시작 · 더위클리만 말할 수 있는 근거 · 번역투 · 유행어 금지)
## 경쟁사 · 시장 — competitor_posts 에서 반응 큰 것 3개 이내와 시사점 (is_self 는 우리 채널)
## 문의 흐름 — 주간 문의 · 광고 유입 변화
## 대표가 할 일 — 최대 3개. 어느 화면에서 무엇을 누르는지까지
Numbers only from the data. Missing data → '확인 필요'. Guesses → '(추정)'. Amounts only in the body, never in summary.
If nothing is connected or there are no campaigns: say so in two lines, then what is needed to start (한도 입력 · 첫 캠페인).

3. Campaign draft — at most one, only if context.draft_allowed is true AND there is a real reason (no active campaign, a fatigued creative with no replacement, or a season/event within 3 weeks). Fields:
title (short, no '[AI 초안]' prefix), brand 'wkly'|'arterior', goal 'leads'|'traffic'|'awareness', platform 'meta', audience, offer ('' unless a real offer appears in the data),
headline (40자 안), primaryText (3~5줄 · 125자 안팎 · 첫 줄은 담당자의 장면), description (30자 안), cta, landingUrl (only one of context.landing_urls),
seasonNote (왜 지금 · 시험할 가설 · 권장 하루 예산 범위와 근거 · 중단 기준). Never invent prices, discounts, client names, numbers or results. Do not repeat a draft that already exists in context.drafts.

4. Save once: intranet fn agent_ad_ops_save args {"p":{"verdict":"완료" or "변동 없음","summary":"<3줄 · 금액 없음>","body":"<log>","notify":true or false,"campaign":{...} or null}}.
notify true only when 대표 must act today (pending proposals, an anomaly). A new draft notifies by itself.

Final line: '광고 일지 저장'.$i$,
  array['agent_ad_ops_context', 'agent_ad_ops_save'], false, 0, array['07:23'], null, true)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
