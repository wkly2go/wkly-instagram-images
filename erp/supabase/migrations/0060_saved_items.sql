-- 0060 나중에 보기 (2026-10-23 "손에 붙게" 4단계)
-- 채팅 메시지 · 카드를 '나중에' 로 저장하고, 시각을 정하면 그때 알람으로 다시 알려 줌

create table if not exists public.saved_items (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message_id bigint references public.chat_messages(id) on delete set null,
  room_id uuid references public.chat_rooms(id) on delete set null,
  preview text not null check (char_length(preview) between 1 and 300),
  remind_at timestamptz,
  reminded_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists saved_items_user_ix on public.saved_items (user_id, done_at);
create index if not exists saved_items_due_ix on public.saved_items (remind_at) where done_at is null and reminded_at is null;
create index if not exists saved_items_message_ix on public.saved_items (message_id);
create index if not exists saved_items_room_ix on public.saved_items (room_id);
alter table public.saved_items enable row level security;
create policy saved_items_own on public.saved_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select is_active_member()));

-- 시각이 된 '나중에' 를 알람으로 (5분마다)
create or replace function private.saved_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select * from public.saved_items where done_at is null and reminded_at is null and remind_at is not null and remind_at <= now() for update skip locked loop
    perform public.notify(r.user_id, '알람', '나중에 보기 · ' || left(r.preview, 60), r.preview,
      case when r.room_id is not null then '/chat?room=' || r.room_id || coalesce('&thread=' || r.message_id, '') else '/chat?view=saved' end);
    update public.saved_items set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('wkly_saved_reminders', '*/5 * * * *', 'select private.saved_reminders()');
