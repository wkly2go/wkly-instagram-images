-- =====================================================================
-- WKLY ERP 0003: 재무(프로젝트 계약 금액·실행 예산, 결제 대장) + 관리자 현황 함수
-- 0001_init.sql, 0002_minihompy.sql 다음에 실행. 여러 번 실행해도 안전합니다.
--
-- - 금액은 모두 원(KRW) 단위 정수입니다.
--   · payments.amount = 실제 이체 금액(부가세가 있으면 포함), payments.vat = 그중 부가세,
--     공급가액 = amount - vat. 환불·차감은 음수로 기록합니다.
--   · project_finances.contract_amount 와 실행 예산(project_budget_lines)은 공급가액(부가세 별도)입니다.
-- - 금액 정보는 활성 관리자(role = 'admin')만 조회·등록·수정·삭제할 수 있습니다.
--   프로젝트 행은 모든 멤버가 보기 때문에 금액은 projects 컬럼이 아니라
--   별도 테이블(project_finances, project_budget_lines, payments)에 둡니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 1-1. project_finances (프로젝트 재무 정보, projects 와 1:1)
create table if not exists public.project_finances (
  project_id       uuid primary key references public.projects (id) on delete cascade,
  contract_amount  bigint
                   constraint project_finances_contract_amount_check
                   check (contract_amount is null or contract_amount >= 0),
  budget_cost      bigint
                   constraint project_finances_budget_cost_check
                   check (budget_cost is null or budget_cost >= 0),
  target_margin    numeric(5, 2)
                   constraint project_finances_target_margin_check
                   check (target_margin is null or target_margin between -100 and 100),
  memo             text,
  updated_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 1-2. project_budget_lines (실행 예산: 공사 구분별 예산·업체 계약금, 공급가액 기준)
create table if not exists public.project_budget_lines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  category         text not null
                   constraint project_budget_lines_category_check check (char_length(category) <= 40),
  item             text,
  payee            text,
  budget_amount    bigint not null default 0
                   constraint project_budget_lines_budget_amount_check check (budget_amount >= 0),
  contract_amount  bigint
                   constraint project_budget_lines_contract_amount_check
                   check (contract_amount is null or contract_amount >= 0),
  sort_order       int not null default 0,
  memo             text,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 1-3. payments (결제 대장: 회사 엑셀 결제 대장과 같은 구성)
--      수금: 클라이언트에게 받을 돈 / 지급: 협력사·작업자 등에 줄 돈
--      approval_id 는 0004 의 지출 승인 트리거가 채움 (승인 1건당 결제 1건)
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  direction         text not null
                    constraint payments_direction_check check (direction in ('수금', '지급')),
  project_id        uuid references public.projects (id) on delete set null,
  client_id         uuid references public.clients (id) on delete set null,
  budget_line_id    uuid references public.project_budget_lines (id) on delete set null,
  approval_id       uuid references public.approvals (id) on delete set null
                    constraint payments_approval_id_key unique,
  category          text
                    constraint payments_category_check check (category is null or char_length(category) <= 40),
  title             text not null,
  payee             text,
  contract_type     text
                    constraint payments_contract_type_check
                    check (contract_type is null or contract_type in (
                      '세금계산서', '계산서', '카드', '현금영수증', '사업소득(3.3%)', '일용근로', '4대보험 근로', '기타')),
  stage             text
                    constraint payments_stage_check check (stage is null or char_length(stage) <= 40),
  amount            bigint not null,
  vat               bigint not null default 0,
  tax_invoice       text not null default '미발행'
                    constraint payments_tax_invoice_check check (tax_invoice in ('발행', '미발행', '해당 없음')),
  tax_invoice_date  date,
  status            text not null default '예정'
                    constraint payments_status_check
                    check (status in ('예정', '청구', '대기', '완료', '보류', '취소')),
  is_estimate       boolean not null default false,
  requested_date    date default ((now() at time zone 'Asia/Seoul')::date),
  due_date          date,
  paid_date         date,
  advance_by        text,
  bank_name         text
                    constraint payments_bank_name_check check (bank_name is null or char_length(bank_name) <= 40),
  account_no        text
                    constraint payments_account_no_check check (account_no is null or char_length(account_no) <= 40),
  account_holder    text
                    constraint payments_account_holder_check
                    check (account_holder is null or char_length(account_holder) <= 60),
  memo              text,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- 부가세는 0 이거나, 금액과 부호가 같고 절댓값이 금액 이하
  constraint payments_vat_check
    check (vat = 0 or (sign(vat) = sign(amount) and abs(vat) <= abs(amount)))
);


