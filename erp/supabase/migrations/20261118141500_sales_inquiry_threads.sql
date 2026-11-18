-- 문의 메일 응대 추적 (2026-11-18 · 대표 지시 '영업 개발 디벨롭 더 고도화 시켜')
--  홈페이지 문의(web_inquiries)를 회사 메일 기록(mail_index · 10분마다 Gmail 동기화)과 이어 본다.
--   · 메일로 답한 문의: 상태 '신규' · '확인' → '응대 완료' (메모에 '[자동] … 메일 답장 확인')
--   · 고객이 다시 메일을 보냈는데 우리가 답하지 않음: 2시간 · 하루 뒤 담당자 알림 (하루가 넘으면 관리자도)
--   · 직접 문의에 메일 답장 기록이 없음: 3시간 · 하루 뒤 알림 (전화로 응대했다면 문의함에서 '응대 완료')
--   · 우리가 답한 뒤 고객 회신이 없음: 3 · 7 · 14일째 후속 연락 알림
--   · 고객의 마지막 메일이 '감사합니다'처럼 답이 필요 없으면 문의함에서 '답장 필요 없음' → 회신 대기로 (새 메일이 오면 다시 올라옴)
--  알림은 한국 시간 08~21시에만, 같은 단계는 한 번만, 같은 메일 주소의 중복 신청은 가장 최근 한 건만.
--  회사 주소(thewklyn.com) · 팀원 주소 · app_settings 'sales_internal_emails'(메일 주소 배열)는 내부 시험으로 보고 건너뛴다.
--  메일을 보내지 않는다(읽기만). 문의함 화면은 public.sales_inquiry_threads() 로 대화 상태를 읽는다.

create table if not exists private.sales_inquiry_threads (
  inquiry_id uuid primary key references public.web_inquiries (id) on delete cascade,
  email text not null,
  state text not null check (state in ('미응대', '우리 답 필요', '회신 대기')),
  thread_id text,
  first_out_at timestamptz,
  last_out_at timestamptz,
  last_in_at timestamptz,
  last_in_subject text,
  last_in_snippet text,
  in_count integer not null default 0,
  out_count integer not null default 0,
  quote_asked boolean not null default false,
  unread boolean not null default false,
  alert_key text,
  alerted_at timestamptz,
  dismissed_in_at timestamptz,
  dismissed_by uuid,
  updated_at timestamptz not null default now()
);
alter table private.sales_inquiry_threads enable row level security;
revoke all on table private.sales_inquiry_threads from public, anon, authenticated;
comment on table private.sales_inquiry_threads is '홈페이지 문의별 메일 대화 상태 · private.sales_inquiry_thread_tick 이 10분마다 갱신';

