-- 인사기록 직급 (대표 지시 2026-11-06 "인사기록에 직급도 추가해") · 직함(profiles.title)과 별도
alter table public.hr_records add column if not exists rank text check (rank is null or char_length(rank) <= 30);
comment on column public.hr_records.rank is '직급 (사원 · 주임 · 대리 · 과장 · 차장 · 부장 · 이사 · 대표 등)';
