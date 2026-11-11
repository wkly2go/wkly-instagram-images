-- 카카오톡 '대화 내용 내보내기' 가져오기 (로드맵 1-3 · 2026-11-11)
--   팀원이 내보낸 .txt/.csv 를 프로젝트에 올리면 한 줄씩 저장 (같은 메시지는 hash 로 한 번만)
--   사진 · 파일은 드라이브 프로젝트 수신방에 저장하고 링크만 kakao_imports.files 에
create table if not exists public.kakao_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '카카오톡 대화',
  file_name text,
  message_count integer not null default 0,
  files jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.kakao_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  import_id uuid references public.kakao_imports(id) on delete cascade,
  sent_at timestamptz not null,
  sender text not null default '',
  content text not null default '' check (char_length(content) <= 20000),
  attachment text,
  hash text not null,
  created_at timestamptz not null default now(),
  unique (project_id, hash)
);
create index if not exists kakao_messages_project_idx on public.kakao_messages (project_id, sent_at desc);
alter table public.kakao_imports enable row level security;
alter table public.kakao_messages enable row level security;
drop policy if exists kakao_imports_read on public.kakao_imports;
create policy kakao_imports_read on public.kakao_imports for select to authenticated using ((select public.is_active_member()));
drop policy if exists kakao_imports_insert on public.kakao_imports;
create policy kakao_imports_insert on public.kakao_imports for insert to authenticated with check ((select public.is_active_member()) and created_by = (select auth.uid()));
drop policy if exists kakao_imports_update on public.kakao_imports;
create policy kakao_imports_update on public.kakao_imports for update to authenticated using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin()))) with check (true);
drop policy if exists kakao_imports_delete on public.kakao_imports;
create policy kakao_imports_delete on public.kakao_imports for delete to authenticated using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
drop policy if exists kakao_messages_read on public.kakao_messages;
create policy kakao_messages_read on public.kakao_messages for select to authenticated using ((select public.is_active_member()));
drop policy if exists kakao_messages_insert on public.kakao_messages;
create policy kakao_messages_insert on public.kakao_messages for insert to authenticated with check ((select public.is_active_member()));
grant select, insert, update, delete on public.kakao_imports to authenticated;
grant select, insert on public.kakao_messages to authenticated;
