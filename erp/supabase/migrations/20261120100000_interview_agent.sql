-- 2026-11-20 인터뷰 전담 AI (대표 지시 '이 자료를 가공해서 리포트를 만들거야 · 리포트 기획안 작성 · 에이전트를 붙여 · 인터뷰지 담당 할 AI 에이전트 전담시켜')
-- 예약 작업 'WKLY-인터뷰 전담 AI'(매일 10:37 KST · 커넥터 없음 · 무료)가 환경 변수 열쇠로 아래 RPC 두 개만 부른다.
--   agent_interview_context : 서면 인터뷰 진행 현황 · 답 받은 브랜드의 답 · 올린 자료 수 · 멈춘 건 · 기획안 결재 상태
--   agent_interview_save    : 리포트 기획안(대표 결재) · 브랜드별 리포트 초안 · 진행 점검 저장(agent_reports)
-- 순서: 리포트 기획안 → 대표 결재 → 승인되면 답 받은 브랜드마다 리포트 초안(하루 2곳) · 매일 진행 점검.
-- 메일 · DM 발송 · 게시는 하지 않는다. 연락처 · 메일 주소는 넘기지 않는다(브랜드 이름 · 단계 · 날짜 · 답만).

create or replace function public.agent_interview_context(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  perform public.agent_token_check(p_token, 'task');
  return jsonb_build_object(
    'kst', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'directives', coalesce((select jsonb_agg(jsonb_build_object('directive', d.directive, 'priority', d.priority, 'set_by', d.set_by))
      from public.agent_directives_for('IV', '마케팅·영업') d), '[]'::jsonb),
    'stages', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.sales_interviews group by stage) s), '{}'::jsonb),
    -- 답을 받은 브랜드: 답 전체(영업용 표시 포함) · 올린 자료 수 · 리포트 초안 여부
    'answered', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'brand', i.brand, 'event', i.event_name, 'venue', i.venue, 'stage', i.stage,
        'answered_at', i.answered_at, 'upload_on', i.upload_on, 'image_use', i.image_use, 'post_url', i.post_url,
        'answers', i.answers,
        'questions', (select f.questions from public.sales_interview_forms f where f.interview_id = i.id order by f.created_at desc limit 1),
        'files', (select count(*) from public.sales_interview_files x where x.interview_id = i.id),
        'has_draft', exists (select 1 from public.agent_reports r where r.job_name = 'IV 인터뷰 리포트' and r.title = '인터뷰 리포트 초안 · ' || i.brand))
        order by i.answered_at nulls last)
      from public.sales_interviews i where i.answers is not null and i.answers <> '{}'::jsonb), '[]'::jsonb),
    -- 멈춘 건 (사람이 챙길 것): 인터뷰지 보낸 뒤 7일 답 없음 · 자료 예정일 지남 · 열어 보고 안 낸 인터뷰지 · 업로드 일정 7일 안
    'stalled', jsonb_build_object(
      'form_sent_no_answer', coalesce((select jsonb_agg(jsonb_build_object('brand', i.brand, 'sent', i.form_sent_at::date)) from public.sales_interviews i
        where i.stage = '인터뷰지 발송' and i.form_sent_at < now() - interval '7 days'), '[]'::jsonb),
      'material_overdue', coalesce((select jsonb_agg(jsonb_build_object('brand', i.brand, 'due', i.material_due)) from public.sales_interviews i
        where i.material_due < v_today and i.stage in ('답변', '인터뷰지 발송')), '[]'::jsonb),
      'opened_not_submitted', coalesce((select jsonb_agg(jsonb_build_object('brand', i.brand, 'seen', f.first_seen_at::date)) from public.sales_interview_forms f
        join public.sales_interviews i on i.id = f.interview_id where f.status = '열림' and f.first_seen_at is not null and f.submitted_at is null), '[]'::jsonb),
      'upload_soon', coalesce((select jsonb_agg(jsonb_build_object('brand', i.brand, 'upload_on', i.upload_on, 'stage', i.stage) order by i.upload_on) from public.sales_interviews i
        where i.upload_on between v_today and v_today + 7 and i.stage <> '업로드 완료'), '[]'::jsonb),
      'no_reply_count', (select count(*) from public.sales_interviews where stage = '답장 없음')),
    'plan', (select jsonb_build_object('summary', r.summary, 'body', r.body, 'run_at', r.run_at)
      from public.agent_reports r where r.job_name = 'IV 인터뷰 리포트 기획' and r.title = '인터뷰 리포트 기획안' order by r.run_at desc limit 1),
    'plan_approval', (select jsonb_build_object('status', a.status, 'comment', a.decision_comment, 'decided_at', a.decided_at)
      from public.approvals a where a.payload->>'type' = 'interview_report_plan' order by a.created_at desc limit 1),
    'drafts', coalesce((select jsonb_agg(r.title order by r.run_at desc) from public.agent_reports r where r.job_name = 'IV 인터뷰 리포트'), '[]'::jsonb),
    'last_check', (select r.summary from public.agent_reports r where r.job_name = 'IV 인터뷰 진행 점검' order by r.run_at desc limit 1)
  );
end $$;

