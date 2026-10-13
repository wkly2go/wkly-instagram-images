-- =====================================================================
-- WKLY ERP 0002: 미니홈피 프로필 항목 + 채팅방 요약 함수
-- 0001_init.sql 다음에 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1. profiles: 직함 / 오늘 상태(TODAY IS) / 오늘의 한마디
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists today_status text not null default '출근';
alter table public.profiles add column if not exists status_message text;
alter table public.profiles add column if not exists status_updated_at timestamptz;

alter table public.profiles drop constraint if exists profiles_today_status_check;
alter table public.profiles add constraint profiles_today_status_check
  check (today_status in ('출근', '외근', '미팅', '재택', '휴가', '퇴근'));

alter table public.profiles drop constraint if exists profiles_status_message_check;
alter table public.profiles add constraint profiles_status_message_check
  check (status_message is null or char_length(status_message) <= 80);

comment on column public.profiles.title is '직함 (예: 대표, 매니저)';
comment on column public.profiles.today_status is '미니홈피 TODAY IS 상태';
comment on column public.profiles.status_message is '오늘의 한마디 (80자 이내)';

create or replace function public.profiles_touch_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.today_status is distinct from old.today_status
     or new.status_message is distinct from old.status_message then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch_status on public.profiles;
create trigger profiles_touch_status
  before update on public.profiles
  for each row execute function public.profiles_touch_status();

revoke execute on function public.profiles_touch_status() from public, anon, authenticated;


-- 2. 채팅방 목록 요약: 마지막 메시지 + 안 읽은 수 (호출자 RLS 그대로 적용)
create or replace function public.chat_room_summaries()
returns table (
  id uuid,
  name text,
  description text,
  project_id uuid,
  is_archived boolean,
  created_by uuid,
  created_at timestamptz,
  last_content text,
  last_at timestamptz,
  last_user_id uuid,
  unread integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id, r.name, r.description, r.project_id, r.is_archived, r.created_by, r.created_at,
    lm.content, lm.created_at, lm.user_id,
    coalesce((
      select count(*)::int
      from public.chat_messages m
      where m.room_id = r.id
        and m.user_id is distinct from auth.uid()
        and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
    ), 0)
  from public.chat_rooms r
  left join public.chat_reads cr
    on cr.room_id = r.id and cr.user_id = auth.uid()
  left join lateral (
    select m.content, m.created_at, m.user_id
    from public.chat_messages m
    where m.room_id = r.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where not r.is_archived
  order by coalesce(lm.created_at, r.created_at) desc;
$$;

revoke execute on function public.chat_room_summaries() from public, anon;
grant execute on function public.chat_room_summaries() to authenticated;


-- 3. profiles 변경도 실시간 반영 (TODAY IS 상태가 팀원 화면에 바로 보이도록)
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
     )
  then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;
