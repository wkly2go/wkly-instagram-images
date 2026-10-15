-- WKLY ERP 0019: Claude 에이전트(예약 작업) 관리 · 일일 보고를 인트라넷으로
--   - agent_jobs: Claude 예약 작업 목록 · 일정 · 최근 실행 결과 (WKLY 총괄이 주기적으로 동기화)
--   - agent_reports: 에이전트별 실행 보고 (판정 · 요약 · 본문 · 링크)
--   - agent_job_requests: 관리자가 인트라넷에서 남기는 관리 요청 (일시정지 · 재개 · 지금 실행 · 시간 변경 · 지시 수정)
--   쓰기는 WKLY 총괄(DB 직접 연결)만, 화면은 관리자만 (보고에 광고비 등 금액이 있을 수 있음)

create table if not exists public.agent_jobs (
  trigger_id      text primary key,
  name            text not null,
  group_name      text not null default '기타',
  cron            text,
  schedule_label  text,
  enabled         boolean not null default true,
  model           text,
  last_status     text,
  last_fired_at   timestamptz,
  last_finished_at timestamptz,
  next_run_at     timestamptz,
  last_verdict    text,
  last_summary    text,
  session_url     text,
  removed         boolean not null default false,
  synced_at       timestamptz not null default now()
);
comment on table public.agent_jobs is 'Claude 예약 작업(AI 에이전트) 현황. WKLY 총괄 관리 작업이 list_triggers 로 동기화';

create table if not exists public.agent_reports (
  id           uuid primary key default gen_random_uuid(),
  trigger_id   text references public.agent_jobs (trigger_id) on delete set null,
  job_name     text not null,
  report_date  date not null default (now() at time zone 'Asia/Seoul')::date,
  run_at       timestamptz,
  verdict      text not null default '완료'
               check (verdict in ('완료', '변동 없음', '일부 실패', '실패', '미실행', '진행 중')),
  title        text not null,
  summary      text,
  body         text check (char_length(body) <= 30000),
  link         text,
  created_at   timestamptz not null default now(),
  unique (job_name, report_date, title)
);
create index if not exists agent_reports_date_idx on public.agent_reports (report_date desc, job_name);
comment on table public.agent_reports is 'AI 에이전트 실행 보고. 같은 작업 · 날짜 · 제목은 한 줄 (다시 쓰면 갱신)';

create table if not exists public.agent_job_requests (
  id            uuid primary key default gen_random_uuid(),
  trigger_id    text not null references public.agent_jobs (trigger_id) on delete cascade,
  action        text not null check (action in ('지금 실행', '일시정지', '재개', '시간 변경', '지시 수정')),
  detail        text check (char_length(detail) <= 4000),
  status        text not null default '대기' check (status in ('대기', '처리 중', '완료', '수동 필요', '거절')),
  result        text,
  requested_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  handled_at    timestamptz
);
create index if not exists agent_job_requests_status_idx on public.agent_job_requests (status, created_at);

alter table public.agent_jobs enable row level security;
alter table public.agent_reports enable row level security;
alter table public.agent_job_requests enable row level security;

drop policy if exists agent_jobs_admin on public.agent_jobs;
create policy agent_jobs_admin on public.agent_jobs for select to authenticated using ((select public.is_admin()));
drop policy if exists agent_reports_admin on public.agent_reports;
create policy agent_reports_admin on public.agent_reports for select to authenticated using ((select public.is_admin()));
drop policy if exists agent_job_requests_select on public.agent_job_requests;
create policy agent_job_requests_select on public.agent_job_requests for select to authenticated using ((select public.is_admin()));
drop policy if exists agent_job_requests_insert on public.agent_job_requests;
create policy agent_job_requests_insert on public.agent_job_requests for insert to authenticated
  with check ((select public.is_admin()) and requested_by = (select auth.uid()) and status = '대기');
drop policy if exists agent_job_requests_cancel on public.agent_job_requests;
create policy agent_job_requests_cancel on public.agent_job_requests for delete to authenticated
  using ((select public.is_admin()) and status = '대기');

grant select on public.agent_jobs, public.agent_reports to authenticated;
grant select, insert, delete on public.agent_job_requests to authenticated;
revoke all on public.agent_jobs, public.agent_reports, public.agent_job_requests from anon;

-- 실패 보고가 들어오면 관리자에게 알림
create or replace function private.agent_report_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.verdict in ('실패', '일부 실패') and (tg_op = 'INSERT' or old.verdict is distinct from new.verdict) then
    for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
      perform public.notify(r.id, '시스템', '⚠ AI 에이전트 ' || new.verdict || ' · ' || new.job_name, coalesce(left(new.summary, 300), new.title), '/agents?date=' || new.report_date);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists agent_reports_notify on public.agent_reports;
create trigger agent_reports_notify after insert or update of verdict on public.agent_reports
  for each row execute function private.agent_report_notify();
