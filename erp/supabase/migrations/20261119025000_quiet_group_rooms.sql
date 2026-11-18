-- 조용한 그룹방 보관 (2026-11-19 대표 지시 '개선해' · 결정 ① '30일 조용한 방은 보관')
--  - 대상: 프로젝트방 · 1:1 이 아닌 방(사람 3명 이상 그룹방 · 전체 공개방) 중 최근 30일 글이 없는 방. '전체' 방은 그대로
--  - 지우지 않고 보관(is_archived)만 · 보관한 방은 기록 표에 남겨 한 번에 되돌릴 수 있음
--  - 보관한 방에 누가 다시 글을 쓰면 저절로 다시 보임(프로젝트방은 원래 규칙대로 프로젝트 상태를 따름)
create table if not exists private.chat_room_archive_log (
  room_id uuid primary key references public.chat_rooms (id) on delete cascade,
  archived_at timestamptz not null default now(),
  reason text not null,
  restored_at timestamptz
);

create or replace function private.chat_room_wake() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_rooms set is_archived = false
  where id = new.room_id and is_archived and project_id is null;
  if found then update private.chat_room_archive_log set restored_at = now() where room_id = new.room_id and restored_at is null; end if;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'chat_messages_wake_room' and tgrelid = 'public.chat_messages'::regclass) then
    create trigger chat_messages_wake_room after insert on public.chat_messages for each row execute function private.chat_room_wake();
  end if;
end $$;

with quiet as (
  select r.id from public.chat_rooms r
  where not r.is_archived and r.project_id is null
    and (r.members is null or coalesce(array_length(r.members, 1), 0) >= 3)
    and r.name not in ('전체', '# 전체')
    and r.created_at < now() - interval '30 days'
    and not exists (select 1 from public.chat_messages m where m.room_id = r.id and m.created_at > now() - interval '30 days')
), done as (
  update public.chat_rooms r set is_archived = true from quiet q where r.id = q.id returning r.id
)
insert into private.chat_room_archive_log (room_id, reason)
select id, '30일 동안 글 없음 (2026-11-19 정리)' from done
on conflict (room_id) do nothing;
