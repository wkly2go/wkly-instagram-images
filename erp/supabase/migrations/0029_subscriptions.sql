-- WKLY ERP 0029: 구독료 — 회사가 구독하는 서비스 · 프로그램 · 요금제 관리
--   누구나 볼 수 있고(무슨 프로그램을 쓰는지), 등록 · 수정 · 삭제는 관리자만

create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 100),
  category      text not null default '기타' check (category in ('디자인', '협업 · 문서', 'AI', '개발 · 서버', '마케팅 · SNS', '회계 · 세무', '통신', '기타')),
  plan          text check (plan is null or char_length(plan) <= 100),
  amount        integer not null default 0 check (amount >= 0),
  currency      text not null default 'KRW' check (currency in ('KRW', 'USD')),
  cycle         text not null default '월' check (cycle in ('월', '년', '1회')),
  next_billing  date,
  pay_method    text check (pay_method is null or char_length(pay_method) <= 60),
  account_email text check (account_email is null or char_length(account_email) <= 120),
  owner_id      uuid references public.profiles (id) on delete set null,
  seats         integer check (seats is null or seats >= 0),
  url           text check (url is null or url ~ '^https?://'),
  status        text not null default '사용 중' check (status in ('사용 중', '해지 예정', '해지')),
  memo          text check (memo is null or char_length(memo) <= 1000),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.subscriptions is '회사 구독 서비스 · 프로그램 (구독료 관리)';
create index if not exists subscriptions_next_idx on public.subscriptions (next_billing);
alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated using ((select public.is_active_member()));
drop policy if exists subscriptions_write on public.subscriptions;
create policy subscriptions_write on public.subscriptions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.subscriptions to authenticated;
revoke all on public.subscriptions from anon;

-- 결제일 7일 전 · 당일 관리자 알림 (금액은 쓰지 않음)
create or replace function public.subscriptions_due_alert()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  r record;
  a record;
begin
  for r in select * from public.subscriptions where status <> '해지' and next_billing in (v_day, v_day + 7) loop
    for a in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
      perform public.notify(a.id, '결제', '구독 결제 ' || case when r.next_billing = v_day then '오늘' else '7일 뒤' end || ' · ' || r.name, coalesce(r.plan, '') || case when r.pay_method is not null then ' · ' || r.pay_method else '' end, '/projects?view=subs');
    end loop;
  end loop;
  -- 월 · 년 구독은 결제일이 지나면 다음 결제일로 넘김
  update public.subscriptions set next_billing = next_billing + interval '1 month', updated_at = now() where status <> '해지' and cycle = '월' and next_billing < v_day;
  update public.subscriptions set next_billing = next_billing + interval '1 year', updated_at = now() where status <> '해지' and cycle = '년' and next_billing < v_day;
end;
$$;
revoke execute on function public.subscriptions_due_alert() from public, anon, authenticated;
select cron.schedule('wkly_subscriptions_due', '20 0 * * *', 'select public.subscriptions_due_alert()');
