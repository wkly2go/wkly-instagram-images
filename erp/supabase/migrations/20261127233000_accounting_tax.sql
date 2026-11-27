-- 2026-11-27 대표 지시 '우리 인트라넷에 경리 회계관련 전문성있게 고도화시켜'
-- 장부 › '세무 · 결산' 탭의 서버 쪽:
--  ① 공휴일 표 (세무 기한이 주말 · 공휴일이면 다음 날 — 국세기본법 제5조 · 지방세기본법 제25조)
--  ② 회사별 회계 설정 (원천세 주기 · 결산월 · 부가세 예정신고/예정고지 · 급여 · 3.3% · 일용 지급 여부)
--  ③ 세무 일정 계산 (법정 기한 → 실제 날짜) · 끝냄 표시 · 대표 알림 (D-7 · D-3 · D-1 · 당일 · 지남, 제목에 금액 없음)
--  ④ 월 마감 기록 (장부 비밀번호로 연 동안만 — 마감 때 숫자를 남겨 두고 마감 뒤 바뀐 줄을 찾음)
--  ⑤ 홈택스 합계표에 회사 칸 (두 회사 장부를 섞지 않음)
-- 규칙(기한)은 이 파일의 private.acct_tax_events 한 곳에만 있다. 화면은 public.acct_tax_calendar 로 읽는다.
-- 이 파일은 공개 저장소에 있으므로 금액 · 계좌 · 개인정보를 넣지 않는다.

-- ① 공휴일 -------------------------------------------------------------------------------------
create table if not exists public.acct_holidays (
  day date primary key,
  name text not null,
  source text not null default 'KASI 월력',
  created_at timestamptz not null default now()
);
comment on table public.acct_holidays is '공휴일 · 대체공휴일 (세무 기한 계산용). 2026~2028 은 한국천문연구원 월력 자료로 넣음 · 매달 1일 특일정보 API 로 다시 받음(활용신청 뒤)';
alter table public.acct_holidays enable row level security;
revoke all on public.acct_holidays from anon;
revoke insert, update, delete, truncate on public.acct_holidays from authenticated;
drop policy if exists acct_holidays_select on public.acct_holidays;
create policy acct_holidays_select on public.acct_holidays for select to authenticated using ((select public.is_active_member()));

