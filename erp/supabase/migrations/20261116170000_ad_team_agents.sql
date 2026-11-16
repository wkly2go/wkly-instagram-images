-- 광고 운영팀 예약 작업 4개 (2026-11-16 대표 지시 '광고 운영팀 예약 작업 4개 만들어 · 자사')
-- 예약 작업은 커넥터 없이 환경 변수 연결 열쇠로 아래 RPC 두 개만 부른다.
--   agent_ad_team_context : 이번 주 기획 · 결재 상태 · 광고 수치 · 팀 산출물 읽기
--   agent_ad_team_save    : 산출물 저장(agent_reports) · 팀장만 대표 결재 올림
-- 집행 · 게시 · 발송은 여기서 하지 않는다. 결재는 대표.

create or replace function public.agent_ad_team_context(p_token text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone 'Asia/Seoul';
  v_week date := date_trunc('week', now() at time zone 'Asia/Seoul')::date;
  v_plan_title text;
  v_assets_title text;
  v_out jsonb;
begin
  perform public.agent_token_check(p_token, 'task');
  if p_role not in ('AD-PLAN', 'AD-CREA', 'AD-UX', 'AD-FILM') then
    raise exception '알 수 없는 역할입니다.' using errcode = '22023';
  end if;
  v_plan_title := '[AI 결재 요청] 광고 주간 기획 · ' || v_week;
  v_assets_title := '[AI 결재 요청] 광고 소재 · 랜딩 · ' || v_week;
  v_out := jsonb_build_object(
    'kst', to_char(v_now, 'YYYY-MM-DD HH24:MI'),
    'week', v_week,
    'dow', extract(isodow from v_now)::int,
    'scope', '자사 광고(더위클리 · 아트리어)만. 고객사 광고 제외',
    'directives', coalesce((select jsonb_agg(jsonb_build_object('directive', d.directive, 'priority', d.priority, 'set_by', d.set_by))
      from public.agent_directives_for(p_role, '광고 운영') d), '[]'::jsonb),
    'plan', (select jsonb_build_object('title', r.title, 'summary', r.summary, 'body', r.body, 'run_at', r.run_at)
      from public.agent_reports r where r.job_name = 'AD-PLAN 광고 기획' and r.title = '광고 주간 기획서 · ' || v_week
      order by r.run_at desc limit 1),
    'plan_approval', (select jsonb_build_object('status', a.status, 'comment', a.decision_comment, 'decided_at', a.decided_at)
      from public.approvals a where a.title = v_plan_title order by a.created_at desc limit 1),
    'assets_approval', (select jsonb_build_object('status', a.status, 'comment', a.decision_comment, 'decided_at', a.decided_at)
      from public.approvals a where a.title = v_assets_title order by a.created_at desc limit 1),
    'mine', (select jsonb_agg(jsonb_build_object('title', r.title, 'summary', r.summary, 'run_at', r.run_at, 'verdict', r.verdict))
      from public.agent_reports r where r.job_name like p_role || ' %' and r.title like '% · ' || v_week)
  );
  if p_role = 'AD-PLAN' then
    v_out := v_out || jsonb_build_object(
      'ad_daily', coalesce((select jsonb_agg(x order by x.date) from (
        select d.date, d.platform, d.campaign, d.impressions, d.clicks, d.cost, d.conversions, left(d.note, 200) as note
        from public.ad_daily d where d.date >= (v_now::date - 56) order by d.date desc limit 400) x), '[]'::jsonb),
      'ad_daily_last', (select max(d.date) from public.ad_daily d),
      'recent_reports', coalesce((select jsonb_agg(jsonb_build_object('job', r.job_name, 'date', r.report_date, 'title', r.title, 'summary', r.summary, 'body', left(r.body, 3000)) order by r.run_at desc)
        from (select * from public.agent_reports r0 where r0.report_date >= (v_now::date - 14)
          and (r0.job_name ilike '%광고%' or r0.job_name like 'AD-%') order by r0.run_at desc limit 20) r), '[]'::jsonb),
      'last_plan', (select jsonb_build_object('title', r.title, 'summary', r.summary, 'body', left(r.body, 6000),
          'decision', (select jsonb_build_object('status', a.status, 'comment', a.decision_comment) from public.approvals a
            where a.title = '[AI 결재 요청] 광고 주간 기획 · ' || (v_week - 7) order by a.created_at desc limit 1))
        from public.agent_reports r where r.job_name = 'AD-PLAN 광고 기획' and r.title = '광고 주간 기획서 · ' || (v_week - 7)
        order by r.run_at desc limit 1),
      'team', coalesce((select jsonb_agg(jsonb_build_object('job', r.job_name, 'title', r.title, 'summary', r.summary, 'body', r.body, 'run_at', r.run_at))
        from public.agent_reports r where r.job_name in ('AD-CREA 광고 소재', 'AD-UX 랜딩 · 문의 경로', 'AD-FILM 영상 광고')
          and r.title like '% · ' || v_week), '[]'::jsonb)
    );
  end if;
  return v_out;
end $$;

create or replace function public.agent_ad_team_save(p_token text, p_role text, p_kind text, p_summary text, p_body text, p_verdict text default '완료', p_approval text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_agent uuid := '58fbbc42-f779-4635-8b88-b0cd86b1f89a';
  v_owner uuid := 'd6ec347b-766a-427d-9aae-7957e830797f';
  v_week date := date_trunc('week', now() at time zone 'Asia/Seoul')::date;
  v_job text;
  v_title text;
  v_ap_title text;
  v_plan_status text;
  v_id uuid;
  v_ap uuid;
  v_verdict text := case when p_verdict in ('완료', '변동 없음', '일부 실패', '실패') then p_verdict else '완료' end;
begin
  perform public.agent_token_check(p_token, 'task');
  if coalesce(p_body, '') ~ '\d{6}\s*-\s*[1-4]\d{6}' then
    raise exception '주민등록번호 형식이 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  select a.status into v_plan_status from public.approvals a
    where a.title = '[AI 결재 요청] 광고 주간 기획 · ' || v_week order by a.created_at desc limit 1;
  if p_role = 'AD-PLAN' and p_kind = 'plan' then
    v_job := 'AD-PLAN 광고 기획'; v_title := '광고 주간 기획서 · ' || v_week;
    v_ap_title := '[AI 결재 요청] 광고 주간 기획 · ' || v_week;
    if v_plan_status = '승인' then
      raise exception '이번 주 기획은 이미 승인되어 고칠 수 없습니다.' using errcode = '22023';
    end if;
  elsif p_role = 'AD-PLAN' and p_kind = 'review' then
    v_job := 'AD-PLAN 광고 기획'; v_title := '광고 소재 · 랜딩 검수 · ' || v_week;
    v_ap_title := '[AI 결재 요청] 광고 소재 · 랜딩 · ' || v_week;
    if v_plan_status is distinct from '승인' and p_approval is not null then
      raise exception '기획 결재가 승인되지 않아 소재 결재를 올릴 수 없습니다.' using errcode = '22023';
    end if;
  elsif p_role in ('AD-CREA', 'AD-UX', 'AD-FILM') then
    if v_plan_status is distinct from '승인' then
      raise exception '기획 결재가 승인되지 않아 제작물을 저장하지 않습니다.' using errcode = '22023';
    end if;
    v_job := case p_role when 'AD-CREA' then 'AD-CREA 광고 소재' when 'AD-UX' then 'AD-UX 랜딩 · 문의 경로' else 'AD-FILM 영상 광고' end;
    v_title := case p_role when 'AD-CREA' then '광고 소재 묶음' when 'AD-UX' then '랜딩 · 문의 경로 수정안' else '영상 광고 콘티' end || ' · ' || v_week;
    p_approval := null;
  else
    raise exception '알 수 없는 역할 · 종류입니다.' using errcode = '22023';
  end if;
  if v_verdict = '완료' and coalesce(length(p_body), 0) < 200 then
    raise exception '200자 이상의 본문이 필요합니다.' using errcode = '22023';
  end if;
  delete from public.agent_reports where job_name = v_job and title = v_title
    and report_date <> (now() at time zone 'Asia/Seoul')::date;
  insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
  values (v_job, (now() at time zone 'Asia/Seoul')::date, now(), v_verdict, v_title, left(coalesce(p_summary, ''), 1000), left(coalesce(p_body, ''), 30000))
  on conflict (job_name, report_date, title) do update set run_at = excluded.run_at, verdict = excluded.verdict, summary = excluded.summary, body = excluded.body
  returning id into v_id;
  if p_approval is not null and length(trim(p_approval)) >= 50 then
    select a.id into v_ap from public.approvals a where a.title = v_ap_title and a.status in ('대기', '승인') limit 1;
    if v_ap is null then
      insert into public.approvals (kind, title, content, payload, requested_by, approver_id, status)
      values ('제안', v_ap_title, left(p_approval, 6000),
        jsonb_build_object('type', case when p_kind = 'plan' then 'ad_plan' else 'ad_assets' end, 'week', v_week, 'report_id', v_id),
        v_agent, v_owner, '대기')
      returning id into v_ap;
    elsif exists (select 1 from public.approvals a where a.id = v_ap and a.status = '대기') then
      update public.approvals set content = left(p_approval, 6000), updated_at = now() where id = v_ap;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'report_id', v_id, 'title', v_title, 'approval_id', v_ap);
end $$;

revoke all on function public.agent_ad_team_context(text, text) from public;
revoke all on function public.agent_ad_team_save(text, text, text, text, text, text, text) from public;
grant execute on function public.agent_ad_team_context(text, text) to anon, authenticated;
grant execute on function public.agent_ad_team_save(text, text, text, text, text, text, text) to anon, authenticated;

-- AI 팀원 명단: 광고 운영 묶음 (기존 ADS 는 퍼포먼스 역할로 같은 묶음에)
insert into public.agent_roster (code, name, group_name, owner_id, duties, schedule, model, approval_rule, phase, active, sort, is_lead, lead_code, home)
values
  ('AD-PLAN', '광고 기획 (팀장)', '광고 운영', 'd6ec347b-766a-427d-9aae-7957e830797f', '자사 광고 주간 가설 2~3개 · 타깃 · 메시지 · 오퍼 · 채널 배분 · 판정 기준 · 팀 지시 · 소재 검수 · 대표 결재 올림(월 기획 · 수 소재)', '월 · 수 09:17', 'claude-sonnet-5-5', '기획 · 예산 · 소재 모두 대표', 1, true, 0, true, 'HQ', '{"intranet":"광고 › 광고 운영팀 · 보고서 › 결재"}'::jsonb),
  ('AD-CREA', '콘텐츠 크리에이팅', '광고 운영', 'd6ec347b-766a-427d-9aae-7957e830797f', '승인된 기획서 기준 카피 · 이미지 소재 시안(가설당 2~3종) · 글과 제작 지시까지(이미지 생성은 하지 않음)', '월 · 화 13:23', 'claude-sonnet-5-5', '소재 대표', 1, true, 1, false, 'AD-PLAN', '{"intranet":"AI 보고"}'::jsonb),
  ('AD-UX', 'UI · UX · AX 디자인', '광고 운영', 'd6ec347b-766a-427d-9aae-7957e830797f', '광고 → 랜딩 → 문의 경로 수정안 · 문의 폼 · AI 응대(채팅 · AI 검색 노출) 경로 점검표 · 배포는 하지 않음', '월 · 화 13:37', 'claude-sonnet-5-5', '랜딩 배포 대표', 1, true, 2, false, 'AD-PLAN', '{"intranet":"AI 보고"}'::jsonb),
  ('AD-FILM', '영상 광고 디렉터', '광고 운영', 'd6ec347b-766a-427d-9aae-7957e830797f', '릴스 · 쇼츠 광고 콘티 · 촬영 · 편집 지시(영상 생성은 하지 않음)', '월 · 화 13:49', 'claude-sonnet-5-5', '소재 대표', 1, true, 3, false, 'AD-PLAN', '{"intranet":"AI 보고"}'::jsonb)
on conflict (code) do update set name = excluded.name, group_name = excluded.group_name, duties = excluded.duties, schedule = excluded.schedule,
  model = excluded.model, approval_rule = excluded.approval_rule, active = true, is_lead = excluded.is_lead, lead_code = excluded.lead_code, updated_at = now();
