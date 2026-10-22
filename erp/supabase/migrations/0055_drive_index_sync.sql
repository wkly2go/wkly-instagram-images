-- 구글 드라이브 자동 동기화 (대표 지시 "구글 드라이브 연동을 연구해서 정확하게" · 4단계)
--  - 5분마다 gdrive 함수가 회사 계정 드라이브의 변경분(changes API)을 읽어 프로젝트 폴더 안 파일 목록을 이 표에 맞춤
--  - 드라이브는 읽기만 함 (수정 · 삭제 없음). 구글 로그인 없이도 팀원 모두 프로젝트 폴더 파일을 보고 검색 가능
--  - 회사 계정이 연결되기 전에는 아무것도 하지 않음

create table if not exists public.drive_index (
  id           text primary key,                 -- 드라이브 파일 id
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null,
  mime_type    text,
  parent_id    text,
  path         text,                             -- 프로젝트 폴더 기준 경로 (예: '도면/1차')
  url          text,
  icon_url     text,
  size         bigint,
  modified_at  timestamptz,
  modified_by  text,
  synced_at    timestamptz not null default now()
);
create index if not exists drive_index_project_idx on public.drive_index (project_id, modified_at desc);
create index if not exists drive_index_parent_idx on public.drive_index (parent_id);
alter table public.drive_index enable row level security;
drop policy if exists drive_index_read on public.drive_index;
create policy drive_index_read on public.drive_index for select to authenticated using (public.is_active_member());
revoke insert, update, delete on public.drive_index from anon, authenticated;

-- 예약 실행용 열쇠 (서버끼리만 씀) · gdrive 함수가 읽을 수 있는 이름에 추가
create or replace function public.gdrive_secret_get(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_name and p_name in ('GOOGLE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GDRIVE_SYNC_KEY') limit 1
$$;
revoke all on function public.gdrive_secret_get(text) from public, anon, authenticated;
grant execute on function public.gdrive_secret_get(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'GDRIVE_SYNC_KEY') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'GDRIVE_SYNC_KEY', '드라이브 자동 동기화 예약 실행 열쇠');
  end if;
end $$;

-- 5분마다: 회사 계정이 연결돼 있을 때만 gdrive 함수 호출
-- gdrive 함수는 스스로 확인(x-sync-key 또는 팀원 로그인)하므로 JWT 검사 없이 배포 (verify_jwt=false)
create or replace function private.gdrive_sync_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key  text;
  v_url  text := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/gdrive';
begin
  if not exists (select 1 from vault.secrets where name = 'GOOGLE_DRIVE_REFRESH_TOKEN') then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function private.gdrive_sync_tick() from public, anon, authenticated;

select cron.unschedule('wkly_gdrive_sync') where exists (select 1 from cron.job where jobname = 'wkly_gdrive_sync');
select cron.schedule('wkly_gdrive_sync', '*/5 * * * *', 'select private.gdrive_sync_tick()');
