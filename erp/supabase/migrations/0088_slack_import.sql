-- 슬랙 대화 · 자료를 프로젝트로 가져오기 (대표 지시 2026-11-05 "슬랙의 채팅과 자료 공유를 프로젝트 폴더에 가져오기")
--   - 슬랙 앱(봇) 토큰은 Vault 에만 (관리자가 인트라넷 화면에서 넣음 · 대화로 받지 않음)
--   - slack_links    : 프로젝트 ↔ 슬랙 채널 연결 (어디까지 가져왔는지 last_ts)
--   - slack_messages : 가져온 대화 한 줄씩 (파일은 드라이브 프로젝트 폴더에 저장한 링크)
--   - 쓰기는 서버 함수(slack-import)만, 읽기는 팀원 누구나

create or replace function public.slack_secret_get() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'SLACK_BOT_TOKEN' limit 1
$$;
create or replace function public.slack_secret_set(p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'SLACK_BOT_TOKEN';
  if p_value is null or p_value = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return;
  end if;
  if v_id is null then perform vault.create_secret(p_value, 'SLACK_BOT_TOKEN', '슬랙 앱 봇 토큰 (slack-import 함수)');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
revoke all on function public.slack_secret_get() from public, anon, authenticated;
revoke all on function public.slack_secret_set(text) from public, anon, authenticated;
grant execute on function public.slack_secret_get() to service_role;
grant execute on function public.slack_secret_set(text) to service_role;

create table if not exists public.slack_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  channel_id text not null,
  channel_name text not null default '',
  last_ts text,
  imported_count integer not null default 0,
  file_count integer not null default 0,
  last_imported_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, channel_id)
);

create table if not exists public.slack_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  channel_id text not null,
  channel_name text not null default '',
  ts text not null,
  thread_ts text,
  user_name text not null default '',
  text text not null default '',
  files jsonb not null default '[]'::jsonb,
  posted_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (project_id, channel_id, ts)
);
create index if not exists slack_messages_project_idx on public.slack_messages (project_id, posted_at desc);

alter table public.slack_links enable row level security;
alter table public.slack_messages enable row level security;
drop policy if exists slack_links_read on public.slack_links;
create policy slack_links_read on public.slack_links for select to authenticated using ((select public.is_active_member()));
drop policy if exists slack_messages_read on public.slack_messages;
create policy slack_messages_read on public.slack_messages for select to authenticated using ((select public.is_active_member()));
