-- 프로젝트 대표 사진 (2026-11-17 대표 지시 '우선순위 1: Houzz Pro 식 화면 개편' · 디자인 계획 '사진이 앞에 오는 카드')
-- gdrive 함수의 5분 동기화가 프로젝트 드라이브 폴더(drive_index)의 사진 중 하나를 골라
-- 작은 미리보기(긴 변 800px)만 비공개 보관함 project-covers 에 넣는다. 원본은 드라이브에 그대로(읽기만).
-- 고르는 순서: 준공 · 촬영 사진 → 성과물 투시도 · 렌더 · 그래픽 → 현장 사진 → 컨셉 · 시안 → 그 밖의 사진
-- 계약 · 견적 · 통장 · 영수증 · 명함 · 캡처 · 로고 같은 사진은 고르지 않는다.
create table if not exists public.project_covers (
  project_id uuid primary key references public.projects(id) on delete cascade,
  drive_id text not null,
  name text,
  path text not null,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  updated_at timestamptz not null default now()
);
alter table public.project_covers enable row level security;
create policy project_covers_read on public.project_covers for select to authenticated
  using ((select public.is_active_member()));
revoke all on table public.project_covers from anon;
grant select on table public.project_covers to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-covers', 'project-covers', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy project_covers_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'project-covers' and (select public.is_active_member()));

-- 10분마다 project-covers 함수 호출 (gdrive 와 같은 열쇠 GDRIVE_SYNC_KEY · 회사 구글 계정이 연결돼 있을 때만)
create or replace function private.project_covers_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'GOOGLE_DRIVE_REFRESH_TOKEN') then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/project-covers',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
end $$;
revoke all on function private.project_covers_tick() from public;
select cron.schedule('project_covers', '3,13,23,33,43,53 * * * *', 'select private.project_covers_tick()');