insert into public.acct_holidays (day, name, source) values
  ('2026-01-01','1월 1일','KASI 월력'),
  ('2026-02-16','설날 연휴','KASI 월력'), ('2026-02-17','설날','KASI 월력'), ('2026-02-18','설날 연휴','KASI 월력'),
  ('2026-03-01','3·1절','KASI 월력'), ('2026-03-02','대체공휴일(3·1절)','KASI 월력'),
  ('2026-05-01','노동절','관공서의 공휴일 규정 개정 (2026-04-28 국무회의)'),
  ('2026-05-05','어린이날','KASI 월력'),
  ('2026-05-24','부처님오신날','KASI 월력'), ('2026-05-25','대체공휴일(부처님오신날)','KASI 월력'),
  ('2026-06-03','전국동시지방선거','KASI 월력'),
  ('2026-06-06','현충일','KASI 월력'),
  ('2026-07-17','제헌절','공휴일에 관한 법률 개정 (2026)'),
  ('2026-08-15','광복절','KASI 월력'), ('2026-08-17','대체공휴일(광복절)','KASI 월력'),
  ('2026-09-24','추석 연휴','KASI 월력'), ('2026-09-25','추석','KASI 월력'), ('2026-09-26','추석 연휴','KASI 월력'),
  ('2026-10-03','개천절','KASI 월력'), ('2026-10-05','대체공휴일(개천절)','KASI 월력'),
  ('2026-10-09','한글날','KASI 월력'),
  ('2026-12-25','기독탄신일','KASI 월력'),
  ('2027-01-01','1월 1일','KASI 월력'),
  ('2027-02-06','설날 연휴','KASI 월력'), ('2027-02-07','설날','KASI 월력'), ('2027-02-08','설날 연휴','KASI 월력'), ('2027-02-09','대체공휴일(설날)','KASI 월력'),
  ('2027-03-01','3·1절','KASI 월력'),
  ('2027-05-01','노동절','KASI 월력'), ('2027-05-03','대체공휴일(노동절)','KASI 월력'),
  ('2027-05-05','어린이날','KASI 월력'),
  ('2027-05-13','부처님오신날','KASI 월력'),
  ('2027-06-06','현충일','KASI 월력'),
  ('2027-07-17','제헌절','KASI 월력'), ('2027-07-19','대체공휴일(제헌절)','KASI 월력'),
  ('2027-08-15','광복절','KASI 월력'), ('2027-08-16','대체공휴일(광복절)','KASI 월력'),
  ('2027-09-14','추석 연휴','KASI 월력'), ('2027-09-15','추석','KASI 월력'), ('2027-09-16','추석 연휴','KASI 월력'),
  ('2027-10-03','개천절','KASI 월력'), ('2027-10-04','대체공휴일(개천절)','KASI 월력'),
  ('2027-10-09','한글날','KASI 월력'), ('2027-10-11','대체공휴일(한글날)','KASI 월력'),
  ('2027-12-25','기독탄신일','KASI 월력'), ('2027-12-27','대체공휴일(기독탄신일)','KASI 월력'),
  ('2028-01-01','1월 1일','KASI 월력 (공식 월력요항 전)'),
  ('2028-01-26','설날 연휴','KASI 월력 (공식 월력요항 전)'), ('2028-01-27','설날','KASI 월력 (공식 월력요항 전)'), ('2028-01-28','설날 연휴','KASI 월력 (공식 월력요항 전)'),
  ('2028-03-01','3·1절','KASI 월력 (공식 월력요항 전)'),
  ('2028-04-12','국회의원선거일','KASI 월력 (공식 월력요항 전)'),
  ('2028-05-01','노동절','KASI 월력 (공식 월력요항 전)'),
  ('2028-05-02','부처님오신날','KASI 월력 (공식 월력요항 전)'),
  ('2028-05-05','어린이날','KASI 월력 (공식 월력요항 전)'),
  ('2028-06-06','현충일','KASI 월력 (공식 월력요항 전)'),
  ('2028-07-17','제헌절','KASI 월력 (공식 월력요항 전)'),
  ('2028-08-15','광복절','KASI 월력 (공식 월력요항 전)'),
  ('2028-10-02','추석 연휴','KASI 월력 (공식 월력요항 전)'), ('2028-10-03','개천절 · 추석','KASI 월력 (공식 월력요항 전)'), ('2028-10-04','추석 연휴','KASI 월력 (공식 월력요항 전)'),
  ('2028-10-05','대체공휴일','KASI 월력 (공식 월력요항 전)'),
  ('2028-10-09','한글날','KASI 월력 (공식 월력요항 전)'),
  ('2028-12-25','기독탄신일','KASI 월력 (공식 월력요항 전)')
on conflict (day) do update set name = excluded.name, source = excluded.source;

-- 주말 · 공휴일이면 다음 날 (근로자의 날 · 노동절도 표에 있음)
create or replace function private.acct_business_day(p date) returns date
language plpgsql stable set search_path = '' as $$
declare d date := p;
begin
  for i in 1..15 loop
    exit when extract(isodow from d) < 6 and not exists (select 1 from public.acct_holidays h where h.day = d);
    d := d + 1;
  end loop;
  return d;
end $$;

create or replace function private.acct_dow(p date) returns text
language sql immutable set search_path = '' as $$ select (array['월','화','수','목','금','토','일'])[extract(isodow from p)::int] $$;

