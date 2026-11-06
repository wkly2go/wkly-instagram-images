-- 슬랙 2분마다 자동 가져오기 (대표 지시 2026-11-06 "모든 외부 연결은 실시간으로 추적해서 가져와")
--   gmail · gdrive 예약과 같은 방식: DB 예약(pg_cron) → slack-import 함수(x-sync-key = Vault GDRIVE_SYNC_KEY)
--   슬랙이 연결돼 있고 연결된 채널이 있을 때만 부름
create or replace function private.slack_sync_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'SLACK_BOT_TOKEN') then return; end if;
  if not exists (select 1 from public.slack_links) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/slack-import',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function private.slack_sync_tick() from public, anon, authenticated;

select cron.unschedule('wkly_slack_sync') where exists (select 1 from cron.job where jobname = 'wkly_slack_sync');
select cron.schedule('wkly_slack_sync', '*/2 * * * *', 'select private.slack_sync_tick()');
