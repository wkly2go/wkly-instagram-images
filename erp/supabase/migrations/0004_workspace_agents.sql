-- =====================================================================
-- WKLY ERP 0004: 업무 공간 확장 + 에이전트 연동
--   - profiles.is_agent, 업무 일지 날짜 기본값(한국 시간), 승인 종류 '일일 보고'
--   - 승인 경로(approval_routes), 알림(notifications) + 알림 트리거 · 예약 작업
--   - 리서치 자료(research_items), 브랜드 연락처(brand_contacts), 메일 템플릿(email_templates)
--   - 에이전트 토큰(agent_tokens) + 에이전트 전용 함수(agent_submit, agent_snapshot)
--   - 지출 승인 → 결제 대장(payments) 자동 등록
-- 0001 ~ 0003 다음에 실행. 여러 번 실행해도 안전합니다.
--
-- Supabase 대시보드에서 할 일
--   - Database → Extensions → pg_cron 켜기 (5분마다 할 일 알람, 매일 09:00 요약 알림 예약용).
--     꺼져 있으면 예약 작업 등록만 건너뛰고 나머지는 그대로 적용됩니다 (켠 뒤 이 파일을 다시 실행).
--   - pgcrypto 는 Supabase 에 기본으로 켜져 있습니다 (extensions 스키마).
-- 관리자 현황 함수(admin_overview, 0003)는 이 파일의 테이블도 자동으로 집계합니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 확장: pgcrypto (에이전트 토큰 난수 생성용)
--    Supabase 는 extensions 스키마에 이미 있음. 없을 때만 설치를 시도하고, 실패하면 안내만 출력
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') then
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
  end if;
exception when others then
  raise notice 'pgcrypto 확장을 설치하지 못했습니다 (%). 에이전트 토큰을 만들기 전에 Database → Extensions 에서 pgcrypto 를 켜 주세요.', sqlerrm;
end;
$$;


-- ---------------------------------------------------------------------
-- 1. 기존 테이블 변경
-- ---------------------------------------------------------------------

-- 1-1. profiles.is_agent: 에이전트(자동화) 계정 표시. 변경 규칙은 6-1 트리거
alter table public.profiles add column if not exists is_agent boolean not null default false;

-- 1-2. work_logs.log_date 기본값: 한국 시간 기준 오늘
--      (DB 기본 시간대가 UTC 라 current_date 는 오전 9시 전까지 전날이 됨)
alter table public.work_logs alter column log_date set default ((now() at time zone 'Asia/Seoul')::date);

