-- 외부 협업방 ↔ 화이트보드 공유 (로드맵 3-4 · 2026-11-27 대표 지시 '외부 협업가능하게 만들어')
--  - 팀원이 협업방마다 그 프로젝트의 화이트보드를 골라 공유(고칠 수 있음 / 보기만). 외부인은 표를 못 보고 서버 함수 collab 으로만.
--  - 외부인이 저장하면 project_boards.guest_editor 에 이름을 적음(저장이 어긋났을 때 '○○님이 먼저 저장' 안내용) · 팀원이 저장하면 비움.
create table if not exists public.collab_room_boards (
  room_id uuid not null references public.collab_rooms (id) on delete cascade,
  board_id uuid not null references public.project_boards (id) on delete cascade,
  can_edit boolean not null default true,
  shared_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, board_id)
);
create index if not exists collab_room_boards_board_idx on public.collab_room_boards (board_id);
alter table public.collab_room_boards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'collab_room_boards' and policyname = 'collab_room_boards_select') then
    create policy collab_room_boards_select on public.collab_room_boards for select to authenticated using ((select public.is_active_member()));
    create policy collab_room_boards_insert on public.collab_room_boards for insert to authenticated with check ((select public.is_active_member()));
    create policy collab_room_boards_update on public.collab_room_boards for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
    create policy collab_room_boards_delete on public.collab_room_boards for delete to authenticated using ((select public.is_active_member()));
  end if;
end $$;
revoke all on table public.collab_room_boards from anon, public;
grant select, insert, update, delete on table public.collab_room_boards to authenticated;

alter table public.project_boards add column if not exists guest_editor text check (guest_editor is null or length(guest_editor) <= 80);

-- 저장(팀원): 외부인 이름 표시를 비우고, 어긋났을 때 마지막에 저장한 사람이 외부인이면 그 이름을 돌려줌 (시그니처 그대로 · DROP 없음)
create or replace function public.board_save(p_id uuid, p_scene jsonb, p_version int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v int; cur record;
begin
  update public.project_boards set scene = p_scene, version = version + 1, updated_by = auth.uid(), guest_editor = null, updated_at = now()
   where id = p_id and version = p_version
  returning version into v;
  if v is not null then return jsonb_build_object('ok', true, 'version', v); end if;
  select b.version, b.scene, b.updated_at, coalesce(b.guest_editor, pr.name, '') as who into cur
    from public.project_boards b left join public.profiles pr on pr.id = b.updated_by where b.id = p_id;
  if not found then raise exception '보드를 찾을 수 없습니다.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', false, 'version', cur.version, 'scene', cur.scene, 'updated_at', cur.updated_at, 'updated_by_name', cur.who);
end $$;
revoke all on function public.board_save(uuid, jsonb, int) from public, anon;
grant execute on function public.board_save(uuid, jsonb, int) to authenticated;

notify pgrst, 'reload schema';
