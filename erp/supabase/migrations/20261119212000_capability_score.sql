-- 능력 지표 자동 집계 (2026-11-19 대표 지시 '현제 인트라넷 능력을 정량화하고' → '모든 수치가 80이상이 나오도록')
-- 아침 보고의 점수는 사람이 매긴 추정이었다. 숫자를 꾸미지 않도록 계산식으로 바꿔 매일 자동으로 재고 관리 화면에 보인다.
--  · 축 7개(기능 범위 · 실사용 · 자동화 · 안정성 · 성능 · 보안 · 품질 체계) = 세부 지표 점수의 평균, 세부 지표는 정해 둔 기준선 사이를 곧게 이은 값
--  · 기준선 · 세부 지표는 erp/docs/CAPABILITY_SCORE.md 와 같아야 한다 (바꾸면 문서도 함께)
--  · 빌드에서만 알 수 있는 값(첫 화면 묶음 크기 · 시험 수 · 설명서 수)은 화면이 version.json 을 읽어 admin_capability_build 로 넘긴다
-- 지우는 표 · 함수 없음.

-- ---------------------------------------------------------------------------------------------------
-- 0) 보안 정리 (점검하다 찾은 것 · 실제 노출은 없었음): 로그인 안 한 사람(anon)에게 필요 없는 권한 거두기
--    설계 보기 7개는 security_invoker 라 anon 이 읽지 못하지만 권한 자체가 붙어 있었다(새 보기에 기본으로 붙음 · 2026-11-17 원칙 'anon 표 권한은 field_survey 만')
revoke all on public.design_g2b_classes, public.design_g2b_items, public.design_ilwi_item_rows, public.design_ilwi_items,
              public.design_ilwi_line_rows, public.design_ilwi_lines, public.design_labor_rates from anon;