-- 1-3. approvals.kind: '일일 보고' 추가
alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals add constraint approvals_kind_check
  check (kind in ('업무 보고', '일일 보고', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타'));


-- ---------------------------------------------------------------------
-- 2. 새 테이블
-- ---------------------------------------------------------------------

-- 2-1. approval_routes (승인 종류별 기본 승인자)
create table if not exists public.approval_routes (
  kind         text primary key
               constraint approval_routes_kind_check
               check (kind in ('업무 보고', '일일 보고', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타')),
  approver_id  uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- 2-2. notifications (사용자별 알림). 클라이언트는 만들 수 없고 트리거·함수만 만듦
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null
              constraint notifications_kind_check
              check (kind in ('할 일', '알람', '승인', '일일 보고', '멘션', '시스템', '결제')),
  title       text not null,
  body        text,
  link        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

-- 2-3. research_items (리서치 자료: 팝업·브랜드·트렌드 등, 에이전트 수집 포함)
create table if not exists public.research_items (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null default '기타'
                      constraint research_items_kind_check
                      check (kind in ('팝업', '브랜드', '트렌드', '경쟁사', '인터뷰', '기타')),
  title               text not null,
  summary             text,
  body                text,
  source_url          text,
  source_name         text,
  brand_name          text,
  tags                text[] not null default '{}',
  status              text not null default '새 자료'
                      constraint research_items_status_check
                      check (status in ('새 자료', '검토 완료', '활용', '보관')),
  client_id           uuid references public.clients (id) on delete set null,
  project_id          uuid references public.projects (id) on delete set null,
  collected_by_agent  uuid references public.profiles (id) on delete set null,
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2-4. brand_contacts (브랜드 담당자 연락처, 영업·협업 제안용)
create table if not exists public.brand_contacts (
  id                  uuid primary key default gen_random_uuid(),
  brand_name          text not null,
  contact_name        text,
  title               text,
  email               text not null
                      constraint brand_contacts_email_check
                      check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone               text,
  source_type         text not null default '기타'
                      constraint brand_contacts_source_type_check
                      check (source_type in ('공식 홈페이지', '보도자료', '명함·미팅', '받은 메일', '소개', '에이전트 리서치', '기타')),
  source_url          text,
  source_note         text,
  status              text not null default '신규'
                      constraint brand_contacts_status_check
                      check (status in ('신규', '연락함', '회신', '미팅', '거래 전환', '보류')),
  opt_out             boolean not null default false,
  opt_out_at          timestamptz,
  client_id           uuid references public.clients (id) on delete set null,
  research_item_id    uuid references public.research_items (id) on delete set null,
  last_contacted_at   timestamptz,
  memo                text,
  tags                text[] not null default '{}',
  collected_by_agent  uuid references public.profiles (id) on delete set null,
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2-5. email_templates (메일 템플릿, {{브랜드}} {{담당자}} 자리 표시)
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null constraint email_templates_name_key unique,
  subject     text not null,
  body        text not null,
  is_ad       boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2-6. agent_tokens (에이전트 API 토큰 목록). 토큰 원문은 저장하지 않고,
--      해시는 클라이언트가 읽을 수 없는 agent_token_secrets 에 따로 보관
create table if not exists public.agent_tokens (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  profile_id    uuid references public.profiles (id) on delete set null,
  scopes        text[] not null
                constraint agent_tokens_scopes_check
                check (cardinality(scopes) > 0
                       and scopes <@ array['research', 'contact', 'task', 'daily_report', 'notify', 'read']::text[]),
  token_hint    text,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- 2-7. agent_token_secrets (토큰 sha256 해시). 권한·정책이 없어 security definer 함수만 접근
create table if not exists public.agent_token_secrets (
  token_id    uuid primary key references public.agent_tokens (id) on delete cascade,
  token_hash  text not null
              constraint agent_token_secrets_token_hash_key unique
              constraint agent_token_secrets_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);

-- 2-8. tasks: 알람 시각 / 알람 보낸 시각 / 리서치에서 만든 할 일
alter table public.tasks add column if not exists remind_at   timestamptz;
alter table public.tasks add column if not exists reminded_at timestamptz;
alter table public.tasks add column if not exists source_research_id uuid
  references public.research_items (id) on delete set null;


-- ---------------------------------------------------------------------
-- 3. 인덱스 (모든 FK 컬럼 + 조회용)
-- ---------------------------------------------------------------------
create index if not exists approval_routes_approver_id_idx        on public.approval_routes (approver_id);

-- (user_id, read_at, created_at desc) 가 user_id FK 인덱스 역할도 겸함
create index if not exists notifications_user_read_created_idx    on public.notifications (user_id, read_at, created_at desc);

create index if not exists research_items_client_id_idx           on public.research_items (client_id);
create index if not exists research_items_project_id_idx          on public.research_items (project_id);
create index if not exists research_items_collected_by_agent_idx  on public.research_items (collected_by_agent);
create index if not exists research_items_created_by_idx          on public.research_items (created_by);
create index if not exists research_items_status_created_idx      on public.research_items (status, created_at desc);

create unique index if not exists brand_contacts_email_key        on public.brand_contacts (lower(email));
create index if not exists brand_contacts_client_id_idx           on public.brand_contacts (client_id);
create index if not exists brand_contacts_research_item_id_idx    on public.brand_contacts (research_item_id);
create index if not exists brand_contacts_collected_by_agent_idx  on public.brand_contacts (collected_by_agent);
create index if not exists brand_contacts_created_by_idx          on public.brand_contacts (created_by);

create index if not exists email_templates_created_by_idx         on public.email_templates (created_by);

create index if not exists agent_tokens_profile_id_idx            on public.agent_tokens (profile_id);
create index if not exists agent_tokens_created_by_idx            on public.agent_tokens (created_by);

create index if not exists tasks_source_research_id_idx           on public.tasks (source_research_id);
-- 알람 예약 작업용: 아직 울리지 않은 알람만
create index if not exists tasks_remind_pending_idx               on public.tasks (remind_at) where reminded_at is null;


-- ---------------------------------------------------------------------
-- 4. 내부 도우미 함수 (클라이언트 호출 불가, 9 에서 EXECUTE 회수)
-- ---------------------------------------------------------------------

-- 4-1. notify: 알림 1건 생성. 비활성·에이전트 계정이면 만들지 않고 null 반환
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_user is null or not exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and p.active
      and not p.is_agent
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
  values (
    p_user,
    p_kind,
    left(coalesce(nullif(btrim(p_title), ''), p_kind), 200),
    left(p_body, 1000),
    left(p_link, 500)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 4-2. payload 읽기: 앞뒤 공백 제거, 최대 길이로 자름, 빈 값은 null
create or replace function public.payload_text(p_payload jsonb, p_key text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(p_payload ->> p_key), p_max), '');
$$;

-- 4-3. payload 의 uuid: 형식이 틀리면 null
create or replace function public.payload_uuid(p_payload jsonb, p_key text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
           when btrim(p_payload ->> p_key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then btrim(p_payload ->> p_key)::uuid
         end;
$$;

-- 4-4. payload 의 참조 id: 값이 있으면 p_table 에 있는 id 여야 함 (아니면 오류 22023)
create or replace function public.payload_ref(p_payload jsonb, p_key text, p_table regclass)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw  text    := public.payload_text(p_payload, p_key, 100);
  v_id   uuid    := public.payload_uuid(p_payload, p_key);
  v_ok   boolean := false;
begin
  if v_raw is null then
    return null;
  end if;

  if v_id is not null then
    execute pg_catalog.format('select exists (select 1 from %s x where x.id = $1)', p_table)
      into v_ok
      using v_id;
  end if;

  if not v_ok then
    raise exception 'payload.% 에 해당하는 항목이 없습니다: %', p_key, v_raw
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

-- 4-5. 에이전트 토큰 확인: 해시 일치 · 폐기 안 됨 · 연결 프로필 활성 · 권한(scope)
--      통과하면 last_used_at 을 갱신하고 연결 프로필 id 반환 (프로필 없는 토큰이면 null)
create or replace function public.agent_token_check(p_token text, p_scope text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok record;
begin
  if p_token is null or p_token !~ '^wkly_[0-9a-f]{48}$' then
    raise exception '유효하지 않은 토큰입니다.'
      using errcode = '28000';
  end if;

  select t.id, t.scopes, t.revoked_at, t.profile_id, p.active as profile_active
    into v_tok
  from public.agent_token_secrets s
  join public.agent_tokens t on t.id = s.token_id
  left join public.profiles p on p.id = t.profile_id
  where s.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  if not found then
    raise exception '유효하지 않은 토큰입니다.'
      using errcode = '28000';
  end if;
  if v_tok.revoked_at is not null then
    raise exception '폐기된 토큰입니다.'
      using errcode = '28000';
  end if;
  if v_tok.profile_id is not null and not v_tok.profile_active then
    raise exception '토큰에 연결된 프로필이 비활성 상태입니다.'
      using errcode = '28000';
  end if;
  if not (p_scope = any (v_tok.scopes)) then
    raise exception '이 토큰에는 "%" 권한(scope)이 없습니다.', p_scope
      using errcode = '42501';
  end if;

  update public.agent_tokens set last_used_at = now() where id = v_tok.id;

  return v_tok.profile_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. 트리거
-- ---------------------------------------------------------------------

-- 5-1. profiles.is_agent: 로그인 사용자 요청에서 관리자가 아니면 변경 불가 (role/active 와 같은 규칙)
--      0001 의 profiles_guard 를 덮어쓰지 않고 별도 트리거로 둠 → 0001 을 다시 실행해도 이 규칙 유지
create or replace function public.profiles_agent_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.is_agent is distinct from old.is_agent
     and not public.is_admin()
  then
    raise exception '에이전트 여부(is_agent)는 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_agent_guard on public.profiles;
create trigger profiles_agent_guard
  before update on public.profiles
  for each row execute function public.profiles_agent_guard();

-- 5-2. updated_at (0001 의 공용 함수)
drop trigger if exists set_updated_at on public.approval_routes;
create trigger set_updated_at
  before update on public.approval_routes
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.research_items;
create trigger set_updated_at
  before update on public.research_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.brand_contacts;
create trigger set_updated_at
  before update on public.brand_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.email_templates;
create trigger set_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- 5-3. 승인 요청 기본 승인자: 승인자를 비워 두면 승인 경로의 승인자로.
--      단, 그 승인자가 요청자 본인이거나 비활성이면 비워 둠 (→ 관리자 누구나 처리)
create or replace function public.approvals_apply_route()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_approver uuid;
begin
  if new.approver_id is null then
    select r.approver_id
      into v_approver
    from public.approval_routes r
    join public.profiles p on p.id = r.approver_id
    where r.kind = new.kind
      and p.active;

    if v_approver is distinct from new.requested_by then
      new.approver_id := v_approver;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists approvals_apply_route on public.approvals;
create trigger approvals_apply_route
  before insert on public.approvals
  for each row execute function public.approvals_apply_route();

-- 5-4. 승인 알림
--      요청 등록 → 승인자(없으면 요청자를 뺀 활성 관리자 전체)에게 '승인'('일일 보고'는 '일일 보고')
--      처리(승인/반려) → 요청자에게 (본인이 처리한 경우 제외)
create or replace function public.approvals_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text := case when new.kind = '일일 보고' then '일일 보고' else '승인' end;
  v_title  text;
  v_name   text;
  r        record;
begin
  if tg_op = 'INSERT' then
    if new.status <> '대기' then
      return null;
    end if;

    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name
    from public.profiles p where p.id = new.requested_by;

    v_title := case when new.kind = '일일 보고' then '일일 보고 도착' else '승인 요청' end || ' · ' || new.title;

    if new.approver_id is not null then
      if new.approver_id is distinct from new.requested_by then
        perform public.notify(new.approver_id, v_kind, v_title, coalesce(v_name, '누군가'), '/approvals');
      end if;
    else
      for r in
        select p.id
        from public.profiles p
        where p.role = 'admin'
          and p.active
          and not p.is_agent
          and p.id is distinct from new.requested_by
      loop
        perform public.notify(r.id, v_kind, v_title, coalesce(v_name, '누군가'), '/approvals');
      end loop;
    end if;

  elsif old.status = '대기'
        and new.status in ('승인', '반려')
        and new.requested_by is distinct from new.decided_by then
    select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name
    from public.profiles p where p.id = new.decided_by;

    v_title := case
                 when new.status = '반려' then '반려됨'
                 when new.kind = '일일 보고' then '확인됨'
                 else '승인됨'
               end || ' · ' || new.title;

    perform public.notify(
      new.requested_by, '승인', v_title,
      coalesce(nullif(btrim(new.decision_comment), ''), coalesce(v_name, '누군가') || '님이 처리했어요'),
      '/approvals?view=mine'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists approvals_notify on public.approvals;
create trigger approvals_notify
  after insert or update on public.approvals
  for each row execute function public.approvals_notify();

-- 5-5. 지출 승인 → 결제 대장 등록 (승인 1건당 1번만, payments.approval_id unique)
--      프로젝트: payload.project_id, 없으면 target_id 가 프로젝트일 때
--      category·payee·contract_type·stage·vat·은행 정보는 payload 에 있으면 사용 (잘못된 값은 무시)
--      금액이 비어 있거나 0 이면 등록하지 않음
create or replace function public.approvals_create_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload  jsonb := coalesce(new.payload, '{}'::jsonb);
  v_project  uuid;
  v_vat      bigint := 0;
  v_type     text;
begin
  if new.kind <> '지출'
     or new.status <> '승인'
     or old.status = '승인'
     or new.amount is null
     or new.amount = 0
  then
    return null;
  end if;

  v_project := public.payload_uuid(v_payload, 'project_id');
  if v_project is not null and not exists (select 1 from public.projects x where x.id = v_project) then
    v_project := null;
  end if;
  if v_project is null and new.target_id is not null
     and exists (select 1 from public.projects x where x.id = new.target_id) then
    v_project := new.target_id;
  end if;

  if btrim(v_payload ->> 'vat') ~ '^-?[0-9]{1,15}$' then
    v_vat := btrim(v_payload ->> 'vat')::bigint;
    if not (v_vat = 0 or (sign(v_vat) = sign(new.amount) and abs(v_vat) <= abs(new.amount))) then
      v_vat := 0;
    end if;
  end if;

  v_type := public.payload_text(v_payload, 'contract_type', 20);
  if v_type not in ('세금계산서', '계산서', '카드', '현금영수증', '사업소득(3.3%)', '일용근로', '4대보험 근로', '기타') then
    v_type := null;
  end if;

  insert into public.payments (
    direction, project_id, title, amount, vat, category, payee, contract_type, stage,
    bank_name, account_no, account_holder, requested_date, status, approval_id, memo, created_by
  ) values (
    '지급', v_project, new.title, new.amount, v_vat,
    public.payload_text(v_payload, 'category', 40),
    public.payload_text(v_payload, 'payee', 200),
    v_type,
    public.payload_text(v_payload, 'stage', 40),
    public.payload_text(v_payload, 'bank_name', 40),
    public.payload_text(v_payload, 'account_no', 40),
    public.payload_text(v_payload, 'account_holder', 60),
    (new.created_at at time zone 'Asia/Seoul')::date,
    '예정', new.id, '지출 승인에서 등록', new.requested_by
  )
  on conflict (approval_id) do nothing;

  return null;
end;
$$;

drop trigger if exists approvals_create_payment on public.approvals;
create trigger approvals_create_payment
  after update on public.approvals
  for each row execute function public.approvals_create_payment();

-- 5-6. tasks.reminded_at: 알람 시각(remind_at)을 바꾸면 다시 울리도록 비움
create or replace function public.tasks_reset_reminded_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.remind_at is distinct from old.remind_at then
    new.reminded_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_reset_reminded_at on public.tasks;
create trigger tasks_reset_reminded_at
  before update on public.tasks
  for each row execute function public.tasks_reset_reminded_at();

-- 5-7. 할 일 배정 알림: 담당자가 새로 정해지면 (본인이 본인에게 배정한 경우 제외)
create or replace function public.tasks_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.assignee_id is null or new.assignee_id is not distinct from auth.uid() then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.assignee_id is not distinct from old.assignee_id then
      return null;
    end if;
  end if;

  select coalesce(nullif(btrim(p.name), ''), '누군가') into v_name
  from public.profiles p where p.id = coalesce(auth.uid(), new.created_by);

  perform public.notify(
    new.assignee_id, '할 일',
    '새 할 일 배정 · ' || new.title,
    coalesce(v_name, '누군가') || '님이 배정했어요',
    '/projects?task=' || new.id
  );

  return null;
end;
$$;

drop trigger if exists tasks_notify_assignee on public.tasks;
create trigger tasks_notify_assignee
  after insert or update on public.tasks
  for each row execute function public.tasks_notify_assignee();

-- 5-8. 채팅 멘션 알림: 내용에 '@이름' 이 있는 활성 사용자에게 (보낸 사람 제외)
create or replace function public.chat_messages_notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender  text;
  v_room    text;
  r         record;
begin
  if strpos(new.content, '@') = 0 then
    return null;
  end if;

  select coalesce(nullif(btrim(p.name), ''), '누군가') into v_sender
  from public.profiles p where p.id = new.user_id;
  select c.name into v_room
  from public.chat_rooms c where c.id = new.room_id;

  for r in
    select p.id
    from public.profiles p
    where p.active
      and not p.is_agent
      and p.id is distinct from new.user_id
      and btrim(p.name) <> ''
      and strpos(new.content, '@' || p.name) > 0
  loop
    perform public.notify(
      r.id, '멘션',
      coalesce(v_sender, '누군가') || '님이 언급했어요 · ' || coalesce(v_room, '채팅'),
      left(new.content, 80),
      '/chat/' || new.room_id
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists chat_messages_notify_mentions on public.chat_messages;
create trigger chat_messages_notify_mentions
  after insert on public.chat_messages
  for each row execute function public.chat_messages_notify_mentions();

-- 5-9. research_items.created_by: 관리자가 아니면 바꿀 수 없음 (삭제 권한이 작성자 기준이므로)
create or replace function public.research_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.created_by is distinct from old.created_by
     and not public.is_admin()
  then
    raise exception '작성자(created_by)는 관리자만 바꿀 수 있습니다.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists research_items_guard on public.research_items;
create trigger research_items_guard
  before update on public.research_items
  for each row execute function public.research_items_guard();

-- 5-10. brand_contacts: 이메일은 소문자·공백 제거로 저장
--       수신 거부(opt_out)하면 opt_out_at 기록, 수신 거부 해제는 관리자만 (해제 시 opt_out_at 비움)
create or replace function public.brand_contacts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));

  if new.opt_out then
    new.opt_out_at := coalesce(new.opt_out_at, now());
  else
    if tg_op = 'UPDATE' then
      if old.opt_out and auth.uid() is not null and not public.is_admin() then
        raise exception '수신 거부(opt_out)는 관리자만 해제할 수 있습니다.'
          using errcode = '42501';
      end if;
    end if;
    new.opt_out_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists brand_contacts_guard on public.brand_contacts;
create trigger brand_contacts_guard
  before insert or update on public.brand_contacts
  for each row execute function public.brand_contacts_guard();

-- 5-11. agent_tokens: 폐기(revoked_at)는 되돌리거나 바꿀 수 없음 (새 토큰을 만들 것)
create or replace function public.agent_tokens_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at
  then
    raise exception '폐기한 토큰은 되살리거나 바꿀 수 없습니다. 새 토큰을 만드세요.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists agent_tokens_guard on public.agent_tokens;
create trigger agent_tokens_guard
  before update on public.agent_tokens
  for each row execute function public.agent_tokens_guard();


-- ---------------------------------------------------------------------
-- 6. 예약 작업 함수 (pg_cron, 12 참고)
-- ---------------------------------------------------------------------

-- 6-1. notify_due_tasks: 알람 시각이 지난 미완료 할 일 → 담당자(없으면 만든 사람)에게 '알람'
--      한 번 울린 할 일은 reminded_at 으로 표시해 다시 보내지 않음. 누가 몇 번 불러도 안전
--      반환: 보낸 알림 수
create or replace function public.notify_due_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r       record;
begin
  for r in
    update public.tasks t
       set reminded_at = now()
     where t.remind_at <= now()
       and t.reminded_at is null
       and t.status <> '완료'
    returning t.id, t.title, t.due_date, coalesce(t.assignee_id, t.created_by) as user_id
  loop
    if public.notify(
         r.user_id, '알람',
         '알람 · ' || r.title,
         case when r.due_date is not null then '마감 ' || to_char(r.due_date, 'MM.DD') end,
         '/projects?task=' || r.id
       ) is not null
    then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- 6-2. daily_digest (매일 09:00 KST): 반환값은 보낸 알림 수
--      사용자별: 오늘 마감이거나 기한이 지난 미완료 할 일 (담당자, 없으면 만든 사람) → '할 일' 1건
--      관리자: 지급 예정(오늘까지, 예정·대기) → '결제' 1건, 미수금(입금 예정일 지남) → '결제' 1건
--      예상 비용(is_estimate)은 제외
create or replace function public.daily_digest()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today     date    := (now() at time zone 'Asia/Seoul')::date;
  v_count     integer := 0;
  v_pay_n     bigint;
  v_pay_sum   bigint;
  v_recv_n    bigint;
  v_recv_sum  bigint;
  r           record;
begin
  for r in
    select coalesce(t.assignee_id, t.created_by) as user_id,
           count(*) filter (where t.due_date = v_today) as due_today,
           count(*) filter (where t.due_date < v_today) as overdue
    from public.tasks t
    where t.status <> '완료'
      and t.due_date <= v_today
      and coalesce(t.assignee_id, t.created_by) is not null
    group by 1
  loop
    if public.notify(
         r.user_id, '할 일',
         format('오늘 확인할 할 일 %s건', r.due_today + r.overdue),
         format('오늘 마감 %s건 · 기한 지남 %s건', r.due_today, r.overdue),
         '/projects?view=mine'
       ) is not null
    then
      v_count := v_count + 1;
    end if;
  end loop;

  select count(*), coalesce(sum(p.amount), 0)
    into v_pay_n, v_pay_sum
  from public.payments p
  where p.direction = '지급'
    and not p.is_estimate
    and p.status in ('예정', '대기')
    and p.due_date <= v_today;

  select count(*), coalesce(sum(p.amount), 0)
    into v_recv_n, v_recv_sum
  from public.payments p
  where p.direction = '수금'
    and not p.is_estimate
    and p.status in ('예정', '청구', '대기', '보류')
    and p.due_date < v_today;

  for r in
    select a.id
    from public.profiles a
    where a.role = 'admin'
      and a.active
      and not a.is_agent
  loop
    if v_pay_n > 0 then
      if public.notify(
           r.id, '결제',
           format('지급 예정 %s건 · 합계 %s원', v_pay_n, to_char(v_pay_sum, 'FM999,999,999,999,999,990')),
           '지급예정일이 오늘이거나 지났어요',
           '/finance'
         ) is not null
      then
        v_count := v_count + 1;
      end if;
    end if;

    if v_recv_n > 0 then
      if public.notify(
           r.id, '결제',
           format('미수금 %s건 · 합계 %s원', v_recv_n, to_char(v_recv_sum, 'FM999,999,999,999,999,990')),
           '입금 예정일이 지났어요',
           '/finance'
         ) is not null
      then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. 에이전트 함수
-- ---------------------------------------------------------------------

-- 7-1. admin_create_agent_token: 토큰 원문('wkly_' + 48자리 16진수)을 한 번만 돌려줌. 관리자 전용
--      p_profile_id: 에이전트가 쓴 글의 작성자가 될 프로필 (없어도 됨, 일일 보고는 프로필 필요)
create or replace function public.admin_create_agent_token(p_name text, p_scopes text[], p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema  text;
  v_token   text;
  v_scopes  text[];
  v_id      uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 에이전트 토큰을 만들 수 있습니다.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception '토큰 이름(p_name)을 입력하세요.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}'::text[])
    into v_scopes
  from unnest(coalesce(p_scopes, '{}'::text[])) as s;

  if cardinality(v_scopes) = 0
     or not (v_scopes <@ array['research', 'contact', 'task', 'daily_report', 'notify', 'read']::text[]) then
    raise exception '권한(p_scopes)은 research, contact, task, daily_report, notify, read 중에서 하나 이상 고르세요.'
      using errcode = '22023';
  end if;

  if p_profile_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_profile_id and p.active) then
    raise exception '연결할 프로필(p_profile_id)이 없거나 비활성 상태입니다.'
      using errcode = '22023';
  end if;

  -- pgcrypto 가 설치된 스키마(Supabase: extensions)를 찾아 난수 생성
  select n.nspname
    into v_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_schema is null then
    raise exception 'pgcrypto 확장이 필요합니다. Database → Extensions 에서 pgcrypto 를 켜 주세요.'
      using errcode = '55000';
  end if;

  execute pg_catalog.format('select pg_catalog.encode(%I.gen_random_bytes(24), %L)', v_schema, 'hex')
    into v_token;
  v_token := 'wkly_' || v_token;

  insert into public.agent_tokens (name, profile_id, scopes, token_hint, created_by)
  values (left(btrim(p_name), 100), p_profile_id, v_scopes, right(v_token, 4), auth.uid())
  returning id into v_id;

  insert into public.agent_token_secrets (token_id, token_hash)
  values (v_id, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex'));

  return v_token;
end;
$$;

-- 7-2. agent_submit: 에이전트가 자료를 넣는 단일 입구 (anon 키 + 토큰으로 호출)
--      p_kind: research | contact | task | daily_report | notify (토큰에 같은 이름의 scope 필요)
--      반환: {"ok": true, "kind": ..., "id": ...} (+ contact: "created", notify: "count")
--      오류: 28000 토큰 문제 · 42501 권한(scope) 없음 · 22023 kind/payload 문제
--      글자 수는 항목별 최대 길이로 자르고, payload 전체는 100,000자까지
create or replace function public.agent_submit(p_token text, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile  uuid;
  v_result   jsonb;
  v_title    text;
  v_text     text;
  v_value    text;
  v_user     uuid;
  v_date     date;
  v_ts       timestamptz;
  v_tags     text[];
  v_nid      bigint;
  v_count    integer := 0;
  v_exists   boolean;
  r          record;
begin
  if p_kind is null or p_kind not in ('research', 'contact', 'task', 'daily_report', 'notify') then
    raise exception '알 수 없는 kind 입니다: % (research, contact, task, daily_report, notify 중 하나)', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  -- 토큰 확인 (scope 이름 = kind)
  v_profile := public.agent_token_check(p_token, p_kind);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload 는 JSON 객체여야 합니다.'
      using errcode = '22023';
  end if;
  if length(p_payload::text) > 100000 then
    raise exception 'payload 가 너무 큽니다 (최대 100,000자).'
      using errcode = '22023';
  end if;

  -- tags: 문자열 배열, 최대 20개 · 각 40자
  select coalesce(array_agg(x.tag order by x.ord), '{}'::text[])
    into v_tags
  from (
    select left(btrim(e.value), 40) as tag, e.ord
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_payload -> 'tags') = 'array' then p_payload -> 'tags' else '[]'::jsonb end
         ) with ordinality as e(value, ord)
    where btrim(e.value) <> ''
    order by e.ord
    limit 20
  ) x;

  -- 1) 리서치 자료
  if p_kind = 'research' then
    v_title := public.payload_text(p_payload, 'title', 200);
    if v_title is null then
      raise exception 'payload.title 이 필요합니다.'
        using errcode = '22023';
    end if;
    v_value := coalesce(public.payload_text(p_payload, 'kind', 20), '기타');
    if v_value not in ('팝업', '브랜드', '트렌드', '경쟁사', '인터뷰', '기타') then
      raise exception 'payload.kind 는 팝업, 브랜드, 트렌드, 경쟁사, 인터뷰, 기타 중 하나여야 합니다: %', v_value
        using errcode = '22023';
    end if;

    insert into public.research_items (
      kind, title, summary, body, source_url, source_name, brand_name, tags,
      client_id, project_id, collected_by_agent, created_by
    ) values (
      v_value, v_title,
      public.payload_text(p_payload, 'summary', 2000),
      public.payload_text(p_payload, 'body', 20000),
      public.payload_text(p_payload, 'source_url', 2000),
      public.payload_text(p_payload, 'source_name', 200),
      public.payload_text(p_payload, 'brand_name', 200),
      v_tags,
      public.payload_ref(p_payload, 'client_id', 'public.clients'),
      public.payload_ref(p_payload, 'project_id', 'public.projects'),
      v_profile, v_profile
    )
    returning jsonb_build_object('ok', true, 'kind', p_kind, 'id', id) into v_result;

  -- 2) 브랜드 연락처: 이메일(소문자) 기준으로 합침. 비어 있는 칸만 채우고 수신 거부·상태는 건드리지 않음
  elsif p_kind = 'contact' then
    v_text := lower(public.payload_text(p_payload, 'email', 320));
    if v_text is null or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'payload.email 이 올바른 이메일 주소가 아닙니다.'
        using errcode = '22023';
    end if;
    v_title := public.payload_text(p_payload, 'brand_name', 200);
    if v_title is null then
      raise exception 'payload.brand_name 이 필요합니다.'
        using errcode = '22023';
    end if;
    v_value := coalesce(public.payload_text(p_payload, 'source_type', 20), '에이전트 리서치');
    if v_value not in ('공식 홈페이지', '보도자료', '명함·미팅', '받은 메일', '소개', '에이전트 리서치', '기타') then
      raise exception 'payload.source_type 은 공식 홈페이지, 보도자료, 명함·미팅, 받은 메일, 소개, 에이전트 리서치, 기타 중 하나여야 합니다: %', v_value
        using errcode = '22023';
    end if;

    v_exists := exists (select 1 from public.brand_contacts c where lower(c.email) = v_text);

    insert into public.brand_contacts as bc (
      brand_name, contact_name, title, email, phone, source_type, source_url, source_note,
      memo, tags, client_id, research_item_id, collected_by_agent, created_by
    ) values (
      v_title,
      public.payload_text(p_payload, 'contact_name', 100),
      public.payload_text(p_payload, 'title', 100),
      v_text,
      public.payload_text(p_payload, 'phone', 50),
      v_value,
      public.payload_text(p_payload, 'source_url', 2000),
      public.payload_text(p_payload, 'source_note', 2000),
      public.payload_text(p_payload, 'memo', 2000),
      v_tags,
      public.payload_ref(p_payload, 'client_id', 'public.clients'),
      public.payload_ref(p_payload, 'research_item_id', 'public.research_items'),
      v_profile, v_profile
    )
    on conflict ((lower(email))) do update set
      brand_name         = case when btrim(bc.brand_name) = '' then excluded.brand_name else bc.brand_name end,
      contact_name       = case when nullif(btrim(bc.contact_name), '') is null then excluded.contact_name else bc.contact_name end,
      title              = case when nullif(btrim(bc.title), '') is null then excluded.title else bc.title end,
      phone              = case when nullif(btrim(bc.phone), '') is null then excluded.phone else bc.phone end,
      source_url         = case when nullif(btrim(bc.source_url), '') is null then excluded.source_url else bc.source_url end,
      source_note        = case when nullif(btrim(bc.source_note), '') is null then excluded.source_note else bc.source_note end,
      memo               = case when nullif(btrim(bc.memo), '') is null then excluded.memo else bc.memo end,
      tags               = case when cardinality(bc.tags) = 0 then excluded.tags else bc.tags end,
      client_id          = coalesce(bc.client_id, excluded.client_id),
      research_item_id   = coalesce(bc.research_item_id, excluded.research_item_id),
      collected_by_agent = coalesce(bc.collected_by_agent, excluded.collected_by_agent)
    returning jsonb_build_object('ok', true, 'kind', p_kind, 'id', bc.id, 'created', not v_exists) into v_result;

  -- 3) 할 일: 날짜만 있는 시각(예: 2026-10-13T09:00)은 한국 시간으로 봄
  elsif p_kind = 'task' then
    v_title := public.payload_text(p_payload, 'title', 200);
    if v_title is null then
      raise exception 'payload.title 이 필요합니다.'
        using errcode = '22023';
    end if;

    v_user := public.payload_ref(p_payload, 'assignee_id', 'public.profiles');
    if v_user is not null and not exists (select 1 from public.profiles x where x.id = v_user and x.active) then
      raise exception 'payload.assignee_id 사용자가 비활성 상태입니다.'
        using errcode = '22023';
    end if;

    v_value := coalesce(public.payload_text(p_payload, 'status', 10), '할 일');
    if v_value not in ('할 일', '진행 중', '완료') then
      raise exception 'payload.status 는 할 일, 진행 중, 완료 중 하나여야 합니다: %', v_value
        using errcode = '22023';
    end if;

    v_text := public.payload_text(p_payload, 'due_date', 40);
    if v_text is not null then
      begin
        if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'bad date';
        end if;
        v_date := v_text::date;
      exception when others then
        raise exception 'payload.due_date 는 YYYY-MM-DD 형식이어야 합니다: %', v_text
          using errcode = '22023';
      end;
    end if;

    v_text := public.payload_text(p_payload, 'remind_at', 60);
    if v_text is not null then
      begin
        if v_text ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}(:?\d{2})?)$' then
          v_ts := v_text::timestamptz;
        elsif v_text ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then
          v_ts := v_text::timestamp at time zone 'Asia/Seoul';
        else
          raise exception 'bad timestamp';
        end if;
      exception when others then
        raise exception 'payload.remind_at 형식이 올바르지 않습니다 (예: 2026-10-13T09:00 = 한국 시간, 2026-10-13T09:00:00+09:00): %', v_text
          using errcode = '22023';
      end;
    end if;

    insert into public.tasks (
      project_id, title, assignee_id, due_date, status, memo, remind_at, source_research_id, created_by
    ) values (
      public.payload_ref(p_payload, 'project_id', 'public.projects'),
      v_title, v_user, v_date, v_value,
      public.payload_text(p_payload, 'memo', 2000),
      v_ts,
      public.payload_ref(p_payload, 'source_research_id', 'public.research_items'),
      v_profile
    )
    returning jsonb_build_object('ok', true, 'kind', p_kind, 'id', id) into v_result;

  -- 4) 일일 보고: 승인 요청(kind '일일 보고')으로 등록, payload 는 그대로 보관
  elsif p_kind = 'daily_report' then
    if v_profile is null then
      raise exception '일일 보고는 프로필이 연결된 토큰으로만 보낼 수 있습니다.'
        using errcode = '22023';
    end if;

    v_title := coalesce(
      public.payload_text(p_payload, 'title', 200),
      '일일 보고 ' || to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
    );

    insert into public.approvals (kind, title, content, payload, requested_by)
    values ('일일 보고', v_title, public.payload_text(p_payload, 'content', 20000), p_payload, v_profile)
    returning jsonb_build_object('ok', true, 'kind', p_kind, 'id', id) into v_result;

  -- 5) 알림: payload.user_id 한 명, 없으면 활성 관리자 전체
  else
    v_title := public.payload_text(p_payload, 'title', 200);
    if v_title is null then
      raise exception 'payload.title 이 필요합니다.'
        using errcode = '22023';
    end if;
    v_value := coalesce(public.payload_text(p_payload, 'kind', 20), '시스템');
    if v_value not in ('할 일', '알람', '승인', '일일 보고', '멘션', '시스템', '결제') then
      raise exception 'payload.kind 는 할 일, 알람, 승인, 일일 보고, 멘션, 시스템, 결제 중 하나여야 합니다: %', v_value
        using errcode = '22023';
    end if;
    v_text := public.payload_text(p_payload, 'link', 500);
    if v_text is not null and left(v_text, 1) <> '/' then
      raise exception 'payload.link 는 / 로 시작하는 앱 안의 경로여야 합니다: %', v_text
        using errcode = '22023';
    end if;

    v_user := public.payload_ref(p_payload, 'user_id', 'public.profiles');
    if v_user is not null then
      v_nid := public.notify(v_user, v_value, v_title, public.payload_text(p_payload, 'body', 2000), v_text);
      if v_nid is null then
        raise exception '알림을 받을 수 없는 사용자입니다 (비활성 또는 에이전트 계정).'
          using errcode = '22023';
      end if;
      v_count := 1;
    else
      for r in
        select a.id
        from public.profiles a
        where a.role = 'admin'
          and a.active
          and not a.is_agent
      loop
        if public.notify(r.id, v_value, v_title, public.payload_text(p_payload, 'body', 2000), v_text) is not null then
          v_count := v_count + 1;
        end if;
      end loop;
    end if;

    v_result := jsonb_build_object('ok', true, 'kind', p_kind, 'id', v_nid, 'count', v_count);
  end if;

  return v_result;
end;
$$;

-- 7-3. agent_snapshot: 에이전트용 오늘 현황 (scope 'read'). 금액 정보는 넣지 않음
--      today, projects(진행 중), tasks(7일 안 마감 또는 지난 미완료), pending_approvals(종류별 수),
--      work_logs_today(사람별 오늘 업무 일지 수), new_research(새 자료 수)
create or replace function public.agent_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  perform public.agent_token_check(p_token, 'read');

  return jsonb_build_object(
    'today', v_today,
    'projects', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'owner', o.name, 'end_date', p.end_date)
               order by p.end_date nulls last, p.name)
      from public.projects p
      left join public.profiles o on o.id = p.owner_id
      where p.status in ('기획', '진행')
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(x.item order by x.due_date, x.title)
      from (
        select t.due_date, t.title,
               jsonb_build_object(
                 'id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
                 'overdue', t.due_date < v_today, 'assignee', a.name,
                 'project_id', t.project_id, 'project', pr.name) as item
        from public.tasks t
        left join public.profiles a on a.id = t.assignee_id
        left join public.projects pr on pr.id = t.project_id
        where t.status <> '완료'
          and t.due_date <= v_today + 7
        order by t.due_date, t.title
        limit 200
      ) x
    ), '[]'::jsonb),
    'pending_approvals', coalesce((
      select jsonb_object_agg(s.kind, s.n)
      from (
        select a.kind, count(*) as n
        from public.approvals a
        where a.status = '대기'
        group by a.kind
      ) s
    ), '{}'::jsonb),
    'work_logs_today', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'user_id', p.id, 'name', p.name,
                 'count', (select count(*) from public.work_logs w where w.user_id = p.id and w.log_date = v_today))
               order by p.name)
      from public.profiles p
      where p.active
        and not p.is_agent
    ), '[]'::jsonb),
    'new_research', (select count(*) from public.research_items ri where ri.status = '새 자료')
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Row Level Security
--    (select fn()) 형태는 행마다가 아니라 쿼리당 1회만 평가되도록 하기 위함
-- ---------------------------------------------------------------------
alter table public.approval_routes     enable row level security;
alter table public.notifications       enable row level security;
alter table public.research_items      enable row level security;
alter table public.brand_contacts      enable row level security;
alter table public.email_templates     enable row level security;
alter table public.agent_tokens        enable row level security;
alter table public.agent_token_secrets enable row level security;   -- 정책 없음 = 클라이언트 접근 불가

