-- WKLY ERP 0030: 프로젝트 연번 (구글 드라이브 폴더 이름 규칙 'TW' + 연도 두 자리 + 순번 두 자리, 예: TW2601)
--   새 프로젝트를 만들면 그 해의 다음 번호가 자동으로 붙는다. 관리자는 바꿀 수 있다.

alter table public.projects add column if not exists code text;
create unique index if not exists projects_code_key on public.projects (code) where code is not null;
comment on column public.projects.code is '연번 TWyyNN (드라이브 폴더 이름과 같음)';

create or replace function private.next_project_code(p_year integer)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := 'TW' || lpad((p_year % 100)::text, 2, '0');
  v_max integer;
begin
  select coalesce(max(substring(code from 5)::integer), 0) into v_max
    from public.projects where code ~ ('^' || v_prefix || '[0-9]{2,}$');
  return v_prefix || lpad((v_max + 1)::text, 2, '0');
end;
$$;

create or replace function private.project_code_assign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or new.code = '' then
    new.code := private.next_project_code(extract(year from coalesce(new.start_date, (now() at time zone 'Asia/Seoul')::date))::integer);
  end if;
  return new;
end;
$$;
drop trigger if exists projects_code_assign on public.projects;
create trigger projects_code_assign before insert on public.projects for each row execute function private.project_code_assign();

-- 기존 프로젝트: 만든 순서대로 번호 붙임
do $$
declare
  r record;
begin
  for r in select id, start_date, created_at from public.projects where code is null order by created_at loop
    update public.projects set code = private.next_project_code(extract(year from coalesce(r.start_date, (r.created_at at time zone 'Asia/Seoul')::date))::integer) where id = r.id;
  end loop;
end;
$$;
