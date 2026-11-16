-- 알람은 해당 팀원에게만 (대표 지시 2026-11-16)
--  PC 알림(푸시) 등록은 브라우저마다 한 줄이고, 인트라넷을 열 때마다 주인 · 시각을 새로 적는다.
--  예전에 다른 사람이 로그인했던 브라우저를 그 뒤로 안 열면 등록이 예전 사람 앞으로 남아, 그 PC 에 남의 알림이 계속 떴다.
--  → 30일 동안 한 번도 안 열린 등록은 매일 지운다 (다시 열면 그때 로그인한 사람 앞으로 새로 등록됨)
create or replace function private.push_cleanup_stale() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from public.push_subscriptions where created_at < now() - interval '30 days' returning 1)
  select count(*)::int from d
$$;
revoke all on function private.push_cleanup_stale() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'wkly_push_cleanup';
select cron.schedule('wkly_push_cleanup', '17 18 * * *', $$select private.push_cleanup_stale()$$);
-- 대표 계정 앞으로 남아 있던 윈도우 PC 등록 (대표는 맥 사용 · 10-17 뒤로 갱신 없음) 한 건 정리
delete from public.push_subscriptions s using public.profiles p
 where p.id = s.user_id and p.role = 'admin' and s.user_agent like '%Windows NT%' and s.created_at < now() - interval '21 days';
