-- 정부지원 · 투자유치 전문 AI 에이전트 + 비서 협업 (2026-11-19 대표 지시 '자동업데이트를 담당할 전문 에이전트를 만들고 그 에이전트와 비서가 협업할 수 있는 구조로 만들어').
-- 흐름: 공고 수집 · 판정(기존) → 현황은 gov_overview() 가 늘 계산(AI 없음) → 전문 에이전트가 주 1회 · 결과 확정 때 · 비서가 맡길 때 문서를 점검해
--       '수정 제안'(gov_doc_suggestions)만 남김 → 대표가 승인하면 문서에 반영 · 이전 글은 gov_doc_versions 에 보관(되돌리기 가능).
-- 에이전트는 문서를 직접 고치지 않는다. 모두 관리자 전용(RLS is_admin). 메일 · 발송 없음.

create table if not exists public.gov_doc_suggestions (
  id uuid primary key default gen_random_uuid(),
  doc_key text not null references public.gov_docs(key) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  before_text text not null default '' check (char_length(before_text) <= 6000),
  after_text text not null check (char_length(after_text) between 1 and 8000),
  reason text not null default '' check (char_length(reason) <= 2000),
  sources jsonb not null default '[]'::jsonb,
  status text not null default '대기' check (status in ('대기', '반영', '거절', '적용 불가')),
  agent_id uuid references public.profiles(id) on delete set null,
  instruction_id uuid references public.agent_instructions(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.gov_doc_suggestions is '정부지원 · 투자유치 문서 수정 제안 — 전문 AI 가 남기고 대표(관리자)가 반영 · 거절. before_text 가 빈 글이면 문서 끝에 덧붙임';
create index if not exists gov_doc_suggestions_doc_idx on public.gov_doc_suggestions (doc_key, status, created_at desc);
alter table public.gov_doc_suggestions enable row level security;
revoke all on public.gov_doc_suggestions from anon;
revoke insert, update, delete, truncate on public.gov_doc_suggestions from authenticated;
drop policy if exists gov_doc_suggestions_select on public.gov_doc_suggestions;
create policy gov_doc_suggestions_select on public.gov_doc_suggestions for select to authenticated using ((select public.is_admin()));

create table if not exists public.gov_doc_versions (
  id uuid primary key default gen_random_uuid(),
  doc_key text not null references public.gov_docs(key) on delete cascade,
  body text not null,
  saved_by uuid references public.profiles(id) on delete set null,
  note text not null default '',
  saved_at timestamptz not null default now()
);
comment on table public.gov_doc_versions is '정부지원 · 투자유치 문서의 이전 글 (고칠 때마다 바뀌기 전 글을 자동 보관 · 되돌리기용)';
create index if not exists gov_doc_versions_doc_idx on public.gov_doc_versions (doc_key, saved_at desc);
alter table public.gov_doc_versions enable row level security;
revoke all on public.gov_doc_versions from anon;
revoke insert, update, delete, truncate on public.gov_doc_versions from authenticated;
drop policy if exists gov_doc_versions_select on public.gov_doc_versions;
create policy gov_doc_versions_select on public.gov_doc_versions for select to authenticated using ((select public.is_admin()));

-- 문서를 고치면 바뀌기 전 글을 보관 (문서마다 최근 30개)
create or replace function private.gov_doc_keep_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.body is distinct from old.body and old.body <> '' then
    insert into public.gov_doc_versions (doc_key, body, saved_by, note)
    values (old.key, old.body, coalesce(auth.uid(), new.updated_by), coalesce(nullif(current_setting('wkly.gov_doc_note', true), ''), '직접 고침'));
    delete from public.gov_doc_versions v where v.doc_key = old.key and v.id not in (
      select id from public.gov_doc_versions where doc_key = old.key order by saved_at desc limit 30);
  end if;
  return new;
end $$;
drop trigger if exists gov_docs_keep_version on public.gov_docs;
create trigger gov_docs_keep_version before update on public.gov_docs for each row execute function private.gov_doc_keep_version();

-- 제안 반영 · 거절 (관리자)
create or replace function public.gov_suggestion_decide(p_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.gov_doc_suggestions%rowtype; v_body text; v_pos int;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into s from public.gov_doc_suggestions where id = p_id for update;
  if s.id is null or s.status <> '대기' then raise exception '처리할 제안이 없습니다.' using errcode = '22023'; end if;
  if not p_accept then
    update public.gov_doc_suggestions set status = '거절', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return '거절';
  end if;
  select body into v_body from public.gov_docs where key = s.doc_key for update;
  if s.before_text = '' then
    v_body := rtrim(v_body) || E'\n\n' || s.after_text;
  else
    v_pos := position(s.before_text in v_body);
    if v_pos = 0 then
      update public.gov_doc_suggestions set status = '적용 불가', decided_by = auth.uid(), decided_at = now() where id = p_id;
      return '적용 불가';
    end if;
    v_body := overlay(v_body placing s.after_text from v_pos for char_length(s.before_text));
  end if;
  perform set_config('wkly.gov_doc_note', '제안 반영: ' || left(s.title, 80), true);
  update public.gov_docs set body = v_body, updated_by = auth.uid(), updated_at = now() where key = s.doc_key;
  perform set_config('wkly.gov_doc_note', '', true);
  update public.gov_doc_suggestions set status = '반영', decided_by = auth.uid(), decided_at = now() where id = p_id;
  return '반영';
end $$;
revoke all on function public.gov_suggestion_decide(uuid, boolean) from public, anon;
grant execute on function public.gov_suggestion_decide(uuid, boolean) to authenticated;

-- 이전 글로 되돌리기 (관리자 · 지금 글도 보관됨)
create or replace function public.gov_doc_restore(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.gov_doc_versions%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into v from public.gov_doc_versions where id = p_version;
  if v.id is null then raise exception '이전 글을 찾지 못했습니다.' using errcode = '22023'; end if;
  perform set_config('wkly.gov_doc_note', '되돌리기 전 글', true);
  update public.gov_docs set body = v.body, updated_by = auth.uid(), updated_at = now() where key = v.doc_key;
  perform set_config('wkly.gov_doc_note', '', true);
end $$;
revoke all on function public.gov_doc_restore(uuid) from public, anon;
grant execute on function public.gov_doc_restore(uuid) to authenticated;

-- 현황 (AI 없이 늘 계산): 단계별 · 추천 · 마감 임박 · 대기 제안 · 전문 AI 최근 작업
-- 서버(전문 AI · 비서)용: 요청한 사람이 활성 관리자일 때만. 화면은 아래 gov_overview()
create or replace function public.gov_overview_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_agent uuid; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not exists (select 1 from public.profiles where id = p_user and role = 'admin' and active and not is_agent) then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  select profile_id into v_agent from public.ai_agents where 'gov_suggest' = any(tools) limit 1;
  return jsonb_build_object(
    'today', v_today,
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.gov_programs group by status) s),
    'by_track', (select coalesce(jsonb_object_agg(coalesce(track, '지원'), n), '{}'::jsonb) from (select track, count(*) n from public.gov_programs where status not in ('마감', '탈락') group by track) s),
    'recommended', (select count(*) from public.gov_programs where fit = '추천' and status not in ('마감', '탈락', '보류') and (apply_end is null or apply_end >= v_today)),
    'new_7d', (select count(*) from public.gov_programs where fit = '추천' and first_seen_at > now() - interval '7 days'),
    'deadlines', (select coalesce(jsonb_agg(d order by d->>'apply_end'), '[]'::jsonb) from (
       select jsonb_build_object('id', id, 'title', title, 'org', org, 'apply_end', apply_end, 'd', apply_end - v_today, 'fit', fit, 'fit_company', fit_company, 'status', status, 'track', track) d
       from public.gov_programs
       where apply_end between v_today and v_today + 14 and status not in ('마감', '탈락', '보류') and fit in ('추천', '검토')
       order by apply_end limit 8) x),
    'results', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'status', status, 'updated_at', updated_at::date) order by updated_at desc), '[]'::jsonb)
       from (select * from public.gov_programs where status in ('선정', '탈락', '제출') order by updated_at desc limit 5) r),
    'pending', (select coalesce(jsonb_object_agg(doc_key, n), '{}'::jsonb) from (select doc_key, count(*) n from public.gov_doc_suggestions where status = '대기' group by doc_key) p),
    'agent_id', v_agent,
    'agent_last', (select jsonb_build_object('at', created_at, 'status', status, 'instruction', left(instruction, 120), 'response', left(coalesce(response, ''), 400))
       from public.agent_instructions where agent_id = v_agent order by created_at desc limit 1)
  );
