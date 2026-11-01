-- 일정 · 할 일의 출처 (대표 지시 2026-11-01 "이메일과 첨부자료로 만들어진 일정과 할일들을 기록")
alter table public.tasks add column if not exists origin text;
alter table public.tasks add column if not exists origin_ref text;
alter table public.tasks drop constraint if exists tasks_origin_check;
alter table public.tasks add constraint tasks_origin_check check (origin is null or origin in ('메일', '첨부자료'));
comment on column public.tasks.origin is '이 일정을 만든 출처: 메일 · 첨부자료 (사람이 직접 적은 것은 null)';
comment on column public.tasks.origin_ref is '출처 이름 (메일 제목 · 파일 이름)';