create or replace function public.agent_interview_save(p_token text, p_kind text, p_summary text, p_body text,
  p_interview uuid default null, p_verdict text default '완료', p_approval text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_agent uuid := '58fbbc42-f779-4635-8b88-b0cd86b1f89a';
  v_owner uuid := 'd6ec347b-766a-427d-9aae-7957e830797f';
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_job text; v_title text; v_status text; v_brand text; v_id uuid; v_ap uuid;
  v_verdict text := case when p_verdict in ('완료', '변동 없음', '일부 실패', '실패') then p_verdict else '완료' end;
begin
  perform public.agent_token_check(p_token, 'task');
  if coalesce(p_body, '') ~ '\d{6}\s*-\s*[1-4]\d{6}' then
    raise exception '주민등록번호 형식이 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  if coalesce(p_body, '') ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' or coalesce(p_body, '') ~ '01[016789]-?\d{3,4}-?\d{4}' then
    raise exception '메일 주소 · 전화번호가 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  select a.status into v_status from public.approvals a where a.payload->>'type' = 'interview_report_plan' order by a.created_at desc limit 1;
  if p_kind = 'plan' then
    if v_status = '승인' then raise exception '리포트 기획안은 이미 승인되어 고칠 수 없습니다.' using errcode = '22023'; end if;
    v_job := 'IV 인터뷰 리포트 기획'; v_title := '인터뷰 리포트 기획안';
  elsif p_kind = 'brand' then
    if v_status is distinct from '승인' then raise exception '리포트 기획안이 승인되지 않아 브랜드 리포트를 쓰지 않습니다.' using errcode = '22023'; end if;
    select brand into v_brand from public.sales_interviews where id = p_interview and answers is not null and answers <> '{}'::jsonb;
    if v_brand is null then raise exception '답을 받은 인터뷰가 아닙니다.' using errcode = '22023'; end if;
    v_job := 'IV 인터뷰 리포트'; v_title := '인터뷰 리포트 초안 · ' || v_brand; p_approval := null;
  elsif p_kind = 'check' then
    v_job := 'IV 인터뷰 진행 점검'; v_title := '인터뷰 진행 점검 · ' || v_today; p_approval := null;
  else
    raise exception '알 수 없는 종류입니다.' using errcode = '22023';
  end if;
  if v_verdict = '완료' and p_kind <> 'check' and coalesce(length(p_body), 0) < 300 then
    raise exception '300자 이상의 본문이 필요합니다.' using errcode = '22023';
  end if;
  -- 기획안 · 브랜드 초안은 한 줄만 남김 (날짜가 바뀌면 예전 줄을 지우고 새로)
  if p_kind <> 'check' then
    delete from public.agent_reports where job_name = v_job and title = v_title and report_date <> v_today;
  end if;
  insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
  values (v_job, v_today, now(), v_verdict, v_title, left(coalesce(p_summary, ''), 1000), left(coalesce(p_body, ''), 30000))
  on conflict (job_name, report_date, title) do update set run_at = excluded.run_at, verdict = excluded.verdict, summary = excluded.summary, body = excluded.body
  returning id into v_id;
  if p_kind = 'plan' and p_approval is not null and length(trim(p_approval)) >= 50 then
    select a.id into v_ap from public.approvals a where a.payload->>'type' = 'interview_report_plan' and a.status = '대기' limit 1;
    if v_ap is null then
      insert into public.approvals (kind, title, content, payload, requested_by, approver_id, status)
      values ('제안', '인터뷰 리포트 기획안', left(p_approval, 6000),
        jsonb_build_object('type', 'interview_report_plan', 'report_id', v_id), v_agent, v_owner, '대기')
      returning id into v_ap;
    else
      update public.approvals set content = left(p_approval, 6000), updated_at = now() where id = v_ap;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'report_id', v_id, 'title', v_title, 'approval_id', v_ap);
end $$;

revoke all on function public.agent_interview_context(text) from public;
revoke all on function public.agent_interview_save(text, text, text, text, uuid, text, text) from public;
grant execute on function public.agent_interview_context(text) to anon, authenticated;
grant execute on function public.agent_interview_save(text, text, text, text, uuid, text, text) to anon, authenticated;

-- AI 팀원 명단: 마케팅·영업 묶음
insert into public.agent_roster (code, name, group_name, owner_id, duties, schedule, model, approval_rule, phase, active, sort, is_lead, lead_code, home)
values ('IV', '인터뷰 전담 (서면 인터뷰 · 리포트)', '마케팅·영업', 'd6ec347b-766a-427d-9aae-7957e830797f',
  '서면 인터뷰 진행 점검(멈춘 건 · 업로드 일정) · 답 받은 브랜드 자료를 가공한 리포트 기획안(대표 결재) · 승인 뒤 브랜드별 리포트 초안 · 발송 · 게시는 하지 않음',
  '매일 10:37', 'claude-sonnet-5-5', '기획안 대표', 1, true, 9, false, 'LEAD-MKT',
  '{"intranet":"영업·수주 › 서면 인터뷰 · 보고서 › 결재 · AI 보고"}'::jsonb)
on conflict (code) do update set name = excluded.name, group_name = excluded.group_name, duties = excluded.duties, schedule = excluded.schedule,
  model = excluded.model, approval_rule = excluded.approval_rule, active = true, updated_at = now();
