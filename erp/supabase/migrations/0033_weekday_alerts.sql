-- 0033 · 주말 알림 중지, 월요일에 모아서 (대표 지시 2026-10-17 "주말에는 아무 보고도 하지말고 월요일에 모아서 보고해")
-- · 아침 요약·결제·구독 알림 cron을 평일(월~금)로 바꾼다 (UTC 00시대 = KST 09시대라 요일이 같다).
-- · 구독 알림은 정확한 날짜만 보던 것을, 월요일에는 토·일 몫까지 함께 본다.
-- · 아침 요약 알림 제목에서 금액을 뺀다 (알림 제목에 금액 금지 규칙).

select cron.alter_job(2, schedule => '0 0 * * 1-5');   -- wkly_daily_digest
select cron.alter_job(5, schedule => '10 0 * * 1-5');  -- wkly_payments_overdue
select cron.alter_job(8, schedule => '20 0 * * 1-5');  -- wkly_subscriptions_due

create or replace function public.subscriptions_due_alert()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  -- 월요일이면 지난 토·일 몫까지 (back = 2), 평일은 당일만
  v_back integer := case when extract(isodow from v_day) = 1 then 2 else 0 end;
  r record;
  a record;
begin
  if extract(isodow from v_day) > 5 then
    return;
  end if;
  for r in
    select * from public.subscriptions
    where status <> '해지'
      and (next_billing between v_day - v_back and v_day
           or next_billing between v_day + 7 - v_back and v_day + 7)
  loop
    for a in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
      perform public.notify(
        a.id, '결제',
        '구독 결제 ' || case
          when r.next_billing < v_day then to_char(r.next_billing, 'MM-DD') || ' (주말)'
          when r.next_billing = v_day then '오늘'
          else to_char(r.next_billing, 'MM-DD') || ' 예정'
        end || ' · ' || r.name,
        coalesce(r.plan, '') || case when r.pay_method is not null then ' · ' || r.pay_method else '' end,
        '/projects?view=subs');
    end loop;
  end loop;
  update public.subscriptions set next_billing = next_billing + interval '1 month', updated_at = now() where status <> '해지' and cycle = '월' and next_billing < v_day;
  update public.subscriptions set next_billing = next_billing + interval '1 year', updated_at = now() where status <> '해지' and cycle = '년' and next_billing < v_day;
end;
$$;

create or replace function public.daily_digest()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today     date    := (now() at time zone 'Asia/Seoul')::date;
  v_count     integer := 0;
  v_pay_n     bigint;
  v_pay_sum   bigint;
  v_recv_n    bigint;
  v_recv_sum  bigint;
  r           record;
begin
  if extract(isodow from v_today) > 5 then
    return 0;
  end if;

  for r in
    select coalesce(t.assignee_id, t.created_by) as user_id,
           count(*) filter (where t.due_date = v_today) as due_today,
           count(*) filter (where t.due_date < v_today) as overdue
    from public.tasks t
    where t.status <> '완료'
      and t.due_date <= v_today
      and coalesce(t.assignee_id, t.created_by) is not null
    group by 1
  loop
    if public.notify(
         r.user_id, '할 일',
         format('오늘 확인할 할 일 %s건', r.due_today + r.overdue),
         format('오늘 마감 %s건 · 기한 지남 %s건', r.due_today, r.overdue),
         '/projects?view=mine'
       ) is not null
    then
      v_count := v_count + 1;
    end if;
  end loop;

  select count(*), coalesce(sum(p.amount), 0)
    into v_pay_n, v_pay_sum
  from public.payments p
  where p.direction = '지급'
    and not p.is_estimate
    and p.status in ('예정', '대기')
    and p.due_date <= v_today;

  select count(*), coalesce(sum(p.amount), 0)
    into v_recv_n, v_recv_sum
  from public.payments p
  where p.direction = '수금'
    and not p.is_estimate
    and p.status in ('예정', '청구', '대기', '보류')
    and p.due_date < v_today;

  for r in
    select a.id
    from public.profiles a
    where a.role = 'admin'
      and a.active
      and not a.is_agent
  loop
    if v_pay_n > 0 then
      if public.notify(
           r.id, '결제',
           format('지급 예정 %s건', v_pay_n),
           format('합계 %s원 · 지급예정일이 오늘이거나 지났어요', to_char(v_pay_sum, 'FM999,999,999,999,999,990')),
           '/finance'
         ) is not null
      then
        v_count := v_count + 1;
      end if;
    end if;

    if v_recv_n > 0 then
      if public.notify(
           r.id, '결제',
           format('미수금 %s건', v_recv_n),
           format('합계 %s원 · 입금 예정일이 지났어요', to_char(v_recv_sum, 'FM999,999,999,999,999,990')),
           '/finance'
         ) is not null
      then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;
