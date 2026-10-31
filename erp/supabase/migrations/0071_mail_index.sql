-- 0071 지메일 연동 (대표 지시 2026-10-31 "지메일 연동해"): 회사 메일함(info@)의 메일 목록을 읽어 프로젝트 · 거래처와 연결
--   - 서버(gmail 함수)만 씀 · 팀원은 읽기만 · 본문 전체는 저장하지 않고 제목 · 미리보기 · 첨부 이름만
--   - 저장될 때 연번(AR2609-03) · 프로젝트 이름 · 보낸/받는 사람 메일 주소(거래처 · 연락처)로 자동 연결
create or replace function public.match_projects(p_text text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.id), '{}')
  from public.projects p
  where p_text is not null and (
    (p.code is not null and length(p.code) >= 7 and p_text ilike '%' || p.code || '%')
    or (length(replace(p.name, ' ', '')) >= 4 and replace(p_text, ' ', '') ilike '%' || replace(p.name, ' ', '') || '%')
  )
$$;
grant execute on function public.match_projects(text) to authenticated;

create table if not exists public.mail_index (
  id             text primary key,
  thread_id      text not null,
  from_name      text,
  from_addr      text,
  to_addr        text,
  subject        text,
  snippet        text,
  sent_at        timestamptz,
  labels         text[] not null default '{}',
  has_attachment boolean not null default false,
  attachments    text[] not null default '{}',
  project_ids    uuid[] not null default '{}',
  client_id      uuid references public.clients (id),
  contact_id     uuid references public.contacts (id),
  synced_at      timestamptz not null default now()
);
create index if not exists mail_index_sent on public.mail_index (sent_at desc);
create index if not exists mail_index_projects on public.mail_index using gin (project_ids);
create index if not exists mail_index_client on public.mail_index (client_id);
alter table public.mail_index enable row level security;
create policy mail_index_read on public.mail_index for select to authenticated using ((select public.is_active_member()));
grant select on public.mail_index to authenticated;

create or replace function private.mail_link() returns trigger language plpgsql set search_path = '' as $$
declare
  v_other text := case when new.from_addr ilike '%@thewklyn.com' then new.to_addr else new.from_addr end;
  v_contact uuid;
  v_client uuid;
begin
  new.project_ids := public.match_projects(concat_ws(' ', new.subject, new.snippet, array_to_string(new.attachments, ' ')));
  if v_other is not null then
    select c.id, c.client_id into v_contact, v_client from public.contacts c where lower(c.email) = lower(v_other) limit 1;
    if v_client is null then
      select k.id into v_client from public.clients k where lower(k.email) = lower(v_other) limit 1;
    end if;
    -- 거래처를 알면 그 거래처의 진행 · 기획 프로젝트가 하나뿐일 때 그 프로젝트에도 연결
    if v_client is not null and cardinality(new.project_ids) = 0 then
      new.project_ids := coalesce((select array_agg(p.id) from public.projects p where p.client_id = v_client and p.status in ('진행', '기획', 'NIC') having count(*) = 1), '{}');
    end if;
  end if;
  new.contact_id := v_contact;
  new.client_id := v_client;
  return new;
end $$;
create or replace trigger mail_index_link before insert or update of subject, snippet, attachments, from_addr, to_addr on public.mail_index for each row execute function private.mail_link();

-- 10분마다 새 메일 읽기 (드라이브와 같은 열쇠)
create or replace function private.gmail_sync_tick() returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'GOOGLE_DRIVE_REFRESH_TOKEN') then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/gmail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
select cron.schedule('wkly_gmail_sync', '*/10 * * * *', 'select private.gmail_sync_tick()');
