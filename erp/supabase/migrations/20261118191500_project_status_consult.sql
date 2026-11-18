-- 프로젝트 상태 '상담협의' 추가 (2026-11-18 대표 지시 '상담협의 항목을 추가해')
-- 문의 · 상담 단계 — 기획보다 앞. 프로젝트 대화방은 기획 · 진행처럼 열어 둠.
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status = any (array['상담협의', '기획', '진행', 'NIC', '완료', '보류']));

create or replace function private.project_room_sync()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text := left(btrim(coalesce(new.code || ' ', '') || new.name), 60);
begin
  if new.status in ('상담협의', '기획', '진행') then
    if exists (select 1 from public.chat_rooms where project_id = new.id and members is null) then
      update public.chat_rooms set is_archived = false, name = v_name
       where project_id = new.id and members is null and (is_archived or name is distinct from v_name);
    else
      insert into public.chat_rooms (name, description, project_id, created_by)
      values (v_name, '프로젝트 대화 · 할 일 · 결재 · 파일이 여기에 모입니다', new.id, coalesce(new.owner_id, new.created_by));
    end if;
  else
    update public.chat_rooms set is_archived = true where project_id = new.id and members is null and not is_archived;
  end if;
  return null;
exception when unique_violation then
  return null;
end $function$;
