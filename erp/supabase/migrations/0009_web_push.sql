-- WKLY ERP 0009: 웹 푸시 알림 (인트라넷 창을 닫아 둬도 채팅·알림이 PC 알림으로 옴)
--   1) push_subscriptions : 브라우저별 푸시 구독 (본인 것만 저장·삭제)
--   2) private.push_config: VAPID 키 · 트리거 비밀값 · 발송 함수 주소 (service_role 전용)
--   3) 트리거: 채팅 메시지 · 알림(notifications)이 생기면 pg_net 으로 send-push 함수 호출
--   send-push 함수 배포 후 아래 '설치 후 한 번' 줄의 function_url 을 프로젝트 주소로 채운다.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1) 구독
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint    text primary key check (char_length(endpoint) between 10 and 1000),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon;
grant select, delete on public.push_subscriptions to authenticated;

-- 같은 브라우저에서 다른 사람이 로그인하면 구독 주인을 바꿔야 하므로 저장은 RPC 로만
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;
revoke execute on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) 비공개 설정
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_config (
  id             int primary key default 1 check (id = 1),
  hook_secret    text not null,
  function_url   text,
  vapid_public   text,
  vapid_private  text,
  vapid_subject  text not null default 'mailto:info@thewklyn.com'
);
insert into private.push_config (id, hook_secret)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- send-push 함수(service_role)만 읽고 키를 한 번 저장
create or replace function public.push_config_get()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('hook_secret', c.hook_secret, 'vapid_public', c.vapid_public,
                            'vapid_private', c.vapid_private, 'vapid_subject', c.vapid_subject)
  from private.push_config c where c.id = 1;
$$;

create or replace function public.push_config_set_vapid(p_public text, p_private text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 이미 키가 있으면 덮어쓰지 않음 (동시에 처음 호출돼도 한 쌍만 남음)
  update private.push_config set vapid_public = p_public, vapid_private = p_private
   where id = 1 and (vapid_public is null or vapid_private is null);
  return public.push_config_get();
end;
$$;

revoke execute on function public.push_config_get(), public.push_config_set_vapid(text, text) from public, anon, authenticated;
grant execute on function public.push_config_get(), public.push_config_set_vapid(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 3) 발송 트리거
-- ---------------------------------------------------------------------
create or replace function private.push_send(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.push_config;
begin
  select * into c from private.push_config where id = 1;
  if c.function_url is null then
    return; -- 아직 설치 전: 조용히 건너뜀
  end if;
  perform net.http_post(
    url := c.function_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.hook_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  -- 알림 실패가 채팅·알림 저장을 막지 않게
  raise warning 'push_send: %', sqlerrm;
end;
$$;

create or replace function private.push_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.push_send(jsonb_build_object('type', 'chat', 'room_id', new.room_id, 'user_id', new.user_id, 'content', left(new.content, 300)));
  return null;
end;
$$;

-- 멘션은 채팅 알림으로 이미 가므로 제외
create or replace function private.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> '멘션' then
    perform private.push_send(jsonb_build_object('type', 'notify', 'id', new.id, 'user_id', new.user_id, 'title', new.title, 'body', new.body, 'link', new.link));
  end if;
  return null;
end;
$$;

drop trigger if exists chat_messages_push on public.chat_messages;
create trigger chat_messages_push
  after insert on public.chat_messages
  for each row execute function private.push_on_chat_message();

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function private.push_on_notification();

-- 설치 후 한 번 (프로젝트 주소로):
-- update private.push_config set function_url = 'https://<project-ref>.supabase.co/functions/v1/send-push' where id = 1;
