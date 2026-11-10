-- 채팅방 참여 팀원 추가 · 제외 (대표 지시 2026-11-10 "채팅방에 참여 팀원을 확인하고 제외하거나 추가할 수 있게")
--   여럿이 보는 비공개 대화방(group, dm_key 없음)만: 참여자 · 관리자가 멤버를 바꿈. 1:1 대화(dm_key)는 그대로.
--   멤버 잠금 트리거는 이 함수 안에서만 통과 (설정값 wkly.members_ok)
create or replace function public.chat_rooms_members_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (new.members is distinct from old.members or new.dm_key is distinct from old.dm_key)
     and coalesce(current_setting('wkly.members_ok', true), '') <> '1' then
    raise exception '대화방 멤버는 바꿀 수 없습니다.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.chat_room_set_members(p_room uuid, p_members uuid[])
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_rooms;
  v uuid[];
begin
  if not public.is_active_member() then raise exception '권한이 없습니다.' using errcode = '42501'; end if;
  select * into r from public.chat_rooms where id = p_room;
  if r.id is null then raise exception '대화방을 찾지 못했습니다.' using errcode = '22023'; end if;
  if r.members is null then raise exception '팀원 모두가 보는 방은 참여자를 따로 정하지 않습니다.' using errcode = '22023'; end if;
  if r.dm_key is not null then raise exception '1:1 대화는 참여자를 바꿀 수 없습니다. 초대하면 새 대화방이 만들어집니다.' using errcode = '22023'; end if;
  if not (public.is_admin() or auth.uid() = any (r.members)) then raise exception '이 대화방 참여자만 바꿀 수 있습니다.' using errcode = '42501'; end if;
  select array_agg(distinct p.id) into v from public.profiles p where p.id = any (p_members) and p.active;
  if coalesce(array_length(v, 1), 0) < 2 then raise exception '대화방에는 2명 이상 있어야 합니다.' using errcode = '22023'; end if;
  perform set_config('wkly.members_ok', '1', true);
  update public.chat_rooms set members = v where id = p_room;
  perform set_config('wkly.members_ok', '', true);
  return v;
end $$;
revoke all on function public.chat_room_set_members(uuid, uuid[]) from public, anon;
grant execute on function public.chat_room_set_members(uuid, uuid[]) to authenticated;
