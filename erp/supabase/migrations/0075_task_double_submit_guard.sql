-- 같은 할 일이 두 번 만들어지는 것 막기 (대표 지시 2026-10-31 "동일 내용인 거 확인하고 합쳐")
--  - 저장 버튼을 두 번 누르거나 Enter 와 클릭이 겹쳐 2~3초 사이에 똑같은 할 일이 2개 생기던 문제
--  - 같은 프로젝트 · 같은 제목 · 같은 담당 · 같은 기간을 30초 안에 또 만들면 거절 (첫 번째는 그대로 저장됨)
create or replace function private.task_double_submit_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if exists (
    select 1 from public.tasks t
    where t.project_id is not distinct from new.project_id
      and regexp_replace(btrim(t.title), '\s+', ' ', 'g') = regexp_replace(btrim(new.title), '\s+', ' ', 'g')
      and t.assignee_id is not distinct from new.assignee_id
      and t.due_date is not distinct from new.due_date
      and t.start_date is not distinct from new.start_date
      and t.created_at > now() - interval '30 seconds'
  ) then
    raise exception '방금 같은 할 일을 만들었습니다. (두 번 저장 방지)' using errcode = 'unique_violation';
  end if;
  return new;
end $$;

create trigger task_double_submit_guard before insert on public.tasks
for each row execute function private.task_double_submit_guard();