-- ② 회사별 회계 설정 -----------------------------------------------------------------------------
create table if not exists public.acct_settings (
  company text primary key check (company in ('AR','TW')),
  withholding_cycle text not null default '매월' check (withholding_cycle in ('매월','반기')),
  fiscal_end_month int not null default 12 check (fiscal_end_month between 1 and 12),
  vat_filing text not null default '예정신고' check (vat_filing in ('예정신고','예정고지')),
  has_payroll boolean not null default false,
  has_freelancers boolean not null default false,
  has_daily_workers boolean not null default false,
  bookkeeper text not null default '',
  payroll_day int check (payroll_day between 1 and 31),
  approval_limit bigint check (approval_limit >= 0),
  alerts boolean not null default true,
  note text not null default '',
  source text not null default '',
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.acct_settings is '회사별 회계 설정 (세무 일정 계산 기준). 관리자 전용 · 계좌 · 주민번호 · 매출 금액은 넣지 않음';
alter table public.acct_settings enable row level security;
revoke all on public.acct_settings from anon;
revoke insert, delete, truncate on public.acct_settings from authenticated;
drop policy if exists acct_settings_select on public.acct_settings;
drop policy if exists acct_settings_update on public.acct_settings;
create policy acct_settings_select on public.acct_settings for select to authenticated using ((select public.is_admin()));
create policy acct_settings_update on public.acct_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.acct_settings (company, withholding_cycle, fiscal_end_month, vat_filing, has_payroll, has_freelancers, has_daily_workers, bookkeeper, payroll_day, note, source) values
  ('AR', '매월', 12, '예정신고', true, true, false, '세무대리인 기장', 5, '',
   '장부 자료로 추정 — 정기 출금에 급여(5일) · 원천세 · 4대보험(10일) · 세무 기장료가 있고 결제 대장에 3.3% 지급이 있음 · 매출 규모로 예정신고 대상. 맞는지 확인해 주세요'),
  ('TW', '매월', 12, '예정신고', false, false, false, '', null,
   '신설 법인(2025년 설립) — 부가세 예정신고 · 예정고지 구분과 법인세 중간예납 대상 여부는 세무대리인 확인',
   '기본값 — 인트라넷에 더위클리 장부 자료가 아직 없음. 급여 · 3.3% · 일용 지급이 있으면 켜 주세요')
on conflict (company) do nothing;

-- ③ 세무 일정 -----------------------------------------------------------------------------------
create table if not exists public.acct_tax_tasks (
  company text not null check (company in ('AR','TW')),
  task_key text not null,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  memo text,
  alerted text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (company, task_key)
);
comment on table public.acct_tax_tasks is '세무 일정 끝냄 표시 · 보낸 알림 단계(D7 · D3 · D1 · D0 · LATE). 일정 자체는 private.acct_tax_events 가 계산';
alter table public.acct_tax_tasks enable row level security;
revoke all on public.acct_tax_tasks from anon;
revoke insert, update, delete, truncate on public.acct_tax_tasks from authenticated;
drop policy if exists acct_tax_tasks_select on public.acct_tax_tasks;
create policy acct_tax_tasks_select on public.acct_tax_tasks for select to authenticated using ((select public.is_admin()));

-- 그 달 결제 대장에 그 계약형태(3.3% · 일용) 지급이 몇 건인지 (회사 = 프로젝트 연번 앞 두 글자 · 프로젝트 없으면 아트리어)
create or replace function private.acct_paid_count(p_company text, p_type text, p_month date) returns int
language sql stable set search_path = '' as $$
  select count(*)::int
    from public.payments pay
    left join public.projects pr on pr.id = pay.project_id
   where pay.contract_type = p_type and pay.status = '완료'
     and coalesce(pay.paid_date, pay.due_date) >= p_month
     and coalesce(pay.paid_date, pay.due_date) < (p_month + interval '1 month')::date
     and (case when upper(left(coalesce(pr.code, ''), 2)) in ('TW', 'RS') then 'TW' else 'AR' end) = p_company
$$;

-- 법정 기한 (12월 결산 법인 기준 · 결산월 설정을 따름). base_date = 법정 날짜, due_date = 주말 · 공휴일을 넘긴 실제 날짜
create or replace function private.acct_tax_events(p_from date, p_to date)
returns table(company text, task_key text, kind text, title text, period text, base_date date, due_date date, prep text, basis text, note text, holidays_loaded boolean)
language sql stable set search_path = '' as $$
  with s as (select * from public.acct_settings),
  months as (
    select generate_series(date_trunc('month', p_from::timestamp) - interval '14 month', date_trunc('month', p_to::timestamp), interval '1 month')::date as m
  ),
  raw as (
    -- 원천세 (매월): 지급한 달의 다음 달 10일
    select s.company, 'wht:' || to_char(mm.m, 'YYYY-MM') as task_key, 'wht' as kind, '원천세 신고 · 납부' as title,
           to_char(mm.m, 'YYYY"년" FMMM"월" 지급분') as period, ((mm.m + interval '1 month')::date + 9) as base,
           '급여 · 3.3% 사업소득 · 일용 지급 내역으로 원천징수이행상황신고서 작성 · 지방소득세(특별징수)도 같은 날' as prep,
           '소득세법 제128조 — 지급한 달의 다음 달 10일' as basis,
           case when extract(month from mm.m) = 2 then '2월 지급분은 연말정산 결과(환급 · 추가 징수)를 함께 신고' end as note
      from s cross join months mm
     where s.withholding_cycle = '매월' and (s.has_payroll or s.has_freelancers or s.has_daily_workers)
    union all
    -- 원천세 (반기 납부 승인): 1~6월분 7월 10일 · 7~12월분 다음 해 1월 10일
    select s.company, 'wht:' || to_char(mm.m, 'YYYY') || case when extract(month from mm.m) = 6 then '-H1' else '-H2' end, 'wht', '원천세 신고 · 납부 (반기)',
           to_char(mm.m, 'YYYY"년" ') || case when extract(month from mm.m) = 6 then '1~6월 지급분' else '7~12월 지급분' end,
           ((mm.m + interval '1 month')::date + 9),
           '반기 동안의 급여 · 3.3% · 일용 지급 내역 합산 · 지방소득세 함께',
           '소득세법 제128조 ② — 반기별 납부 승인 사업장 (7월 10일 · 1월 10일)',
           '연말정산 환급이 있으면 따로 신고할 수 있음 — 세무대리인 확인'
      from s cross join months mm
     where s.withholding_cycle = '반기' and extract(month from mm.m) in (6, 12) and (s.has_payroll or s.has_freelancers or s.has_daily_workers)
    union all
    -- 4대보험료: 다음 달 10일
    select s.company, 'ins:' || to_char(mm.m, 'YYYY-MM'), 'ins', '4대보험료 납부',
           to_char(mm.m, 'YYYY"년" FMMM"월"분'), ((mm.m + interval '1 month')::date + 9),
           '건강 · 연금 · 고용 · 산재 고지 금액 확인 (자동이체면 통장 잔액) · 입사 · 퇴사자 취득 · 상실 신고 누락 확인',
           '국민건강보험법 제78조 · 보험료징수법 제16조의7 등 — 다음 달 10일', null
      from s cross join months mm where s.has_payroll
    union all
    -- 세금계산서 발급 마감 (월합계 포함): 공급 시기가 속하는 달의 다음 달 10일
    select s.company, 'einv:' || to_char(mm.m, 'YYYY-MM'), 'einv', '세금계산서 발급 마감 (월합계 포함)',
           to_char(mm.m, 'YYYY"년" FMMM"월" 공급분'), ((mm.m + interval '1 month')::date + 9),
           '지난달 공급(납품 · 용역 완료)분 중 아직 발급하지 않은 세금계산서 · 월합계 · 수정 발행 확인 — 늦으면 지연발급 가산세',
           '부가가치세법 제34조 ③ — 공급 시기가 속하는 달의 다음 달 10일', null
      from s cross join months mm
    union all
    -- 일용근로소득 지급명세서: 다음 달 말일
    select s.company, 'daily:' || to_char(mm.m, 'YYYY-MM'), 'daily', '일용근로소득 지급명세서 제출',
           to_char(mm.m, 'YYYY"년" FMMM"월" 지급분'), (mm.m + interval '2 month' - interval '1 day')::date,
           '일용 근로자 지급액 · 근무일수 (주민번호는 인트라넷에 두지 않음 — 홈택스 · 세무대리인에서 입력)',
           '소득세법 제164조 ① — 지급한 달의 다음 달 말일',
           case when private.acct_paid_count(s.company, '일용근로', mm.m) = 0
                then '결제 대장에 이 달 일용 지급 기록이 없음 — 지급이 없었으면 끝냄 표시 (알림은 보내지 않음)'
                else '결제 대장 일용 지급 ' || private.acct_paid_count(s.company, '일용근로', mm.m) || '건' end
      from s cross join months mm where s.has_daily_workers
    union all
    -- 간이지급명세서 (3.3% 사업소득 · 인적용역 기타소득): 다음 달 말일
    select s.company, 'sbiz:' || to_char(mm.m, 'YYYY-MM'), 'sbiz', '간이지급명세서 (3.3% 사업 · 인적용역 기타소득)',
           to_char(mm.m, 'YYYY"년" FMMM"월" 지급분'), (mm.m + interval '2 month' - interval '1 day')::date,
           '프리랜서 · 강사 등 3.3% · 8.8% 지급 내역 (지급일 · 금액)',
           '소득세법 제164조의3 — 지급한 달의 다음 달 말일',
           case when private.acct_paid_count(s.company, '사업소득(3.3%)', mm.m) = 0
                then '결제 대장에 이 달 3.3% 지급 기록이 없음 — 지급이 없었으면 끝냄 표시 (알림은 보내지 않음)'
                else '결제 대장 3.3% 지급 ' || private.acct_paid_count(s.company, '사업소득(3.3%)', mm.m) || '건' end
      from s cross join months mm where s.has_freelancers
    union all
    -- 간이지급명세서 (근로소득): 2026년 지급분까지 반기 (7월 말 · 다음 해 1월 말), 2027년 1월 지급분부터 매월 (다음 달 말일)
    select s.company,
           'swage:' || case when mm.m >= date '2027-01-01' then to_char(mm.m, 'YYYY-MM')
                            else to_char(mm.m, 'YYYY') || case when extract(month from mm.m) = 6 then '-H1' else '-H2' end end,
           'swage', '간이지급명세서 (근로소득)',
           case when mm.m >= date '2027-01-01' then to_char(mm.m, 'YYYY"년" FMMM"월" 지급분')
                else to_char(mm.m, 'YYYY"년" ') || case when extract(month from mm.m) = 6 then '1~6월 지급분' else '7~12월 지급분' end end,
           (mm.m + interval '2 month' - interval '1 day')::date,
           '상용 근로자 급여 지급 내역 (급여대장)',
           case when mm.m >= date '2027-01-01' then '소득세법 제164조의3 — 2027년 1월 지급분부터 매월 (지급한 달의 다음 달 말일)'
                else '소득세법 제164조의3 — 반기 (7월 말 · 다음 해 1월 말)' end,
           case when mm.m >= date '2027-01-01' and mm.m < date '2028-01-01'
                then '2027년은 반기 기한(7월 말 · 다음 해 1월 말) 안에 내면 가산세 면제 — 반기납부 사업장은 2028년까지 · 세무대리인 확인' end
      from s cross join months mm
     where s.has_payroll and (mm.m >= date '2027-01-01' or extract(month from mm.m) in (6, 12))
    union all
    -- 부가가치세 (법인): 예정 4월 · 10월 25일, 확정 7월 · 1월 25일
    select s.company, 'vat:' || to_char(mm.m, 'YYYY') || '-Q' || (extract(month from mm.m)::int / 3), 'vat',
           case extract(month from mm.m)::int
             when 3 then case when s.vat_filing = '예정고지' then '부가세 1기 예정고지 납부' else '부가세 1기 예정 신고 · 납부' end
             when 6 then '부가세 1기 확정 신고 · 납부'
             when 9 then case when s.vat_filing = '예정고지' then '부가세 2기 예정고지 납부' else '부가세 2기 예정 신고 · 납부' end
             else '부가세 2기 확정 신고 · 납부' end,
           to_char(mm.m, 'YYYY"년" ') || case extract(month from mm.m)::int
             when 3 then '1~3월' when 6 then case when s.vat_filing = '예정고지' then '1~6월' else '4~6월' end
             when 9 then '7~9월' else case when s.vat_filing = '예정고지' then '7~12월' else '10~12월' end end,
           ((mm.m + interval '1 month')::date + 24),
           case when s.vat_filing = '예정고지' and extract(month from mm.m) in (3, 9)
                then '세무서 고지서 금액 납부 (직전 과세기간 납부세액의 50% · 50만 원 미만이면 고지 없음) — 신고는 안 함'
                else '매출 · 매입 세금계산서 합계표 대사 · 카드 매입 공제 · 불공제 구분 → 장부 › 세무 · 결산 › 부가세 신고 준비에서 세무대리인 자료 내려받기' end,
           '부가가치세법 제48조 · 제49조 — 예정 4월 · 10월 25일, 확정 7월 · 다음 해 1월 25일',
           case when s.vat_filing = '예정고지' then '직전 과세기간 공급가액 1억 5천만 원 미만 법인만 예정고지 — 해당 여부 세무대리인 확인' end
      from s cross join months mm where extract(month from mm.m) in (3, 6, 9, 12)
    union all
    -- 지급명세서 (근로 · 퇴직 · 사업소득): 다음 해 3월 10일
    select s.company, 'stmt:' || to_char(mm.m, 'YYYY'), 'stmt', '지급명세서 제출 (근로 · 퇴직 · 사업소득)',
           to_char(mm.m, 'YYYY"년" 지급분'), ((mm.m + interval '3 month')::date + 9),
           '연말정산 결과 · 근로 · 퇴직 · 3.3% 사업소득 연간 지급 내역',
           '소득세법 제164조 — 다음 해 3월 10일', null
      from s cross join months mm where extract(month from mm.m) = 12 and (s.has_payroll or s.has_freelancers)
    union all
    -- 보수총액 신고: 건강보험 3월 10일 · 고용 · 산재보험 3월 15일
    select s.company, 'hitotal:' || to_char(mm.m, 'YYYY'), 'hitotal', '건강보험 보수총액 신고',
           to_char(mm.m, 'YYYY"년" 보수'), ((mm.m + interval '3 month')::date + 9),
           '연간 보수 총액 (연말정산 자료) · 입사 · 퇴사자 확인', '국민건강보험법 시행령 제39조 — 다음 해 3월 10일', null
      from s cross join months mm where extract(month from mm.m) = 12 and s.has_payroll
    union all
    select s.company, 'eitotal:' || to_char(mm.m, 'YYYY'), 'eitotal', '고용 · 산재보험 보수총액 신고',
           to_char(mm.m, 'YYYY"년" 보수'), ((mm.m + interval '3 month')::date + 14),
           '근로자별 연간 보수 총액', '보험료징수법 제16조의10 — 다음 해 3월 15일', null
      from s cross join months mm where extract(month from mm.m) = 12 and s.has_payroll
    union all
    -- 법인세: 사업연도 종료일이 속하는 달의 말일부터 3개월
    select s.company, 'cit:' || to_char(mm.m, 'YYYY'), 'cit', '법인세 신고 · 납부',
           to_char(mm.m, 'YYYY"년" 사업연도'), (mm.m + interval '4 month' - interval '1 day')::date,
           '결산 마감 · 재무제표 · 세무조정 자료 (세무대리인) · 가지급금 · 가수금 정리',
           '법인세법 제60조 — 사업연도 종료일이 속하는 달의 말일부터 3개월 이내',
           '성실신고확인 대상 소규모 법인은 4개월 — 해당 여부 확인'
      from s cross join months mm where extract(month from mm.m) = s.fiscal_end_month
    union all
    -- 법인지방소득세: 4개월
    select s.company, 'lit:' || to_char(mm.m, 'YYYY'), 'lit', '법인지방소득세 신고 · 납부',
           to_char(mm.m, 'YYYY"년" 사업연도'), (mm.m + interval '5 month' - interval '1 day')::date,
           '법인세 신고서 · 사업장별 안분 (위택스)', '지방세법 제103조의23 — 사업연도 종료일이 속하는 달의 말일부터 4개월 이내', null
      from s cross join months mm where extract(month from mm.m) = s.fiscal_end_month
    union all
    -- 법인세 중간예납: 사업연도 시작 후 6개월이 지난 날부터 2개월 이내
    select s.company, 'citmid:' || to_char(mm.m, 'YYYY'), 'citmid', '법인세 중간예납',
           to_char(mm.m, 'YYYY"년" 중간예납 (상반기)'), (mm.m + interval '3 month' - interval '1 day')::date,
           '직전 사업연도 법인세의 절반 또는 상반기 가결산 — 세무대리인과 방식 정하기',
           '법인세법 제63조 — 사업연도 시작 후 6개월이 지난 날부터 2개월 이내',
           '직전 사업연도 산출세액이 없는 법인 · 중간예납세액 50만 원 미만 중소기업 등은 제외 — 세무대리인 확인'
      from s cross join months mm where extract(month from mm.m)::int = ((s.fiscal_end_month + 5) % 12) + 1
    union all
    -- 주민세 사업소분: 8월 1일 ~ 31일
    select s.company, 'res:' || to_char(mm.m, 'YYYY'), 'res', '주민세 사업소분 신고 · 납부',
           to_char(mm.m, 'YYYY"년"'), (mm.m + interval '1 month' - interval '1 day')::date,
           '7월 1일 기준 사업소 연면적 · 종업원 수 (위택스)', '지방세법 제83조 — 매년 8월 1일 ~ 8월 31일', null
      from s cross join months mm where extract(month from mm.m) = 8
  )
  select r.company, r.task_key, r.kind, r.title, r.period, r.base, private.acct_business_day(r.base), r.prep, r.basis, r.note,
         exists (select 1 from public.acct_holidays h where h.day >= make_date(extract(year from r.base)::int, 1, 1) and h.day < make_date(extract(year from r.base)::int + 1, 1, 1))
    from raw r
   where private.acct_business_day(r.base) between p_from and p_to
$$;

-- 화면용 (관리자): 기간 안 일정 + 끝냄 표시
create or replace function public.acct_tax_calendar(p_from date, p_to date)
returns table(company text, task_key text, kind text, title text, period text, base_date date, due_date date, prep text, basis text, note text, holidays_loaded boolean, done boolean, done_at timestamptz, memo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception '기간을 다시 골라 주세요.'; end if;
  return query
    select e.company, e.task_key, e.kind, e.title, e.period, e.base_date, e.due_date, e.prep, e.basis, e.note, e.holidays_loaded,
           coalesce(t.done, false), t.done_at, t.memo
      from private.acct_tax_events(p_from, p_to) e
      left join public.acct_tax_tasks t on t.company = e.company and t.task_key = e.task_key
     order by e.due_date, e.company, e.kind;
end $$;
revoke execute on function public.acct_tax_calendar(date, date) from public, anon;
grant execute on function public.acct_tax_calendar(date, date) to authenticated;

-- 끝냄 표시 (관리자)
create or replace function public.acct_tax_mark(p_company text, p_key text, p_done boolean, p_memo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 고칠 수 있습니다.' using errcode = '42501'; end if;
  if p_company not in ('AR','TW') or coalesce(p_key, '') !~ '^[a-z]+:[0-9]{4}(-[0-9A-Z]{2,3})?$' then raise exception '일정을 찾을 수 없습니다.'; end if;
  insert into public.acct_tax_tasks (company, task_key, done, done_at, done_by, memo, updated_at)
  values (p_company, p_key, p_done, case when p_done then now() end, case when p_done then auth.uid() end, nullif(left(coalesce(p_memo, ''), 300), ''), now())
  on conflict (company, task_key) do update
    set done = excluded.done, done_at = excluded.done_at, done_by = excluded.done_by,
        memo = coalesce(excluded.memo, public.acct_tax_tasks.memo), updated_at = now();
end $$;
revoke execute on function public.acct_tax_mark(text, text, boolean, text) from public, anon;
grant execute on function public.acct_tax_mark(text, text, boolean, text) to authenticated;

-- 대표 알림: 7일 안 · 3일 전 지남까지 끝내지 않은 일정 → 단계(D7 · D3 · D1 · D0 · LATE)가 새로 바뀐 것만 하루 한 통으로 묶음
create table if not exists private.acct_notes (key text primary key, at timestamptz not null default now());

create or replace function private.acct_tax_alert() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  e record; v_stage text; v_left int; v_lines text[] := '{}'; v_first text; v_min int := 999; v_n int := 0; v_co text;
  v_ceo record; v_year int := extract(year from (now() at time zone 'Asia/Seoul'))::int;
begin
  for e in
    select ev.*, coalesce(t.alerted, '{}'::text[]) as sent
      from private.acct_tax_events(v_today - 3, v_today + 7) ev
      left join public.acct_tax_tasks t on t.company = ev.company and t.task_key = ev.task_key
      join public.acct_settings st on st.company = ev.company and st.alerts
     where not coalesce(t.done, false)
     order by ev.due_date, ev.company, ev.kind
  loop
    v_left := e.due_date - v_today;
    v_stage := case when v_left < 0 then 'LATE' when v_left = 0 then 'D0' when v_left = 1 then 'D1' when v_left <= 3 then 'D3' else 'D7' end;
    continue when v_stage = any (e.sent);
    -- 3.3% · 일용 간이지급명세서는 결제 대장에 그 달 지급이 있을 때만 알림 (지급 없는 달은 화면에만)
    continue when e.kind in ('sbiz', 'daily')
      and private.acct_paid_count(e.company, case e.kind when 'sbiz' then '사업소득(3.3%)' else '일용근로' end,
                                  to_date(split_part(e.task_key, ':', 2) || '-01', 'YYYY-MM-DD')) = 0;
    v_n := v_n + 1;
    v_co := case e.company when 'AR' then '아트리어' else '더위클리' end;
    if v_left < v_min then v_min := v_left; v_first := e.title || ' (' || v_co || ')'; end if;
    v_lines := v_lines || ('· ' || to_char(e.due_date, 'FMMM/FMDD') || '(' || private.acct_dow(e.due_date) || ') '
                          || case when v_left < 0 then '기한 지남' when v_left = 0 then '오늘' else 'D-' || v_left end
                          || ' ' || e.title || ' — ' || v_co || ' · ' || e.period);
    insert into public.acct_tax_tasks (company, task_key, due_date, alerted, updated_at)
    values (e.company, e.task_key, e.due_date, array[v_stage], now())
    on conflict (company, task_key) do update
      set alerted = (select array_agg(distinct x) from unnest(public.acct_tax_tasks.alerted || excluded.alerted) x),
          due_date = excluded.due_date, updated_at = now();
  end loop;

  -- 내년 공휴일 자료가 없으면 11월부터 한 번 알림 (기한 계산이 주말만 반영됨)
  if extract(month from v_today) >= 11
     and not exists (select 1 from public.acct_holidays h where h.day >= make_date(v_year + 1, 1, 1) and h.day < make_date(v_year + 2, 1, 1))
     and not exists (select 1 from private.acct_notes n where n.key = 'holidays:' || (v_year + 1)) then
    insert into private.acct_notes (key) values ('holidays:' || (v_year + 1));
    for v_ceo in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.title = '대표' loop
      perform public.notify(v_ceo.id, '알람', '세무 일정 · ' || (v_year + 1) || '년 공휴일 자료 없음',
        (v_year + 1) || '년 공휴일이 아직 없어 세무 기한이 주말만 넘겨 계산됩니다. 공공데이터포털에서 ''한국천문연구원_특일 정보''를 활용신청(자동 승인)하면 매달 1일 자동으로 받아 옵니다.',
        '/ledger?tab=acct');
    end loop;
  end if;

  if v_n = 0 then return 0; end if;
  for v_ceo in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' and p.title = '대표' loop
    perform public.notify(v_ceo.id, '알람',
      '세무 일정 · ' || case when v_min < 0 then '기한 지남 ' when v_min = 0 then '오늘 ' else 'D-' || v_min || ' ' end
        || v_first || case when v_n > 1 then ' 외 ' || (v_n - 1) || '건' else '' end,
      left(array_to_string(v_lines, E'\n') || E'\n\n준비물 · 근거는 장부 › 세무 · 결산 › 세무 일정. 끝낸 일은 ''끝냄''을 누르면 알림이 멈춥니다.', 900),
      '/ledger?tab=acct');
  end loop;
  return v_n;
end $$;
revoke execute on function private.acct_tax_alert() from public;

-- 공휴일 자동 받기 (공공데이터포털 '한국천문연구원_특일 정보' — 활용신청 전에는 403 이라 아무것도 안 함)
create or replace function private.acct_holiday_sync(p_year int) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; items jsonb; it jsonb; n int := 0;
begin
  r := public.public_data_get('B090041/openapi/service/SpcdeInfoService/getRestDeInfo',
         jsonb_build_object('solYear', p_year::text, 'numOfRows', '100', '_type', 'json'), 'acct-holiday');
  if coalesce((r->>'status')::int, 0) <> 200 then return -1; end if;
  items := r #> '{body,response,body,items,item}';
  if items is null or jsonb_typeof(items) not in ('array', 'object') then return 0; end if;
  if jsonb_typeof(items) = 'object' then items := jsonb_build_array(items); end if;
  for it in select * from jsonb_array_elements(items) loop
    if coalesce(it->>'isHoliday', '') = 'Y' and coalesce(it->>'locdate', '') ~ '^[0-9]{8}$' then
      insert into public.acct_holidays (day, name, source)
      values (to_date(it->>'locdate', 'YYYYMMDD'), left(coalesce(it->>'dateName', '공휴일'), 40), 'KASI 특일정보 API')
      on conflict (day) do update set name = excluded.name, source = excluded.source;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function private.acct_holiday_sync(int) from public;

create or replace function private.acct_holiday_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare y int := extract(year from (now() at time zone 'Asia/Seoul'))::int;
begin
  perform private.acct_holiday_sync(y);
  perform private.acct_holiday_sync(y + 1);
exception when others then null;
end $$;
revoke execute on function private.acct_holiday_tick() from public;

-- ④ 월 마감 기록 (장부를 연 동안만) -------------------------------------------------------------------
create table if not exists public.acct_month_close (
  company text not null check (company in ('AR','TW')),
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  closed boolean not null default true,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  note text,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company, month)
);
comment on table public.acct_month_close is '월 마감 기록 — 마감 때 숫자(snapshot)를 남기고 마감 뒤 바뀐 장부 줄을 찾음. 장부 비밀번호로 연 동안만 읽고 씀';
alter table public.acct_month_close enable row level security;
revoke all on public.acct_month_close from anon;
revoke truncate on public.acct_month_close from authenticated;
drop policy if exists acct_month_close_open on public.acct_month_close;
create policy acct_month_close_open on public.acct_month_close for all to authenticated using ((select public.ledger_open())) with check ((select public.ledger_open()));

-- ⑤ 홈택스 합계표 회사 구분 ------------------------------------------------------------------------
alter table public.tax_invoice_summaries add column if not exists company text not null default 'AR';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tax_invoice_summaries_company_chk') then
    alter table public.tax_invoice_summaries add constraint tax_invoice_summaries_company_chk check (company in ('AR','TW'));
  end if;
end $$;
create unique index if not exists tax_invoice_summaries_company_key on public.tax_invoice_summaries (company, direction, period_from, period_to, partner_biz_no);
-- 예전 고유 키(회사 없음)는 뺌 — 두 회사가 같은 거래처 · 같은 기간 합계표를 올려도 서로 덮지 않게 (화면 올리기는 onConflict 에 company 포함)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'tax_invoice_summaries_direction_period_from_period_to_partn_key') then
    alter table public.tax_invoice_summaries drop constraint tax_invoice_summaries_direction_period_from_period_to_partn_key;
  end if;
end $$;

-- 예약 작업 (분은 다른 작업과 겹치지 않게)
select cron.schedule('acct_tax_alert', '45 23 * * *', $$select private.acct_tax_alert()$$);
select cron.schedule('acct_holiday_sync', '15 0 1 * *', $$select private.acct_holiday_tick()$$);