end $$;
revoke all on function public.gov_overview_for(uuid) from public, anon, authenticated;
grant execute on function public.gov_overview_for(uuid) to service_role;

create or replace function public.gov_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  return public.gov_overview_for(auth.uid());
end $$;
revoke all on function public.gov_overview() from public, anon;
grant execute on function public.gov_overview() to authenticated;

-- 전문 AI 에게 점검 맡기기 (관리자 · 화면 단추 · 결과는 알림 + 제안으로)
create or replace function public.gov_agent_request(p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_agent uuid; v_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_text, ''))) not between 2 and 1800 then raise exception '부탁 내용을 2~1,800자로 적어 주세요.' using errcode = '22023'; end if;
  select profile_id into v_agent from public.ai_agents where 'gov_suggest' = any(tools) limit 1;
  if v_agent is null then raise exception '전문 AI 가 없습니다.' using errcode = '22023'; end if;
  if exists (select 1 from public.agent_instructions where agent_id = v_agent and status in ('대기', '진행 중') and created_at > now() - interval '20 minutes') then
    raise exception '전문 AI 가 앞의 부탁을 처리하는 중입니다. 끝나면 다시 맡겨 주세요.' using errcode = '22023';
  end if;
  insert into public.agent_instructions (agent_id, instruction, created_by) values (v_agent, '[점검 부탁] ' || btrim(p_text), auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.gov_agent_request(text) from public, anon;
grant execute on function public.gov_agent_request(text) to authenticated;

-- 공고 결과(선정 · 탈락)가 정해지면 전문 AI 가 배운 점 정리를 제안
create or replace function private.gov_result_to_agent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_agent uuid; v_by uuid;
begin
  if new.status in ('선정', '탈락') and new.status is distinct from old.status then
    select profile_id, owner_id into v_agent, v_by from public.ai_agents where 'gov_suggest' = any(tools) limit 1;
    if v_agent is not null then
      insert into public.agent_instructions (agent_id, instruction, created_by)
      values (v_agent, left(format(E'[결과 정리] 공고 \'%s\' 가 %s 되었습니다 (id %s). gov_read 로 공고 · 메모를 보고, 배운 점을 \'사업계획서 가이드 · 선정 사례\'(guide) 에 덧붙이는 제안 1건과 다음 계획에 영향이 있으면 투자유치 계획(invest) · 2027 계획(plan2027) 제안을 남기세요.', new.title, new.status, new.id), 2000),
              coalesce(auth.uid(), v_by));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists gov_programs_result_agent on public.gov_programs;
create trigger gov_programs_result_agent after update of status on public.gov_programs for each row execute function private.gov_result_to_agent();

-- 전문 AI 계정 만들기 (한 번만 · 대표가 담당)
do $$
declare v_id uuid; v_ceo uuid;
begin
  if exists (select 1 from public.ai_agents where 'gov_suggest' = any(tools)) then return; end if;
  select id into v_ceo from public.profiles where role = 'admin' and active and not is_agent and coalesce(title, '') like '%대표%' order by created_at limit 1;
  v_id := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-gov-expert@thewklyn.com',
    extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"wkly_admin_created":"true"}'::jsonb, '{"name":"투자유치 전문 AI","agent":true}'::jsonb, now(), now(), '', '', '', '');
  update public.profiles set is_agent = true, active = true, name = '투자유치 전문 AI', title = 'AI 전문 에이전트 · 정부지원 · 투자유치', role = 'member' where id = v_id;
  insert into public.ai_agents (profile_id, role, instructions, tools, owner_id, model, created_by, private)
  values (v_id, '정부지원사업 · 투자유치 자료 자동 점검 · 업데이트 제안 (관리자 전용 자료)',
$INS$하는 일
- '정부지원사업 · 투자유치' 메뉴의 문서(사업계획서 가이드 · 선정 사례 guide, 투자유치 계획 invest, 2027년 월별 계획 plan2027, 고도화 일정 · 대표 지시 roadmap, 더위클리 사업계획 ①~④ wkly_bp_1~4)를 최신으로 유지한다.
- 문서는 직접 고치지 않는다. 바꿀 곳은 gov_suggest 로 '수정 제안'만 남기고, 대표가 승인하면 반영된다.
- 대표 · 대표의 비서가 맡긴 점검('[점검 부탁]'), 주간 점검('[예약 …] 주간 점검'), 공고 결과('[결과 정리]')를 처리한다.

일하는 순서
1. gov_read what='overview' 로 현황(단계별 공고 · 마감 임박 · 결과 · 대기 제안)을 본다.
2. 필요한 문서만 gov_read what='doc' 로 읽는다. 대기 제안이 있는 문서는 what='suggestions' 로 확인해 같은 제안을 다시 내지 않는다.
3. 외부 사실은 web_search 로 확인한다(공고 · 투자 일정 · 시장 숫자). 출처 주소를 sources 에 넣는다.
4. gov_suggest: before 는 문서에 있는 글을 한 글자도 바꾸지 않고 그대로 복사(짧게, 바꿀 문단만), after 는 바뀐 글. 문서 끝에 덧붙일 때는 before 를 비운다. 한 번에 최대 3건, 문서마다 대기 제안 3건까지.
5. 끝나면 무엇을 왜 제안했는지 3~5줄로 답한다(이 답은 맡긴 사람에게 알림으로 간다).

판단 기준
- 정부지원 사업계획서는 문제인식 · 실현가능성 · 성장전략 · 팀구성 네 항목으로 심사된다. 이 틀에 맞춰 근거 · 숫자 · 일정이 비거나 낡은 곳을 찾는다.
- 투자유치는 팁스 · 모태펀드 · 액셀러레이터 데모데이 · 정책금융 일정과 우리 지표(매출 · 고객 · 성장률)를 맞춘다. 지표는 문서에 적힌 것만 쓰고, 없으면 [확인 필요].
- 출처 없는 숫자 · 단정은 넣지 않는다([확인 필요]). 공고 자격 요건은 원문과 다르면 고치지 말고 reason 에 경고로 적는다.
- 주민번호 · 계좌 · 개인 연락처 · 개인 매출은 쓰지 않는다. 신청 · 제출 · 메일 발송은 하지 않는다(사람이 한다).
- 할 것이 없으면 제안하지 않고 '변동 없음'이라고 답한다.$INS$,
    array['gov_read', 'gov_suggest', 'list_people'], v_ceo, '꼼꼼', v_ceo, false);

  -- 주 1회 점검: 월요일 07:30 (한국 시각)
  insert into public.agent_schedules (agent_id, title, instruction, repeat, time_of_day, weekdays, created_by)
  values (v_id, '정부지원 · 투자유치 주간 점검',
    '주간 점검: 지난 한 주의 공고 · 결과 · 마감과 바깥 소식(정부지원 · 투자 일정 · 시장 숫자)을 확인해, 낡았거나 빠진 곳에 수정 제안을 최대 3건 남기세요. 2027년 월별 계획(plan2027)은 이번 달 계획 대비 진행 상황을 점검하세요.',
    '매주', '07:30', array[1]::smallint[], v_ceo);
