-- 인트라넷 API 에이전트 (2026-11-22 대표 지시 '인트라넷을 위한 클로드는 모두 삭제하고 인트라넷의 클로드 콘솔 api 에 속한 에이전트를 만들어')
--  - Claude 예약 작업(루틴) 27개는 지움 · 지시문 원문은 private.claude_routine_archive 에 보관
--  - 이제 에이전트는 인트라넷 서버 함수 api-agents 가 Claude 콘솔 API 키(서버 함수 비밀 ANTHROPIC_API_KEY)로 돌림
--  - 에이전트 정의는 표 api_agents (지시문 · 모델 · 시각 · 요일 · 부를 수 있는 인트라넷 RPC 목록 · 웹 검색 여부)
--  - 실행마다 api_agent_runs 에 토큰 · 웹 검색 수 · 비용(달러 · 계산값) 기록 · 이번 달 합계가 한도(app_settings api_agent_budget)를 넘으면 멈춤
--  - 에이전트는 인트라넷 RPC 를 전용 토큰(금고 API_AGENT_TOKEN · 토큰 이름 'API 에이전트 실행기')으로만 부름 — 발송 · 게시 · 결제 RPC 는 목록에 없음
--  - DROP 없음 · anon 권한 없음

create table if not exists public.api_agents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  name text not null,
  group_name text not null default '기타',
  owner_id uuid references public.profiles (id) on delete set null,
  model text not null default 'claude-sonnet-5-5' check (model in ('claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5')),
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  instructions text not null,
  rpcs text[] not null default '{}',
  web_search boolean not null default false,
  web_max int not null default 5 check (web_max between 0 and 20),
  times text[] not null default '{}',          -- 'HH:MM' 한국 시각
  weekdays int[],                              -- 1=월 … 7=일 · 비우면 매일
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_summary text,
  updated_at timestamptz not null default now()
);

create table if not exists public.api_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.api_agents (id) on delete cascade,
  slot text,                                   -- 'YYYY-MM-DD HH:MM' (예약) · 'manual'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default '실행 중' check (status in ('실행 중', '완료', '실패', '한도 초과')),
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  web_searches int not null default 0,
  tool_calls int not null default 0,
  usd numeric(10, 4) not null default 0,
  result text,
  error text
);
create index if not exists api_agent_runs_agent_idx on public.api_agent_runs (agent_id, started_at desc);
create unique index if not exists api_agent_runs_slot_uq on public.api_agent_runs (agent_id, slot) where slot is not null and slot <> 'manual';

alter table public.api_agents enable row level security;
alter table public.api_agent_runs enable row level security;
drop policy if exists api_agents_admin on public.api_agents;
create policy api_agents_admin on public.api_agents for select to authenticated using ((select public.is_admin()));
drop policy if exists api_agent_runs_admin on public.api_agent_runs;
create policy api_agent_runs_admin on public.api_agent_runs for select to authenticated using ((select public.is_admin()));
revoke all on public.api_agents, public.api_agent_runs from anon;
revoke insert, update, delete on public.api_agents, public.api_agent_runs from authenticated;

