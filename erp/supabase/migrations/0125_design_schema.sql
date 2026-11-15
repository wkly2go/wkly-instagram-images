-- 0125 설계·견적 구역(design): 아트리어 인테리어 디자인 자동화 프로그램을 인트라넷에 합친다.
--  - 기존 표는 하나도 바꾸지 않는다. 새 구역 design 과 public.design_* 보기만 추가한다.
--  - 되돌리기: drop schema design cascade; (보기도 같이 지워짐) + drop function public.design_po_lines_for_site(uuid); + drop owned by design_worker; drop role design_worker;
--  - 로그인 · 사람 · 프로젝트 · 거래처는 인트라넷 것(public.profiles · projects · clients)을 그대로 쓴다.
--  - 실행 단가 · 발주(금액)는 관리자만 본다. 판매 단가 · 수량 · 견적은 팀원 모두 본다.
--  - 화면은 public.design_* 보기로 읽고 쓴다(보기는 부른 사람 권한으로 동작 · security_invoker).
--  - 작업 처리기(맥)는 design_worker 계정으로만 접속한다. 비밀번호는 여기 적지 않는다.
begin;

create schema design;
revoke all on schema design from public;
grant usage on schema design to authenticated, service_role;

-- ─────────────────────────────── 열거형
create type design.space_type as enum ('popup', 'retail', 'flagship', 'booth', 'office');
create type design.project_stage as enum (
  'survey', 'plan', 'draft3d', 'proposal', 'meeting', 'model',
  'estimate', 'drawings', 'purchase', 'sitelog', 'done');
create type design.variant_kind as enum ('economy', 'standard', 'premium');
create type design.qty_source as enum ('model', 'manual');
create type design.po_status as enum ('draft', 'sent', 'accepted', 'partially_received', 'received', 'settled', 'cancelled');
create type design.approval_status as enum ('pending', 'approved', 'rejected');
create type design.job_status as enum ('queued', 'running', 'done', 'failed');
create type design.sample_grade as enum ('exemplary', 'normal', 'bad');
create type design.log_entry_kind as enum ('work', 'manpower', 'delivery', 'photo', 'issue', 'safety');

-- ─────────────────────────────── 기준 정보
create table design.trades (
  code text primary key,
  name text not null unique,
  group_name text not null,
  sort int not null,
  synonyms text[] not null default '{}',
  required_for design.space_type[] not null default '{}'
);

create table design.units (
  standard text primary key,
  kind text not null,
  synonyms text[] not null default '{}'
);

-- 협력사: 인트라넷 거래처(public.clients)와 이어 쓴다. 나라장터 등에서 찾은 곳은 후보(candidate).
create table design.vendors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  name text not null,
  biz_no text,
  trades text[] not null default '{}',
  contact_name text,
  phone text,
  email text,
  payment_terms text,
  avg_lead_days int,
  notes text,
  status text not null default 'partner' check (status in ('partner', 'candidate')),
  source_url text,
  source_note text,
  region text,
  created_at timestamptz not null default now()
);
create index vendors_status on design.vendors (status);
create index vendors_client on design.vendors (client_id);

create table design.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  spec text,
  color_code text,
  unit text references design.units(standard),
  supplier_id uuid references design.vendors(id),
  product_url text,
  image_path text,
  alternative_ids uuid[] not null default '{}',
  notes text,
  source_note text,
  list_price numeric(14,0),
  price_as_of date,
  created_at timestamptz not null default now()
);

