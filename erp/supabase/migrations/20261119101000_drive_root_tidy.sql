-- 내 드라이브 맨 위 정리 (2026-11-19 대표 지시 '이 폴더를 정리해서 항상 지금과 같은 상태로 유지 · 새로 생기는 파일들을 자료정리 폴더로 이동').
-- 함수 drive-tidy 를 10분마다 부름. 처음 실행 때 맨 위 폴더 13개를 app_settings drive_root_keep 에 기억하고, 그 뒤 새로 생긴 파일 · 폴더는 '자료정리' 로 옮김(지우지 않음).
-- 그대로 둘 폴더를 바꾸려면 app_settings drive_root_keep.ids 를 고칠 것. 멈추려면 cron wkly_drive_tidy 를 끔.
create or replace function private.drive_tidy_tick(p_dry boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return null; end if;
  return net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/drive-tidy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := jsonb_build_object('dry', p_dry),
    timeout_milliseconds := 60000);
end $$;
revoke all on function private.drive_tidy_tick(boolean) from public, anon, authenticated;

select cron.unschedule('wkly_drive_tidy') where exists (select 1 from cron.job where jobname = 'wkly_drive_tidy');
select cron.schedule('wkly_drive_tidy', '4,14,24,34,44,54 * * * *', 'select private.drive_tidy_tick()');
