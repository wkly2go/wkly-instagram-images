-- 피그마 열쇠를 관리 화면으로 (대표 지시 2026-11-27 '피그마 키를 한번 넣으면 모든 프로젝트에서 사용가능하지? 그러면 관리탭에 넣는게 어때?')
-- 열쇠는 원래 회사에 하나(금고 FIGMA_TOKEN). 피그마 개인 토큰은 최대 90일이라, 넣은 날 · 만료일을 app_settings figma_token_info 에 남기고
-- 만료 7일 · 1일 전에 관리자에게 알림(제목에 금액 없음 · 단계마다 한 번). 값 자체는 금고에만.

create or replace function public.figma_secret_set(p_value text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 연결할 수 있습니다.' using errcode = '42501'; end if;
  select id into v_id from vault.secrets where name = 'FIGMA_TOKEN';
  if coalesce(btrim(p_value), '') = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    delete from public.app_settings where key = 'figma_token_info';
    return;
  end if;
  if length(p_value) > 300 or p_value ~ '\s' then raise exception '값 형식을 확인해 주세요.'; end if;
  if v_id is null then perform vault.create_secret(p_value, 'FIGMA_TOKEN', '피그마 읽기 열쇠 (figma 함수 · 읽기 권한만)');
  else perform vault.update_secret(v_id, p_value); end if;
  insert into public.app_settings (key, value, updated_at)
  values ('figma_token_info', jsonb_build_object('set_at', now(), 'expires_at', now() + interval '90 days', 'set_by', auth.uid(), 'notified', '[]'::jsonb), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $function$;

-- 관리 화면: 열쇠가 있는지 · 넣은 날 · 만료일
create or replace function public.figma_token_info()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'token', exists (select 1 from vault.secrets where name = 'FIGMA_TOKEN'),
    'set_at', (select value->>'set_at' from public.app_settings where key = 'figma_token_info'),
    'expires_at', (select value->>'expires_at' from public.app_settings where key = 'figma_token_info'),
    'boards', (select count(*) from public.project_figma)) end
$$;
revoke all on function public.figma_token_info() from public, anon;
grant execute on function public.figma_token_info() to authenticated;

-- 만료 7일 · 1일 전 관리자 알림 (하루 한 번 · 단계마다 한 번)
create or replace function private.figma_token_expiry_tick()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $$
declare v jsonb; v_exp timestamptz; v_left int; v_stage text; n int := 0;
begin
  select value into v from public.app_settings where key = 'figma_token_info';
  if v is null or v->>'expires_at' is null then return 0; end if;
  v_exp := (v->>'expires_at')::timestamptz;
  v_left := ceil(extract(epoch from v_exp - now()) / 86400)::int;
  v_stage := case when v_left <= 1 then 'd1' when v_left <= 7 then 'd7' end;
  if v_stage is null or coalesce(v->'notified', '[]'::jsonb) ? v_stage then return 0; end if;
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, '시스템', case when v_left <= 0 then '피그마 열쇠가 만료되었습니다' else format('피그마 열쇠 만료 D-%s', greatest(v_left, 1)) end,
         format('피그마 개인 토큰이 %s 에 끝납니다. 피그마 › 계정 설정 › 보안 › 새 토큰 생성(만료 90일 · file_content:read · file_metadata:read) 뒤 인트라넷 관리 › 외부 연결 › 피그마 열쇠 바꾸기에 넣어 주세요.', to_char(v_exp at time zone 'Asia/Seoul', 'YYYY-MM-DD')),
         '/admin'
    from public.profiles p where p.active and p.role = 'admin' and not p.is_agent;
  get diagnostics n = row_count;
  update public.app_settings set value = jsonb_set(value, '{notified}', coalesce(value->'notified', '[]'::jsonb) || to_jsonb(v_stage)), updated_at = now() where key = 'figma_token_info';
  return n;
end $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'figma_token_expiry') then
    perform cron.schedule('figma_token_expiry', '17 0 * * *', 'select private.figma_token_expiry_tick()');
  end if;
end $$;

notify pgrst, 'reload schema';