create table design.components (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  trade_code text not null references design.trades(code),
  space_types design.space_type[] not null default '{}',
  unit text not null references design.units(standard),
  dims jsonb not null default '{}',
  bom jsonb not null default '[]',
  skp_path text,
  detail_block text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 판매 단가(견적용). 팀원 모두 본다.
create table design.unit_prices (
  id uuid primary key default gen_random_uuid(),
  trade_code text not null references design.trades(code),
  item text not null,
  spec text not null default '',
  unit text not null references design.units(standard),
  variant design.variant_kind not null default 'standard',
  sell_price numeric(14,0) not null check (sell_price >= 0),
  component_id uuid references design.components(id),
  effective_date date not null,
  source_project_code text,
  source_doc text,
  approved boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index unit_prices_lookup on design.unit_prices (trade_code, item, spec, unit, variant, effective_date desc);

-- 실행 단가(발주용). 관리자만 본다.
create table design.unit_costs (
  id uuid primary key default gen_random_uuid(),
  trade_code text not null references design.trades(code),
  item text not null,
  spec text not null default '',
  unit text not null references design.units(standard),
  cost_price numeric(14,0) not null check (cost_price >= 0),
  vendor_id uuid references design.vendors(id),
  effective_date date not null,
  source_doc text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index unit_costs_lookup on design.unit_costs (trade_code, item, spec, unit, effective_date desc);

create table design.rules (
  key text primary key,
  value jsonb not null,
  version text not null,
  updated_at timestamptz not null default now()
);

create table design.proposal_templates (
  id uuid primary key default gen_random_uuid(),
  space_type design.space_type not null,
  version int not null,
  sections jsonb not null,
  active boolean not null default true,
  unique (space_type, version)
);

-- ─────────────────────────────── 프로젝트(인트라넷 프로젝트에 붙는 설계 정보)
-- 이름 · 코드 · 거래처 · 주소 · 기간은 public.projects 가 원본이다. 여기에는 설계에만 필요한 값만 둔다.
create table design.projects (
  id uuid primary key references public.projects(id) on delete cascade,
  space_type design.space_type not null default 'retail',
  area_m2 numeric(10,2),
  budget numeric(14,0),
  work_start date,                    -- 착공일(공정표 기준). 비우면 public.projects.start_date
  stage design.project_stage not null default 'survey',
  model_version int not null default 0,
  share_consent boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table design.spaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  version int not null,
  source text not null check (source in ('lidar', 'sketch', 'manual')),
  geometry jsonb not null,
  ref_dims jsonb not null default '[]',
  calibration jsonb,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table design.placements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  model_version int not null,
  component_id uuid references design.components(id),
  trade_code text not null references design.trades(code),
  item text not null,
  spec text not null default '',
  unit text not null references design.units(standard),
  qty numeric(14,3) not null check (qty >= 0),
  dims jsonb not null default '{}',
  material_id uuid references design.materials(id),
  location text,
  source design.qty_source not null default 'model',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index placements_project on design.placements (project_id, model_version);

create table design.estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  revision int not null,
  variant design.variant_kind not null default 'standard',
  model_version int,
  rules_version text not null,
  totals jsonb not null,
  warnings jsonb not null default '[]',
  file_xlsx text,
  file_pdf text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, revision, variant)
);

create table design.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references design.estimates(id) on delete cascade,
  trade_code text not null references design.trades(code),
  item text not null,
  spec text not null default '',
  unit text not null references design.units(standard),
  qty numeric(14,3) not null,
  unit_price numeric(14,0),
  amount numeric(14,0),
  placement_id uuid references design.placements(id) on delete set null,
  price_source uuid references design.unit_prices(id) on delete set null,
  source design.qty_source not null,
  sort int not null default 0
);
create index estimate_lines_estimate on design.estimate_lines (estimate_id);

create table design.schedule_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  trade_code text references design.trades(code),
  name text not null,
  start_date date not null,
  end_date date not null,
  weight numeric(6,3) not null default 1,
  predecessor_ids uuid[] not null default '{}',
  done boolean not null default false
);
create index schedule_tasks_project on design.schedule_tasks (project_id);

-- 발주(금액 포함)는 관리자만
create table design.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  vendor_id uuid not null references design.vendors(id),
  po_number text not null unique,
  revision int not null default 1,
  status design.po_status not null default 'draft',
  estimate_id uuid references design.estimates(id) on delete set null,
  issue_date date,
  due_date date,
  delivery_place text,
  delivery_terms text,
  inspection text,
  payment_terms text,
  total numeric(14,0) not null default 0,
  file_pdf text,
  supersedes uuid references design.purchase_orders(id),
  created_at timestamptz not null default now()
);

create table design.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references design.purchase_orders(id) on delete cascade,
  estimate_line_id uuid references design.estimate_lines(id) on delete set null,
  trade_code text not null references design.trades(code),
  item text not null,
  spec text not null default '',
  unit text not null references design.units(standard),
  qty numeric(14,3) not null,
  cost_price numeric(14,0),
  amount numeric(14,0),
  received_qty numeric(14,3) not null default 0
);
create index po_lines_po on design.po_lines (po_id);

create table design.change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  reason text not null,
  before_amount numeric(14,0),
  after_amount numeric(14,0),
  status design.approval_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table design.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  kind text not null check (kind in ('proposal', 'estimate', 'progress', 'internal')),
  held_at timestamptz,
  deck_path text,
  audio_path text,
  minutes text,
  decisions jsonb not null default '[]',
  todos jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table design.proposal_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  template_id uuid references design.proposal_templates(id),
  section_key text not null,
  body text,
  figures jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'checked', 'blank')),
  updated_at timestamptz not null default now(),
  unique (project_id, section_key)
);

