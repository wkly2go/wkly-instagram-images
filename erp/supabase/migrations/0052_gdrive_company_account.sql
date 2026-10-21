-- 회사 구글 계정 연결 (대표 지시 2026-10-21 "구글 계정은 회사 계정을 모두 공유" · 프로젝트 폴더를 드라이브와 연동)
--  - 관리자가 한 번 '회사 구글 계정 연결' → gdrive 함수가 받은 갱신 토큰을 Vault 에 보관 (브라우저로 나가지 않음)
--  - 아래 두 함수는 서버(service_role)만 부를 수 있음 · 다룰 수 있는 이름도 고정
create or replace function public.gdrive_secret_get(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_name and p_name in ('GOOGLE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN') limit 1
$$;
create or replace function public.gdrive_secret_set(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name <> 'GOOGLE_DRIVE_REFRESH_TOKEN' then raise exception 'not allowed'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name, '회사 구글 드라이브 연결 (gdrive 함수)');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
revoke all on function public.gdrive_secret_get(text) from public, anon, authenticated;
revoke all on function public.gdrive_secret_set(text, text) from public, anon, authenticated;
grant execute on function public.gdrive_secret_get(text) to service_role;
grant execute on function public.gdrive_secret_set(text, text) to service_role;
