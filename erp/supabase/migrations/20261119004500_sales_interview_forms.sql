-- 인터뷰지 DB (2026-11-19 대표 지시 '인터뷰지 db 작업 시작해') — 서면 인터뷰 2단계: 구글 폼을 대신할 인트라넷 인터뷰지
-- 지금까지는 브랜드마다 구글 폼을 새로 만들었다(19개): 틀은 같고(4구역 · Q1~Q10 · Q3 예산 고르기 · Q10 필수) 질문 글만 브랜드에 맞춰 고침.
--  public.sales_interview_questions : 질문 은행 — 자리(Q1~Q10)마다 기본 문안과 다른 문안. {브랜드} · {팝업} · {기간} · {장소} 를 채워 쓴다
--  public.sales_interview_forms     : 브랜드별 인터뷰지 한 부 — 안내문 · 일정 · 그 브랜드에 맞춘 질문 10개(그때 글 그대로 보관) · 받은 답
-- 브랜드 담당자는 로그인 없이 링크(토큰)로만 연다: interview_form_get / interview_form_submit (그 인터뷰지 하나만 · 표는 직접 못 봄).
-- 답을 내면 서면 인터뷰(sales_interviews)의 답 · 단계에 반영하고 담당자에게 알린다. 메일 발송 없음. 지우는 것 없음.
create table if not exists public.sales_interview_questions (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot ~ '^Q([1-9]|10)$'),
  section text not null,
  title text not null,
  body text not null check (char_length(body) between 5 and 2000),
  help text not null default '',
  kind text not null default 'long' check (kind in ('long', 'choice')),
  options jsonb not null default '[]',
  use text not null default '콘텐츠' check (use in ('콘텐츠', '영업')),
  required boolean not null default false,
  variant text not null default '기본',
  is_default boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_interview_questions_default on public.sales_interview_questions (slot) where is_default and active;
create unique index if not exists sales_interview_questions_variant on public.sales_interview_questions (slot, variant);

