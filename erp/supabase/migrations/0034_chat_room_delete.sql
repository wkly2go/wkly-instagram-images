-- 0034 · 채팅방 삭제 (대표 지시 2026-10-17 "채팅방을 삭제할 수 있게 해")
-- 기존 chat_rooms_delete(만든 사람 · 관리자)에 더해, 1:1 대화는 두 당사자 모두 지울 수 있게 (허용 정책 추가)
-- 메시지 · 읽음 기록은 on delete cascade 로 함께 삭제
drop policy if exists chat_rooms_delete_dm on public.chat_rooms;
create policy chat_rooms_delete_dm on public.chat_rooms
  for delete to authenticated
  using ((select public.is_active_member()) and members is not null and (select auth.uid()) = any (members));
