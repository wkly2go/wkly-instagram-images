-- 자동화 고도화 (2026-11-19 대표 지시 '성능과 자동화를 더욱 고도화 시켜')
-- 운영 자료로 재 본 빈 곳을 메운다. 지우는 표 · 함수 없음. 메일 · DM 은 보내지 않는다.
--  ① 주간 보고: 금요일 16:30 에 사람마다 초안을 자동으로 채움 → 확인하고 '제출'만 누르면 됨 (제출 0건이던 것) · 월요일 아침 대표에게 제출 현황
--  ② 메일 → 프로젝트: 같은 대화(thread)의 다른 메일이 이미 프로젝트에 붙어 있으면 따라 붙임 (최근 30일 거래 메일 552통 중 209통이 여기에 해당)
--  ③ 알림: 같은 제목의 안 읽은 알림을 합치는 기준을 24 → 36시간으로 (매일 오는 AI 보고가 몇 분 차이로 안 합쳐지고 쌓이던 것)
--  ④ 문의함: 답할 필요 없는 구독 · 자료 신청은 자동으로 '확인' (신규 60건이 쌓여 있던 것)

-- ---------------------------------------------------------------------------------------------------
-- ① 주간 보고 자동 초안
alter table public.weekly_reports add column if not exists auto_draft_at timestamptz;