create or replace function private.sales_inquiry_thread_tick(p_dry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_quiet boolean := extract(hour from now() at time zone 'Asia/Seoul') not between 8 and 20;
  v_internal text[];
  v_admins uuid[];
  v_ids uuid[] := '{}';
  r record;
  v_key text;
  v_title text;
  v_body text;
  v_hours numeric;
  v_days integer;
  v_stage integer;
  v_wide boolean;
  v_to uuid[];
  v_u uuid;
  v_closed integer := 0;
  v_alerts integer := 0;
  v_tests integer := 0;
  v_blocked integer := 0;
  v_count jsonb := '{}'::jsonb;
  v_preview jsonb := '[]'::jsonb;
begin
  if not p_dry and not pg_try_advisory_xact_lock(903161201) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  select coalesce(array_agg(distinct lower(trim(t.x))), '{}') into v_internal
  from (
    select p.email as x from public.profiles p where nullif(trim(p.email), '') is not null
    union all
    select e from public.app_settings s,
      jsonb_array_elements_text(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) e
    where s.key = 'sales_internal_emails'
  ) t;

  select coalesce(array_agg(p.id), '{}') into v_admins
  from public.profiles p
  where p.role = 'admin' and p.active and not coalesce(p.is_agent, false);

  -- 회사 · 팀원 주소로 들어온 신청은 내부 시험 · 그 주소의 영업 후보는 연락하지 않게 막음
  if p_dry then
    select count(*) into v_tests from public.web_inquiries w
     where not coalesce(w.is_test, false) and nullif(trim(w.email), '') is not null
       and (split_part(lower(trim(w.email)), '@', 2) = 'thewklyn.com' or lower(trim(w.email)) = any (v_internal));
    select count(*) into v_blocked from public.sales_prospects p
     where not coalesce(p.blocked, false)
       and (split_part(lower(substring(p.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')), '@', 2) = 'thewklyn.com'
            or lower(substring(p.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) = any (v_internal));
  else
    update public.web_inquiries w
       set is_test = true,
           memo = concat_ws(E'\n', nullif(trim(w.memo), ''), '[자동] 회사 · 팀원 주소 → 내부 시험으로 표시'),
           updated_at = v_now
     where not coalesce(w.is_test, false) and nullif(trim(w.email), '') is not null
       and (split_part(lower(trim(w.email)), '@', 2) = 'thewklyn.com' or lower(trim(w.email)) = any (v_internal));
    get diagnostics v_tests = row_count;
    update public.sales_prospects p
       set blocked = true, next_action = '회사 · 팀원 주소 · 영업 연락하지 않음'
     where not coalesce(p.blocked, false)
       and (split_part(lower(substring(p.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')), '@', 2) = 'thewklyn.com'
            or lower(substring(p.contact from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) = any (v_internal));
    get diagnostics v_blocked = row_count;
    -- 상태를 '응대 완료'로 바꾸기 전에 새 문의가 영업 후보로 먼저 올라가 있게 한다
    perform private.sales_inquiry_prospects();
  end if;

  for r in
    with inq as (
      select w.id, lower(trim(w.email)) as email, w.kind, coalesce(w.status, '신규') as status,
             w.submitted_at, w.assignee, w.title, w.detail,
             coalesce(nullif(trim(w.brand), ''), split_part(lower(trim(w.email)), '@', 1)) as who
      from public.web_inquiries w
      where not coalesce(w.is_test, false)
        and nullif(trim(w.email), '') is not null
        and w.submitted_at >= v_now - interval '120 days'
        and coalesce(w.status, '신규') <> '제외'
        and split_part(lower(trim(w.email)), '@', 2) <> 'thewklyn.com'
        and lower(trim(w.email)) <> all (v_internal)
    ),
    -- 문의한 주소가 보냈거나, 우리가 그 주소로 보낸 메일이 들어 있는 대화
    seed as (
      select distinct i.id, m.thread_id
      from inq i
      join public.mail_index m
        on m.thread_id is not null
       and m.sent_at >= i.submitted_at - interval '2 hours'
       and not ('DRAFT' = any (m.labels))
       and (lower(m.from_addr) = i.email
            or ('SENT' = any (m.labels) and position(i.email in lower(coalesce(m.to_addr, ''))) > 0))
    ),
    -- 그 대화의 메일 전부 (임시 저장 제외 · 회사 주소에서 받은 메일 제외)
    msgs as (
      select distinct on (s.id, m.id)
             s.id, m.thread_id, m.sent_at, m.subject, m.snippet,
             ('SENT' = any (m.labels)) as is_out,
             ('UNREAD' = any (m.labels)) as is_unread
      from seed s
      join inq i on i.id = s.id
      join public.mail_index m
        on m.thread_id = s.thread_id
       and m.sent_at >= i.submitted_at - interval '2 hours'
       and not ('DRAFT' = any (m.labels))
      where 'SENT' = any (m.labels) or split_part(lower(m.from_addr), '@', 2) <> 'thewklyn.com'
    ),
    agg as (
      select i.id, i.email, i.kind, i.status, i.submitted_at, i.assignee, i.who, i.title, i.detail,
             (count(m.id) filter (where m.is_out))::integer as out_count,
             (count(m.id) filter (where not m.is_out))::integer as in_count,
             min(m.sent_at) filter (where m.is_out) as first_out_at,
             max(m.sent_at) filter (where m.is_out) as last_out_at,
             max(m.sent_at) filter (where not m.is_out) as last_in_at
      from inq i
      left join msgs m on m.id = i.id
      group by i.id, i.email, i.kind, i.status, i.submitted_at, i.assignee, i.who, i.title, i.detail
    )
    select a.*,
           case when a.out_count = 0 then '미응대'
                when a.last_in_at > a.last_out_at
                 and (t.dismissed_in_at is null or a.last_in_at > t.dismissed_in_at) then '우리 답 필요'
                else '회신 대기' end as state,
           greatest(a.last_out_at, t.dismissed_in_at) as wait_from,
           li.subject as last_in_subject,
           li.snippet as last_in_snippet,
           coalesce(li.is_unread, false) as unread,
           case when a.last_in_at > coalesce(a.last_out_at, '-infinity'::timestamptz) then li.thread_id
                else coalesce(lo.thread_id, li.thread_id) end as thread_id,
           (exists (select 1 from msgs q
                    where q.id = a.id and not q.is_out
                      and (coalesce(q.subject, '') || ' ' || coalesce(q.snippet, '')) ~ '견적|비용|단가|금액|가격|예산')
            or (coalesce(a.title, '') || ' ' || coalesce(a.detail, '')) ~ '견적') as quote_asked,
           t.alert_key,
           exists (select 1 from inq n
                   where n.email = a.email and n.id <> a.id
                     and (n.submitted_at, n.id::text) > (a.submitted_at, a.id::text)) as superseded
    from agg a
    left join lateral (select m.subject, m.snippet, m.thread_id, m.is_unread from msgs m
                       where m.id = a.id and not m.is_out order by m.sent_at desc limit 1) li on true
    left join lateral (select m.thread_id from msgs m
                       where m.id = a.id and m.is_out order by m.sent_at desc limit 1) lo on true
    left join private.sales_inquiry_threads t on t.inquiry_id = a.id
  loop
    v_ids := v_ids || r.id;
    v_count := jsonb_set(v_count, array[r.state], to_jsonb(coalesce((v_count ->> r.state)::integer, 0) + 1));

    -- 지금 알릴 단계 (없으면 null)
    v_key := null; v_title := null; v_body := null; v_wide := false;
    if r.state = '우리 답 필요' then
      v_hours := extract(epoch from v_now - r.last_in_at) / 3600;
      if v_hours >= 24 and v_hours < 24 * 14 then
        v_key := 'in:' || floor(extract(epoch from r.last_in_at))::bigint || ':2';
        v_wide := true;
      elsif v_hours >= 2 and v_hours < 24 then
        v_key := 'in:' || floor(extract(epoch from r.last_in_at))::bigint || ':1';
      end if;
      v_title := '고객 답장 · 회신 필요 — ' || left(r.who, 40);
      v_body := to_char(r.last_in_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 받은 메일 「'
        || left(coalesce(nullif(trim(r.last_in_subject), ''), '제목 없음'), 60) || '」에 아직 답장이 없습니다 ('
        || case when v_hours < 24 then floor(v_hours)::integer || '시간째' else floor(v_hours / 24)::integer || '일째' end || ')'
        || case when r.quote_asked then ' · 견적 요청 포함' else '' end || '.';
    elsif r.state = '미응대' and r.kind = '문의' and r.status in ('신규', '확인') then
      v_hours := extract(epoch from v_now - r.submitted_at) / 3600;
      if v_hours >= 24 and v_hours < 24 * 14 then
        v_key := 'new:2';
        v_wide := true;
      elsif v_hours >= 3 and v_hours < 24 then
        v_key := 'new:1';
      end if;
      v_title := '문의 답장 필요 — ' || left(r.who, 40);
      v_body := to_char(r.submitted_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 홈페이지 문의에 메일 답장 기록이 없습니다 ('
        || case when v_hours < 24 then floor(v_hours)::integer || '시간째' else floor(v_hours / 24)::integer || '일째' end
        || '). 전화로 응대했다면 문의함에서 응대 완료로 바꿔 주세요.';
    elsif r.state = '회신 대기' and (r.kind = '문의' or r.in_count > 0) then
      v_days := floor(extract(epoch from v_now - r.wait_from) / 86400)::integer;
      v_stage := case when v_days >= 14 then 14 when v_days >= 7 then 7 when v_days >= 3 then 3 end;
      if v_stage is not null and v_days < v_stage + 3 then
        v_key := 'out:' || floor(extract(epoch from r.wait_from))::bigint || ':' || v_stage;
      end if;
      v_title := '후속 연락 시점 — ' || left(r.who, 40);
      v_body := '마지막 연락(' || to_char(r.wait_from at time zone 'Asia/Seoul', 'MM-DD') || ') 뒤 ' || v_days || '일째 회신이 없습니다'
        || case when r.quote_asked then ' · 견적 건' else '' end || '. 메일 대화를 열어 후속 연락을 보내 주세요.';
    end if;

    if p_dry then
      v_preview := v_preview || jsonb_build_object(
        'who', r.who, 'kind', r.kind, 'status', r.status, 'state', r.state, 'quote', r.quote_asked,
        'close', r.out_count > 0 and r.status in ('신규', '확인'),
        'alert', case when v_key is not null and v_key is distinct from r.alert_key and not r.superseded then v_key end,
        'wide', v_wide, 'title', v_title);
      continue;
    end if;

    insert into private.sales_inquiry_threads as t
      (inquiry_id, email, state, thread_id, first_out_at, last_out_at, last_in_at, last_in_subject, last_in_snippet,
       in_count, out_count, quote_asked, unread, updated_at)
    values
      (r.id, r.email, r.state, r.thread_id, r.first_out_at, r.last_out_at, r.last_in_at, left(r.last_in_subject, 300),
       left(r.last_in_snippet, 500), r.in_count, r.out_count, r.quote_asked, r.unread, v_now)
    on conflict (inquiry_id) do update set
      email = excluded.email, state = excluded.state, thread_id = excluded.thread_id,
      first_out_at = excluded.first_out_at, last_out_at = excluded.last_out_at, last_in_at = excluded.last_in_at,
      last_in_subject = excluded.last_in_subject, last_in_snippet = excluded.last_in_snippet,
      in_count = excluded.in_count, out_count = excluded.out_count, quote_asked = excluded.quote_asked,
      unread = excluded.unread, updated_at = excluded.updated_at
    where (t.email, t.state, t.thread_id, t.first_out_at, t.last_out_at, t.last_in_at, t.in_count, t.out_count, t.quote_asked, t.unread)
      is distinct from
          (excluded.email, excluded.state, excluded.thread_id, excluded.first_out_at, excluded.last_out_at, excluded.last_in_at,
           excluded.in_count, excluded.out_count, excluded.quote_asked, excluded.unread);

    -- 메일로 답한 문의는 처리한 것으로 (전화 응대 · 제외는 사람이 고름)
    if r.out_count > 0 and r.status in ('신규', '확인') then
      update public.web_inquiries w
         set status = '응대 완료',
             memo = concat_ws(E'\n', nullif(trim(w.memo), ''),
               '[자동] ' || to_char(r.first_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 메일 답장 확인'),
             updated_at = v_now
       where w.id = r.id and coalesce(w.status, '신규') in ('신규', '확인');
      v_closed := v_closed + 1;
    end if;

    if v_key is not null and v_key is distinct from r.alert_key and not r.superseded and not v_quiet then
      v_to := case
        when r.assignee is not null and exists (
          select 1 from public.profiles p where p.id = r.assignee and p.active and not coalesce(p.is_agent, false))
        then array[r.assignee]
        else v_admins end;
      if v_wide then v_to := v_to || v_admins; end if;
      for v_u in select distinct x from unnest(v_to) x where x is not null loop
        perform public.notify(v_u, '알람', v_title, v_body, '/sales?inquiry=' || r.id);
      end loop;
      update private.sales_inquiry_threads set alert_key = v_key, alerted_at = v_now where inquiry_id = r.id;
      v_alerts := v_alerts + 1;
    end if;
  end loop;

  if not p_dry then
    delete from private.sales_inquiry_threads t where not (t.inquiry_id = any (v_ids));
  end if;

  return jsonb_build_object('seen', coalesce(array_length(v_ids, 1), 0), 'states', v_count,
                            'closed', v_closed, 'alerts', v_alerts, 'quiet', v_quiet,
                            'internal_tests', v_tests, 'internal_blocked', v_blocked)
    || case when p_dry then jsonb_build_object('preview', v_preview) else '{}'::jsonb end;
end
$$;
revoke all on function private.sales_inquiry_thread_tick(boolean) from public, anon, authenticated;

-- 문의함 화면용 (팀원만) · '답장 필요 없음'으로 넘긴 대화는 state 가 회신 대기인데 last_in_at 이 last_out_at 보다 늦음
create or replace function public.sales_inquiry_threads()
returns table (
  inquiry_id uuid, state text, thread_id text, first_out_at timestamptz, last_out_at timestamptz,
  last_in_at timestamptz, last_in_subject text, last_in_snippet text, in_count integer, out_count integer,
  quote_asked boolean, unread boolean, alerted_at timestamptz, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.inquiry_id, t.state, t.thread_id, t.first_out_at, t.last_out_at, t.last_in_at, t.last_in_subject,
         t.last_in_snippet, t.in_count, t.out_count, t.quote_asked, t.unread, t.alerted_at, t.updated_at
  from private.sales_inquiry_threads t
  where (select public.is_active_member())
$$;
revoke all on function public.sales_inquiry_threads() from public, anon;
grant execute on function public.sales_inquiry_threads() to authenticated;

-- 고객의 마지막 메일에 답이 필요 없을 때 (팀원만) · 그 메일까지만 해당하고, 새 메일이 오면 다시 '우리 답 필요'
create or replace function public.sales_inquiry_thread_dismiss(p_inquiry uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not (select public.is_active_member()) then
    raise exception '팀원만 쓸 수 있습니다.';
  end if;
  update private.sales_inquiry_threads t
     set dismissed_in_at = t.last_in_at,
         dismissed_by = auth.uid(),
         state = case when t.state = '우리 답 필요' then '회신 대기' else t.state end,
         updated_at = now()
   where t.inquiry_id = p_inquiry and t.last_in_at is not null
  returning t.dismissed_in_at into v_at;
  if v_at is null then
    raise exception '답장 필요 없음으로 표시할 받은 메일이 없습니다.';
  end if;
  return v_at;
end
$$;
revoke all on function public.sales_inquiry_thread_dismiss(uuid) from public, anon;
grant execute on function public.sales_inquiry_thread_dismiss(uuid) to authenticated;

-- 영업 자동 실행 순서에 넣음 (10분마다 · Gmail 동기화와 같은 간격)
insert into private.sales_ops_steps (step, label, call, every_min, grace_min, enabled)
values ('inquiry_threads', '문의 메일 응대 추적', 'private.sales_inquiry_thread_tick()', 10, 10, true)
on conflict (step) do update
  set label = excluded.label, call = excluded.call, every_min = excluded.every_min, grace_min = excluded.grace_min;
