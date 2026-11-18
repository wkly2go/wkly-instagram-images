-- 서면 인터뷰 관리 (2026-11-18 · 대표 지시 '광고 컨텐츠에 더위클리 인터뷰자료 수신과 정리 페이지 … 영업수주에서 인터뷰지와
--   인터뷰질문 데이터 관리하고 제작은 광고 컨텐츠에서' → '작업 환경에 맞게 인트라넷에 반영하고 현재 작업중인 자료도 이전해줘')
--  1단계: 구글 시트 '인터뷰피드 발송현황'(답변 온 브랜드 · 발송 전체 리스트 · 이전 발송 · 1차 가공 데이터 · 로우 데이터)을
--  브랜드 한 곳 = 한 줄로 옮겨 영업·수주 화면에서 관리한다. 시트 내용은 데이터로만 옮기고 이 파일에는 넣지 않는다(공개 저장소).
--   · 단계: 발송 → 답변 → 인터뷰지 발송 → 자료 수령 → 제작 → 업로드 완료 (그 밖: 답장 없음 · 확인 필요 · 불가 · 보류)
--   · 인터뷰 답(answers {"Q1": …})과 영업 정보(sales_info: category · region · budget · partner · next_plan)를 같은 줄에 둔다
--   · 메일 자동 확인(10분마다): 연락처의 메일 주소로 오간 메일을 찾아 마지막 받은 · 보낸 메일, 첨부 메일, 대화 목록을 채우고
--     발송 · 답장 없음 · 확인 필요 단계에서 브랜드 메일이 오면 '답변'으로 바꾼다.
--     담당자를 정해 두면 답장 · 첨부 메일 도착 · 자료 수령 예정일 지남을 알린다 (08~21시 · 한 번씩). 메일은 보내지 않는다.

create table if not exists public.sales_interviews (
  id uuid primary key default gen_random_uuid(),
  batch text not null default '',
  brand text not null check (char_length(brand) between 1 and 200),
  event_name text,
  venue text,
  stage text not null default '발송'
    check (stage in ('발송', '답변', '인터뷰지 발송', '자료 수령', '제작', '업로드 완료', '답장 없음', '확인 필요', '불가', '보류')),
  send_channel text,
  sent_on date,
  contact text,
  emails text[] not null default '{}',
  reply_channel text,
  replied_at timestamptz,
  image_use text,
  interview_ok text,
  form_url text check (form_url is null or form_url ~* '^https?://'),
  form_sent_at timestamptz,
  form_note text,
  material_due date,
  material_note text,
  upload_on date,
  upload_note text,
  post_url text check (post_url is null or post_url ~* '^https?://'),
  note text,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  answered_at timestamptz,
  answered_note text,
  sales_info jsonb not null default '{}'::jsonb check (jsonb_typeof(sales_info) = 'object'),
  owner_id uuid references public.profiles (id) on delete set null,
  mail_threads text[] not null default '{}',
  mail_last_in_at timestamptz,
  mail_last_out_at timestamptz,
  mail_attach_at timestamptz,
  mail_alert_key text,
  source text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_interviews_stage_idx on public.sales_interviews (stage, upload_on);
create index if not exists sales_interviews_emails_idx on public.sales_interviews using gin (emails);
comment on table public.sales_interviews is '더위클리 서면 인터뷰(팝업 큐레이션) 섭외 · 인터뷰지 · 자료 · 업로드 일정 · 영업 정보 — 영업·수주 화면';

-- 연락처 글에서 메일 주소를 뽑아 둔다 (메일 자동 확인용)
create or replace function private.sales_interviews_prepare()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.emails := coalesce((
    select array_agg(distinct lower(t.m[1]))
    from regexp_matches(coalesce(new.contact, ''), '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') as t(m)
  ), '{}');
  new.updated_at := now();
  return new;
end
$$;
create or replace trigger sales_interviews_prepare before insert or update on public.sales_interviews
  for each row execute function private.sales_interviews_prepare();

-- 팀원은 보고 · 추가 · 고치기, 지우기는 관리자만 (보통은 단계 '보류')
alter table public.sales_interviews enable row level security;
create policy sales_interviews_select on public.sales_interviews for select using ((select public.is_active_member()));
create policy sales_interviews_insert on public.sales_interviews for insert with check ((select public.is_active_member()));
create policy sales_interviews_update on public.sales_interviews for update
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy sales_interviews_delete on public.sales_interviews for delete using ((select public.is_admin()));
revoke all on table public.sales_interviews from anon;
grant select, insert, update, delete on table public.sales_interviews to authenticated;

create or replace function private.sales_interview_mail_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_quiet boolean := extract(hour from now() at time zone 'Asia/Seoul') not between 8 and 20;
  r record;
  v_key text;
  v_title text;
  v_body text;
  v_rows integer := 0;
  v_replied integer := 0;
  v_alerts integer := 0;
begin
  if not pg_try_advisory_xact_lock(903161202) then
    return jsonb_build_object('skipped', 'locked');
  end if;

  for r in
    with iv as (
      select s.id, s.emails, s.stage, s.brand, s.owner_id, s.form_sent_at, s.material_due, s.mail_alert_key,
             s.mail_threads, s.mail_last_in_at, s.mail_last_out_at, s.mail_attach_at,
             coalesce(s.sent_on::timestamptz, s.created_at) - interval '1 day' as since
      from public.sales_interviews s
      where s.stage not in ('업로드 완료', '불가', '보류')
    ),
    -- 연락처 주소가 보냈거나 우리가 그 주소로 보낸 메일이 들어 있는 대화
    seed as (
      select distinct iv.id, m.thread_id
      from iv
      join public.mail_index m
        on m.thread_id is not null
       and m.sent_at >= iv.since
       and not ('DRAFT' = any (m.labels))
       and (lower(m.from_addr) = any (iv.emails)
            or ('SENT' = any (m.labels)
                and exists (select 1 from unnest(iv.emails) e where position(e in lower(coalesce(m.to_addr, ''))) > 0)))
    ),
    -- 그 대화의 메일 (임시 저장 · 회사 주소에서 받은 메일 · 자동 응답 제외)
    msgs as (
      select distinct on (s.id, m.id)
             s.id, m.thread_id, m.sent_at, ('SENT' = any (m.labels)) as is_out, coalesce(m.has_attachment, false) as has_file
      from seed s
      join iv on iv.id = s.id
      join public.mail_index m
        on m.thread_id = s.thread_id and m.sent_at >= iv.since and not ('DRAFT' = any (m.labels))
      where 'SENT' = any (m.labels)
         or (split_part(lower(m.from_addr), '@', 2) <> 'thewklyn.com'
             and coalesce(m.subject, '') !~* '(자동 ?응답|부재|out of office|auto.?reply|automatic reply|undeliver|delivery status)')
    )
    select iv.*,
           coalesce((select array_agg(distinct q.thread_id order by q.thread_id) from msgs q where q.id = iv.id), '{}') as threads,
           (select min(q.sent_at) from msgs q where q.id = iv.id and not q.is_out) as first_in,
           (select max(q.sent_at) from msgs q where q.id = iv.id and not q.is_out) as last_in,
           (select max(q.sent_at) from msgs q where q.id = iv.id and q.is_out) as last_out,
           (select max(q.sent_at) from msgs q where q.id = iv.id and not q.is_out and q.has_file) as last_file
    from iv
  loop
    v_rows := v_rows + 1;
    if (r.mail_threads, r.mail_last_in_at, r.mail_last_out_at, r.mail_attach_at)
       is distinct from (r.threads, r.last_in, r.last_out, r.last_file) then
      update public.sales_interviews s
         set mail_threads = r.threads, mail_last_in_at = r.last_in, mail_last_out_at = r.last_out, mail_attach_at = r.last_file
       where s.id = r.id;
    end if;

    -- 섭외 메일에 브랜드가 메일로 답하면 '답변'
    if r.stage in ('발송', '답장 없음', '확인 필요') and r.first_in is not null then
      update public.sales_interviews s
         set stage = '답변',
             replied_at = coalesce(s.replied_at, r.first_in),
             reply_channel = case when coalesce(s.reply_channel, '') ~ '이메일' then s.reply_channel
                                  else concat_ws(', ', nullif(trim(s.reply_channel), ''), '이메일') end,
             note = concat_ws(E'\n', nullif(trim(s.note), ''),
               '[자동] ' || to_char(r.first_in at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 메일 답장 확인')
       where s.id = r.id and s.stage in ('발송', '답장 없음', '확인 필요');
      v_replied := v_replied + 1;
    end if;

    -- 담당자 알림 (담당자를 정한 줄만)
    v_key := null;
    if r.owner_id is not null then
      if r.stage in ('발송', '답장 없음', '확인 필요') and r.first_in is not null then
        v_key := 'reply:' || floor(extract(epoch from r.first_in))::bigint;
        v_title := '인터뷰 섭외 답장 — ' || left(r.brand, 40);
        v_body := to_char(r.first_in at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 메일로 답이 왔습니다. 메일을 확인하고 인터뷰지를 보내 주세요.';
      elsif r.stage = '인터뷰지 발송' and r.last_file is not null
            and r.last_file > coalesce(r.form_sent_at, '-infinity'::timestamptz) then
        v_key := 'file:' || floor(extract(epoch from r.last_file))::bigint;
        v_title := '인터뷰 자료 메일 도착 — ' || left(r.brand, 40);
        v_body := to_char(r.last_file at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' 첨부가 있는 메일이 왔습니다. 확인 뒤 단계를 자료 수령으로 바꿔 주세요.';
      elsif r.stage in ('답변', '인터뷰지 발송') and r.material_due is not null and r.material_due < v_today then
        v_key := 'due:' || r.material_due;
        v_title := '인터뷰 자료 수령 예정일 지남 — ' || left(r.brand, 40);
        v_body := to_char(r.material_due, 'MM-DD') || ' 수령 예정이었습니다. 자료를 다시 요청하거나 일정을 바꿔 주세요.';
      end if;
      if v_key is not null and v_key is distinct from r.mail_alert_key and not v_quiet then
        perform public.notify(r.owner_id, '알람', v_title, v_body, '/sales?interview=' || r.id);
        update public.sales_interviews s set mail_alert_key = v_key where s.id = r.id;
        v_alerts := v_alerts + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('rows', v_rows, 'replied', v_replied, 'alerts', v_alerts, 'quiet', v_quiet);
end
$$;
revoke all on function private.sales_interview_mail_tick() from public, anon, authenticated;

-- 영업 자동 실행 순서에 넣음 (10분마다 · Gmail 동기화와 같은 간격)
insert into private.sales_ops_steps (step, label, call, every_min, grace_min, enabled)
values ('interview_mail', '서면 인터뷰 메일 확인', 'private.sales_interview_mail_tick()', 10, 10, true)
on conflict (step) do update
  set label = excluded.label, call = excluded.call, every_min = excluded.every_min, grace_min = excluded.grace_min;
