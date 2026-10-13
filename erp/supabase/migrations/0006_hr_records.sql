-- WKLY ERP 0006: 인사기록 (이름을 누르면 보이는 인사 카드)
--   본인과 관리자만 볼 수 있고, 관리자만 고칠 수 있음
create table if not exists public.hr_records (
  profile_id        uuid primary key references public.profiles (id) on delete cascade,
  joined_on         date,
  phone             text check (phone is null or char_length(phone) <= 40),
  birthday          date,
  address           text check (address is null or char_length(address) <= 200),
  emergency_contact text check (emergency_contact is null or char_length(emergency_contact) <= 100),
  note              text check (note is null or char_length(note) <= 2000),
  updated_at        timestamptz not null default now(),
  updated_by        uuid default auth.uid() references public.profiles (id) on delete set null
);

alter table public.hr_records enable row level security;

drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records
  for select to authenticated
  using ((profile_id = auth.uid() and public.is_active_member()) or public.is_admin());

drop policy if exists hr_records_insert on public.hr_records;
create policy hr_records_insert on public.hr_records
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists hr_records_update on public.hr_records;
create policy hr_records_update on public.hr_records
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists hr_records_delete on public.hr_records;
create policy hr_records_delete on public.hr_records
  for delete to authenticated
  using (public.is_admin());

revoke all on public.hr_records from anon;
grant select, insert, update, delete on public.hr_records to authenticated;

create or replace function public.hr_records_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists hr_records_touch on public.hr_records;
create trigger hr_records_touch
  before insert or update on public.hr_records
  for each row execute function public.hr_records_touch();

revoke execute on function public.hr_records_touch() from public, anon, authenticated;