--    안에서 로그인 여부를 확인하는 함수 8개는 anon 이 부를 일이 없다 — 실행 권한을 로그인한 사람 · 서버로만
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn, p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('attendance_punch', 'ledger_lock', 'ledger_open', 'ledger_set_password', 'ledger_status', 'ledger_touch', 'ledger_unlock', 'profiles_identity_guard') loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    if r.proname <> 'profiles_identity_guard' then execute format('grant execute on function %s to authenticated, service_role', r.fn); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 1) 저장소 · 도우미
create table if not exists private.capability_daily (
  day date primary key,
  metrics jsonb not null,
  scores jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on private.capability_daily from public, anon, authenticated;

-- 기준선 사이를 곧게 이은 점수: pts = {x1,y1,x2,y2,…} (x 오름차순) · 양 끝 밖은 끝 값
create or replace function private.cap_scale(v numeric, pts numeric[]) returns numeric
language plpgsql immutable set search_path = '' as $$
declare i int; n int := array_length(pts, 1) / 2;
begin
  if v is null then return null; end if;
  if v <= pts[1] then return pts[2]; end if;
  for i in 1 .. n - 1 loop
    if v <= pts[2 * i + 1] then
      return round(pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * (v - pts[2 * i - 1]) / nullif(pts[2 * i + 1] - pts[2 * i - 1], 0), 1);
    end if;
  end loop;
  return pts[2 * n];
end $$;

-- 비어 있지 않은 점수들의 평균
create or replace function private.cap_avg(variadic vals numeric[]) returns numeric
language sql immutable set search_path = '' as $$
  select round(avg(x), 1) from unnest(vals) x where x is not null
$$;

-- 서버 밖 감시(깃허브 예약 실행)가 접속 확인에 성공할 때마다 부른다 — 시각 하나만 적는다 (1분에 한 번까지)
create or replace function public.monitor_ping() returns text
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_settings (key, value, updated_at) values ('external_monitor', jsonb_build_object('last_ok', now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
    where public.app_settings.updated_at < now() - interval '1 minute';
  return 'ok';
end $$;
revoke all on function public.monitor_ping() from public;
grant execute on function public.monitor_ping() to anon, authenticated, service_role;

-- 처음 값: 기능 목록(완성 full · 부분 partial · 아직 none) · 마지막 장애 · 대표가 대시보드에서 켜는 보안 설정
insert into public.app_settings (key, value) values
 ('capability_features', $j$[
  {"name":"프로젝트 · 할 일 · 일정","state":"full"},{"name":"업무 일지 · 주간 보고","state":"full"},{"name":"근태 · 휴가 · 인사","state":"full"},
  {"name":"채팅 · AI 비서","state":"full"},{"name":"결재 · 보고","state":"full"},{"name":"알림 · 푸시","state":"full"},
  {"name":"드라이브 연결 · 수신방","state":"full"},{"name":"메일 색인 · 프로젝트 연결","state":"full"},{"name":"슬랙 가져오기","state":"full"},
  {"name":"카카오톡 가져오기","state":"partial","note":"내보낸 파일을 사람이 올려야 함"},
  {"name":"외부 협업방","state":"partial","note":"실제 거래처 시험 전"},
  {"name":"회계 장부 · 카드 · 계산서 대사","state":"full"},{"name":"결제 대장","state":"full"},
  {"name":"영업 후보 수집 · 기획 · 실행 묶음","state":"full"},{"name":"웹 문의함 · 응대 추적","state":"full"},
  {"name":"서면 인터뷰 · 인터뷰지","state":"partial","note":"사진 · 자료 올리기 칸 없음"},
  {"name":"나라장터 공고 · 입찰 자격","state":"full"},{"name":"정부지원사업 · 투자유치","state":"full"},
  {"name":"광고 운영 · 소재","state":"partial","note":"광고 수치는 파일을 올려야 함"},
  {"name":"콘텐츠 · 인스타그램 게시","state":"partial","note":"Meta 앱 게시 전 · 고객 DM 미수신"},
  {"name":"리서치 · 거래처 리포트","state":"full"},
  {"name":"설계 · 견적 · 발주","state":"partial","note":"금액 계산은 맥 작업 처리기 · 스케치업 실행 미시험"},
  {"name":"물가 기준 · 나라장터 자재 · 일위대가","state":"full"},{"name":"현장 실측","state":"full"},{"name":"회의록","state":"full"},
  {"name":"관리 · 시스템 현황 · 능력 지표","state":"full"},
  {"name":"협업 화이트보드","state":"none","note":"로드맵 12/4"},{"name":"외국어 홈페이지 · 릴스 자동 편집","state":"none","note":"로드맵 11/23"}
 ]$j$::jsonb),
 ('last_incident', '{"at":"2026-11-19T00:02:00Z","note":"11/19 새벽 DB 느림 · 로그인 불가 → 재시작 뒤 08:55~09:02 일시 오류"}'::jsonb),
 ('security_flags', '{"leaked_password_protection":false}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 2) 재기
create or replace function private.capability_measure() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb; m jsonb := '{}'::jsonb; s jsonb := '{}'::jsonb; d jsonb;
  v1 numeric; v2 numeric; v3 numeric; v4 numeric; v5 numeric; s1 numeric; s2 numeric; s3 numeric; s4 numeric; s5 numeric;
  v_ts timestamptz; v_humans int; v_list jsonb; v_n int; v_total numeric;
begin
  select value into b from public.app_settings where key = 'capability_build';
  b := coalesce(b, '{}'::jsonb);
  select count(*) into v_humans from public.profiles where active and not is_agent;

  -- ── 성능 ──
  v1 := nullif(b->>'first_load_kb', '')::numeric;   -- 첫 화면에 꼭 받는 양 (압축 KB)
  v2 := nullif(b->>'update_kb', '')::numeric;       -- '업데이트' 뒤 다시 받는 양
  begin
    select round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 1) into v3 from extensions.pg_stat_statements where query like 'WITH pgrst_source%';
  exception when others then v3 := null; end;
  select round(coalesce(sum(extract(epoch from (x.end_time - x.start_time))), 0)::numeric / 24, 1) into v4
    from cron.job_run_details x where x.runid > (select coalesce(max(runid), 0) - 30000 from cron.job_run_details) and x.start_time > now() - interval '24 hours';
  s1 := private.cap_scale(v1, array[250, 100, 350, 70, 500, 40]); s2 := private.cap_scale(v2, array[100, 100, 200, 70, 350, 40]);
  s3 := private.cap_scale(v3, array[50, 100, 200, 70, 600, 40]);  s4 := private.cap_scale(v4, array[60, 100, 180, 70, 600, 40]);
  m := m || jsonb_build_object('performance', jsonb_build_array(
    jsonb_build_object('name', '첫 화면에 받는 양', 'value', v1, 'unit', 'KB', 'score', s1, 'rule', '250 이하 100점 · 350 70점 · 500 40점'),
    jsonb_build_object('name', '업데이트 뒤 다시 받는 양', 'value', v2, 'unit', 'KB', 'score', s2, 'rule', '100 이하 100점 · 200 70점 · 350 40점'),
    jsonb_build_object('name', '화면 조회 평균 응답', 'value', v3, 'unit', 'ms', 'score', s3, 'rule', '50 이하 100점 · 200 70점 · 600 40점 (재시작 뒤 누적)'),
    jsonb_build_object('name', '예약 작업이 쓰는 DB 시간', 'value', v4, 'unit', '초/시간', 'score', s4, 'rule', '60 이하 100점 · 180 70점 · 600 40점')));
  s := s || jsonb_build_object('performance', private.cap_avg(s1, s2, s3, s4));

  -- ── 안정성 ──
  select round(100.0 * count(*) filter (where x.status = 'succeeded') / nullif(count(*), 0), 2) into v1
    from cron.job_run_details x where x.runid > (select coalesce(max(runid), 0) - 60000 from cron.job_run_details) and x.start_time > now() - interval '72 hours';
  select greatest(coalesce((select (value->>'at')::timestamptz from public.app_settings where key = 'last_incident'), now() - interval '30 days'),
                  coalesce((select max(l.at) from private.server_health_log l where l.alerted), now() - interval '30 days')) into v_ts;
  v2 := round((extract(epoch from now() - v_ts) / 86400.0)::numeric, 1);
  v_list := jsonb_build_array(
    jsonb_build_object('name', '서버 지킴이(5분)', 'ok', exists (select 1 from cron.job where jobname = 'wkly_server_health' and active)),
    jsonb_build_object('name', '수집 자동 멈춤', 'ok', pg_catalog.to_regprocedure('private.db_calm()') is not null),
    jsonb_build_object('name', '실행 기록 정리', 'ok', exists (select 1 from cron.job where jobname = 'wkly_cron_history_cleanup' and active)),
    jsonb_build_object('name', '서버 밖 감시', 'ok', coalesce((select (value->>'last_ok')::timestamptz > now() - interval '90 minutes' from public.app_settings where key = 'external_monitor'), false)),
    jsonb_build_object('name', '백업 복구 확인(35일 안)', 'ok', coalesce((select (value->>'at')::timestamptz > now() - interval '35 days' from public.app_settings where key = 'backup_checked'), false)));
  select count(*) filter (where (e->>'ok')::boolean), count(*) into v_n, v3 from jsonb_array_elements(v_list) e;
  v3 := round(100.0 * v_n / v3, 0);
  select round(100.0 * count(*) / current_setting('max_connections')::int, 0) into v4 from pg_catalog.pg_stat_activity where datname = current_database();
  s1 := private.cap_scale(v1, array[90, 20, 97, 50, 99, 80, 99.9, 100]); s2 := private.cap_scale(v2, array[0, 30, 3, 60, 7, 80, 14, 100]);
  s3 := v3; s4 := private.cap_scale(v4, array[50, 100, 70, 70, 90, 30]);
  m := m || jsonb_build_object('stability', jsonb_build_array(
    jsonb_build_object('name', '예약 작업 성공률(72시간)', 'value', v1, 'unit', '%', 'score', s1, 'rule', '99.9 이상 100점 · 99 80점 · 97 50점'),
    jsonb_build_object('name', '마지막 장애 뒤 지난 날', 'value', v2, 'unit', '일', 'score', s2, 'rule', '14일 100점 · 7일 80점 · 3일 60점 · 당일 30점'),
    jsonb_build_object('name', '재발 방지 장치', 'value', v_n, 'unit', '/5', 'score', s3, 'rule', '갖춘 수 ÷ 5', 'items', v_list),
    jsonb_build_object('name', 'DB 연결 사용률', 'value', v4, 'unit', '%', 'score', s4, 'rule', '50 이하 100점 · 70 70점 · 90 30점')));
  s := s || jsonb_build_object('stability', private.cap_avg(s1, s2, s3, s4));

  -- ── 자동화 ──
  select round(100.0 * count(*) filter (where p.is_agent or t.created_by is null or t.origin_ref is not null) / nullif(count(*), 0), 1) into v1
    from public.tasks t left join public.profiles p on p.id = t.created_by where t.created_at > now() - interval '30 days';
  select round(100.0 * count(*) filter (where not coalesce(needs_review, false)) / nullif(count(*), 0), 1) into v2 from public.cash_ledger;
  select round(100.0 * count(*) filter (where cardinality(x.project_ids) > 0) / nullif(count(*), 0), 1) into v3 from (
    select mi.project_ids, lower(regexp_replace(case when mi.from_addr ilike '%@thewklyn.com' then split_part(mi.to_addr, ',', 1) else mi.from_addr end, '^.*<|>.*$', '', 'g')) as other
    from public.mail_index mi where mi.sent_at > now() - interval '30 days') x
   where x.other <> '' and x.other not like '%@thewklyn.com' and x.other !~ '(no-?reply|notification|newsletter|mailer|bounce|billing|do-not-reply)'
     and split_part(x.other, '@', 2) not in ('github.com', 'google.com', 'resend.dev', 'mail.anthropic.com', 'slack.com', 'redditmail.com', 'business-updates.facebook.com', 'hometax.go.kr', 'adobe.com', 'email.figma.com', 'googlemail.com', 'supabase.com', 'cloudflare.com', 'notion.so', 'canva.com', 'linkedin.com', 'facebookmail.com', 'instagram.com', 'apple.com');
  select round(100.0 * count(*) filter (where exists (select 1 from public.work_logs w where w.task_id = t.id)) / nullif(count(*), 0), 1) into v4
    from public.tasks t join public.profiles p on p.id = coalesce(t.assignee_id, t.created_by)
   where not p.is_agent and t.status = '완료' and t.completed_at >= greatest(now() - interval '30 days', timestamptz '2026-11-18 00:00+09');
  v_list := jsonb_build_array(
    jsonb_build_object('name', '메일 → 색인', 'ok', exists (select 1 from public.mail_index where synced_at > now() - interval '2 days')),
    jsonb_build_object('name', '드라이브 → 색인', 'ok', exists (select 1 from public.drive_index where synced_at > now() - interval '2 days')),
    jsonb_build_object('name', '할 일 → 업무 일지', 'ok', exists (select 1 from public.work_logs where task_id is not null and log_date > current_date - 14)),
    jsonb_build_object('name', '업무 일지 → 주간 보고 초안', 'ok', exists (select 1 from public.weekly_reports where auto_draft_at > now() - interval '8 days')),
    jsonb_build_object('name', '홈페이지 문의 → 프로젝트 · 답장 할 일', 'ok', exists (select 1 from private.sales_ops_steps where step = 'inquiry_projects' and enabled and last_ok > now() - interval '1 day')),
    jsonb_build_object('name', '문의 메일 응대 추적', 'ok', exists (select 1 from private.sales_ops_steps where step = 'inquiry_threads' and enabled and last_ok > now() - interval '1 day')),
    jsonb_build_object('name', '답할 필요 없는 문의 자동 확인', 'ok', exists (select 1 from private.sales_ops_steps where step = 'inquiry_auto_confirm' and enabled and last_ok > now() - interval '1 day')),
    jsonb_build_object('name', '영업 후보 수집', 'ok', exists (select 1 from public.sales_prospects where created_at > now() - interval '3 days')),
    jsonb_build_object('name', '영업 기획 · 실행 묶음', 'ok', exists (select 1 from public.sales_strategies where created_at > now() - interval '3 days')),
    jsonb_build_object('name', 'AI 리서치 수집', 'ok', exists (select 1 from public.research_items where created_at > now() - interval '3 days')),
    jsonb_build_object('name', 'AI 보고', 'ok', exists (select 1 from public.agent_reports where created_at > now() - interval '2 days')),
    jsonb_build_object('name', '정부지원 공고 수집 · 판정', 'ok', exists (select 1 from public.gov_programs where updated_at > now() - interval '3 days')),
    jsonb_build_object('name', '물가 · 나라장터 수집', 'ok', exists (select 1 from cron.job where jobname in ('design_g2b_mall', 'design_price_refs') and active)),
    jsonb_build_object('name', '프로젝트 표지 사진', 'ok', exists (select 1 from cron.job where jobname = 'project_covers' and active)),
    jsonb_build_object('name', '슬랙 가져오기', 'ok', exists (select 1 from cron.job where jobname = 'wkly_slack_sync' and active)),
    jsonb_build_object('name', '광고 수치 수집', 'ok', exists (select 1 from public.ad_daily where date > current_date - 7)),
    jsonb_build_object('name', '능력 지표 집계', 'ok', exists (select 1 from cron.job where jobname = 'wkly_capability_daily' and active)));
  select count(*) filter (where (e->>'ok')::boolean), count(*) into v_n, v5 from jsonb_array_elements(v_list) e;
  v5 := round(100.0 * v_n / v5, 0);
  s1 := private.cap_scale(v1, array[20, 40, 50, 70, 80, 100]); s2 := private.cap_scale(v2, array[70, 40, 85, 70, 95, 100]);
  s3 := private.cap_scale(v3, array[40, 40, 65, 70, 85, 100]); s4 := private.cap_scale(v4, array[50, 40, 75, 70, 95, 100]); s5 := v5;
  m := m || jsonb_build_object('automation', jsonb_build_array(
    jsonb_build_object('name', '할 일 자동 생성', 'value', v1, 'unit', '%', 'score', s1, 'rule', '80 이상 100점 · 50 70점 · 20 40점 (30일)'),
    jsonb_build_object('name', '장부 자동 분류', 'value', v2, 'unit', '%', 'score', s2, 'rule', '95 이상 100점 · 85 70점'),
    jsonb_build_object('name', '거래 메일 → 프로젝트 자동 연결', 'value', v3, 'unit', '%', 'score', s3, 'rule', '85 이상 100점 · 65 70점 · 40 40점 (사내 · 서비스 알림 메일 제외 · 30일)'),
    jsonb_build_object('name', '끝낸 할 일이 일지에 자동으로 남음', 'value', v4, 'unit', '%', 'score', s4, 'rule', '95 이상 100점 · 75 70점'),
    jsonb_build_object('name', '살아 있는 자동 연결 고리', 'value', v_n, 'unit', '/' || jsonb_array_length(v_list), 'score', s5, 'rule', '도는 고리 수 ÷ 전체', 'items', v_list)));
  s := s || jsonb_build_object('automation', private.cap_avg(s1, s2, s3, s4, s5));

  -- ── 실사용 ──
  select count(distinct x.u) into v_n from (
    select user_id as u from public.attendance where day > current_date - 7
    union select user_id from public.work_logs where log_date > current_date - 7
    union select user_id from public.chat_messages where created_at > now() - interval '7 days') x
   join public.profiles p on p.id = x.u where p.active and not p.is_agent;
  v1 := round(100.0 * v_n / nullif(v_humans, 0), 0);
  select jsonb_agg(jsonb_build_object('name', f.name, 'n', f.n, 'use', case when f.n >= 10 then 1 when f.n >= 1 then 0.5 else 0 end) order by f.ord) into v_list from (values
    (1, '프로젝트', (select count(*) from public.projects where updated_at > now() - interval '30 days')),
    (2, '할 일', (select count(*) from public.tasks where updated_at > now() - interval '30 days')),
    (3, '업무 일지', (select count(*) from public.work_logs where log_date > current_date - 30)),
    (4, '근태', (select count(*) from public.attendance where day > current_date - 30)),
    (5, '채팅', (select count(*) from public.chat_messages c join public.profiles p on p.id = c.user_id where not p.is_agent and c.created_at > now() - interval '30 days')),
    (6, '결재', (select count(*) from public.approvals where created_at > now() - interval '30 days')),
    (7, '알림 확인', (select count(*) from public.notifications where read_at > now() - interval '30 days')),
    (8, '드라이브', (select count(*) from public.drive_index where first_seen_at > now() - interval '30 days')),
    (9, '메일', (select count(*) from public.mail_index where sent_at > now() - interval '30 days')),
    (10, '회계 장부', (select count(*) from public.cash_ledger where created_at > now() - interval '30 days')),
    (11, '세금계산서 대사', (select count(*) from public.tax_invoices where created_at > now() - interval '30 days')),
    (12, '리서치', (select count(*) from public.research_items where created_at > now() - interval '30 days')),
    (13, '설계 · 견적', (select count(*) from design.estimates where created_at > now() - interval '30 days')),
    (14, '현장 실측', (select count(*) from public.site_photos where created_at > now() - interval '30 days')),
    (15, '회의록', (select count(*) from public.meeting_minutes where created_at > now() - interval '30 days')),
    (16, '외부 협업방', (select count(*) from public.collab_messages where created_at > now() - interval '30 days')),
    (17, '영업 발송', (select count(*) from private.sales_dispatch_jobs where created_at > now() - interval '30 days')),
    (18, '서면 인터뷰', (select count(*) from public.sales_interviews where updated_at > now() - interval '30 days')),
    (19, '정부지원 검토', (select count(*) from public.gov_programs where status not in ('신규', '마감'))),
    (20, '광고 수치', (select count(*) from public.ad_daily where date > current_date - 30)),
    (21, '주간 보고 제출', (select count(*) from public.weekly_reports where submitted_at > now() - interval '30 days')),
    (22, '카카오톡 가져오기', (select count(*) from public.kakao_messages where created_at > now() - interval '30 days')),
    (23, '일위대가', (select count(*) from design.ilwi_items)),
    (24, '스펙북', (select count(*) from design.spec_items where created_at > now() - interval '30 days')),
    (25, '콘텐츠 게시', (select count(*) from private.growth_ig_publish where finished_at > now() - interval '30 days'))
  ) as f(ord, name, n);
  select round(100.0 * sum((e->>'use')::numeric) / count(*), 0) into v2 from jsonb_array_elements(v_list) e;
  select round(100.0 * count(*) filter (where n.read_at is not null) / nullif(count(*), 0), 0) into v3
    from public.notifications n join public.profiles p on p.id = n.user_id where not p.is_agent and n.created_at > now() - interval '30 days';
  select round(100.0 * count(*) filter (where t.due_date < (now() at time zone 'Asia/Seoul')::date) / nullif(count(*), 0), 0) into v4
    from public.tasks t join public.profiles p on p.id = t.assignee_id where not p.is_agent and t.status <> '완료';
  s1 := v1; s2 := v2; s3 := private.cap_scale(v3, array[0, 0, 10, 30, 30, 60, 60, 100]); s4 := private.cap_scale(v4, array[5, 100, 10, 85, 20, 60, 40, 30]);
  m := m || jsonb_build_object('adoption', jsonb_build_array(
    jsonb_build_object('name', '최근 7일 쓴 사람', 'value', v1, 'unit', '%', 'score', s1, 'rule', '쓴 사람 ÷ 전체'),
    jsonb_build_object('name', '쓰이는 기능', 'value', v2, 'unit', '%', 'score', s2, 'rule', '30일 기록 10건 이상 1점 · 1~9건 0.5점 · 0건 0점의 평균', 'items', v_list),
    jsonb_build_object('name', '알림 읽음', 'value', v3, 'unit', '%', 'score', s3, 'rule', '60 이상 100점 · 30 60점 · 10 30점'),
    jsonb_build_object('name', '지연 할 일 비율', 'value', v4, 'unit', '%', 'score', s4, 'rule', '5 이하 100점 · 10 85점 · 20 60점 · 40 30점')));
  s := s || jsonb_build_object('adoption', private.cap_avg(s1, s2, s3, s4));

  -- ── 보안 ──
  select round(100.0 * count(*) filter (where c.relrowsecurity) / nullif(count(*), 0), 0) into v1
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
  select count(*) into v2 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and c.relname <> 'field_survey'
     and (pg_catalog.has_table_privilege('anon', c.oid, 'select') or pg_catalog.has_table_privilege('anon', c.oid, 'insert') or pg_catalog.has_table_privilege('anon', c.oid, 'update') or pg_catalog.has_table_privilege('anon', c.oid, 'delete'));
  select count(*) into v3 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
     and pg_catalog.pg_get_function_identity_arguments(p.oid) not like '%p_token%' and p.proname <> 'monitor_ping';
  v4 := case when pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.handle_new_user()')) like '%wkly_admin_created%' then 100 else 0 end;
  v5 := case when coalesce((select (value->>'leaked_password_protection')::boolean from public.app_settings where key = 'security_flags'), false) then 100 else 0 end;
  s1 := v1; s2 := private.cap_scale(v2, array[0, 100, 5, 60, 10, 30]); s3 := private.cap_scale(v3, array[0, 100, 5, 70, 10, 40]); s4 := v4; s5 := v5;
  m := m || jsonb_build_object('security', jsonb_build_array(
    jsonb_build_object('name', '접근 정책이 걸린 표', 'value', v1, 'unit', '%', 'score', s1, 'rule', '공개 구역 표 중 비율'),
    jsonb_build_object('name', '로그인 없이 권한이 붙은 표 · 보기', 'value', v2, 'unit', '개', 'score', s2, 'rule', '0개 100점 · 5개 60점 (현장 조사 표 제외)'),
    jsonb_build_object('name', '로그인 없이 부를 수 있는 열쇠 없는 함수', 'value', v3, 'unit', '개', 'score', s3, 'rule', '0개 100점 · 5개 70점 · 10개 40점'),
    jsonb_build_object('name', '공개 가입 막기', 'value', v4, 'unit', '점', 'score', s4, 'rule', '가입해도 비활성으로 만드는 장치가 있으면 100점'),
    jsonb_build_object('name', '유출된 비밀번호 거르기', 'value', v5, 'unit', '점', 'score', s5, 'rule', 'Supabase 설정에서 켜면 100점 (대표 설정)')));
  s := s || jsonb_build_object('security', private.cap_avg(s1, s2, s3, s4, s5));

  -- ── 품질 체계 ──
  v1 := nullif(b->>'tests', '')::numeric;
  v2 := case when (b->>'ci')::boolean then 100 when b ? 'ci' then 0 end;
  v3 := case when nullif(b->>'menus', '')::numeric > 0 then least(100, round(100.0 * nullif(b->>'manual_pages', '')::numeric / (b->>'menus')::numeric, 0)) end;
  v4 := case when (b->>'runbook')::boolean then 100 when b ? 'runbook' then 0 end;
  s1 := private.cap_scale(v1, array[100, 30, 500, 70, 1000, 100]);
  m := m || jsonb_build_object('quality', jsonb_build_array(
    jsonb_build_object('name', '자동 시험 수', 'value', v1, 'unit', '개', 'score', s1, 'rule', '1,000개 이상 100점 · 500개 70점'),
    jsonb_build_object('name', '합치기 전 자동 시험', 'value', v2, 'unit', '점', 'score', v2, 'rule', '깃허브에서 시험 · 빌드 · 묶음 크기를 자동 확인하면 100점'),
    jsonb_build_object('name', '메뉴별 사용설명', 'value', v3, 'unit', '%', 'score', v3, 'rule', '설명 있는 메뉴 ÷ 전체 메뉴'),
    jsonb_build_object('name', '장애 대응 문서', 'value', v4, 'unit', '점', 'score', v4, 'rule', '있으면 100점')));
  s := s || jsonb_build_object('quality', private.cap_avg(s1, v2, v3, v4));

  -- ── 기능 범위 ──
  select value into d from public.app_settings where key = 'capability_features';
  select round(100.0 * sum(case e->>'state' when 'full' then 1 when 'partial' then 0.5 else 0 end) / nullif(count(*), 0), 0) into v1 from jsonb_array_elements(coalesce(d, '[]'::jsonb)) e;
  m := m || jsonb_build_object('coverage', jsonb_build_array(
    jsonb_build_object('name', '기능 목록 완성도', 'value', v1, 'unit', '%', 'score', v1, 'rule', '완성 1점 · 부분 0.5점 · 아직 0점의 평균', 'items', coalesce(d, '[]'::jsonb))));
  s := s || jsonb_build_object('coverage', v1);

  select round(avg((e.value)::numeric), 1) into v_total from jsonb_each_text(s) e where e.value is not null;
  s := s || jsonb_build_object('total', v_total);
  return jsonb_build_object('metrics', m, 'scores', s, 'at', now(), 'build', b);
end $$;
revoke all on function private.capability_measure() from public, anon, authenticated;

create or replace function private.capability_snapshot() returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb := private.capability_measure();
begin
  insert into private.capability_daily (day, metrics, scores) values ((now() at time zone 'Asia/Seoul')::date, r->'metrics', r->'scores')
  on conflict (day) do update set metrics = excluded.metrics, scores = excluded.scores, created_at = now();
  delete from private.capability_daily where day < (now() at time zone 'Asia/Seoul')::date - 400;
end $$;
revoke all on function private.capability_snapshot() from public, anon, authenticated;

-- 관리자 화면: 오늘 값 + 지난 30일 점수
create or replace function public.admin_capability(p_refresh boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  if p_refresh or not exists (select 1 from private.capability_daily where day = v_day) then perform private.capability_snapshot(); end if;
  return jsonb_build_object(
    'today', (select jsonb_build_object('day', c.day, 'metrics', c.metrics, 'scores', c.scores, 'at', c.created_at) from private.capability_daily c where c.day = v_day),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', c.day, 'scores', c.scores) order by c.day), '[]'::jsonb) from private.capability_daily c where c.day > v_day - 30));
end $$;
revoke all on function public.admin_capability(boolean) from public, anon;
grant execute on function public.admin_capability(boolean) to authenticated;

-- 화면이 version.json 에서 읽은 빌드 값(묶음 크기 · 시험 수 · 설명서 수)을 넘김 — 숫자 · 참거짓만 받는다
create or replace function public.admin_capability_build(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  foreach k in array array['first_load_kb', 'update_kb', 'app_kb', 'tests', 'menus', 'manual_pages'] loop
    if jsonb_typeof(p->k) = 'number' then v := v || jsonb_build_object(k, p->k); end if;
  end loop;
  foreach k in array array['ci', 'runbook'] loop
    if jsonb_typeof(p->k) = 'boolean' then v := v || jsonb_build_object(k, p->k); end if;
  end loop;
  if left(coalesce(p->>'build', ''), 40) <> '' then v := v || jsonb_build_object('build', left(p->>'build', 40)); end if;
  insert into public.app_settings (key, value, updated_by, updated_at) values ('capability_build', v, (select auth.uid()), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
    where public.app_settings.value is distinct from excluded.value;
end $$;
revoke all on function public.admin_capability_build(jsonb) from public, anon;
grant execute on function public.admin_capability_build(jsonb) to authenticated;

select cron.unschedule('wkly_capability_daily') where exists (select 1 from cron.job where jobname = 'wkly_capability_daily');
select cron.schedule('wkly_capability_daily', '5 15 * * *', 'select private.capability_snapshot()');   -- 매일 00:05 KST
