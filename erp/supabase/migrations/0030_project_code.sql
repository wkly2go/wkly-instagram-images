-- WKLY ERP 0030: 프로젝트 연번 — 구글 드라이브 ARTERIOR 폴더 이름 규칙과 동일
--   'AR' + 시작 연월 두 자리씩 (예: 2026년 9월 시작 → AR2609). 경영 · 파트너스 같은 관리 폴더는 AR0000.
--   같은 달에 시작한 프로젝트는 같은 연번을 쓰므로 중복 허용. 관리자는 직접 바꿀 수 있다.

alter table public.projects add column if not exists code text;
drop index if exists public.projects_code_key; -- 예전 TWyyNN 순번 방식의 유일 인덱스 (연번은 중복 가능)
create index if not exists projects_code_idx on public.projects (code);
comment on column public.projects.code is '연번 AR + 시작 연월(YYMM), 관리 폴더는 AR0000 (드라이브 ARTERIOR 폴더 규칙, 중복 가능)';

create or replace function private.project_code_for(p_day date)
returns text
language sql
immutable
set search_path = ''
as $$ select 'AR' || to_char(p_day, 'YYMM') $$;

create or replace function private.project_code_assign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or new.code = '' then
    new.code := private.project_code_for(coalesce(new.start_date, (now() at time zone 'Asia/Seoul')::date));
  end if;
  return new;
end;
$$;
drop trigger if exists projects_code_assign on public.projects;
create trigger projects_code_assign before insert on public.projects for each row execute function private.project_code_assign();
drop function if exists private.next_project_code(integer);

-- 기존 프로젝트: 시작일 기준으로 연번 부여 (이름 · 연번은 드라이브 폴더와 같게 관리자가 맞춤)
update public.projects set code = private.project_code_for(coalesce(start_date, (created_at at time zone 'Asia/Seoul')::date)) where code is null or code ~ '^TW';
