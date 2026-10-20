-- 0046 · 프로젝트 3구분 · 구분별 연번 · 대표 색상 (대표 지시 2026-10-21
--   "프로젝트를 아트리어 · 더위클리 · 내부 리서치 프로젝트로 구분해서 각 프로젝트의 연번 다르게, 대표 색상도 부여")
-- 구분(division): AR 아트리어 · TW 더위클리 · RS 내부 리서치  (색상은 화면: AR 그린 · TW 블루 · RS 핑크)
-- 연번: 구분 + 시작 연월 + '-' + 그달 일련번호  예) AR2610-01, TW2610-03, RS2610-01  (프로젝트마다 다름)
--   드라이브 ARTERIOR 폴더 규칙(AR + 연월)은 '-' 앞부분이 그대로 맞음. AR0000(경영 관리 폴더)은 그대로 둠.
alter table public.projects add column if not exists division text not null default 'AR';
alter table public.projects drop constraint if exists projects_division_check;
alter table public.projects add constraint projects_division_check check (division in ('AR', 'TW', 'RS'));

update public.projects set division = 'TW' where code like 'TW%';
-- 내부 연구 · 시스템 프로젝트는 내부 리서치로
update public.projects set division = 'RS' where name in ('입찰·제안 파이프라인', '마감재 DB·라이브러리', '인테리어 AI 디자인자동화');

-- 다음 연번: 구분 + 연월 + 그달 일련번호(2자리)
create or replace function private.project_code_next(p_division text, p_day date)
returns text
language sql
stable
set search_path to ''
as $$
  select p_division || to_char(p_day, 'YYMM') || '-' || lpad((coalesce(max(split_part(code, '-', 2)::int), 0) + 1)::text, 2, '0')
  from public.projects
  where code like p_division || to_char(p_day, 'YYMM') || '-%'
    and split_part(code, '-', 2) ~ '^[0-9]{1,4}$'
$$;

-- 연번 자동: 새 프로젝트는 구분별 다음 번호, 구분을 바꾸면 그 구분 번호로 다시 매김
create or replace function private.project_code_assign()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' and new.division is distinct from old.division
     and new.code is not distinct from old.code and old.code ~ '^(AR|TW|RS)[0-9]{4}-[0-9]+$' then
    new.code := private.project_code_next(new.division, coalesce(new.start_date, (old.created_at at time zone 'Asia/Seoul')::date));
  end if;
  if new.code is null or btrim(new.code) = '' then
    new.code := private.project_code_next(new.division, coalesce(new.start_date, (now() at time zone 'Asia/Seoul')::date));
  end if;
  return new;
end;
$$;
drop trigger if exists projects_code_assign on public.projects;
create trigger projects_code_assign before insert or update of code, division on public.projects
  for each row execute function private.project_code_assign();

-- 기존 연번(AR2610 처럼 같은 번호가 여럿)을 프로젝트마다 다르게: 구분 · 연월별로 만든 순서대로 -01, -02 …
with x as (
  select id, division, substr(code, 3, 4) as ym,
         row_number() over (partition by division, substr(code, 3, 4) order by created_at, name) as rn
  from public.projects
  where code ~ '^(AR|TW)[0-9]{4}$' and code <> 'AR0000'
)
update public.projects p
   set code = x.division || x.ym || '-' || lpad(x.rn::text, 2, '0')
  from x
 where p.id = x.id;

create unique index if not exists projects_code_unique on public.projects (code) where code is not null;
