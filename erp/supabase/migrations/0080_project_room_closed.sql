-- 채팅방 삭제 (대표 지시 2026-11-04 "채팅방 삭제 가능하게"): 프로젝트 방을 지우면 프로젝트를 고칠 때 다시 생기지 않게
alter table public.projects add column if not exists room_closed boolean not null default false;
comment on column public.projects.room_closed is '프로젝트 채팅방을 지움 → 자동으로 다시 만들지 않음 (프로젝트 화면 [채팅방]을 누르면 다시 만듦)';

create or replace function private.project_room_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text := left(btrim(coalesce(new.code || ' ', '') || new.name), 60);
begin
  if new.status in ('기획', '진행') then
    if exists (select 1 from public.chat_rooms where project_id = new.id and members is null) then
      update public.chat_rooms set is_archived = false, name = v_name
       where project_id = new.id and members is null and (is_archived or name is distinct from v_name);
    elsif not coalesce(new.room_closed, false) then
      insert into public.chat_rooms (name, description, project_id, created_by)
      values (v_name, '프로젝트 대화 · 할 일 · 결재 · 파일이 여기에 모입니다', new.id, coalesce(new.owner_id, new.created_by));
    end if;
  else
    update public.chat_rooms set is_archived = true where project_id = new.id and members is null and not is_archived;
  end if;
  return null;
exception when unique_violation then
  return null;
end $$;

-- 프로젝트 방이 지워지면 그 프로젝트에 '방 닫음' 표시 · 다시 만들면 표시 해제
create or replace function private.project_room_closed_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.project_id is not null and old.members is null then
    update public.projects set room_closed = true where id = old.project_id and not room_closed;
  elsif tg_op = 'INSERT' and new.project_id is not null and new.members is null then
    update public.projects set room_closed = false where id = new.project_id and room_closed;
  end if;
  return null;
end $$;
drop trigger if exists chat_rooms_project_closed on public.chat_rooms;
create trigger chat_rooms_project_closed after insert or delete on public.chat_rooms
  for each row execute function private.project_room_closed_mark();
