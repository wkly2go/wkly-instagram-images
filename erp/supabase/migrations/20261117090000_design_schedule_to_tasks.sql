-- 설계 공정 → 인트라넷 할 일 · 달력 · 구글 캘린더 구독 (대표 지시 2026-11-17 '인테리어 개발도 진행해' · DESIGN_INTEGRATION 남은 일 '공정 → 구글 캘린더')
-- design.schedule_tasks 를 넣고 · 고치고 · 지우면 같은 프로젝트(public.projects.id = design.projects.id)의 할 일이 따라 바뀐다.
-- 할 일은 phase '공정' · origin_ref 'design:<공정 id>' 로 묶여 calendar-feed 구독 주소를 거쳐 구글 캘린더에도 보인다.
-- 기존 표 · 제약은 바꾸지 않는다(origin 칸은 비워 둠). 인트라넷에서 그 할 일을 '완료'로 바꾸면 공정 완료 표시도 같이 바뀐다.
create unique index if not exists tasks_design_schedule_ref on public.tasks (origin_ref) where origin_ref like 'design:%';

create or replace function private.design_schedule_to_task()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_ref text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    v_ref := 'design:' || old.id::text;
    delete from public.tasks where origin_ref = v_ref and status <> '완료';
    update public.tasks set origin_ref = null where origin_ref = v_ref;
    return null;
  end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id) then return null; end if;
  v_ref := 'design:' || new.id::text;
  v_title := '[공정] ' || coalesce((select t.name || ' · ' from design.trades t where t.code = new.trade_code), '') || new.name;
  insert into public.tasks (project_id, title, start_date, due_date, status, phase, origin_ref, created_by, memo)
  values (new.project_id, left(v_title, 200), new.start_date, new.end_date, case when new.done then '완료' else '할 일' end,
          '공정', v_ref, auth.uid(), '설계·견적 › 공정표에서 자동으로 만든 할 일입니다. 날짜 · 이름은 공정표에서 고치세요.')
  on conflict (origin_ref) where origin_ref like 'design:%' do update
    set title = excluded.title, start_date = excluded.start_date, due_date = excluded.due_date,
        status = case when new.done then '완료' when public.tasks.status = '완료' then '할 일' else public.tasks.status end;
  return null;
end $$;

create or replace trigger design_schedule_to_task after insert or update or delete on design.schedule_tasks
  for each row execute function private.design_schedule_to_task();

-- 인트라넷 할 일 완료 → 공정 완료 표시
create or replace function private.task_to_design_schedule()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.origin_ref like 'design:%' and new.status is distinct from old.status then
    update design.schedule_tasks set done = (new.status = '완료')
     where id::text = substr(new.origin_ref, 8) and done is distinct from (new.status = '완료');
  end if;
  return null;
end $$;

create or replace trigger tasks_to_design_schedule after update of status on public.tasks
  for each row when (new.origin_ref like 'design:%') execute function private.task_to_design_schedule();

revoke all on function private.design_schedule_to_task() from public, anon, authenticated;
revoke all on function private.task_to_design_schedule() from public, anon, authenticated;