-- 8-1. approval_routes: 활성 멤버 조회, 등록·수정·삭제는 관리자
drop policy if exists approval_routes_select on public.approval_routes;
create policy approval_routes_select on public.approval_routes
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists approval_routes_insert on public.approval_routes;
create policy approval_routes_insert on public.approval_routes
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists approval_routes_update on public.approval_routes;
create policy approval_routes_update on public.approval_routes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists approval_routes_delete on public.approval_routes;
create policy approval_routes_delete on public.approval_routes
  for delete to authenticated
  using ((select public.is_admin()));

-- 8-2. notifications: 본인 알림만 조회·삭제, 수정은 읽음 표시(read_at)만 (컬럼 권한, 9 참고)
--      등록 정책 없음 (트리거·함수만 등록)
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()))
  with check ((select public.is_active_member()) and user_id = (select auth.uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using ((select public.is_active_member()) and user_id = (select auth.uid()));

-- 8-3. research_items: 활성 멤버 조회·등록(본인 명의)·수정, 삭제는 작성자 또는 관리자
drop policy if exists research_items_select on public.research_items;
create policy research_items_select on public.research_items
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists research_items_insert on public.research_items;
create policy research_items_insert on public.research_items
  for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()));

drop policy if exists research_items_update on public.research_items;
create policy research_items_update on public.research_items
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists research_items_delete on public.research_items;
create policy research_items_delete on public.research_items
  for delete to authenticated
  using (
    (select public.is_active_member())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  );