-- ---------------------------------------------------------------------
-- 2. 인덱스 (모든 FK 컬럼 + 조회용)
-- ---------------------------------------------------------------------
-- project_finances.project_id 는 PK 라 별도 인덱스 불필요
create index if not exists project_finances_updated_by_idx      on public.project_finances (updated_by);

-- (project_id, sort_order) 가 project_id FK 인덱스 역할도 겸함
create index if not exists project_budget_lines_project_id_idx  on public.project_budget_lines (project_id, sort_order);
create index if not exists project_budget_lines_created_by_idx  on public.project_budget_lines (created_by);

-- (project_id, category) 가 project_id FK 인덱스, payments_approval_id_key(unique) 가 approval_id 인덱스 역할도 겸함
create index if not exists payments_project_category_idx        on public.payments (project_id, category);
create index if not exists payments_client_id_idx               on public.payments (client_id);
create index if not exists payments_budget_line_id_idx          on public.payments (budget_line_id);
create index if not exists payments_created_by_idx              on public.payments (created_by);
create index if not exists payments_status_due_date_idx         on public.payments (status, due_date);


-- ---------------------------------------------------------------------
-- 3. 트리거
-- ---------------------------------------------------------------------

-- 3-1. updated_at (0001 의 공용 함수 public.set_updated_at 사용)
drop trigger if exists set_updated_at on public.project_finances;
create trigger set_updated_at
  before update on public.project_finances
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.project_budget_lines;
create trigger set_updated_at
  before update on public.project_budget_lines
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.payments;
create trigger set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- 3-2. project_finances.updated_by: 로그인 사용자가 등록하거나 내용(금액·마진·메모)을 바꾸면
--      그 사용자로 기록. 화면이 예전 updated_by 값을 그대로 다시 보내도 실제 수정자가 남음
--      (auth.uid() 가 없는 SQL Editor / service_role 은 입력값 유지,
--       수정자 계정 삭제로 on delete set null 이 적용될 때는 내용이 그대로라 null 유지)
create or replace function public.project_finances_set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.updated_by := auth.uid();
    elsif (to_jsonb(new) - array['updated_by', 'updated_at'])
          is distinct from
          (to_jsonb(old) - array['updated_by', 'updated_at']) then
      new.updated_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists project_finances_set_updated_by on public.project_finances;
create trigger project_finances_set_updated_by
  before insert or update on public.project_finances
  for each row execute function public.project_finances_set_updated_by();

-- 3-3. payments.paid_date: '완료'가 되면 (비어 있을 때만) 오늘 날짜를 기록, '완료'가 아니면 비움
--      직접 입력한 입금·지급일은 그대로 유지
--      DB 기본 시간대는 UTC 라 current_date 대신 한국 시간(Asia/Seoul) 기준 날짜 사용
create or replace function public.payments_set_paid_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = '완료' then
    new.paid_date := coalesce(new.paid_date, (now() at time zone 'Asia/Seoul')::date);
  else
    new.paid_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_set_paid_date on public.payments;
create trigger payments_set_paid_date
  before insert or update on public.payments
  for each row execute function public.payments_set_paid_date();

-- 3-4. payments.due_date: 지급 건의 지급예정일이 비어 있으면 결제요청일 기준 차주 월요일
--      (월요일 요청 → +7일, 화요일 → +6일, 일요일 → +1일). 직접 입력한 값은 그대로
create or replace function public.payments_set_due_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.direction = '지급' and new.due_date is null and new.requested_date is not null then
    new.due_date := new.requested_date + (8 - extract(isodow from new.requested_date))::int;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_set_due_date on public.payments;
