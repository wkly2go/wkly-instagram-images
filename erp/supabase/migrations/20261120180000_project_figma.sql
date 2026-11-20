-- 2026-11-20 피그잼 · 피그마 연결 (대표 지시 '피그잼 계속 사용중이고 인트라넷에서 사용하고 자료도 저장하는 방식 · 제출용 pdf 도 출력')
-- 편집은 피그잼에서, 인트라넷은 ① 프로젝트에 보드 연결 · 안에서 보기 ② 자료 보관(미리보기 그림 · 프레임 목록 · 보드 글) ③ 프레임을 골라 제출용 PDF 를 만듦.
-- 피그마 읽기 열쇠(개인 접근 토큰 · 읽기 권한만)는 금고 FIGMA_TOKEN · 관리자가 화면에서 넣음(다시 보여 주지 않음).
-- 서버 함수 figma 만 피그마를 부름(verify_jwt true · 활성 팀원 확인) · 30분마다 바뀐 보드만 다시 읽음.

create table if not exists public.project_figma (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  file_key text not null check (file_key ~ '^[A-Za-z0-9]{10,64}$'),
  kind text not null default 'board' check (kind in ('board', 'design', 'slides')),
  url text not null,
  title text not null default '',
  frames jsonb not null default '[]'::jsonb,
  content text,
  thumb_path text,
  last_modified timestamptz,
  checked_at timestamptz,
  sync_error text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, file_key)
);
create index if not exists project_figma_project_idx on public.project_figma (project_id);
alter table public.project_figma enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_figma' and policyname = 'project_figma_select') then
    create policy project_figma_select on public.project_figma for select using ((select public.is_active_member()));
    create policy project_figma_delete on public.project_figma for delete using ((select public.is_active_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));
  end if;
end $$;
revoke all on table public.project_figma from anon;
grant select, delete on table public.project_figma to authenticated;

create table if not exists public.figma_exports (
  id uuid primary key default gen_random_uuid(),
  figma_id uuid not null references public.project_figma (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  node_ids text[] not null default '{}',
  pages int not null default 0,
  path text not null,
  drive_file_id text,
  drive_url text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists figma_exports_project_idx on public.figma_exports (project_id, created_at desc);
alter table public.figma_exports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'figma_exports' and policyname = 'figma_exports_select') then
    create policy figma_exports_select on public.figma_exports for select using ((select public.is_active_member()));
    -- 드라이브에 올린 뒤 주소만 적음
    create policy figma_exports_update on public.figma_exports for update using ((select public.is_active_member())) with check ((select public.is_active_member()));
  end if;
end $$;
revoke all on table public.figma_exports from anon;
grant select, update (drive_file_id, drive_url) on table public.figma_exports to authenticated;

-- 미리보기 그림 · 만든 PDF (비공개 · 팀원 읽기 · 쓰기는 서버 함수만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('figma-files', 'figma-files', false, 52428800, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'figma_files_obj_read') then
    create policy figma_files_obj_read on storage.objects for select to authenticated
      using (bucket_id = 'figma-files' and (select public.is_active_member()));
  end if;
end $$;

-- 피그마 열쇠: 넣기 · 지우기는 관리자 · 읽기는 서버만 · 있는지 여부는 팀원
create or replace function public.figma_secret_set(p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 연결할 수 있습니다.' using errcode = '42501'; end if;
  select id into v_id from vault.secrets where name = 'FIGMA_TOKEN';
  if coalesce(btrim(p_value), '') = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if length(p_value) > 300 or p_value ~ '\s' then raise exception '값 형식을 확인해 주세요.'; end if;
  if v_id is null then perform vault.create_secret(p_value, 'FIGMA_TOKEN', '피그마 읽기 열쇠 (figma 함수 · 읽기 권한만)');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
create or replace function public.figma_secret_get()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'FIGMA_TOKEN' limit 1
$$;
create or replace function public.figma_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('token', exists (select 1 from vault.secrets where name = 'FIGMA_TOKEN'))
   where (select public.is_active_member())
$$;
revoke all on function public.figma_secret_set(text), public.figma_secret_get(), public.figma_status() from public, anon, authenticated;
grant execute on function public.figma_secret_set(text), public.figma_status() to authenticated;
grant execute on function public.figma_secret_get() to service_role;

-- 30분마다 바뀐 보드만 다시 읽기 (열쇠 · 연결한 보드가 있을 때만 · 정각 · 5분 단위 피함)
create or replace function private.figma_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'FIGMA_TOKEN') then return; end if;
  if not exists (select 1 from public.project_figma) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/figma',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 90000
  );
end $$;
revoke all on function private.figma_tick() from public;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'figma_sync') then perform cron.unschedule('figma_sync'); end if;
  perform cron.schedule('figma_sync', '17,47 * * * *', 'select private.figma_tick()');
end $$;

notify pgrst, 'reload schema';