-- 8-4. brand_contacts: 활성 멤버 조회·등록·수정, 삭제는 관리자
drop policy if exists brand_contacts_select on public.brand_contacts;
create policy brand_contacts_select on public.brand_contacts
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists brand_contacts_insert on public.brand_contacts;
create policy brand_contacts_insert on public.brand_contacts
  for insert to authenticated
  with check ((select public.is_active_member()));

drop policy if exists brand_contacts_update on public.brand_contacts;
create policy brand_contacts_update on public.brand_contacts
  for update to authenticated
  using ((select public.is_active_member()))
  with check ((select public.is_active_member()));

drop policy if exists brand_contacts_delete on public.brand_contacts;
create policy brand_contacts_delete on public.brand_contacts
  for delete to authenticated
  using ((select public.is_admin()));

-- 8-5. email_templates: 활성 멤버 조회·등록(본인 명의), 수정·삭제는 작성자 또는 관리자
drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates
  for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()));

drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates
  for update to authenticated
  using (
    (select public.is_active_member())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  )
  with check (
    (select public.is_active_member())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  );

drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates
  for delete to authenticated
  using (
    (select public.is_active_member())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  );

-- 8-6. agent_tokens: 관리자만 조회, 수정은 폐기(revoked_at)만 (컬럼 권한, 9 참고)
--      등록은 admin_create_agent_token() 으로만, 삭제 없음
drop policy if exists agent_tokens_select on public.agent_tokens;
create policy agent_tokens_select on public.agent_tokens
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists agent_tokens_update on public.agent_tokens;
create policy agent_tokens_update on public.agent_tokens
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- ---------------------------------------------------------------------
-- 9. 권한(GRANT)
--    Supabase 기본 권한(anon/authenticated 에 ALL)을 덮어씀. anon 은 테이블 권한 없음
--    (테이블 권한을 회수하면 컬럼 권한도 함께 회수되므로 다시 실행해도 같은 상태)
-- ---------------------------------------------------------------------
revoke all on table
  public.approval_routes, public.notifications, public.research_items, public.brand_contacts,
  public.email_templates, public.agent_tokens, public.agent_token_secrets
