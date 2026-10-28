-- 0062 AI 팀원 실시간 답 (2026-10-28 "wkly 총괄은 실시간 채팅이 가능한 버전으로")
-- agent-chat 이 쓰는 중인 답을 Realtime 비공개 방송(topic 'agent:<방 id>')으로 보냄.
-- 받기: 그 방을 볼 수 있는 사람만 (chat_rooms 의 RLS 를 그대로 따름)
create policy agent_live_draft_read on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'agent:%'
    and exists (select 1 from public.chat_rooms r where r.id::text = substr(realtime.topic(), 7))
  );