create trigger payments_set_due_date
  before insert or update on public.payments
  for each row execute function public.payments_set_due_date();


-- ---------------------------------------------------------------------
-- 4. Row Level Security: 금액 정보는 활성 관리자만 (조회 포함)
--    (select fn()) 형태는 행마다가 아니라 쿼리당 1회만 평가되도록 하기 위함
-- ---------------------------------------------------------------------
alter table public.project_finances     enable row level security;
alter table public.project_budget_lines enable row level security;
alter table public.payments             enable row level security;

-- 4-1. project_finances: 관리자만 조회/등록/수정/삭제
drop policy if exists project_finances_select on public.project_finances;
create policy project_finances_select on public.project_finances
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists project_finances_insert on public.project_finances;
create policy project_finances_insert on public.project_finances
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists project_finances_update on public.project_finances;
create policy project_finances_update on public.project_finances
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists project_finances_delete on public.project_finances;
create policy project_finances_delete on public.project_finances
  for delete to authenticated
  using ((select public.is_admin()));

-- 4-2. project_budget_lines: 관리자만 조회/등록/수정/삭제
drop policy if exists project_budget_lines_select on public.project_budget_lines;
create policy project_budget_lines_select on public.project_budget_lines
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists project_budget_lines_insert on public.project_budget_lines;
create policy project_budget_lines_insert on public.project_budget_lines
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists project_budget_lines_update on public.project_budget_lines;
create policy project_budget_lines_update on public.project_budget_lines
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists project_budget_lines_delete on public.project_budget_lines;
create policy project_budget_lines_delete on public.project_budget_lines
  for delete to authenticated
  using ((select public.is_admin()));

-- 4-3. payments: 관리자만 조회/등록/수정/삭제
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using ((select public.is_admin()));