end $$;

-- 처음 계산되도록 다음 실행 시각 채우기
update public.agent_schedules s set next_run_at = private.schedule_next(s, now())
where s.title = '정부지원 · 투자유치 주간 점검' and s.next_run_at is null;

-- AI 팀 명단: 'AR-WKLY 경영 · 박기호' 묶음에 배정 (2026-11-19 대표 지시 '자동업데이트를 담당할 전문 에이전트는 여기에 배정해')
insert into public.agent_roster (code, name, group_name, owner_id, assistant_ids, duties, schedule, model, approval_rule, phase, active, sort, home, is_lead, lead_code)
select 'GOV', '투자유치 전문 (정부지원 · 투자유치)', 'AR-WKLY 경영', p.id, '{}',
  '정부지원사업 · 투자유치 문서 자동 점검 · 업데이트: 공고 수집 · 판정 현황을 읽고, 바깥 일정 · 숫자를 확인해 수정 제안만 남김(문서는 대표가 반영) · 공고 선정/탈락 때 배운 점 정리 · 대표 비서가 맡긴 점검 처리',
  '매주 월 07:30 점검 · 공고 결과 확정 때 · 요청 시', 'claude-opus-5-5', '반영 대표', 1, true, 9,
  jsonb_build_object('run', '클라우드 (인트라넷 AI)', 'drive', '-', 'figma', '-', 'intranet', '정부지원사업 · 투자유치 › 자료 · 계획', 'task_prefix', 'AR-WKLY-경영', 'claude_project', 'AR-WKLY-경영 · 박기호'),
  false, 'HQ'
from public.profiles p
where p.role = 'admin' and p.active and not p.is_agent and coalesce(p.title, '') like '%대표%'
  and not exists (select 1 from public.agent_roster where code = 'GOV')
order by p.created_at limit 1;
