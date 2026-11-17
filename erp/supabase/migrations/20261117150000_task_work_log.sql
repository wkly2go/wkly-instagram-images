-- 할 일 → 업무 일지 연동 (2026-11-17 대표 지시 '내할일을 수정하면 업무일지 까지 연동되게 만들어')
--
-- 할 일을 '진행 중' · '완료'로 바꾸거나, 진행 중인 할 일의 메모를 고치면 그날(한국 시각) 업무 일지에 한 줄이 자동으로 적힌다.
--  · 일지 주인 = 담당자(없으면 만든 사람). AI 팀원(profiles.is_agent)의 할 일은 적지 않는다.
--  · 하루에 할 일 하나당 한 줄: 같은 날 다시 바꾸면 그 줄을 고친다 ('… — 진행 중' → '… — 완료').
--  · 그날 이미 손으로 적은 일지에 할 일 제목이 들어 있으면 새로 적지 않고 그 일지에 연결만 한다(중복 방지).
--  · 다시 '할 일'로 되돌리면 그날 자동 기록만 지운다. 사람이 글을 고친 기록은 지우거나 덮어쓰지 않는다.
--  · 제목 · 프로젝트 · 메모를 고치면 연결된 일지도 따라 바뀐다(자동으로 적힌 글 그대로인 것만).
--  · 일지 쪽에 문제가 생겨도 할 일 저장은 막지 않는다(경고만 남김).
-- 지난 할 일은 거슬러 채우지 않는다. 글 모양은 화면의 src/lib/taskLog.ts 와 같아야 한다.

alter table public.work_logs add column if not exists task_id uuid references public.tasks(id) on delete set null;
comment on column public.work_logs.task_id is '이 기록이 연결된 할 일 (할 일 상태 · 메모 변경으로 자동 기록되었거나 같은 날 손으로 적은 기록에 연결됨)';
create index if not exists work_logs_task_id_idx on public.work_logs (task_id) where task_id is not null;

create or replace function private.task_log_text(p_title text, p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(coalesce(p_title, '')), 300) || case when p_status = '완료' then ' — 완료' else ' — 진행 중' end
$$;

create or replace function private.task_to_work_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid;
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_log uuid;
  v_title text := btrim(coalesce(new.title, ''));
  v_memo text := nullif(left(btrim(coalesce(new.memo, '')), 1000), '');
  v_old_title text;
  v_old_memo text;
  v_old_project uuid;
  v_texts text[];
  v_text text;
  v_ensure boolean := false;
begin
  begin
    v_user := coalesce(new.assignee_id, new.created_by);
    if v_user is null or v_title = '' or exists (select 1 from public.profiles p where p.id = v_user and p.is_agent) then
      return new;
    end if;

    if tg_op = 'UPDATE' then
      v_old_title := btrim(coalesce(old.title, ''));
      v_old_memo := nullif(left(btrim(coalesce(old.memo, '')), 1000), '');
      v_old_project := old.project_id;
    else
      v_old_title := v_title;
      v_old_memo := v_memo;
      v_old_project := new.project_id;
    end if;
    -- 자동으로 적힌 글(예전 제목 · 새 제목 × 두 상태). 이 가운데 하나와 같을 때만 사람이 안 고친 기록으로 본다
    v_texts := array[
      private.task_log_text(v_old_title, '완료'), private.task_log_text(v_old_title, '진행 중'),
      private.task_log_text(v_title, '완료'), private.task_log_text(v_title, '진행 중')
    ];

    if tg_op = 'INSERT' then
      v_ensure := new.status in ('진행 중', '완료');
    else
      if new.status is distinct from old.status then
        if new.status in ('진행 중', '완료') then
          v_ensure := true;
        else
          -- 다시 '할 일'로: 그날 자동 기록만 지움 (사람이 고친 글 · 손으로 적어 연결된 기록은 남김)
          delete from public.work_logs
          where task_id = new.id and user_id = v_user and log_date = v_day and content = any (v_texts);
        end if;
      end if;

      -- 제목 · 프로젝트 · 메모를 고치면 연결된 일지도 따라감
      if v_title is distinct from v_old_title then
        update public.work_logs set content = private.task_log_text(v_title, '완료')
        where task_id = new.id and content = private.task_log_text(v_old_title, '완료');
        update public.work_logs set content = private.task_log_text(v_title, '진행 중')
        where task_id = new.id and content = private.task_log_text(v_old_title, '진행 중');
      end if;
      if new.project_id is distinct from old.project_id then
        update public.work_logs set project_id = new.project_id
        where task_id = new.id and project_id is not distinct from old.project_id;
      end if;
      if v_memo is distinct from v_old_memo then
        update public.work_logs set memo = v_memo
        where task_id = new.id and log_date = v_day and memo is not distinct from v_old_memo;
        -- 진행 중인 할 일에 메모를 적었으면 오늘 한 일로 본다
        if new.status = '진행 중' then
          v_ensure := true;
        end if;
      end if;
    end if;

    if v_ensure then
      v_text := private.task_log_text(v_title, new.status);
      select l.id into v_log from public.work_logs l
      where l.task_id = new.id and l.user_id = v_user and l.log_date = v_day
      order by l.created_at limit 1;

      if v_log is not null then
        update public.work_logs
        set content = case when content = any (v_texts) then v_text else content end,
            project_id = case when project_id is null or project_id is not distinct from v_old_project then new.project_id else project_id end,
            memo = case when memo is null or memo is not distinct from v_old_memo then v_memo else memo end
        where id = v_log;
      else
        -- 오늘 이미 손으로 적은 기록에 이 할 일 제목이 있으면 새로 적지 않고 연결만
        if char_length(v_title) >= 4 then
          select l.id into v_log from public.work_logs l
          where l.user_id = v_user and l.log_date = v_day and l.task_id is null
            and position(lower(v_title) in lower(l.content)) > 0
          order by l.created_at desc limit 1;
        end if;
        if v_log is not null then
          update public.work_logs set task_id = new.id, project_id = coalesce(project_id, new.project_id) where id = v_log;
        else
          insert into public.work_logs (user_id, log_date, kind, content, project_id, memo, task_id)
          values (v_user, v_day, '업무', v_text, new.project_id, v_memo, new.id);
        end if;
      end if;
    end if;
  exception when others then
    -- 일지 연동이 실패해도 할 일 저장은 그대로 된다
    raise warning 'task_to_work_log: % (task %)', sqlerrm, new.id;
  end;
  return new;
end;
$fn$;

drop trigger if exists tasks_work_log on public.tasks;
create trigger tasks_work_log
  after insert or update of status, title, memo, project_id on public.tasks
  for each row execute function private.task_to_work_log();

revoke execute on function private.task_log_text(text, text) from public, anon, authenticated;
revoke execute on function private.task_to_work_log() from public, anon, authenticated;