-- ---------------------------------------------------------------------
-- 5. 관리자 현황: DB 용량, 활성 멤버 수, 테이블별 행 수
--    security definer: RLS 와 무관하게 전체 행 수를 세기 위함 (관리자 확인 후에만)
--    0004 의 테이블도 목록에 있으며, 아직 없는 테이블은 건너뜀
--    (0003 만 실행해도, 0003 을 0004 뒤에 다시 실행해도 같은 결과)
--    예) supabase.rpc('admin_overview')
-- ---------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tables  jsonb := '{}'::jsonb;
  v_name    text;
  v_count   bigint;
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다.'
      using errcode = '42501';
  end if;

  foreach v_name in array array[
    'profiles', 'clients', 'contacts', 'projects', 'tasks', 'work_logs',
    'chat_rooms', 'chat_messages', 'approvals', 'payments', 'project_budget_lines',
    'approval_routes', 'notifications', 'research_items', 'brand_contacts',
    'email_templates', 'agent_tokens'
  ] loop
    if pg_catalog.to_regclass('public.' || v_name) is not null then
      execute pg_catalog.format('select count(*) from public.%I', v_name) into v_count;
      v_tables := v_tables || jsonb_build_object(v_name, v_count);
    end if;
  end loop;

  return jsonb_build_object(
    'db_size_bytes',  pg_catalog.pg_database_size(current_database()),
    'active_members', (select count(*) from public.profiles p where p.active),
    'tables',         v_tables,
    'generated_at',   now()
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 6. 권한(GRANT)
--    Supabase 기본 권한(anon/authenticated 에 ALL)을 덮어써서
--    authenticated 는 select/insert/update/delete 만, anon 은 아무것도 없음.
-- ---------------------------------------------------------------------
revoke all on table
  public.project_finances, public.project_budget_lines, public.payments
from anon, authenticated;

grant select, insert, update, delete on table
  public.project_finances, public.project_budget_lines, public.payments
to authenticated;

revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- 트리거 전용 함수는 직접 호출할 필요가 없음 (트리거 실행에는 EXECUTE 권한 불필요)
revoke execute on function
  public.project_finances_set_updated_by(),
  public.payments_set_paid_date(),
  public.payments_set_due_date()
from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. 설명(comment)
-- ---------------------------------------------------------------------
comment on table public.project_finances     is '프로젝트 재무 정보 (projects 와 1:1, 계약 금액·예산·목표 마진, 공급가액 기준, 관리자 전용)';
comment on table public.project_budget_lines is '실행 예산 (공사 구분별 예산·업체 계약금, 공급가액 기준, 관리자 전용)';
comment on table public.payments             is '결제 대장 (수금·지급, 금액은 부가세 포함 실제 이체액, 관리자 전용)';

comment on column public.project_finances.contract_amount  is '계약 금액(원, 공급가액·부가세 별도)';
comment on column public.project_finances.budget_cost      is '예상 비용·예산(원, 공급가액·부가세 별도)';
comment on column public.project_finances.target_margin    is '목표 마진율(%, -100 ~ 100)';
comment on column public.project_finances.updated_by       is '마지막 수정자 (로그인 사용자가 등록하거나 내용을 바꾸면 자동 기록)';

comment on column public.project_budget_lines.category        is '공사 구분 (예: 목공, 전기, 운영비, 노무비), 40자 이내';
comment on column public.project_budget_lines.item            is '세부 항목';
comment on column public.project_budget_lines.payee           is '업체명';
comment on column public.project_budget_lines.budget_amount   is '실행 예산(원, 공급가액)';
comment on column public.project_budget_lines.contract_amount is '업체 계약금(원, 공급가액)';
comment on column public.project_budget_lines.sort_order      is '표시 순서';

comment on column public.payments.direction        is '수금: 클라이언트에게 받는 돈 / 지급: 협력사·작업자 등에 주는 돈';
comment on column public.payments.project_id       is '관련 프로젝트 (프로젝트 삭제 시 null, 결제 내역은 유지)';
comment on column public.payments.client_id        is '상대 거래처';
comment on column public.payments.budget_line_id   is '연결된 실행 예산 항목';
comment on column public.payments.approval_id      is '이 결제를 만든 지출 승인 요청 (승인 1건당 1건)';
comment on column public.payments.category         is '공사 구분 (예: 목공, 전기, 운영비, 노무비), 40자 이내';
comment on column public.payments.title            is '항목 (세부내용)';
comment on column public.payments.payee            is '업체명 또는 성명';
comment on column public.payments.contract_type    is '계약형태(증빙): 세금계산서·계산서·카드·현금영수증·사업소득(3.3%)·일용근로·4대보험 근로·기타';
comment on column public.payments.stage            is '지급 단계 (계약금·선금·중도금·잔금·추가·환불 등), 40자 이내';
comment on column public.payments.amount           is '실제 이체 금액(원, 부가세 포함), 환불·차감은 음수';
comment on column public.payments.vat              is 'amount 중 부가세(원). 공급가액 = amount - vat';
comment on column public.payments.tax_invoice      is '세금계산서 발행·수취 상태: 발행 / 미발행 / 해당 없음';
comment on column public.payments.tax_invoice_date is '세금계산서 발행일';
comment on column public.payments.status           is '예정 → 청구(수금) / 대기 → 완료, 보류, 취소';
comment on column public.payments.is_estimate      is '예상 비용 (아직 실제 결제가 아님)';
comment on column public.payments.requested_date   is '결제요청일 (기본값: 오늘, 한국 시간)';
comment on column public.payments.due_date         is '지급·입금 예정일 (지급은 비워 두면 결제요청일 기준 차주 월요일)';
comment on column public.payments.paid_date        is '실제 입금·지급일 (완료로 바꿀 때 비어 있으면 오늘(한국 시간)로 자동 기록, 완료가 아니면 비움)';
comment on column public.payments.advance_by       is '대지급자 (현장소장 등이 먼저 결제한 경우, 상태는 그 사람에게 정산했는지)';
comment on column public.payments.bank_name        is '은행명, 40자 이내';
comment on column public.payments.account_no       is '계좌번호, 40자 이내';
comment on column public.payments.account_holder   is '예금주, 60자 이내';
