-- WKLY ERP 0028: 연락처(사람) ↔ 프로젝트 연계 · 주고받은 자료 · 업무 일지의 상대방 자동 연결
--   project_contacts: 프로젝트에 참여하는 거래처 담당자 (역할 메모)
--   exchange_files: 거래처 · 담당자 · 프로젝트와 주고받은 자료 (파일은 exchange-files 저장소, 또는 링크)
--   work_logs.contact_id: 업무 일지(메일 · 전화 · 미팅)의 상대방. 메일 상대 주소가 등록된 담당자 이메일이면 자동 연결

-- 1. 프로젝트 ↔ 담당자
create table if not exists public.project_contacts (
  project_id uuid not null references public.projects (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  role       text check (role is null or char_length(role) <= 60),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, contact_id)
);
create index if not exists project_contacts_contact_idx on public.project_contacts (contact_id);
comment on table public.project_contacts is '프로젝트에 참여하는 거래처 담당자';
alter table public.project_contacts enable row level security;
drop policy if exists project_contacts_all on public.project_contacts;
create policy project_contacts_all on public.project_contacts for all to authenticated
  using ((select public.is_active_member())) with check ((select public.is_active_member()));
grant select, insert, update, delete on public.project_contacts to authenticated;
revoke all on public.project_contacts from anon;

-- 2. 주고받은 자료
create table if not exists public.exchange_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients (id) on delete cascade,
  contact_id   uuid references public.contacts (id) on delete set null,
  project_id   uuid references public.projects (id) on delete set null,
  direction    text not null default '받음' check (direction in ('받음', '보냄')),
  name         text not null check (char_length(name) between 1 and 200),
  url          text check (url is null or url ~ '^https?://'),
  storage_path text,
  size         bigint,
  mime         text,
  note         text check (note is null or char_length(note) <= 1000),
  file_date    date not null default ((now() at time zone 'Asia/Seoul')::date),
  source       text not null default '직접' check (source in ('직접', '메일', '채팅', 'AI')),
  work_log_id  uuid references public.work_logs (id) on delete set null,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);
create index if not exists exchange_files_client_idx on public.exchange_files (client_id, file_date desc);
create index if not exists exchange_files_contact_idx on public.exchange_files (contact_id);
create index if not exists exchange_files_project_idx on public.exchange_files (project_id);
comment on table public.exchange_files is '거래처 · 담당자 · 프로젝트와 주고받은 자료 (파일 또는 링크)';
alter table public.exchange_files enable row level security;
drop policy if exists exchange_files_select on public.exchange_files;
create policy exchange_files_select on public.exchange_files for select to authenticated using ((select public.is_active_member()));
drop policy if exists exchange_files_insert on public.exchange_files;
create policy exchange_files_insert on public.exchange_files for insert to authenticated with check ((select public.is_active_member()));
drop policy if exists exchange_files_update on public.exchange_files;
create policy exchange_files_update on public.exchange_files for update to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()));
drop policy if exists exchange_files_delete on public.exchange_files;
create policy exchange_files_delete on public.exchange_files for delete to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));
grant select, insert, update, delete on public.exchange_files to authenticated;
revoke all on public.exchange_files from anon;

-- 저장소 (비공개, 한 파일 50MB 까지): 경로 '<무작위>/file.확장자'
insert into storage.buckets (id, name, public, file_size_limit)
values ('exchange-files', 'exchange-files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists exchange_files_obj_select on storage.objects;
create policy exchange_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'exchange-files' and (select public.is_active_member()));
drop policy if exists exchange_files_obj_insert on storage.objects;
create policy exchange_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'exchange-files' and (select public.is_active_member()));
drop policy if exists exchange_files_obj_delete on storage.objects;
create policy exchange_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'exchange-files' and (owner_id = (select auth.uid())::text or (select public.is_admin())));

-- 3. 업무 일지 상대방
alter table public.work_logs add column if not exists contact_id uuid references public.contacts (id) on delete set null;
create index if not exists work_logs_contact_idx on public.work_logs (contact_id);

-- 메일 상대 주소(email_counterpart)에 등록된 담당자 이메일이 있으면 그 사람 · 그 거래처로 연결
create or replace function private.work_log_match_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.contacts;
begin
  if new.contact_id is null and coalesce(new.email_counterpart, '') <> '' then
    select c.* into v from public.contacts c
     where c.email is not null and c.email <> '' and position(lower(c.email) in lower(new.email_counterpart)) > 0
       and (new.client_id is null or c.client_id = new.client_id)
     order by c.is_primary desc, c.created_at
     limit 1;
    if v.id is not null then
      new.contact_id := v.id;
      new.client_id := coalesce(new.client_id, v.client_id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists work_logs_match_contact on public.work_logs;
create trigger work_logs_match_contact before insert or update of email_counterpart, contact_id, client_id on public.work_logs
  for each row execute function private.work_log_match_contact();

-- 기존 기록도 한 번 연결
update public.work_logs w set contact_id = c.id, client_id = coalesce(w.client_id, c.client_id)
  from public.contacts c
 where w.contact_id is null and coalesce(w.email_counterpart, '') <> '' and c.email is not null and c.email <> ''
   and position(lower(c.email) in lower(w.email_counterpart)) > 0
   and (w.client_id is null or w.client_id = c.client_id);
