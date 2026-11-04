-- 안드로이드 앱(APK) 서명 키: 공개 저장소에 두지 않고 Vault 에 보관 (ANDROID_KEYSTORE_B64 · ANDROID_KEYSTORE_PASSWORD)
-- 서버 함수 android-key 만 읽음 (GitHub Actions 의 OIDC 토큰을 확인한 뒤 빌드 작업에만 넘김)
create or replace function public.android_key_get(p_name text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_name and p_name in ('ANDROID_KEYSTORE_B64', 'ANDROID_KEYSTORE_PASSWORD') limit 1
$$;
revoke all on function public.android_key_get(text) from public, anon, authenticated;
grant execute on function public.android_key_get(text) to service_role;

-- 처음 빌드 때 GitHub Actions 가 키를 만들어 넘기면 저장 (이미 있으면 바꾸지 않음 · 키가 바뀌면 설치된 앱을 업데이트할 수 없음)
create or replace function public.android_key_set(p_name text, p_value text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_name not in ('ANDROID_KEYSTORE_B64', 'ANDROID_KEYSTORE_PASSWORD') then return false; end if;
  if exists (select 1 from vault.secrets where name = p_name) then return false; end if;
  perform vault.create_secret(p_value, p_name);
  return true;
end
$$;
revoke all on function public.android_key_set(text, text) from public, anon, authenticated;
grant execute on function public.android_key_set(text, text) to service_role;