-- 관리자: 켜기 · 끄기 · 시각 · 모델 · 지시문 고치기
create or replace function public.api_agent_update(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception '관리자만 바꿀 수 있습니다.'; end if;
  update public.api_agents set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    model = coalesce(nullif(p->>'model', ''), model),
    effort = coalesce(nullif(p->>'effort', ''), effort),
    instructions = coalesce(nullif(p->>'instructions', ''), instructions),
    times = coalesce((select array_agg(x) from jsonb_array_elements_text(p->'times') x where x ~ '^\d{2}:\d{2}$'), times),
    web_search = coalesce((p->>'web_search')::boolean, web_search),
    updated_at = now()
  where id = p_id;
end $$;
revoke all on function public.api_agent_update(uuid, jsonb) from public, anon;
grant execute on function public.api_agent_update(uuid, jsonb) to authenticated;

-- 이번 달 비용 · 한도
create or replace function public.api_agent_budget()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'month_usd', coalesce((select sum(usd) from public.api_agent_runs where started_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'), 0),
    'cap_usd', coalesce((select (value->>'monthly_usd')::numeric from public.app_settings where key = 'api_agent_budget'), 30)
  )
$$;
revoke all on function public.api_agent_budget() from public, anon;
grant execute on function public.api_agent_budget() to authenticated, service_role;

insert into public.app_settings (key, value)
values ('api_agent_budget', '{"monthly_usd": 30, "note": "2026-11-22 안전 기본값 · 대표가 정하면 바꿈"}'::jsonb)
on conflict (key) do nothing;

-- 시스템 점검 에이전트용 읽기 RPC (토큰 scope read · 키 · 비밀 값은 주지 않음)
create or replace function public.agent_system_health(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.agent_token_check(p_token, 'read');
  return jsonb_build_object(
    'kst', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'cron_failed_24h', coalesce((
      select jsonb_agg(x) from (
        select j.jobname, count(*) n, max(left(d.return_message, 160)) msg
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where d.start_time > now() - interval '24 hours' and d.status = 'failed'
        group by j.jobname order by count(*) desc limit 15
      ) x), '[]'::jsonb),
    'cron_slow_24h', coalesce((
      select jsonb_agg(x) from (
        select j.jobname, count(*) n, round(max(extract(epoch from d.end_time - d.start_time))::numeric, 1) max_sec
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where d.start_time > now() - interval '24 hours' and d.end_time - d.start_time > interval '30 seconds'
        group by j.jobname order by count(*) desc limit 10
      ) x), '[]'::jsonb),
    'http_errors_24h', coalesce((
      select jsonb_agg(x) from (
        select status_code, count(*) n, max(left(coalesce(error_msg, content), 160)) sample
        from net._http_response where created > now() - interval '24 hours' and (status_code >= 500 or error_msg is not null)
        group by status_code order by count(*) desc limit 10
      ) x), '[]'::jsonb),
    'approvals_waiting', (select count(*) from public.approvals where status = '대기'),
    'dev_requests', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.dev_requests group by status) s), '{}'::jsonb),
    'reports_failed_24h', coalesce((
      select jsonb_agg(x) from (
        select job_name, verdict, left(summary, 160) summary from public.agent_reports
        where run_at > now() - interval '24 hours' and verdict in ('실패', '일부 실패', '미실행') order by run_at desc limit 15
      ) x), '[]'::jsonb),
    'api_agents', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'enabled', enabled, 'last_run', to_char(last_run_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), 'status', last_status)) from public.api_agents), '[]'::jsonb),
    'budget', public.api_agent_budget(),
    'db_size_mb', (select round(pg_database_size(current_database()) / 1048576.0))
  );
end $$;
revoke all on function public.agent_system_health(text) from public;
grant execute on function public.agent_system_health(text) to anon, authenticated, service_role;

-- 실행기 전용 토큰 (원문은 금고에만 · 해시만 표에)
do $$
declare v_tok text; v_id uuid;
begin
  if exists (select 1 from vault.secrets where name = 'API_AGENT_TOKEN') then return; end if;
  v_tok := 'wkly_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.agent_tokens (name, profile_id, scopes, token_hint)
  values ('API 에이전트 실행기', '58fbbc42-f779-4635-8b88-b0cd86b1f89a', array['read', 'research', 'task', 'daily_report', 'notify'], right(v_tok, 4))
  returning id into v_id;
  insert into public.agent_token_secrets (token_id, token_hash)
  values (v_id, encode(sha256(convert_to(v_tok, 'UTF8')), 'hex'));
  perform vault.create_secret(v_tok, 'API_AGENT_TOKEN', 'API 에이전트 실행기가 인트라넷 RPC 를 부를 때 쓰는 토큰');
end $$;

create or replace function public.api_agent_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'API_AGENT_TOKEN'
$$;
revoke all on function public.api_agent_secret() from public, anon, authenticated;
grant execute on function public.api_agent_secret() to service_role;

-- 5분마다(정각 · 5분 단위 피함) 시각이 된 에이전트를 실행기에 맡김
create or replace function private.api_agents_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from public.api_agents where enabled) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/api-agents',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 5000
  );
end $$;
revoke all on function private.api_agents_tick() from public;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'api_agents') then perform cron.unschedule('api_agents'); end if;
  perform cron.schedule('api_agents', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *', 'select private.api_agents_tick()');
end $$;

notify pgrst, 'reload schema';