create table design.research_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references design.projects(id) on delete cascade,
  url text,
  title text,
  provider text,
  accessed_at timestamptz not null default now(),
  as_of date,
  extracted jsonb not null default '{}'
);

-- 산출물(견적서 · 도면 세트 · 스펙북 · 제안서 · 설계 보고서 · 납품 묶음)
create table design.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references design.projects(id) on delete cascade,
  kind text not null,
  version int not null,
  file_path text not null,
  source_model_version int,
  issued boolean not null default false,
  created_at timestamptz not null default now()
);
create index documents_project on design.documents (project_id, kind, version desc);

-- ─────────────────────────────── 검토함과 작업 대기열
-- 설계 구역 안의 검토 카드(단가 가져오기 · 견적 확정 · 발주 발송 준비). 회사 결재(public.approvals)와는 따로이며
-- 밖으로 나가는 것은 회사 결재로 한 번 더 올린다(다음 단계에서 연결).
create table design.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references design.projects(id) on delete cascade,
  kind text not null,
  ref_table text,
  ref_id uuid,
  title text not null,
  payload jsonb not null default '{}',
  diff jsonb,
  external boolean not null default false,
  status design.approval_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  comment text
);
create index approvals_pending on design.approvals (status, requested_at);

create table design.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  project_id uuid references design.projects(id) on delete cascade,
  payload jsonb not null default '{}',
  status design.job_status not null default 'queued',
  attempts int not null default 0,
  result jsonb,
  error text,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queue on design.jobs (status, created_at);

-- ─────────────────────────────── 학습
create table design.samples (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  file_path text not null,
  grade design.sample_grade not null default 'normal',
  project_code text,
  confidential boolean not null default false,
  third_party boolean not null default false,
  ingested_at timestamptz not null default now(),
  notes text
);

create table design.extractions (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references design.samples(id) on delete cascade,
  target_table text not null,
  payload jsonb not null,
  confidence numeric(4,3),
  status design.approval_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);

create table design.revision_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references design.projects(id) on delete cascade,
  artifact text not null,
  generated jsonb not null,
  final jsonb not null,
  diff jsonb not null,
  category text,
  created_at timestamptz not null default now()
);

create table design.rule_candidates (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  occurrences int not null default 1,
  status text not null default 'candidate' check (status in ('candidate', 'promoted', 'dismissed')),
  promoted_rule_key text references design.rules(key),
  created_at timestamptz not null default now()
);

create table design.benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  code_version text,
  scores jsonb not null
);

