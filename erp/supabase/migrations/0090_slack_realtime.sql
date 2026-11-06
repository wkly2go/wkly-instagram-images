-- 슬랙 실시간에 가깝게: 1분마다 가져오기 + 막힌 이유 기록 (대표 지시 2026-11-06 "실시간으로 받을 수 있게")
alter table public.slack_links add column if not exists last_error text;
comment on column public.slack_links.last_error is '마지막 가져오기에서 막힌 이유 (없으면 정상)';

select cron.unschedule('wkly_slack_sync') where exists (select 1 from cron.job where jobname = 'wkly_slack_sync');
select cron.schedule('wkly_slack_sync', '* * * * *', 'select private.slack_sync_tick()');
