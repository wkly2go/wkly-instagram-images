-- WKLY ERP 0016: 개인 메모장 (업무 일지 · 보고에 들어가지 않음, 본인만 봄)
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content    text not null default '' check (char_length(content) <= 20000),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notes is '개인 메모장. 본인만 읽고 쓰며 업무 일지 · 보고 · 관리자 화면에 나오지 않음';
create index notes_user_idx on public.notes (user_id, updated_at desc);
alter table public.notes enable row level security;
create policy notes_own on public.notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.notes to authenticated;
