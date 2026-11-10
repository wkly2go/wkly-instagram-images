-- 캘린더 개인 일정 (대표 지시 2026-11-10 "캘린더에 개인일정 저장 기능 추가")
--   본인만 보고 고침 (관리자도 못 봄) · 하루 또는 기간 · 시각(선택) · 메모
create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  start_date date not null,
  end_date date not null,
  start_time time,
  memo text check (memo is null or char_length(memo) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists personal_events_user_date_idx on public.personal_events (user_id, start_date);
alter table public.personal_events enable row level security;
drop policy if exists personal_events_own on public.personal_events;
create policy personal_events_own on public.personal_events for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()))
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));
grant select, insert, update, delete on public.personal_events to authenticated;
comment on table public.personal_events is '캘린더 개인 일정 · 본인만 봄';
