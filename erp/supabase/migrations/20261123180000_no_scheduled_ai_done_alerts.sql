-- 예약으로 돈 AI 지시의 '완료' 알림은 보내지 않는다 (2026-11-23 대표 지시 '이런 알람 보내지마')
--  - 대상: 제목이 'AI 지시 완료 · [예약 …' 인 알림 (아침 브리핑 · 마감 점검 · 수집 점검처럼 정해진 시각에 저절로 도는 것)
--  - 결과는 그대로 남는다: AI 팀 화면의 지시 기록(agent_instructions.response) · 예약 실행 기록
--  - 사람이 방금 직접 시킨 지시의 완료 알림('AI 지시 완료 · …' 중 [예약 이 아닌 것)은 그대로 보낸다
--  - 알림을 만드는 곳이 서버 함수(agent-chat)라 DB 에서 막는다 · 지우는 표 · 함수 없음
create or replace function private.notifications_skip_scheduled_done() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.title like 'AI 지시 완료 · [예약%' then return null; end if;
  return new;
end $$;
revoke all on function private.notifications_skip_scheduled_done() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.notifications'::regclass and tgname = 'notifications_0_skip_scheduled_done') then
    create trigger notifications_0_skip_scheduled_done before insert on public.notifications
      for each row execute function private.notifications_skip_scheduled_done();
  end if;
end $$;
