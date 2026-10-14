-- WKLY ERP 0013: 구글 캘린더 연동 (개인 일정 구독 주소)
--   팀원마다 비밀 주소(토큰)를 하나 발급한다. 구글 캘린더 › 'URL로 추가'에 이 주소를 넣으면
--   calendar-feed 함수가 그 사람의 할 일 · 프로젝트 일정 · 휴가를 iCalendar(.ics) 로 내려준다.
--   주소를 다시 만들면 예전 주소는 바로 막힌다. 금액 정보는 넣지 않는다.

create table public.calendar_feeds (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);
comment on table public.calendar_feeds is '구글 캘린더 구독 주소용 비밀 토큰 (본인만 읽기 · 발급)';
alter table public.calendar_feeds enable row level security;
create policy calendar_feeds_own on public.calendar_feeds
  for select to authenticated using (user_id = (select auth.uid()));

-- 내 구독 토큰: 없으면 만들고, p_reset 이면 새로 발급
create function public.calendar_feed_token(p_reset boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_token text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception '로그인한 팀원만 쓸 수 있습니다.' using errcode = '42501';
  end if;
  if not p_reset then
    select f.token into v_token from public.calendar_feeds f where f.user_id = v_me;
    if v_token is not null then
      return v_token;
    end if;
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.calendar_feeds (user_id, token) values (v_me, v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return v_token;
end;
$$;
revoke execute on function public.calendar_feed_token(boolean) from public, anon;
grant execute on function public.calendar_feed_token(boolean) to authenticated;
