-- WKLY ERP 0021: 에이전트 관리 작업이 연결 키(agent token)로 쓰는 함수
--   (예약 작업은 Supabase 커넥터 없이 WKLY_ERP_* 환경 변수 + RPC 로 인트라넷에 접근)
--   읽기: scope read / 쓰기: scope daily_report

-- 1. 에이전트 목록 동기화: p_jobs = [{trigger_id, name, group_name, cron, schedule_label, enabled, model, last_status, last_fired_at, last_finished_at, next_run_at}]
create or replace function public.agent_fleet_sync(p_token text, p_jobs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_removed integer := 0;
  j jsonb;
begin
  perform public.agent_token_check(p_token, 'daily_report');
  if jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'p_jobs 는 비어 있지 않은 배열이어야 합니다.' using errcode = '22023';
  end if;
  for j in select * from jsonb_array_elements(p_jobs) loop
    if coalesce(j ->> 'trigger_id', '') = '' or coalesce(j ->> 'name', '') = '' then
      continue;
    end if;
    insert into public.agent_jobs as a (trigger_id, name, group_name, cron, schedule_label, enabled, model, last_status, last_fired_at, last_finished_at, next_run_at, removed, synced_at)
    values (
      left(j ->> 'trigger_id', 100), left(j ->> 'name', 200), coalesce(left(j ->> 'group_name', 40), '기타'),
      left(j ->> 'cron', 200), left(j ->> 'schedule_label', 200), coalesce((j ->> 'enabled')::boolean, true),
      left(j ->> 'model', 100), left(j ->> 'last_status', 200),
      nullif(j ->> 'last_fired_at', '')::timestamptz, nullif(j ->> 'last_finished_at', '')::timestamptz, nullif(j ->> 'next_run_at', '')::timestamptz,
      false, now()
    )
    on conflict (trigger_id) do update set
      name = excluded.name, group_name = excluded.group_name, cron = excluded.cron, schedule_label = excluded.schedule_label,
      enabled = excluded.enabled, model = excluded.model, last_status = excluded.last_status,
      last_fired_at = excluded.last_fired_at, last_finished_at = excluded.last_finished_at, next_run_at = excluded.next_run_at,
      removed = false, synced_at = now();
    v_count := v_count + 1;
  end loop;
  update public.agent_jobs set removed = true
  where not removed and trigger_id not in (select x ->> 'trigger_id' from jsonb_array_elements(p_jobs) x);
  get diagnostics v_removed = row_count;
  return jsonb_build_object('ok', true, 'synced', v_count, 'removed', v_removed);
end;
$$;

-- 2. 오늘(또는 p_date) 이미 기록된 보고 (중복 방지용)
create or replace function public.agent_fleet_existing(p_token text, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.agent_token_check(p_token, 'read');
  return coalesce((
    select jsonb_agg(jsonb_build_object('trigger_id', r.trigger_id, 'job_name', r.job_name, 'title', r.title, 'run_at', r.run_at, 'verdict', r.verdict))
    from public.agent_reports r
    where r.report_date = coalesce(p_date, (now() at time zone 'Asia/Seoul')::date)
  ), '[]'::jsonb);
end;
$$;

-- 3. 보고 기록: p_report = {trigger_id, job_name, report_date, run_at, verdict, title, summary, body, link}
create or replace function public.agent_fleet_report(p_token text, p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_trigger text := nullif(p_report ->> 'trigger_id', '');
  v_verdict text := coalesce(p_report ->> 'verdict', '완료');
begin
  perform public.agent_token_check(p_token, 'daily_report');
  if v_verdict not in ('완료', '변동 없음', '일부 실패', '실패', '미실행', '진행 중') then
    v_verdict := '완료';
  end if;
  if coalesce(p_report ->> 'job_name', '') = '' or coalesce(p_report ->> 'title', '') = '' then
    raise exception 'job_name 과 title 이 필요합니다.' using errcode = '22023';
  end if;
  if v_trigger is not null and not exists (select 1 from public.agent_jobs where trigger_id = v_trigger) then
    v_trigger := null;
  end if;
  insert into public.agent_reports as r (trigger_id, job_name, report_date, run_at, verdict, title, summary, body, link)
  values (
    v_trigger, left(p_report ->> 'job_name', 200),
    coalesce(nullif(p_report ->> 'report_date', '')::date, (now() at time zone 'Asia/Seoul')::date),
    nullif(p_report ->> 'run_at', '')::timestamptz, v_verdict, left(p_report ->> 'title', 300),
    left(p_report ->> 'summary', 600), left(p_report ->> 'body', 30000), left(p_report ->> 'link', 2000)
  )
  on conflict (job_name, report_date, title) do update set
    run_at = excluded.run_at, verdict = excluded.verdict, summary = excluded.summary, body = excluded.body, link = excluded.link
  returning id into v_id;
  if v_trigger is not null then
    update public.agent_jobs set last_verdict = v_verdict, last_summary = left(p_report ->> 'summary', 600) where trigger_id = v_trigger;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 4. 처리할 관리 요청
create or replace function public.agent_fleet_requests(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.agent_token_check(p_token, 'read');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'trigger_id', q.trigger_id, 'job_name', j.name, 'action', q.action, 'detail', q.detail, 'created_at', q.created_at) order by q.created_at)
    from public.agent_job_requests q
    left join public.agent_jobs j on j.trigger_id = q.trigger_id
    where q.status = '대기'
  ), '[]'::jsonb);
end;
$$;

-- 5. 요청 결과 기록 + 요청자 알림
create or replace function public.agent_fleet_request_set(p_token text, p_id uuid, p_status text, p_result text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.agent_job_requests;
begin
  perform public.agent_token_check(p_token, 'daily_report');
  if p_status not in ('처리 중', '완료', '수동 필요', '거절') then
    raise exception 'p_status 는 처리 중, 완료, 수동 필요, 거절 중 하나여야 합니다.' using errcode = '22023';
  end if;
  update public.agent_job_requests
  set status = p_status, result = left(p_result, 2000), handled_at = case when p_status = '처리 중' then null else now() end
  where id = p_id
  returning * into v_req;
  if v_req.id is null then
    raise exception '요청을 찾을 수 없습니다.' using errcode = '22023';
  end if;
  if p_status <> '처리 중' then
    perform public.notify(v_req.requested_by, '시스템', 'AI 에이전트 요청 ' || p_status, left(coalesce(p_result, v_req.action), 300), '/agents?tab=requests');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.agent_fleet_sync(text, jsonb), public.agent_fleet_existing(text, date), public.agent_fleet_report(text, jsonb),
  public.agent_fleet_requests(text), public.agent_fleet_request_set(text, uuid, text, text) from public;
grant execute on function public.agent_fleet_sync(text, jsonb), public.agent_fleet_existing(text, date), public.agent_fleet_report(text, jsonb),
  public.agent_fleet_requests(text), public.agent_fleet_request_set(text, uuid, text, text) to anon, authenticated;