from anon, authenticated;

grant select, insert, update, delete on table
  public.approval_routes, public.research_items, public.brand_contacts, public.email_templates
to authenticated;

-- notifications: 조회·삭제 + 읽음 표시(read_at)만 수정. 등록 권한 없음
grant select, delete on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- agent_tokens: 조회 + 폐기(revoked_at)만 수정. agent_token_secrets 는 권한 없음
grant select on table public.agent_tokens to authenticated;
grant update (revoked_at) on table public.agent_tokens to authenticated;

-- identity 컬럼은 시퀀스 권한 없이도 insert 가능하므로 시퀀스 권한은 주지 않음
revoke all on sequence public.notifications_id_seq from anon, authenticated;

-- 클라이언트가 부르는 함수
revoke execute on function public.notify_due_tasks() from public, anon;
grant execute on function public.notify_due_tasks() to authenticated;

revoke execute on function public.admin_create_agent_token(text, text[], uuid) from public, anon;
grant execute on function public.admin_create_agent_token(text, text[], uuid) to authenticated;

-- 에이전트 함수: 토큰으로 인증하므로 anon 키로도 호출 가능
revoke execute on function public.agent_submit(text, text, jsonb), public.agent_snapshot(text) from public;
grant execute on function public.agent_submit(text, text, jsonb), public.agent_snapshot(text) to anon, authenticated;

