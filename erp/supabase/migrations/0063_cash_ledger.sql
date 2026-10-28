-- 0063 입출금 장부 (대표 지시 2026-10-28 "관리자만 사용하는 월별 입출입 장부 · 반드시 관리자만 · 접근 시 비밀번호")
-- 보안은 서버에서 강제:
--   1) 관리자(is_admin)만
--   2) 장부 비밀번호로 잠금을 푼 뒤 30분 동안만 (ledger_unlock → private.ledger_sessions)
--   3) 비밀번호는 bcrypt 해시로만 저장, 5번 틀리면 10분 잠금
-- 계좌번호 · 주민번호는 받지 않음 (결제 수단은 계좌 · 카드 · 현금 구분만)

create table if not exists private.ledger_secret (
  id int primary key default 1 check (id = 1),
  pw_hash text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists private.ledger_sessions (
  user_id uuid primary key,
  expires_at timestamptz not null
);
create table if not exists private.ledger_fails (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists ledger_fails_ix on private.ledger_fails (user_id, at);

-- 정책에서 부르는 검사 함수 (private 스키마 권한을 열지 않도록 public 에 둠)
create or replace function public.ledger_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists (
    select 1 from private.ledger_sessions s where s.user_id = auth.uid() and s.expires_at > now())
$$;
revoke execute on function public.ledger_open() from public, anon;
grant execute on function public.ledger_open() to authenticated;

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
-- 관리자 + 잠금 해제한 사람만 (보기 · 쓰기 · 고치기 · 지우기 전부)
create policy cash_ledger_admin on public.cash_ledger for all to authenticated
  using ((select public.ledger_open())) with check ((select public.ledger_open()));
-- 실시간 알림 · 다른 경로 차단: anon 권한 없음
revoke all on public.cash_ledger from anon;

-- 상태: 비밀번호가 정해졌는지 · 지금 열려 있는지 · 남은 시간
create or replace function public.ledger_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return jsonb_build_object('admin', false); end if;
  return jsonb_build_object(
    'admin', true,
    'has_password', exists (select 1 from private.ledger_secret),
    'open_until', (select expires_at from private.ledger_sessions where user_id = auth.uid() and expires_at > now()),
    'locked_until', (select max(at) + interval '10 minutes' from private.ledger_fails
                      where user_id = auth.uid() and at > now() - interval '10 minutes'
                      having count(*) >= 5));
end $$;

-- 처음 비밀번호 정하기 / 바꾸기 (바꿀 때는 지금 비밀번호 필요)
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
  -- 바꾸면 모든 열린 장부를 닫음
  delete from private.ledger_sessions;
end $$;

-- 잠금 해제 (30분)
create or replace function public.ledger_unlock(p_password text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_until timestamptz := now() + interval '30 minutes';
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.'; end if;
  if (select count(*) from private.ledger_fails where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception '비밀번호를 5번 틀려 10분 동안 잠겼습니다.';
  end if;
  select pw_hash into v_hash from private.ledger_secret where id = 1;
  if v_hash is null then raise exception '먼저 장부 비밀번호를 정해 주세요.'; end if;
  if p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into private.ledger_fails (user_id) values (auth.uid());
    raise exception '비밀번호가 맞지 않습니다.';
  end if;
  delete from private.ledger_fails where user_id = auth.uid();
  insert into private.ledger_sessions (user_id, expires_at) values (auth.uid(), v_until)
  on conflict (user_id) do update set expires_at = excluded.expires_at;
  return v_until;
end $$;

-- 다시 잠그기 (화면을 떠나거나 잠금 버튼)
create or replace function public.ledger_lock() returns void
language sql security definer set search_path = '' as $$
  delete from private.ledger_sessions where user_id = auth.uid()
$$;

-- 쓰는 동안 연장 (열려 있을 때만, 30분)
create or replace function public.ledger_touch() returns timestamptz
language sql security definer set search_path = '' as $$
  update private.ledger_sessions set expires_at = now() + interval '30 minutes'
  where user_id = auth.uid() and expires_at > now() and public.is_admin()
  returning expires_at
$$;

revoke execute on function public.ledger_status(), public.ledger_set_password(text, text), public.ledger_unlock(text), public.ledger_lock(), public.ledger_touch() from public, anon;
grant execute on function public.ledger_status(), public.ledger_set_password(text, text), public.ledger_unlock(text), public.ledger_lock(), public.ledger_touch() to authenticated;

create or replace function private.cash_ledger_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create or replace trigger cash_ledger_updated before update on public.cash_ledger for each row execute function private.cash_ledger_touch();
