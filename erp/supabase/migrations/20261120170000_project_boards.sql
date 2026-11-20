-- 2026-11-20 협업 화이트보드 (로드맵 3단계 3-1 · 3-2 앞당김 · 대표 지시 '개발 진행해')
-- 프로젝트마다 여러 장의 보드(Excalidraw · MIT · 무료). 그림 자료(scene)는 jsonb 한 칸, 붙인 사진은 비공개 보관함 project-boards.
-- 동시 편집: 저장할 때 version 이 맞을 때만 저장(board_save) · 다르면 서버 쪽 그림을 돌려주고 화면이 요소별로 합쳐 다시 저장.
--   같은 보드를 연 사람끼리는 비공개 방송 주제 'board:<id>' 로 '저장함' · 접속 표시만 주고받음(그림은 DB 로).
-- 읽기 · 만들기 · 고치기: 활성 팀원 · 지우기: 만든 사람 · 관리자. 로그인 없는(anon) 권한 없음.

create table if not exists public.project_boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '새 보드' check (length(btrim(title)) between 1 and 60),
  scene jsonb not null default '{}'::jsonb check (octet_length(scene::text) < 4000000),
  version int not null default 1,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_boards_project_idx on public.project_boards (project_id, updated_at desc);
alter table public.project_boards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_boards' and policyname = 'project_boards_select') then
    create policy project_boards_select on public.project_boards for select using ((select public.is_active_member()));
    create policy project_boards_insert on public.project_boards for insert with check ((select public.is_active_member()) and created_by = (select auth.uid()));
    create policy project_boards_update on public.project_boards for update using ((select public.is_active_member())) with check ((select public.is_active_member()));
    create policy project_boards_delete on public.project_boards for delete using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
  end if;
end $$;
revoke all on table public.project_boards from anon;
grant select, insert, update, delete on table public.project_boards to authenticated;

-- 저장: 버전이 맞을 때만 (부르는 사람 권한 그대로)
create or replace function public.board_save(p_id uuid, p_scene jsonb, p_version int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v int; cur record;
begin
  update public.project_boards set scene = p_scene, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id and version = p_version
  returning version into v;
  if v is not null then return jsonb_build_object('ok', true, 'version', v); end if;
  select b.version, b.scene, b.updated_at, coalesce(pr.name, '') as who into cur
    from public.project_boards b left join public.profiles pr on pr.id = b.updated_by where b.id = p_id;
  if not found then raise exception '보드를 찾을 수 없습니다.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', false, 'version', cur.version, 'scene', cur.scene, 'updated_at', cur.updated_at, 'updated_by_name', cur.who);
end $$;
revoke all on function public.board_save(uuid, jsonb, int) from public, anon;
grant execute on function public.board_save(uuid, jsonb, int) to authenticated;

-- 붙인 사진 · 도면 (보드마다 폴더 <보드 id>/<파일 id>.<확장자> · 지우지 않음)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-boards', 'project-boards', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_boards_obj_read') then
    create policy project_boards_obj_read on storage.objects for select to authenticated
      using (bucket_id = 'project-boards' and (select public.is_active_member()));
    create policy project_boards_obj_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'project-boards' and (select public.is_active_member()));
  end if;
end $$;

-- 같은 보드를 연 사람끼리 '저장함' · 접속 표시 (팀원만)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'board_live_read') then
    create policy board_live_read on realtime.messages for select to authenticated
      using (extension in ('broadcast', 'presence') and realtime.topic() like 'board:%' and (select public.is_active_member()));
    create policy board_live_write on realtime.messages for insert to authenticated
      with check (extension in ('broadcast', 'presence') and realtime.topic() like 'board:%' and (select public.is_active_member()));
  end if;
end $$;

notify pgrst, 'reload schema';