-- 내부 전용 함수 (클라이언트 호출 불가)
revoke execute on function
  public.notify(uuid, text, text, text, text),
  public.daily_digest(),
  public.payload_text(jsonb, text, integer),
  public.payload_uuid(jsonb, text),
  public.payload_ref(jsonb, text, regclass),
  public.agent_token_check(text, text)
from public, anon, authenticated;

-- 트리거 전용 함수는 직접 호출할 필요가 없음 (트리거 실행에는 EXECUTE 권한 불필요)
revoke execute on function
  public.profiles_agent_guard(),
  public.approvals_apply_route(),
  public.approvals_notify(),
  public.approvals_create_payment(),
  public.tasks_reset_reminded_at(),
  public.tasks_notify_assignee(),
  public.chat_messages_notify_mentions(),
  public.research_items_guard(),
  public.brand_contacts_guard(),
  public.agent_tokens_guard()
from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 10. 기본 데이터: 메일 템플릿 2개 (이미 있으면 그대로)
--     광고성 메일(is_ad)의 제목 '(광고)' 표기와 수신거부 안내는 보낼 때 화면에서 붙임
-- ---------------------------------------------------------------------
insert into public.email_templates (name, subject, body, is_ad)
values
  (
    '첫 인사 (협업 제안)',
    '[더위클리] {{브랜드}} 협업 제안드립니다',
    $tpl$안녕하세요, {{브랜드}} {{담당자}}님.
팝업 기획 매거진 더위클리(THE WKLY)입니다.

{{브랜드}}의 최근 팝업과 캠페인을 인상 깊게 보고 연락드렸습니다.
더위클리는 팝업스토어와 브랜드 캠페인을 기획·운영하고, 주목할 만한 팝업을 매주 소개하고 있습니다.
{{브랜드}}와 함께 팝업이나 콘텐츠 협업을 진행할 수 있을지 제안드리고 싶습니다.

편하신 시간에 20분 정도 통화나 미팅이 가능하실지 회신 부탁드립니다.

감사합니다.
더위클리 드림$tpl$,
    true
  ),
  (
    '미팅 후 감사 인사',
    '[더위클리] {{브랜드}} 미팅 감사드립니다',
    $tpl$안녕하세요, {{담당자}}님.
더위클리(THE WKLY)입니다.

오늘 귀한 시간 내어 미팅해 주셔서 감사합니다.
나눈 이야기를 정리해 다음 단계 제안과 함께 곧 다시 연락드리겠습니다.
그 사이 궁금하신 점이 있으면 언제든 편하게 회신 주세요.

감사합니다.
더위클리 드림$tpl$,
    false
  )
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 11. Realtime: notifications 변경 사항 구독 허용 (publication 이 있고 아직 없을 때만)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 12. pg_cron 예약 작업 (pg_cron 이 켜져 있을 때만, 같은 이름은 지우고 다시 등록)
--     wkly_notify_due_tasks: 5분마다 할 일 알람
--     wkly_daily_digest:     매일 00:00 UTC = 09:00 KST 요약 알림
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron 이 켜져 있지 않아 예약 작업(5분마다 할 일 알람, 매일 09:00 요약)을 건너뜁니다. Database → Extensions 에서 pg_cron 을 켠 뒤 이 파일을 다시 실행하세요.';
    return;
  end if;

  execute $sql$
    select cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname in ('wkly_notify_due_tasks', 'wkly_daily_digest')
  $sql$;
  execute $sql$select cron.schedule('wkly_notify_due_tasks', '*/5 * * * *', 'select public.notify_due_tasks()')$sql$;
  execute $sql$select cron.schedule('wkly_daily_digest', '0 0 * * *', 'select public.daily_digest()')$sql$;