create or replace function private.weekly_report_drafts(p_dry boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_mon date := v_today - ((extract(isodow from v_today)::int) - 1);
  u record; v_sum text; v_plan text; v_logs int; v_proj int; v_done int; v_lines text; v_done_list text; v_late text; n int := 0;
begin
  for u in select p.id, p.name from public.profiles p
           where p.active and not p.is_agent and coalesce(p.title, '') <> '대표' loop
    -- 이미 적었거나 제출한 사람은 건드리지 않는다
    if exists (select 1 from public.weekly_reports w where w.user_id = u.id and w.week_start = v_mon
                 and (w.submitted_at is not null or coalesce(btrim(w.summary), '') <> '' or coalesce(btrim(w.next_plan), '') <> '')) then
      continue;
    end if;
    select count(*), count(distinct l.project_id) into v_logs, v_proj
      from public.work_logs l where l.user_id = u.id and l.log_date between v_mon and v_mon + 6;
    select count(*) into v_done from public.tasks t
     where coalesce(t.assignee_id, t.created_by) = u.id and t.status = '완료'
       and (t.completed_at at time zone 'Asia/Seoul')::date between v_mon and v_mon + 6;
    -- 프로젝트별 한 줄: '연번 이름 — n건: 내용 / 내용 / 내용'
    select string_agg(line, E'\n' order by cnt desc) into v_lines from (
      select count(*) cnt,
             '· ' || coalesce(nullif(concat_ws(' ', pr.code, pr.name), ''), '프로젝트 없음') || ' — ' || count(*) || '건: '
               || left(string_agg(left(regexp_replace(l.content, '\s+', ' ', 'g'), 40), ' / ' order by l.log_date desc, l.created_at desc), 150) as line
      from public.work_logs l left join public.projects pr on pr.id = l.project_id
      where l.user_id = u.id and l.log_date between v_mon and v_mon + 6
      group by pr.id, pr.code, pr.name
      order by count(*) desc limit 8) x;
    select string_agg(left(t.title, 40), ', ') into v_done_list from (
      select t.title from public.tasks t
      where coalesce(t.assignee_id, t.created_by) = u.id and t.status = '완료'
        and (t.completed_at at time zone 'Asia/Seoul')::date between v_mon and v_mon + 6
      order by t.completed_at desc limit 6) t;
    v_sum := '이번 주 기록 ' || v_logs || '건 · 프로젝트 ' || v_proj || '곳 · 끝낸 할 일 ' || v_done || '건'
      || coalesce(E'\n' || v_lines, '')
      || case when v_done_list is not null then E'\n끝낸 할 일: ' || v_done_list || case when v_done > 6 then ' 외 ' || (v_done - 6) || '건' else '' end else '' end;
    -- 다음 주 계획: 다음 주까지 마감인 내 할 일 + 지연
    select string_agg('· ' || left(t.title, 50) || coalesce(' (' || to_char(t.due_date, 'MM.DD') || coalesce(' · ' || pr.code, '') || ')', ''), E'\n' order by t.due_date nulls last) into v_plan from (
      select t.* from public.tasks t
      where coalesce(t.assignee_id, t.created_by) = u.id and t.status <> '완료'
        and t.due_date between v_mon + 7 and v_mon + 13
      order by t.due_date limit 8) t left join public.projects pr on pr.id = t.project_id;
    select string_agg(left(t.title, 40) || ' (' || to_char(t.due_date, 'MM.DD') || ')', ', ') into v_late from (
      select t.title, t.due_date from public.tasks t
      where coalesce(t.assignee_id, t.created_by) = u.id and t.status <> '완료' and t.due_date < v_mon + 7
      order by t.due_date limit 5) t;
    v_plan := nullif(concat_ws(E'\n', v_plan, case when v_late is not null then '지연 · 이번 주에 못 끝낸 일: ' || v_late end), '');
    if v_logs = 0 and v_done = 0 and v_plan is null then continue; end if;
    n := n + 1;
    if p_dry then continue; end if;
    insert into public.weekly_reports (user_id, week_start, summary, next_plan, auto_draft_at, updated_at)
    values (u.id, v_mon, left(v_sum, 4000), nullif(left(coalesce(v_plan, ''), 4000), ''), now(), now())
    on conflict (user_id, week_start) do update
      set summary = excluded.summary, next_plan = excluded.next_plan, auto_draft_at = now(), updated_at = now()
      where public.weekly_reports.submitted_at is null
        and coalesce(btrim(public.weekly_reports.summary), '') = '' and coalesce(btrim(public.weekly_reports.next_plan), '') = '';
    perform public.notify(u.id, '할 일', '주간 보고 초안이 준비됐습니다',
      '이번 주 기록 ' || v_logs || '건 · 끝낸 할 일 ' || v_done || '건을 정리해 두었습니다. 확인하고 고칠 곳만 고친 뒤 제출해 주세요.',
      '/team?tab=weekly&week=' || v_mon);
  end loop;
  return n;
end $$;
revoke all on function private.weekly_report_drafts(boolean) from public, anon, authenticated;

-- 월요일 아침: 지난주 제출 현황을 대표에게만
create or replace function private.weekly_report_monday() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_mon date := v_today - ((extract(isodow from v_today)::int) - 1) - 7;
  v_total int; v_done int; v_miss text; r record;
begin
  select count(*), count(*) filter (where w.submitted_at is not null),
         string_agg(p.name, ', ' order by p.name) filter (where w.submitted_at is null)
    into v_total, v_done, v_miss
  from public.profiles p left join public.weekly_reports w on w.user_id = p.id and w.week_start = v_mon
  where p.active and not p.is_agent and coalesce(p.title, '') <> '대표';
  if v_total = 0 then return; end if;
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.title = '대표' loop
    perform public.notify(r.id, '일일 보고', '지난주 주간 보고 · 제출 ' || v_done || '/' || v_total || '명',
      case when v_miss is null then '모두 제출했습니다.' else '아직 제출 전: ' || v_miss end,
      '/team?tab=weekly&week=' || v_mon);
  end loop;
end $$;
revoke all on function private.weekly_report_monday() from public, anon, authenticated;

select cron.unschedule('wkly_weekly_report_drafts') where exists (select 1 from cron.job where jobname = 'wkly_weekly_report_drafts');
select cron.schedule('wkly_weekly_report_drafts', '30 7 * * 5', 'select private.weekly_report_drafts()');   -- 금 16:30 KST
select cron.unschedule('wkly_weekly_report_monday') where exists (select 1 from cron.job where jobname = 'wkly_weekly_report_monday');
select cron.schedule('wkly_weekly_report_monday', '10 0 * * 1', 'select private.weekly_report_monday()');  -- 월 09:10 KST

-- ---------------------------------------------------------------------------------------------------
-- ② 메일 → 프로젝트: 글에서 못 찾았으면 같은 대화의 다른 메일이 붙은 프로젝트를 따라감 (+ 거래처 한 곳 규칙에 '상담협의' 포함)
create index if not exists mail_index_thread on public.mail_index (thread_id);

create or replace function private.mail_link() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_text text := concat_ws(' ', new.subject, new.snippet, array_to_string(new.attachments, ' '));
  v_other text := case when new.from_addr ilike '%@thewklyn.com' then new.to_addr else new.from_addr end;
  v_contact uuid;
  v_client uuid;
begin
  new.project_ids := (select coalesce(array_agg(distinct x), '{}') from unnest(public.match_projects(v_text) || public.match_projects_loose(v_text)) x);
  if v_other is not null then
    select c.id, c.client_id into v_contact, v_client from public.contacts c where lower(c.email) = lower(v_other) limit 1;
    if v_client is null then
      select k.id into v_client from public.clients k where lower(k.email) = lower(v_other) limit 1;
    end if;
    if v_client is not null and cardinality(new.project_ids) = 0 then
      new.project_ids := coalesce((select array_agg(p.id) from public.projects p where p.client_id = v_client and p.status in ('상담협의', '진행', '문의', 'NIC') having count(*) = 1), '{}');
    end if;
  end if;
  -- 같은 대화의 다른 메일이 이미 프로젝트에 붙어 있으면 그 프로젝트로 (답장 · 전달에는 프로젝트 이름이 안 적히는 일이 많다)
  if cardinality(new.project_ids) = 0 and new.thread_id is not null then
    new.project_ids := coalesce((select array_agg(distinct x) from public.mail_index m, unnest(m.project_ids) x
                                  where m.thread_id = new.thread_id and m.id <> new.id), '{}');
  end if;
  new.contact_id := v_contact;
  new.client_id := v_client;
  return new;
end $$;

-- 나중에 온 메일이 프로젝트에 붙으면 같은 대화의 앞 메일도 따라 붙게 10분마다 훑음 (한 번에 300통 · 붙을 곳이 생긴 메일만 건드림)
create or replace function private.mail_link_threads() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.mail_index m set project_ids = sub.pids
  from (
    select u.id, (select array_agg(distinct x) from public.mail_index s, unnest(s.project_ids) x where s.thread_id = u.thread_id and s.id <> u.id) as pids
    from public.mail_index u
    where cardinality(u.project_ids) = 0 and u.thread_id is not null
      and exists (select 1 from public.mail_index s where s.thread_id = u.thread_id and s.id <> u.id and cardinality(s.project_ids) > 0)
    limit 300) sub
  where m.id = sub.id and sub.pids is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.mail_link_threads() from public, anon, authenticated;
select private.mail_link_threads();   -- 지금 있는 메일 한 번 (나머지는 예약이 이어서)
select cron.unschedule('wkly_mail_link_threads') where exists (select 1 from cron.job where jobname = 'wkly_mail_link_threads');
select cron.schedule('wkly_mail_link_threads', '4,14,24,34,44,54 * * * *', 'select private.mail_link_threads()');

-- ---------------------------------------------------------------------------------------------------
-- ③ 알림 쌓임 줄이기: 같은 제목의 안 읽은 알림을 합치는 장치(notifications_merge_repeat)의 기준을 24시간 → 36시간으로
--    매일 같은 제목으로 오는 AI 보고 · 에이전트 실패 알림은 24시간을 몇 분 넘겨 도착해 합쳐지지 않고 쌓였다. 그 부분만 바꿔 다시 만든다.
do $$
declare def text;
begin
  def := pg_catalog.pg_get_functiondef('private.notifications_merge_repeat()'::regprocedure);
  if position($q$interval '24 hours'$q$ in def) > 0 then
    execute replace(def, $q$interval '24 hours'$q$, $q$interval '36 hours'$q$);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- ④ 문의함: 답할 필요 없는 것은 자동 '확인' — 구독 신청, 관심 신호 없는 자료 신청(공부 · 내부 보고 · 기타)
--    직접 문의와 관심 신호(다음 팝업 기획 · 첫 팝업 준비 · 상권·입지 검토)는 건드리지 않는다 (영업 대상 등록 · 수신 동의 표시가 '신규'를 봄)
create or replace function private.sales_inquiry_auto_confirm() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.web_inquiries w
     set status = '확인',
         memo = concat_ws(E'\n', nullif(btrim(coalesce(w.memo, '')), ''), '[자동] ' || case when w.kind = '구독' then '구독 신청' else '자료 신청' end || ' — 답장할 내용이 없어 확인 처리'),
         updated_at = now()
   where not coalesce(w.is_test, false) and coalesce(w.status, '신규') = '신규'
     and w.received_at < now() - interval '1 hour'
     and (w.kind = '구독'
       or (w.kind = '리포트 신청' and coalesce(w.category, '') not in ('다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토')));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.sales_inquiry_auto_confirm() from public, anon, authenticated;

insert into private.sales_ops_steps (step, label, call, every_min, enabled)
select 'inquiry_auto_confirm', '답할 필요 없는 문의 자동 확인', 'private.sales_inquiry_auto_confirm()', 30, true
where not exists (select 1 from private.sales_ops_steps where step = 'inquiry_auto_confirm');