-- 표본에서 뽑은 지식(도면 세트 구성 · 캐드 기준 · 일반 사항 · 자재 코드 · 설계 보고서 · 스펙북 구성 …). 금액은 넣지 않는다.
create table design.knowledge (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  key text not null unique,
  title text not null,
  body jsonb not null,
  source text,
  project_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 반입 기록(현장 → 발주 입고 수량). 현장일지 자체는 인트라넷 것(public.site_logs)을 쓴다.
create table design.deliveries (
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references design.po_lines(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  received_on date not null default current_date,
  note text,
  photo_path text,
  client_id uuid unique,              -- 휴대폰에서 만든 고유 번호(다시 보내도 한 번만 저장)
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create function design.apply_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update design.po_lines set received_qty = received_qty + new.qty where id = new.po_line_id;
  update design.purchase_orders p set status = case
      when not exists (select 1 from design.po_lines l where l.po_id = p.id and l.received_qty < l.qty)
        then 'received'::design.po_status
      else 'partially_received'::design.po_status end
    where p.id = (select po_id from design.po_lines where id = new.po_line_id)
      and p.status in ('sent', 'accepted', 'partially_received');
  return new;
end $$;
revoke all on function design.apply_delivery() from public, anon, authenticated;
create trigger delivery_apply after insert on design.deliveries
  for each row execute function design.apply_delivery();

-- ─────────────────────────────── 행 단위 접근 정책
do $$
declare
  t text;
  member_read text[] := array[
    'trades','units','vendors','materials','components','unit_prices','rules','proposal_templates',
    'projects','spaces','placements','estimates','estimate_lines','schedule_tasks','change_orders',
    'meetings','proposal_sections','research_sources','documents',
    'samples','revision_logs','rule_candidates','benchmark_runs','knowledge'];
  member_write text[] := array[
    'materials','components','projects','spaces','placements','estimates','estimate_lines',
    'schedule_tasks','change_orders','meetings','proposal_sections','research_sources','documents','samples'];
  admin_only text[] := array['unit_costs','purchase_orders','po_lines'];
  admin_write text[] := array[
    'trades','units','vendors','unit_prices','rules','proposal_templates','approvals',
    'extractions','revision_logs','rule_candidates','benchmark_runs','knowledge','jobs'];
begin
  for t in select tablename from pg_tables where schemaname = 'design' loop
    execute format('alter table design.%I enable row level security', t);
    execute format('revoke all on design.%I from public, anon', t);
    execute format('grant select, insert, update, delete on design.%I to authenticated', t);
    execute format('grant all on design.%I to service_role', t);
  end loop;

  foreach t in array member_read loop
    execute format('create policy %I on design.%I for select to authenticated using ((select public.is_active_member()))', t || '_read', t);
  end loop;

  foreach t in array member_write loop
    execute format($p$create policy %I on design.%I for all to authenticated
      using ((select public.is_active_member())) with check ((select public.is_active_member()))$p$, t || '_write', t);
  end loop;

  foreach t in array admin_only || admin_write loop
    execute format($p$create policy %I on design.%I for all to authenticated
      using ((select public.is_admin())) with check ((select public.is_admin()))$p$, t || '_admin', t);
  end loop;
end $$;

-- 검토함 · 추출 결과 · 작업: 실행 단가가 새지 않게 팀원에게는 금액 관련 종류를 가린다.
create policy approvals_read on design.approvals for select to authenticated using (
  (select public.is_active_member()) and kind not in ('po_send', 'cost_extract'));
create policy extractions_read on design.extractions for select to authenticated using (
  (select public.is_active_member()) and target_table <> 'unit_costs');
create policy jobs_read on design.jobs for select to authenticated using (
  (select public.is_active_member()) and kind = 'estimate.build');
create policy jobs_request on design.jobs for insert to authenticated with check (
  (select public.is_active_member()) and kind = 'estimate.build'
  and status = 'queued' and requested_by = (select auth.uid()));

-- 반입 기록: 팀원이 넣고 본다(금액 없음). 고치기 · 지우기는 관리자.
create policy deliveries_read on design.deliveries for select to authenticated using ((select public.is_active_member()));
create policy deliveries_add on design.deliveries for insert to authenticated
  with check ((select public.is_active_member()) and created_by = (select auth.uid()));
create policy deliveries_admin on design.deliveries for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─────────────────────────────── 화면용 보기(public.design_*) — 부른 사람 권한 그대로
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'design' loop
    execute format('create view public.%I with (security_invoker = true) as select * from design.%I', 'design_' || t, t);
    execute format('revoke all on public.%I from public, anon', 'design_' || t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', 'design_' || t);
    execute format('grant all on public.%I to service_role', 'design_' || t);
  end loop;
end $$;

-- 팀원용 발주 목록(단가 · 금액 제외): 반입 대상을 고를 때 쓴다.
create function public.design_po_lines_for_site(p_project uuid)
returns table (id uuid, project_id uuid, po_number text, vendor_name text, due_date date, po_status text,
               trade_code text, item text, spec text, unit text, qty numeric, received_qty numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, p.project_id, p.po_number, v.name, p.due_date, p.status::text,
         l.trade_code, l.item, l.spec, l.unit, l.qty, l.received_qty
  from design.po_lines l
  join design.purchase_orders p on p.id = l.po_id
  join design.vendors v on v.id = p.vendor_id
  where p.project_id = p_project
    and p.status not in ('draft', 'cancelled')
    and (select public.is_active_member())
  order by p.due_date nulls last, p.po_number, l.item
$$;
revoke all on function public.design_po_lines_for_site(uuid) from public, anon;
grant execute on function public.design_po_lines_for_site(uuid) to authenticated;

-- ─────────────────────────────── 작업 처리기 계정(맥에서만 접속 · 설계 구역만)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'design_worker') then
    create role design_worker nologin bypassrls nocreatedb nocreaterole;
  end if;
end $$;
grant usage on schema design to design_worker;
grant select, insert, update, delete on all tables in schema design to design_worker;
alter default privileges in schema design grant select, insert, update, delete on tables to design_worker;
grant usage on schema public to design_worker;
grant select on public.projects, public.clients to design_worker;
grant select (id, name) on public.profiles to design_worker;
alter role design_worker set search_path = design, public;

notify pgrst, 'reload schema';
commit;
