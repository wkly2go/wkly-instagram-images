-- 개인 일정 완료 표시 (대표 지시 2026-11-10 "일정을 완료할 수 있게")
alter table public.personal_events add column if not exists done boolean not null default false;
