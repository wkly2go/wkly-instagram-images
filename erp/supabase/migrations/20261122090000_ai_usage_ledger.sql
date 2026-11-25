-- 2026-11-22 대표 지시 '사용량 기록부터 붙이고' · '(월 한도) 500달러' · '모든 비서 · AI 팀원 Opus 로 · 페이블도 사용'
-- 인트라넷 서버가 Claude API 를 부를 때마다 토큰 · 금액을 한 줄씩 남기고, 이번 달(한국 시각) 합계가 한도를 넘으면 자동 실행을 멈춘다.
-- 지금까지는 광고 · 콘텐츠 AI(growth_ai_usage)만 금액이 남았고 비서 · 영업 · 회의록은 기록이 없었다.
-- 기존 표는 건드리지 않는다. 되돌리기: 두 표와 함수 세 개를 지우면 됨(agent-chat 은 기록 실패를 무시함).

create table public.ai_model_rates (
  model text primary key,
  input_usd numeric not null,        -- 100만 토큰당 달러
  output_usd numeric not null,
  cache_read_usd numeric not null,
  cache_write_usd numeric not null,  -- 5분 캐시 쓰기
  note text
);
insert into public.ai_model_rates values
  ('claude-fable-5-2', 8, 40, 0.20, 10, '2026-11-22 platform.claude.com 가격표'),
  ('claude-opus-5-5', 4, 20, 0.20, 5, '2026-11-22 platform.claude.com 가격표'),
  ('claude-sonnet-5-5', 2, 10, 0.20, 2.5, '2026-11-22 가격표 · 캐시 읽기는 입력의 10%'),
  ('claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125, '2026-11-22 가격표 · 10만 토큰 이하 기준 · 캐시는 입력 기준 계산');

create table public.ai_usage_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null,              -- 부른 곳 (agent-chat · sales-planner …)
  agent_id uuid references public.profiles(id) on delete set null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  usd numeric(12,6) not null default 0
);
create index ai_usage_log_created_idx on public.ai_usage_log (created_at);

alter table public.ai_model_rates enable row level security;
alter table public.ai_usage_log enable row level security;
create policy ai_model_rates_admin_read on public.ai_model_rates for select to authenticated using ((select public.is_admin()));
create policy ai_usage_log_admin_read on public.ai_usage_log for select to authenticated using ((select public.is_admin()));
revoke all on public.ai_model_rates, public.ai_usage_log from anon, authenticated;
grant select on public.ai_model_rates, public.ai_usage_log to authenticated;
grant all on public.ai_model_rates, public.ai_usage_log to service_role;

insert into public.app_settings (key, value) values ('ai_month_cap_usd', '500'::jsonb) on conflict (key) do nothing;

-- 이번 달(한국 시각) 쓴 금액과 한도. 광고 · 콘텐츠 AI 의 기존 기록도 합친다.
create function public.ai_month_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul' as since),
  s as (
    select coalesce((select sum(usd) from public.ai_usage_log, m where created_at >= m.since), 0)
         + coalesce((select sum(coalesce(actual_usd, reserved_usd)) from public.growth_ai_usage, m where created_at >= m.since), 0) as spent
  ),
  c as (select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'ai_month_cap_usd'), 500) as cap)
  select jsonb_build_object('since', (select since from m), 'spent', round(s.spent, 4), 'cap', c.cap, 'ok', s.spent < c.cap) from s, c
$$;

-- 서버 함수가 호출 한 번을 적는다. 단가표에 없는 모델은 가장 비싼 단가로 잡는다(한도를 낮게 세지 않게).
-- 웹 검색 단가는 1,000건당 10달러로 가정(확인 필요 · 실제 청구는 Anthropic 콘솔 기준).
create function public.ai_usage_record(p_source text, p_agent uuid, p_model text, p_input integer, p_output integer, p_cache_read integer, p_cache_write integer, p_web integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.ai_model_rates; v_usd numeric;
begin
  select * into r from public.ai_model_rates where model = p_model;
  if not found then select * into r from public.ai_model_rates order by output_usd desc limit 1; end if;
  v_usd := (greatest(coalesce(p_input, 0), 0) * r.input_usd + greatest(coalesce(p_output, 0), 0) * r.output_usd
          + greatest(coalesce(p_cache_read, 0), 0) * r.cache_read_usd + greatest(coalesce(p_cache_write, 0), 0) * r.cache_write_usd) / 1000000.0
          + greatest(coalesce(p_web, 0), 0) * 0.01;
  insert into public.ai_usage_log (source, agent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, usd)
  values (left(p_source, 60), p_agent, left(p_model, 80), coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_cache_read, 0), coalesce(p_cache_write, 0), coalesce(p_web, 0), v_usd);
  return public.ai_month_state();
end $$;

-- 관리자 화면용: 이번 달 합계와 부른 곳 · 모델별 내역
create function public.admin_ai_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st jsonb;
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  st := public.ai_month_state();
  return st || jsonb_build_object('rows', coalesce((
    select jsonb_agg(x order by x.usd desc) from (
      select source, model, count(*) as calls, sum(input_tokens + cache_read_tokens + cache_write_tokens) as input_tokens,
             sum(output_tokens) as output_tokens, sum(web_searches) as web_searches, round(sum(usd), 4) as usd
      from public.ai_usage_log where created_at >= (st ->> 'since')::timestamptz group by source, model
    ) x), '[]'::jsonb));
end $$;

revoke all on function public.ai_month_state(), public.ai_usage_record(text, uuid, text, integer, integer, integer, integer, integer), public.admin_ai_usage() from public, anon, authenticated;
grant execute on function public.ai_month_state(), public.ai_usage_record(text, uuid, text, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.admin_ai_usage() to authenticated;
