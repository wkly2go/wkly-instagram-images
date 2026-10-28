-- 0063 입출금 장부 (대표 지시 2026-10-28 "관리자만 사용하는 월별 입출입 장부 · 반드시 관리자만 · 접근 시 비밀번호")
-- 보안은 서버에서 강제: 관리자(is_admin) + 장부 비밀번호로 잠금을 푼 뒤 30분 (쓰는 동안 연장)
-- 비밀번호는 bcrypt 해시로만 저장, 10분 안에 5번 틀리면 잠금. 계좌번호 · 주민번호는 받지 않음
-- (운영은 0063a 테이블 · 정책 + 0063b 잠금 함수로 나눠 적용, 아래는 합친 최종본)

create table if not exists private.ledger_secret (
  id int primary key default 1 check (id = 1),
  pw_hash text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists private.ledger_sessions (
  user_id uuid primary key,
  expires_at timestamptz not null,
  unlocked_at timestamptz
);
create table if not exists private.ledger_fails (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists ledger_fails_ix on private.ledger_fails (user_id, at);

create or replace function public.ledger_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists (
    select 1 from private.ledger_sessions s where s.user_id = auth.uid() and s.expires_at > now())
$$;

create table if not exists public.cash_ledger (
  id bigint generated always as identity primary key,
  entry_date date not null default (now() at time zone 'Asia/Seoul')::date,
  direction text not null check (direction in ('입금', '출금')),
  amount bigint not null check (amount > 0 and amount < 100000000000),
  category text not null default '기타' check (char_length(category) between 1 and 40),
  counterparty text check (counterparty is null or char_length(counterparty) <= 100),
  method text not null default '계좌' check (method in ('계좌', '카드', '현금', '기타')),
  memo text check (memo is null or char_length(memo) <= 500),
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cash_ledger_date_ix on public.cash_ledger (entry_date desc);
create index if not exists cash_ledger_project_ix on public.cash_ledger (project_id);
create index if not exists cash_ledger_created_by_ix on public.cash_ledger (created_by);
alter table public.cash_ledger enable row level security;
create policy cash_ledger_admin on public.cash_ledger for all to authenticated
  using ((select public.ledger_open())) with check ((select public.ledger_open()));

create or replace function private.cash_ledger_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create or replace trigger cash_ledger_updated before update on public.cash_ledger for each row execute function private.cash_ledger_touch();

-- 최근 10분 실패 수 (마지막 잠금 해제 뒤로만 셈)
create or replace function private.ledger_fail_count(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from private.ledger_fails f
  where f.user_id = p_user and f.at > now() - interval '10 minutes'
    and f.at > coalesce((select s.unlocked_at from private.ledger_sessions s where s.user_id = p_user), '-infinity'::timestamptz)
$$;

create or replace function public.ledger_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return jsonb_build_object('admin', false); end if;
  return jsonb_build_object(
    'admin', true,
    'has_password', exists (select 1 from private.ledger_secret),
    'open_until', (select expires_at from private.ledger_sessions where user_id = auth.uid() and expires_at > now()),
    'fails', private.ledger_fail_count(auth.uid()));
end $$;

create or replace function public.ledger_set_password(p_old text, p_new text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if not public.is_admin() then raise exception '관리자만 정할 수 있습니다.'; end if;
  if p_new is null or char_length(p_new) < 6 then raise exception '비밀번호는 6자 이상으로 정해 주세요.'; end if;
  select pw_hash into v_hash from private.ledger_secret where id = 1;
  if v_hash is not null and (p_old is null or extensions.crypt(p_old, v_hash) <> v_hash) then
    raise exception '지금 비밀번호가 맞지 않습니다.';
  end if;
  insert into private.ledger_secret (id, pw_hash, updated_by, updated_at)
  values (1, extensions.crypt(p_new, extensions.gen_salt('bf', 10)), auth.uid(), now())
  on conflict (id) do update set pw_hash = excluded.pw_hash, updated_by = excluded.updated_by, updated_at = now();
  update private.ledger_sessions set expires_at = now() where expires_at > now();
end $$;

create or replace function public.ledger_unlock(p_password text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_until timestamptz := now() + interval '30 minutes';
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.'; end if;
  if private.ledger_fail_count(auth.uid()) >= 5 then raise exception '비밀번호를 5번 틀려 10분 동안 잠겼습니다.'; end if;
  select pw_hash into v_hash from private.ledger_secret where id = 1;
  if v_hash is null then raise exception '먼저 장부 비밀번호를 정해 주세요.'; end if;
  if p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into private.ledger_fails (user_id) values (auth.uid());
    raise exception '비밀번호가 맞지 않습니다.';
  end if;
  insert into private.ledger_sessions (user_id, expires_at, unlocked_at) values (auth.uid(), v_until, now())
  on conflict (user_id) do update set expires_at = excluded.expires_at, unlocked_at = excluded.unlocked_at;
  return v_until;
end $$;

create or replace function public.ledger_lock() returns void
language sql security definer set search_path = '' as $$
  update private.ledger_sessions set expires_at = now() where user_id = auth.uid() and expires_at > now()
$$;

create or replace function public.ledger_touch() returns timestamptz
language sql security definer set search_path = '' as $$
  update private.ledger_sessions set expires_at = now() + interval '30 minutes'
  where user_id = auth.uid() and expires_at > now() and public.is_admin()
  returning expires_at
$$;
