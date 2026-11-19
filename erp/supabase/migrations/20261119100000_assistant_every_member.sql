-- 모든 사람 팀원에게 AI 비서 (2026-11-19 대표 지시 '모든 사람 팀원에게 ai 비서 만들어주고 각자의 비서들은 타인에게 노출 안되게').
-- 지금 6명은 모두 있음. 새로 들어온 · 다시 켠 팀원도 한 시간 안에 비서가 생기도록 매시 확인 (비공개 구조는 20261116100000 그대로).
create or replace function private.assistant_ensure_all()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select p.id from public.profiles p
           where p.active and not p.is_agent
             and not exists (select 1 from public.ai_agents a where a.private and a.owner_id = p.id)
           limit 10 loop
    perform private.assistant_ensure(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.assistant_ensure_all() from public, anon, authenticated;

select cron.unschedule('wkly_assistant_ensure') where exists (select 1 from cron.job where jobname = 'wkly_assistant_ensure');
select cron.schedule('wkly_assistant_ensure', '41 * * * *', 'select private.assistant_ensure_all()');
