-- 인사기록: 급여 계좌 · 연차 조정 (대표 지시 2026-11-06 "인사정보 란에 계좌번호도 추가하고 연차 관련 정보도 추가")
--   볼 수 있는 사람은 기존 hr_records 정책 그대로 (본인 · 관리자), 고치는 건 관리자만
alter table public.hr_records
  add column if not exists bank_name text check (bank_name is null or char_length(bank_name) <= 40),
  add column if not exists account_no text check (account_no is null or char_length(account_no) <= 40),
  add column if not exists account_holder text check (account_holder is null or char_length(account_holder) <= 60),
  add column if not exists leave_adjust numeric(4,1) not null default 0 check (leave_adjust between -30 and 30),
  add column if not exists leave_note text check (leave_note is null or char_length(leave_note) <= 500);
comment on column public.hr_records.bank_name is '급여 계좌 은행';
comment on column public.hr_records.account_no is '급여 계좌번호';
comment on column public.hr_records.account_holder is '예금주';
comment on column public.hr_records.leave_adjust is '이번 연차 기간 조정 일수 (이월 · 포상 +, 선사용 · 차감 −)';
comment on column public.hr_records.leave_note is '연차 조정 사유 · 메모';

-- 사원번호 (대표 지시 2026-11-06 "사원번호 기입란을 만들어")
alter table public.hr_records add column if not exists employee_no text check (employee_no is null or char_length(employee_no) <= 20);
create unique index if not exists hr_records_employee_no_key on public.hr_records (employee_no) where employee_no is not null;
comment on column public.hr_records.employee_no is '사원번호 (회사 안에서 겹치지 않게)';
