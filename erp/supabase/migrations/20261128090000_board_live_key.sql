-- 화이트보드 실시간 커서 (2026-11-28 대표 지시 '외부인 실시간 커서도 개발 진행해')
--  - 외부인은 로그인이 없어 팀원용 비공개 방송 주제(board:<id>)에 못 들어옴
--    → 보드마다 추측할 수 없는 '실시간 열쇠'(live_key)를 두고, 그 이름의 방송 주제로 마우스 위치만 주고받음(DB 에 쓰지 않음)
--  - 팀원은 보드를 읽을 때(RLS), 외부인은 서버 함수 collab-board 가 공유된 보드에 한해 열쇠를 줌
--  - 협업방 공유를 끄면 열쇠를 새로 만들어, 나간 외부인이 예전 주제를 계속 듣지 못하게 함
alter table public.project_boards
  add column if not exists live_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

create or replace function private.board_live_key_rotate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.project_boards
     set live_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   where id = old.board_id;
  return old;
end $$;
revoke all on function private.board_live_key_rotate() from public, anon, authenticated;

drop trigger if exists collab_room_boards_rotate_live on public.collab_room_boards;
create trigger collab_room_boards_rotate_live
  after delete on public.collab_room_boards
  for each row execute function private.board_live_key_rotate();
