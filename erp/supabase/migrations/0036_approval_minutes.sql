-- 0036 · 승인에 '회의록' 종류 추가 (대표 지시 2026-10-18 "승인 폴더에 회의록방을 만들어")
alter table public.approvals drop constraint if exists approvals_kind_check;
alter table public.approvals add constraint approvals_kind_check
  check (kind = any (array['업무 보고','일일 보고','회의록','메일 발송','프로젝트','거래처','할 일','지출','기타'])) not valid;
