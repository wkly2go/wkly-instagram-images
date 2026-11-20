-- 2026-11-20 인스타그램 접근 토큰 자동 갱신 (대표 지시 '신속히 자동화 완성해' · DM · 바로 게시 · 연락처 수집이 같은 토큰을 씀)
-- 'Instagram 로그인' 방식의 장기 토큰은 60일 뒤 만료된다. 매주 한 번 graph.instagram.com/refresh_access_token 으로 새로 받아 금고에 넣는다.
-- 토큰 값은 DB 함수 안에서만 오가고 화면 · 로그 · 알림에 나오지 않는다. 실패하면 관리자에게 알림(하루 한 번 · 금액 없음).
-- 상태는 app_settings 'instagram_token_info' {refreshed_at, expires_at, last_error} 에 남긴다.

create or replace function private.instagram_token_refresh()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_tok text; r record; j jsonb; v_err text;
begin
  select s.id, d.decrypted_secret into v_id, v_tok
    from vault.secrets s join vault.decrypted_secrets d on d.id = s.id where s.name = 'INSTAGRAM_ACCESS_TOKEN';
  if v_tok is null then return jsonb_build_object('skipped', 'no token'); end if;
  begin
    r := extensions.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || v_tok);
    j := case when r.content ~ '^\s*\{' then r.content::jsonb else '{}'::jsonb end;
  exception when others then
    r := null; j := '{}'::jsonb; v_err := left(sqlerrm, 200);
  end;
  if r.status = 200 and coalesce(j->>'access_token', '') <> '' then
    perform vault.update_secret(v_id, j->>'access_token');
    insert into public.app_settings (key, value, updated_at)
    values ('instagram_token_info', jsonb_build_object('refreshed_at', now(), 'expires_at', now() + make_interval(secs => coalesce((j->>'expires_in')::int, 5184000)), 'last_error', null), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
    return jsonb_build_object('ok', true, 'expires_in_days', round(coalesce((j->>'expires_in')::int, 5184000) / 86400.0));
  end if;
  v_err := coalesce(v_err, left(coalesce(j #>> '{error,message}', 'HTTP ' || coalesce(r.status::text, '?')), 200));
  insert into public.app_settings (key, value, updated_at)
  values ('instagram_token_info', jsonb_build_object('last_error', v_err, 'failed_at', now()), now())
  on conflict (key) do update set value = public.app_settings.value || jsonb_build_object('last_error', v_err, 'failed_at', now()), updated_at = now();
  -- 관리자에게 하루 한 번만 알림
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'system', '[인스타그램] 접근 토큰 자동 갱신 실패',
         '인스타그램 연결 토큰을 새로 받지 못했습니다. 만료되면 DM 받기 · 바로 게시 · 연락처 수집이 멈춥니다. 영업·수주 › Instagram DM 연결에서 토큰을 다시 넣어 주세요. (사유: ' || v_err || ')', '/sales'
    from public.profiles p
   where p.role = 'admin' and p.active and not p.is_agent
     and not exists (select 1 from public.notifications n where n.user_id = p.id and n.title = '[인스타그램] 접근 토큰 자동 갱신 실패' and n.created_at > now() - interval '20 hours');
  return jsonb_build_object('ok', false, 'error', v_err);
end $$;
revoke all on function private.instagram_token_refresh() from public, anon, authenticated;

-- 매주 월요일 04:27 KST (일요일 19:27 UTC · 정각 · 5분 단위 피함 · 새벽 대량 작업 시간과 겹치지 않게)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'instagram_token_refresh') then perform cron.unschedule('instagram_token_refresh'); end if;
  perform cron.schedule('instagram_token_refresh', '27 19 * * 0', 'select private.instagram_token_refresh()');
end $$;