create table if not exists public.sales_interview_forms (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.sales_interviews (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  title text not null,
  intro text not null default '',
  due_on date,
  upload_on date,
  questions jsonb not null default '[]' check (jsonb_typeof(questions) = 'array'),
  status text not null default '작성 중' check (status in ('작성 중', '열림', '제출', '닫힘')),
  opened_at timestamptz,
  first_seen_at timestamptz,
  submitted_at timestamptz,
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  respondent text,
  respondent_contact text,
  image_consent text,
  submit_count integer not null default 0,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_interview_questions enable row level security;
alter table public.sales_interview_forms enable row level security;
do $$ declare t text; begin
  foreach t in array array['sales_interview_questions', 'sales_interview_forms'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select using ((select public.is_active_member()))', t || '_select', t);
      execute format('create policy %I on public.%I for insert with check ((select public.is_active_member()))', t || '_insert', t);
      execute format('create policy %I on public.%I for update using ((select public.is_active_member())) with check ((select public.is_active_member()))', t || '_update', t);
      execute format('create policy %I on public.%I for delete using ((select public.is_admin()))', t || '_delete', t);
    end if;
  end loop;
end $$;
revoke all on table public.sales_interview_questions, public.sales_interview_forms from anon;
grant select, insert, update, delete on table public.sales_interview_questions, public.sales_interview_forms to authenticated;

-- 링크로 인터뷰지 열기 (로그인 없음): 열려 있는 인터뷰지의 안내문 · 질문 · 이미 낸 답만 준다. 내부용 표시(use)는 주지 않는다
create or replace function public.interview_form_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.sales_interview_forms; b text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into f from public.sales_interview_forms where token = p_token;
  if not found or f.status = '작성 중' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if f.first_seen_at is null then update public.sales_interview_forms set first_seen_at = now() where id = f.id; end if;
  select brand into b from public.sales_interviews where id = f.interview_id;
  return jsonb_build_object('ok', true, 'brand', b, 'title', f.title, 'intro', f.intro, 'due_on', f.due_on, 'upload_on', f.upload_on,
    'closed', f.status = '닫힘', 'submitted_at', f.submitted_at, 'answers', f.answers, 'respondent', f.respondent, 'image_consent', f.image_consent,
    'questions', (select coalesce(jsonb_agg(q - 'use' order by ord), '[]'::jsonb) from jsonb_array_elements(f.questions) with ordinality as x(q, ord)));
end $$;

-- 답 내기 (로그인 없음 · 닫히기 전까지 고쳐 낼 수 있음): 필수 문항 · 고르기 문항 · 길이를 서버에서 다시 본다
create or replace function public.interview_form_submit(p_token text, p_answers jsonb, p_respondent text, p_contact text, p_image_consent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.sales_interview_forms; q jsonb; a text; clean jsonb := '{}'::jsonb; iv public.sales_interviews; v_stage text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into f from public.sales_interview_forms where token = p_token for update;
  if not found or f.status = '작성 중' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if f.status = '닫힘' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if f.submit_count >= 30 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_answers'); end if;
  for q in select * from jsonb_array_elements(f.questions) loop
    a := btrim(coalesce(p_answers->>(q->>'no'), ''));
    if char_length(a) > 5000 then return jsonb_build_object('ok', false, 'reason', 'too_long', 'no', q->>'no'); end if;
    if a = '' and coalesce((q->>'required')::boolean, false) then return jsonb_build_object('ok', false, 'reason', 'required', 'no', q->>'no'); end if;
    if a <> '' and q->>'kind' = 'choice' and not (q->'options') ? a then return jsonb_build_object('ok', false, 'reason', 'bad_choice', 'no', q->>'no'); end if;
    if a <> '' then clean := clean || jsonb_build_object(q->>'no', a); end if;
  end loop;
  if clean = '{}'::jsonb then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  update public.sales_interview_forms set answers = clean, status = '제출', submitted_at = now(), submit_count = submit_count + 1,
    respondent = nullif(left(btrim(coalesce(p_respondent, '')), 80), ''), respondent_contact = nullif(left(btrim(coalesce(p_contact, '')), 120), ''),
    image_consent = nullif(left(btrim(coalesce(p_image_consent, '')), 200), ''), updated_at = now()
  where id = f.id;
  select * into iv from public.sales_interviews where id = f.interview_id;
  v_stage := case when iv.stage in ('발송', '답장 없음', '확인 필요', '답변', '인터뷰지 발송') then '자료 수령' else iv.stage end;
  update public.sales_interviews set answers = clean, answered_at = now(), stage = v_stage,
    answered_note = left('인트라넷 인터뷰지로 받음' || coalesce(' · ' || nullif(left(btrim(coalesce(p_respondent, '')), 80), ''), ''), 200),
    image_use = coalesce(nullif(left(btrim(coalesce(p_image_consent, '')), 200), ''), image_use)
  where id = iv.id;
  if iv.owner_id is not null then
    perform public.notify(iv.owner_id, '알람', left('인터뷰 답 도착 · ' || iv.brand, 120), left(iv.brand || ' 담당자가 인터뷰지에 답을 냈습니다 (' || (select count(*) from jsonb_object_keys(clean)) || '개 문항).', 300), '/sales?interview=' || iv.id);
  end if;
  return jsonb_build_object('ok', true, 'answered', (select count(*) from jsonb_object_keys(clean)));
end $$;
revoke all on function public.interview_form_get(text) from public;
revoke all on function public.interview_form_submit(text, jsonb, text, text, text) from public;
grant execute on function public.interview_form_get(text) to anon, authenticated;
grant execute on function public.interview_form_submit(text, jsonb, text, text, text) to anon, authenticated;

-- 질문 은행 기본 문안: 지금 쓰는 구글 폼의 틀(4구역 · Q1~Q10)을 브랜드 이름 · 팝업 · 기간 · 장소를 채워 쓰게 풀어 적은 것.
-- 브랜드마다 인터뷰지를 만들 때 이 글에서 시작해 그 팝업에 맞게 고친다. '은(는)' · '을(를)' 같은 토씨는 채울 때 받침에 맞춰진다(lib/interviewForms.ts).
insert into public.sales_interview_questions (slot, section, title, body, help, kind, options, use, required, variant, is_default, sort)
select v.slot, v.section, v.title, v.body, v.help, v.kind, v.options::jsonb, v.use, v.required, '기본', true, v.sort
from (values
  ('Q1', '브랜드 철학 및 팝업 기획 의도', '브랜드 소개 · 철학', '{브랜드}은(는) 어떤 브랜드인가요? 브랜드를 대표하는 컬러와 브랜딩(로고 · 네이밍 · 비주얼)에 담긴 의미, 가장 중요하게 생각하는 철학과 지향하는 방향을 자유롭게 적어 주세요.', '예: 브랜드가 시작된 배경, 핵심 가치, 고객에게 주고 싶은 경험', 'long', '[]', '콘텐츠', false, 1),
  ('Q2', '브랜드 철학 및 팝업 기획 의도', '팝업 기획 계기 · 공간을 고른 이유', '{기간} {장소}에서 여는 {팝업}을(를) 기획하게 된 계기와 이 공간을 고른 이유는 무엇인가요? Q1의 브랜드 정체성을 이번 팝업에 어떻게 녹였는지도 함께 들려주세요.', '예: 컬러 활용, 공간 구성과 장면 연출, 소품 · 제품 구성', 'long', '[]', '콘텐츠', false, 2),
  ('Q3', '공간 구성 및 체험 연출', '전체 예산 규모', '이번 팝업의 전체 예산 규모(공간 임차 · 기획 · 시공 · 운영 포함)를 공유 가능한 범위에서 골라 주세요. 내부 참고용으로만 쓰며 콘텐츠에 싣지 않습니다.', '', 'choice', '["1,500만원 미만","1,500만원 이상 ~ 3,000만원 미만","3,000만원 이상 ~ 5,000만원 미만","5,000만원 이상 ~ 7,000만원 미만","7,000만원 이상 ~ 1억원 미만","1억원 이상"]', '영업', false, 3),
  ('Q4', '공간 구성 및 체험 연출', '공간 구현의 중점 요소 · 키 포인트 공간', '{팝업}의 콘셉트를 공간에 구현할 때 가장 중점을 둔 요소(레이아웃 · 컬러 · 세트와 소품 · 조명 등)는 무엇인가요? 제작 기간 · 시공 방식 · 공간 조건 때문에 조정한 부분과, {브랜드}의 정체성이 가장 잘 드러나는 키 포인트 공간(Key Space)도 소개해 주세요.', '', 'long', '[]', '콘텐츠', false, 4),
  ('Q5', '공간 구성 및 체험 연출', '방문객 동선 · 체류 · 촬영', '방문객이 공간을 둘러보고 체험하는 동선은 어떻게 설계했나요? 구역 순서와 체류 시간, 포토존과 촬영 허용 범위를 정한 기준이 있다면 알려 주세요.', '예: 동선 방향, 구역별 소요 시간, 포토존 배치, 대기 인원 관리', 'long', '[]', '콘텐츠', false, 5),
  ('Q6', '마케팅 및 고객 접점', '제품 · 콘텐츠와 팝업 콘셉트의 연결', '제품(또는 콘텐츠) 소개를 팝업 콘셉트와 어떻게 연결했나요? 노출 위치와 비중을 정한 기준, 방문객의 이해와 구매로 이어지게 하는 장치가 있다면 소개해 주세요.', '예: SNS 사전 공개, 현장 이벤트, 구매 혜택', 'long', '[]', '콘텐츠', false, 6),
  ('Q7', '마케팅 및 고객 접점', '현장 운영 · 협업', '방문객이 몰리는 시간대의 현장 운영(입장 접수 · 대기 안내 · 인원 관리)과 운영 인력 구성, 안전 관리는 어떻게 준비했나요? 함께한 파트너가 있다면 역할을 어떻게 나눴는지도 알려 주세요.', '', 'long', '[]', '콘텐츠', false, 7),
  ('Q8', '인사이트 및 향후 비전', '방문객 반응 · 운영 중 조정', '운영하면서 예상과 달랐던 방문객 반응이나 변수는 무엇이었고, 그에 따라 보완하거나 조정한 부분이 있나요? 이번 팝업에서 기대하는 전환점도 함께 들려주세요.', '', 'long', '[]', '콘텐츠', false, 8),
  ('Q9', '인사이트 및 향후 비전', '실무자에게 주는 조언', '팝업을 준비하는 실무자(공간 디자이너 · 마케터)에게 기획 · 제작 · 오픈 일정과 사전 점검 항목을 중심으로 조언을 부탁드립니다. 준비하면서 가장 어려웠던 점과 해결한 방법도 알려 주세요.', '', 'long', '[]', '콘텐츠', false, 9),
  ('Q10', '인사이트 및 향후 비전', '향후 계획 · 파트너 선정 기준', '{브랜드}의 추가 팝업 등 앞으로의 오프라인 전개 방향과, 기획사 · 대행사 · 협업 파트너를 고를 때 가장 중요하게 보는 기준을 알려 주세요.', '', 'long', '[]', '영업', true, 10)
) v(slot, section, title, body, help, kind, options, use, required, sort)
on conflict (slot, variant) do nothing;
notify pgrst, 'reload schema';
