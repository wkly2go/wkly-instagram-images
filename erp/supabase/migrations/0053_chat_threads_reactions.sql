-- 채팅 스레드(답글) · 이모지 반응 (2026-10-22 슬랙 참고 개선)
--  - parent_id: 답글이 달린 원래 메시지. 원래 메시지를 지우면 답글도 지워짐
--  - reactions: {"👍": ["user-id", ...], ...} — 본인만 메시지를 고칠 수 있으므로 반응은 chat_react() 로만 바꿈
alter table public.chat_messages add column if not exists parent_id bigint references public.chat_messages(id) on delete cascade;
alter table public.chat_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
create index if not exists chat_messages_parent_idx on public.chat_messages (parent_id) where parent_id is not null;

-- 답글은 같은 방 메시지에만, 답글의 답글은 원래 메시지로 붙임
create or replace function private.chat_parent_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_parent bigint;
begin
  if new.parent_id is null then return new; end if;
  select room_id, parent_id into v_room, v_parent from public.chat_messages where id = new.parent_id;
  if v_room is null or v_room <> new.room_id then raise exception '같은 방 메시지에만 답글을 달 수 있습니다.'; end if;
  if v_parent is not null then new.parent_id := v_parent; end if;
  return new;
end $$;
create or replace trigger chat_parent_check before insert on public.chat_messages
  for each row execute function private.chat_parent_check();

-- 반응 넣기 · 빼기 (같은 이모지를 다시 누르면 뺌). 그 방을 볼 수 있는 팀원만
create or replace function public.chat_react(p_message bigint, p_emoji text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_r jsonb; v_list jsonb; v_me text := auth.uid()::text;
begin
  if v_me is null or not public.is_active_member() then raise exception '로그인이 필요합니다.'; end if;
  if p_emoji is null or length(p_emoji) > 16 then raise exception '반응을 확인해 주세요.'; end if;
  select room_id, reactions into v_room, v_r from public.chat_messages where id = p_message for update;
  if v_room is null or not public.chat_room_visible(v_room) then raise exception '메시지를 찾을 수 없습니다.'; end if;
  v_list := coalesce(v_r -> p_emoji, '[]'::jsonb);
  if v_list ? v_me then
    v_list := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v_list) x where x <> v_me);
  else
    v_list := v_list || to_jsonb(v_me);
  end if;
  v_r := case when jsonb_array_length(v_list) = 0 then coalesce(v_r, '{}'::jsonb) - p_emoji else jsonb_set(coalesce(v_r, '{}'::jsonb), array[p_emoji], v_list) end;
  update public.chat_messages set reactions = v_r where id = p_message;
  return v_r;
end $$;
revoke all on function public.chat_react(bigint, text) from public, anon;
grant execute on function public.chat_react(bigint, text) to authenticated;

-- 답글 알림: 원래 메시지를 쓴 사람(본인 · AI 제외)에게 (알림 종류는 기존 '멘션' 사용 — notifications.kind 허용 값)
create or replace function private.chat_reply_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_author uuid; v_sender text;
begin
  if new.parent_id is null then return null; end if;
  select m.user_id into v_author from public.chat_messages m where m.id = new.parent_id;
  if v_author is null or v_author = new.user_id or exists (select 1 from public.profiles p where p.id = v_author and (p.is_agent or not p.active)) then return null; end if;
  select coalesce(nullif(btrim(p.name), ''), '누군가') into v_sender from public.profiles p where p.id = new.user_id;
  perform public.notify(v_author, '멘션', coalesce(v_sender, '누군가') || '님이 답글을 남겼어요', left(new.content, 80), '/chat?room=' || new.room_id || '&thread=' || new.parent_id);
  return null;
exception when others then
  return null; -- 알림 실패가 답글 저장을 막지 않게
end $$;
create or replace trigger chat_reply_notify after insert on public.chat_messages
  for each row execute function private.chat_reply_notify();