exception when others then
  raise notice 'pg_cron 예약 작업을 등록하지 못했습니다: %', sqlerrm;
end;
$$;


-- ---------------------------------------------------------------------
-- 13. 설명(comment)
-- ---------------------------------------------------------------------
comment on table public.approval_routes     is '승인 종류별 기본 승인자 (요청 시 승인자를 비워 두면 적용)';
comment on table public.notifications       is '사용자별 알림 (트리거·예약 작업이 생성, 본인만 조회·읽음 표시·삭제)';
comment on table public.research_items      is '리서치 자료 (팝업·브랜드·트렌드·경쟁사·인터뷰, 에이전트 수집 포함)';
comment on table public.brand_contacts      is '브랜드 연락처 (협업 제안·영업용, 이메일 기준 1건, 수신 거부 관리)';
comment on table public.email_templates     is '메일 템플릿 ({{브랜드}} {{담당자}} 자리 표시)';
comment on table public.agent_tokens        is '에이전트 API 토큰 (원문은 저장하지 않음, 관리자 전용)';
comment on table public.agent_token_secrets is '에이전트 토큰 sha256 해시 (클라이언트 접근 불가)';

comment on column public.profiles.is_agent              is '에이전트(자동화) 계정 여부 (관리자만 변경, 알림을 받지 않음)';
comment on column public.tasks.remind_at                is '알람 시각';
comment on column public.tasks.reminded_at              is '알람을 보낸 시각 (remind_at 을 바꾸면 비워져 다시 울림)';
comment on column public.tasks.source_research_id       is '이 할 일을 만든 리서치 자료';
comment on column public.approval_routes.approver_id    is '기본 승인자 (요청자 본인이거나 비활성이면 적용 안 함)';
comment on column public.notifications.kind             is '할 일 / 알람 / 승인 / 일일 보고 / 멘션 / 시스템 / 결제';
comment on column public.notifications.link             is '눌렀을 때 이동할 앱 안의 경로';
comment on column public.notifications.read_at          is '읽은 시각 (사용자가 바꿀 수 있는 유일한 칸)';
comment on column public.research_items.collected_by_agent is '자료를 수집한 에이전트 프로필';
comment on column public.brand_contacts.email           is '이메일 (소문자로 저장, 중복 불가)';
comment on column public.brand_contacts.opt_out         is '수신 거부 (해제는 관리자만)';
comment on column public.brand_contacts.opt_out_at      is '수신 거부 시각 (자동 기록)';
comment on column public.email_templates.is_ad          is '광고성 메일 여부 (보낼 때 제목 (광고) 표기 + 수신거부 안내)';
comment on column public.agent_tokens.scopes            is '권한: research, contact, task, daily_report, notify, read';
comment on column public.agent_tokens.token_hint        is '토큰 끝 4자리 (확인용)';
comment on column public.agent_tokens.revoked_at        is '폐기 시각 (한 번 폐기하면 되돌릴 수 없음)';
