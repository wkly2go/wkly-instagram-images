-- 업무 기록마다 메모 (대표 지시 2026-10-21 "업무에서 메모를 추가할 수 있게")
alter table public.work_logs add column if not exists memo text;
comment on column public.work_logs.memo is '업무 기록에 덧붙이는 메모 (후속 조치 · 참고)';
