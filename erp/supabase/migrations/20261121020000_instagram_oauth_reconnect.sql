-- 인스타그램 다시 연결 버튼 (2026-11-21 · 계정 잠김으로 토큰이 끊긴 뒤 대표 지시 '너가 작업해 권한을 줄께')
--  - 예전: 개발자 화면에서 토큰 생성 → 복사 → 인트라넷 'Instagram DM 연결'에 붙여 넣기
--  - 이제: 인트라넷 버튼 → 인스타그램 로그인 · [허용] → 서버 함수 instagram-oauth 가 코드를 장기 토큰(60일)으로 바꿔 금고에 저장
--  - 엉뚱한 계정이 연결되지 않게 우리 계정(@theweekly_magazine · 17841475999645207)인지 서버가 확인
--  - 메타 앱 설정 'Instagram 비즈니스 로그인 › OAuth 리디렉션 URI' 에 함수 주소를 한 번 넣어야 동작
--  - DROP 없음

create table if not exists private.instagram_oauth_states (
  state text primary key,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- 관리자: 연결 시작 → 인스타그램 로그인 주소
create or replace function public.instagram_oauth_start()
returns text language plpgsql security definer set search_path = '' as $$
declare v_state text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_admin() then raise exception '관리자만 연결할 수 있습니다.' using errcode = '42501'; end if;
  delete from private.instagram_oauth_states where created_at < now() - interval '1 day';
  insert into private.instagram_oauth_states (state, created_by) values (v_state, auth.uid());
  return 'https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1'
    || '&client_id=2635151180272025'
    || '&redirect_uri=' || replace(replace('https://hophgcpszenrvchvbkav.supabase.co/functions/v1/instagram-oauth', ':', '%3A'), '/', '%2F')
    || '&response_type=code'
    || '&scope=instagram_business_basic%2Cinstagram_business_manage_messages%2Cinstagram_business_manage_comments%2Cinstagram_business_content_publish'
    || '&state=' || v_state;
end $$;
revoke all on function public.instagram_oauth_start() from public, anon;
grant execute on function public.instagram_oauth_start() to authenticated;

-- 서버 함수만: state 확인(15분 · 한 번) → 토큰 저장 · 상태 기록 · 연결한 사람에게 알림
create or replace function public.instagram_oauth_finish(p_state text, p_token text, p_expires_in integer, p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.instagram_oauth_states; v_id uuid;
begin
  update private.instagram_oauth_states set used_at = now()
   where state = p_state and used_at is null and created_at > now() - interval '15 minutes'
  returning * into v_row;
  if v_row.state is null then return jsonb_build_object('ok', false, 'error', '연결 요청이 만료됐거나 이미 쓰였습니다. 인트라넷에서 다시 눌러 주세요.'); end if;
  if coalesce(btrim(p_token), '') = '' or length(p_token) > 1000 or p_token ~ '\s' then return jsonb_build_object('ok', false, 'error', '토큰 형식이 맞지 않습니다.'); end if;
  select id into v_id from vault.secrets where name = 'INSTAGRAM_ACCESS_TOKEN';
  if v_id is null then perform vault.create_secret(p_token, 'INSTAGRAM_ACCESS_TOKEN', 'Instagram DM 연결 (sales-instagram · sales-dispatch 함수)');
  else perform vault.update_secret(v_id, p_token); end if;
  insert into public.app_settings (key, value, updated_at)
  values ('instagram_token_info', jsonb_build_object('refreshed_at', now(), 'expires_at', now() + make_interval(secs => coalesce(p_expires_in, 5184000)), 'last_error', null, 'reconnected_by', v_row.created_by, 'username', p_username), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.notifications (user_id, kind, title, body, link)
  values (v_row.created_by, '시스템', '인스타그램 다시 연결됨', '@' || coalesce(p_username, '') || ' 접근 토큰을 새로 저장했습니다 (60일 · 매주 자동 갱신).', '/sales');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.instagram_oauth_finish(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.instagram_oauth_finish(text, text, integer, text) to service_role;

-- 연결 상태에 토큰 오류(끊김)를 함께 돌려줌 — 오류 뒤 새 토큰이 들어오면(손으로 넣어도) 오류를 숨김
create or replace function public.sales_instagram_status() returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_info jsonb := (select value from public.app_settings where key = 'instagram_token_info');
        v_upd timestamptz := (select updated_at from vault.secrets where name = 'INSTAGRAM_ACCESS_TOKEN' limit 1);
begin
 if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.' using errcode='42501';end if;
 return jsonb_build_object(
  'token',v_upd is not null,
  'app_secret',exists(select 1 from vault.secrets where name='INSTAGRAM_APP_SECRET'),
  'verify_token',(select decrypted_secret from vault.decrypted_secrets where name='INSTAGRAM_VERIFY_TOKEN' limit 1),
  'inbound',(select count(*) from private.sales_dm_inbound),
  'people',(select count(distinct ig_user) from private.sales_dm_inbound),
  'open_windows',(select count(*) from (select ig_user from private.sales_dm_inbound group by ig_user having not bool_or(opt_out) and max(received_at)>now()-interval '24 hours') x),
  'last_inbound',(select max(received_at) from private.sales_dm_inbound),
  'sent',(select count(*) from private.sales_dispatch_jobs where message->>'channel'='instagram' and state='accepted'),
  'token_error',case when v_info->>'last_error' is not null
                       and (v_upd is null or v_upd <= coalesce((v_info->>'invalid_at')::timestamptz, 'infinity'::timestamptz))
                     then v_info->>'last_error' end,
  'expires_at',v_info->>'expires_at');
end $function$;
