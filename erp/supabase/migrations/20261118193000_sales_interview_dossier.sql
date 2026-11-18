-- 서면 인터뷰 DB 고도화 (2026-11-18 대표 지시 '인터뷰지에 대한 db 작업 필수야 고도화 작업하고 한페이지에 모든 정보를 볼 수 있게
--   만들어 그리고 이자료를 가공해서 리포트를 만들거야' · '인터뷰지 담당 할 ai 에이전트 전담시켜' · '리포트 기획안 작성 에이전트를 붙여')
--  ① 문항 표 sales_interview_questions — 인터뷰지 10문항(질문 은행의 시작 · 화면 · AI 가 같은 문항 정의를 씀)
--  ② 문항별 답 표 sales_interview_answers — sales_interviews.answers(jsonb)를 브랜드 × 문항 한 줄로 펼쳐 둠
--     (트리거가 자동으로 맞춤 · 사람이 따로 적지 않음) → 문항별로 모든 브랜드 답을 모아 보고 리포트로 가공
--  ③ AI 분석 칸 sales_interviews.analysis — 인터뷰지 담당 AI(IV-DESK)가 답을 읽어 요약 · 키워드 · KPI · 방문객 · 예산대 ·
--     카테고리 · 지역 · 인용문 · 인사이트를 채움 (답이 바뀌면 다시 분석 대상)
--  ④ 리포트 표 interview_reports — 리포트 기획 AI(IV-REPORT)가 모인 답으로 리포트 기획안을 만들고 팀이 확정 · 작성
--  결재 · 알림 · 메일 없음. AI 는 환경 변수 열쇠로 RPC 두 개만 부름 (agent_interview_context · agent_interview_save).

-- ① 문항
create table if not exists public.sales_interview_questions (
  no text primary key check (no ~ '^Q[0-9]{1,2}$'),
  sort int not null,
  section text not null,
  label text not null,
  use text not null default '콘텐츠' check (use in ('콘텐츠', '영업')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.sales_interview_questions (no, sort, section, label, use) values
  ('Q1', 1, '브랜드 철학 · 팝업 목표', '공간을 고른 이유 · 심고자 한 브랜드 이미지', '콘텐츠'),
  ('Q2', 2, '브랜드 철학 · 팝업 목표', '핵심 KPI · 예상 방문객', '콘텐츠'),
  ('Q3', 3, '브랜드 철학 · 팝업 목표', '전체 예산 규모 (기획 · 시공 · 운영)', '영업'),
  ('Q4', 4, '공간 기획 · 인테리어', '인테리어 중점 요소 · 키 포인트 공간', '콘텐츠'),
  ('Q5', 5, '공간 기획 · 인테리어', '사진 · 공유를 부르는 장치', '콘텐츠'),
  ('Q6', 6, '마케팅 · 고객 접점', '체류 구간의 구매 · 브랜드 경험 전략', '콘텐츠'),
  ('Q7', 7, '마케팅 · 고객 접점', '체험 요소 · 현장 이벤트', '콘텐츠'),
  ('Q8', 8, '인사이트 · 향후 비전', '기대하는 전환점', '콘텐츠'),
  ('Q9', 9, '인사이트 · 향후 비전', '어려움 · 인사이트 · 조언', '콘텐츠'),
  ('Q10', 10, '향후 계획 · 파트너 기준', '향후 팝업 계획 · 파트너 선정 기준 (필수)', '영업')
on conflict (no) do nothing;
alter table public.sales_interview_questions enable row level security;
create policy sales_interview_questions_select on public.sales_interview_questions for select using ((select public.is_active_member()));
create policy sales_interview_questions_admin on public.sales_interview_questions for all using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on table public.sales_interview_questions from anon;

-- ② 문항별 답 (쓰기는 트리거만)
create table if not exists public.sales_interview_answers (
  interview_id uuid not null references public.sales_interviews (id) on delete cascade,
  q_no text not null,
  answer text not null,
  chars int generated always as (char_length(answer)) stored,
  updated_at timestamptz not null default now(),
  primary key (interview_id, q_no)
);
create index if not exists sales_interview_answers_q_idx on public.sales_interview_answers (q_no);
alter table public.sales_interview_answers enable row level security;
create policy sales_interview_answers_select on public.sales_interview_answers for select using ((select public.is_active_member()));
revoke all on table public.sales_interview_answers from anon;
revoke insert, update, delete on table public.sales_interview_answers from authenticated;

create or replace function private.sales_interview_answers_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.answers is not distinct from old.answers then
    return null;
  end if;
  delete from public.sales_interview_answers a
   where a.interview_id = new.id
     and not exists (select 1 from jsonb_each_text(new.answers) e where e.key = a.q_no and btrim(e.value) <> '');
  insert into public.sales_interview_answers (interview_id, q_no, answer, updated_at)
  select new.id, e.key, btrim(e.value), now()
    from jsonb_each_text(new.answers) e
   where e.key ~ '^Q[0-9]{1,2}$' and btrim(e.value) <> ''
  on conflict (interview_id, q_no) do update set answer = excluded.answer, updated_at = now()
   where public.sales_interview_answers.answer is distinct from excluded.answer;
  return null;
end
$$;
create or replace trigger sales_interview_answers_sync after insert or update of answers on public.sales_interviews
  for each row execute function private.sales_interview_answers_sync();

-- 지금 있는 답 옮기기
insert into public.sales_interview_answers (interview_id, q_no, answer)
select i.id, e.key, btrim(e.value)
  from public.sales_interviews i, jsonb_each_text(i.answers) e
 where e.key ~ '^Q[0-9]{1,2}$' and btrim(e.value) <> ''
on conflict (interview_id, q_no) do nothing;

-- ③ AI 분석 칸
alter table public.sales_interviews
  add column if not exists analysis jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis) = 'object'),
  add column if not exists analyzed_at timestamptz;
comment on column public.sales_interviews.analysis is
  '인터뷰지 담당 AI 분석: summary · keywords[] · kpi · visitors · budget_band · category · region · quote · insights[] · next_steps[] · answers_hash';

-- ④ 리포트
create table if not exists public.interview_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default '기획안' check (status in ('기획안', '확정', '작성 중', '완료', '보류')),
  audience text,
  period text,
  interview_ids uuid[] not null default '{}',
  plan text not null default '',
  body text not null default '',
  note text,
  made_by text not null default '사람',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.interview_reports enable row level security;
create policy interview_reports_select on public.interview_reports for select using ((select public.is_active_member()));
create policy interview_reports_insert on public.interview_reports for insert with check ((select public.is_active_member()));
create policy interview_reports_update on public.interview_reports for update
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
create policy interview_reports_delete on public.interview_reports for delete using ((select public.is_admin()));
revoke all on table public.interview_reports from anon;
create or replace function private.interview_reports_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create or replace trigger interview_reports_touch before update on public.interview_reports
  for each row execute function private.interview_reports_touch();

-- AI 전용 RPC: 읽기
create or replace function public.agent_interview_context(p_token text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  perform public.agent_token_check(p_token, 'task');
  if p_role not in ('IV-DESK', 'IV-REPORT') then
    raise exception '알 수 없는 역할입니다.' using errcode = '22023';
  end if;
  v_out := jsonb_build_object(
    'kst', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'questions', (select jsonb_agg(jsonb_build_object('no', q.no, 'section', q.section, 'label', q.label, 'use', q.use) order by q.sort)
      from public.sales_interview_questions q where q.active),
    'directives', coalesce((select jsonb_agg(jsonb_build_object('directive', d.directive, 'priority', d.priority, 'set_by', d.set_by))
      from public.agent_directives_for(p_role, '인터뷰') d), '[]'::jsonb),
    'totals', (select jsonb_build_object('brands', count(*), 'answered', count(*) filter (where i.answers <> '{}'::jsonb),
        'analyzed', count(*) filter (where i.analyzed_at is not null)) from public.sales_interviews i)
  );
  if p_role = 'IV-DESK' then
    -- 답이 있는데 분석이 없거나 답이 분석 뒤에 바뀐 브랜드 (한 번에 8곳) · 연락처 · 메일 주소는 넘기지 않음
    v_out := v_out || jsonb_build_object('pending', coalesce((select jsonb_agg(x) from (
      select i.id, i.brand, i.event_name, i.venue, i.stage, i.answers, i.sales_info, i.answered_at, i.analysis
        from public.sales_interviews i
       where i.answers <> '{}'::jsonb
         and (i.analyzed_at is null or coalesce(i.analysis ->> 'answers_hash', '') <> md5(i.answers::text))
       order by i.answered_at desc nulls last, i.updated_at desc limit 8) x), '[]'::jsonb));
  else
    v_out := v_out || jsonb_build_object(
      'interviews', coalesce((select jsonb_agg(x) from (
        select i.id, i.brand, i.event_name, i.venue, i.stage, i.upload_on, i.analysis,
               (select jsonb_object_agg(a.q_no, left(a.answer, 1500)) from public.sales_interview_answers a where a.interview_id = i.id) as answers
          from public.sales_interviews i where i.answers <> '{}'::jsonb
         order by i.answered_at desc nulls last limit 40) x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(jsonb_build_object('title', r.title, 'status', r.status, 'period', r.period,
          'brands', cardinality(r.interview_ids), 'created_at', r.created_at, 'plan', left(r.plan, 1500)) order by r.created_at desc)
        from (select * from public.interview_reports order by created_at desc limit 12) r), '[]'::jsonb));
  end if;
  return v_out;
end $$;

-- AI 전용 RPC: 저장 (IV-DESK → 브랜드 분석 / IV-REPORT → 리포트 기획안)
create or replace function public.agent_interview_save(p_token text, p_role text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_answers jsonb;
  v_ids uuid[];
  v_title text;
begin
  perform public.agent_token_check(p_token, 'task');
  if coalesce(p_payload::text, '') ~ '\d{6}\s*-\s*[1-4]\d{6}' then
    raise exception '주민등록번호 형식이 들어 있어 저장하지 않습니다.' using errcode = '22023';
  end if;
  if p_role = 'IV-DESK' then
    v_id := (p_payload ->> 'interview_id')::uuid;
    select i.answers into v_answers from public.sales_interviews i where i.id = v_id;
    if v_answers is null then raise exception '인터뷰를 찾지 못했습니다.' using errcode = '22023'; end if;
    if jsonb_typeof(p_payload -> 'analysis') is distinct from 'object' then
      raise exception 'analysis 는 객체여야 합니다.' using errcode = '22023';
    end if;
    update public.sales_interviews
       set analysis = (p_payload -> 'analysis') - 'answers_hash' || jsonb_build_object('answers_hash', md5(v_answers::text), 'by', 'IV-DESK'),
           analyzed_at = now()
     where id = v_id;
    insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
    values ('IV-DESK 인터뷰지 담당', (now() at time zone 'Asia/Seoul')::date, now(), '완료',
            '인터뷰 분석 · ' || (select brand from public.sales_interviews where id = v_id),
            left(coalesce(p_payload -> 'analysis' ->> 'summary', ''), 500), left((p_payload -> 'analysis')::text, 20000));
    return jsonb_build_object('ok', true, 'interview_id', v_id);
  elsif p_role = 'IV-REPORT' then
    v_title := left(btrim(coalesce(p_payload ->> 'title', '')), 200);
    if v_title = '' or btrim(coalesce(p_payload ->> 'plan', '')) = '' then
      raise exception '제목과 기획안 내용이 필요합니다.' using errcode = '22023';
    end if;
    select coalesce(array_agg(i.id), '{}') into v_ids from public.sales_interviews i
     where i.id in (select (jsonb_array_elements_text(coalesce(p_payload -> 'interview_ids', '[]'::jsonb)))::uuid);
    -- 같은 제목의 기획안이 아직 '기획안'이면 고침 · 확정된 것은 건드리지 않음
    update public.interview_reports set plan = left(p_payload ->> 'plan', 30000), interview_ids = v_ids,
           audience = left(p_payload ->> 'audience', 200), period = left(p_payload ->> 'period', 100)
     where title = v_title and status = '기획안' and made_by = 'IV-REPORT'
     returning id into v_id;
    if v_id is null then
      insert into public.interview_reports (title, status, audience, period, interview_ids, plan, made_by, created_by)
      values (v_title, '기획안', left(p_payload ->> 'audience', 200), left(p_payload ->> 'period', 100), v_ids,
              left(p_payload ->> 'plan', 30000), 'IV-REPORT', null)
      returning id into v_id;
    end if;
    insert into public.agent_reports (job_name, report_date, run_at, verdict, title, summary, body)
    values ('IV-REPORT 리포트 기획', (now() at time zone 'Asia/Seoul')::date, now(), '완료', '리포트 기획안 · ' || v_title,
            left(p_payload ->> 'plan', 500), left(p_payload ->> 'plan', 20000));
    return jsonb_build_object('ok', true, 'report_id', v_id);
  end if;
  raise exception '알 수 없는 역할입니다.' using errcode = '22023';
end $$;

revoke all on function public.agent_interview_context(text, text) from public;
revoke all on function public.agent_interview_save(text, text, jsonb) from public;
grant execute on function public.agent_interview_context(text, text) to anon, authenticated;
grant execute on function public.agent_interview_save(text, text, jsonb) to anon, authenticated;

-- AI 팀원 명단: 인터뷰 묶음
insert into public.agent_roster (code, name, group_name, owner_id, duties, schedule, model, approval_rule, phase, active, sort, is_lead, lead_code, home)
values
  ('IV-DESK', '인터뷰지 담당', '인터뷰', 'd6ec347b-766a-427d-9aae-7957e830797f', '받은 인터뷰지 답을 읽어 브랜드마다 요약 · 키워드 · KPI · 방문객 · 예산대 · 카테고리 · 지역 · 인용문 · 인사이트를 DB 에 정리(답이 바뀌면 다시) · 메일 · 발송 없음', '매일 10:13', 'claude-sonnet-5-5', '결재 없음 (DB 정리)', 1, true, 0, true, 'HQ', '{"intranet":"영업·수주 › 서면 인터뷰 · 분석"}'::jsonb),
  ('IV-REPORT', '인터뷰 리포트 기획', '인터뷰', 'd6ec347b-766a-427d-9aae-7957e830797f', '정리된 인터뷰 답을 모아 리포트 기획안(주제 · 대상 독자 · 목차 · 쓸 브랜드 · 근거 문항 · 도표 · 일정) 작성 · 팀이 확정하면 본문 작성은 사람', '월 · 목 10:41', 'claude-sonnet-5-5', '결재 없음 (팀 확정)', 1, true, 1, false, 'IV-DESK', '{"intranet":"영업·수주 › 서면 인터뷰 · 리포트"}'::jsonb)
on conflict (code) do update set name = excluded.name, group_name = excluded.group_name, duties = excluded.duties, schedule = excluded.schedule,
  model = excluded.model, approval_rule = excluded.approval_rule, active = true, is_lead = excluded.is_lead, lead_code = excluded.lead_code, updated_at = now();
