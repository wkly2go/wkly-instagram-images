-- 서버 안정화 (2026-11-19 대표 지시 '현제 서버 안정화 부터 실시해')
-- 같은 날 아침 DB 멈춤 뒤 남은 일: ① 이상을 사람이 알아채기 전에 대표에게 알림 ② 늘 도는 영업 맥박 중 무거운 단계 간격 늘림
-- ③ 관리 › 시스템 현황이 큰 표를 매번 끝까지 세지 않게. 지우는 표 · 함수 없음.

-- ① 서버 지킴이: 5분마다 예약 작업 기록 끝부분(최근 600줄)만 본다 → 10분 안에 '서버가 느려서' 난 실패(시작 시간 초과 · 실행 시간 초과 · 재시작)가
--    3건 이상이거나 30초 넘게 걸린 실행이 2건 이상이면 대표에게 한 시간에 한 번만 알림 + 나라장터 새벽 수집을 하루 쉬게 함
--    (state.brake_until · 수집 함수가 보고 쉼). 작업 자체의 오류(자료 형식 등)는 세지 않는다 — 그건 서버 문제가 아니다.
create table if not exists private.server_health_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  fails integer not null,
  slow integer not null,
  jobs text,
  alerted boolean not null default false
);
revoke all on private.server_health_log from public, anon, authenticated;

create or replace function private.server_health_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fails integer; v_slow integer; v_jobs text; v_last timestamptz; v_alert boolean := false; r record;
begin
  select count(*) filter (where d.status = 'failed' and (d.return_message like 'job startup timeout%' or d.return_message like '%statement timeout%'
                                                         or d.return_message like 'server restarted%' or d.return_message like '%connection%')),
         count(*) filter (where d.status = 'succeeded' and d.end_time - d.start_time > interval '30 seconds' and j.jobname not like 'design_g2b%'),
         string_agg(distinct j.jobname, ', ') filter (where d.status = 'failed' or d.end_time - d.start_time > interval '30 seconds')
    into v_fails, v_slow, v_jobs
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where d.runid > (select coalesce(max(x.runid), 0) - 600 from cron.job_run_details x)
    and d.start_time > now() - interval '10 minutes';
  if v_fails = 0 and v_slow = 0 then return; end if;

  if v_fails >= 3 or v_slow >= 2 then
    select max(l.at) into v_last from private.server_health_log l where l.alerted;
    v_alert := v_last is null or v_last < now() - interval '1 hour';
    -- 서버가 힘들 때 밤 대량 수집이 겹치지 않게 하루 쉼 (수집 함수가 brake_until 을 보고 건너뜀)
    update private.design_g2b_sync set state = state || jsonb_build_object('brake_until', now() + interval '1 day')
     where kind in ('mall', 'items');
  end if;
  insert into private.server_health_log (fails, slow, jobs, alerted) values (v_fails, v_slow, left(v_jobs, 500), v_alert);
  if v_alert then
    for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.title = '대표' loop
      perform public.notify(r.id, '알람', '서버 점검 필요 · 최근 10분 시간 초과 ' || v_fails || '건 · 느린 실행 ' || v_slow || '건',
        '느려진 작업: ' || coalesce(left(v_jobs, 300), '-') || E'\n로그인이 안 되거나 화면이 계속 불러오는 중이면 Supabase 대시보드에서 DB 를 재시작해 주세요. 나라장터 밤 수집은 하루 쉬게 했습니다.',
        '/admin');
    end loop;
  end if;
  delete from private.server_health_log where at < now() - interval '30 days';
end $$;
revoke all on function private.server_health_tick() from public, anon, authenticated;

select cron.unschedule('wkly_server_health') where exists (select 1 from cron.job where jobname = 'wkly_server_health');
select cron.schedule('wkly_server_health', '*/5 * * * *', 'select private.server_health_tick()');

-- 밤 수집이 끼어들어도 되는지: 30초 넘게 도는 조회가 없고 바쁜 연결이 적고 최근 15분 예약 실패가 2건 미만일 때만
create or replace function private.db_calm() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from pg_catalog.pg_stat_activity a
                      where a.state = 'active' and a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid()
                        and now() - a.query_start > interval '30 seconds')
     and (select count(*) from pg_catalog.pg_stat_activity a where a.state = 'active' and a.backend_type = 'client backend') < 12
     and (select count(*) from cron.job_run_details d
           where d.runid > (select coalesce(max(x.runid), 0) - 600 from cron.job_run_details x)
             and d.start_time > now() - interval '15 minutes' and d.status = 'failed'
             and (d.return_message like 'job startup timeout%' or d.return_message like '%statement timeout%' or d.return_message like 'server restarted%')) < 2
$$;
revoke all on function private.db_calm() from public, anon, authenticated;

-- ② 영업 맥박: 단계별 시간을 재 보니(2026-11-19 · 되돌리는 시험) 연락처 찾기 0.9초 · 실행 자료 0.5초 · 연락 근거 0.4초가 가장 무거움.
--    늦어도 되는 일이라 간격만 늘린다(실행 자료 2 → 5분 · 연락 근거 5 → 15분 · 연락처 찾기 10 → 30분)
update private.sales_ops_steps set every_min = 5 where step = 'execution_material' and every_min < 5;
update private.sales_ops_steps set every_min = 15 where step = 'contact_evidence' and every_min < 15;
update private.sales_ops_steps set every_min = 30 where step = 'contact_discovery' and every_min < 30;

-- ③ 시스템 현황: 2만 줄 넘는 표는 통계 추정치(reltuples)로 · 작은 표만 정확히 센다 (한 번 6초 → 1초 아래 목표)
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tables jsonb := '{}'::jsonb;
  v_name text;
  v_count bigint;
  v_est real;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.' using errcode = '42501';
  end if;

  foreach v_name in array array[
    'public.profiles', 'public.clients', 'public.contacts', 'public.projects', 'public.tasks', 'public.work_logs',
    'public.chat_rooms', 'public.chat_messages', 'public.approvals', 'public.payments', 'public.project_budget_lines',
    'public.approval_routes', 'public.notifications', 'public.research_items', 'public.brand_contacts',
    'public.email_templates', 'public.agent_tokens',
    'public.sales_prospects', 'public.sales_interviews', 'public.web_inquiries', 'public.mail_index', 'public.drive_index',
    'design.price_refs', 'design.g2b_items'
  ] loop
    if pg_catalog.to_regclass(v_name) is not null then
      select c.reltuples into v_est from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass(v_name);
      if v_est > 20000 then
        v_count := v_est::bigint;
      else
        execute pg_catalog.format('select count(*) from %s', v_name) into v_count;
      end if;
      v_tables := v_tables || jsonb_build_object(split_part(v_name, '.', 2), v_count);
    end if;
  end loop;

  return jsonb_build_object(
    'db_size_bytes', pg_catalog.pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
    'connections', (select count(*) from pg_catalog.pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::int,
    'active_members', (select count(*) from public.profiles p where p.active),
    'tables', v_tables,
    'generated_at', now()
  );
end;
$$;
