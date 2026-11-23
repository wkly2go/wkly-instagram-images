-- 2026-11-21 광고 자동 운영 4단계: 네이버 검색광고 연결 (대표 지시 '개발 진행해' · 다음 단계 '네이버 · 구글 광고')
-- 메타와 같은 규칙 · 한도 · 모드 · 긴급 정지 · 기록을 그대로 쓴다. 한도는 두 매체 합계.
-- 네이버 쓰기는 캠페인 '멈춤'(userLock) · '하루 예산'(dailyBudget) 두 가지뿐. 열쇠는 금고 NAVER_SEARCHAD_KEY · NAVER_SEARCHAD_SECRET (다시 안 보여 줌).
-- 기존 표에는 칸만 더함 (지우기 · 제약 변경 없음).

alter table public.ad_autopilot_settings add column if not exists naver_customer_id text check (naver_customer_id is null or naver_customer_id ~ '^\d{3,15}$');
alter table public.ad_autopilot_actions add column if not exists platform text not null default 'meta' check (platform in ('meta', 'naver'));

create table if not exists public.ad_naver_campaigns (
  id text primary key,
  name text not null,
  status text not null,
  user_lock boolean not null default false,
  daily_budget integer,
  use_daily_budget boolean not null default false,
  campaign_type text,
  synced_at timestamptz not null default now()
);
alter table public.ad_naver_campaigns enable row level security;
create policy ad_naver_campaigns_admin on public.ad_naver_campaigns for select to authenticated using ((select public.is_admin()));
revoke all on public.ad_naver_campaigns from anon;
revoke insert, update, delete on public.ad_naver_campaigns from authenticated;

-- 네이버 검색광고 API 열쇠 (searchad.naver.com › 도구 › API 사용 관리: 엑세스라이선스 · 비밀키) — 넣기만
create or replace function public.ad_naver_keys_set(p_key text, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (select public.is_admin()) then raise exception '관리자만 넣을 수 있습니다.'; end if;
  p_key := trim(coalesce(p_key, '')); p_secret := trim(coalesce(p_secret, ''));
  if length(p_key) < 20 or length(p_key) > 300 or p_key ~ '\s' or length(p_secret) < 10 or length(p_secret) > 300 or p_secret ~ '\s' then
    raise exception '엑세스라이선스 · 비밀키 형식을 확인해 주세요.';
  end if;
  select id into v_id from vault.secrets where name = 'NAVER_SEARCHAD_KEY';
  if v_id is null then perform vault.create_secret(p_key, 'NAVER_SEARCHAD_KEY', '네이버 검색광고 엑세스라이선스 (ad-autopilot)'); else perform vault.update_secret(v_id, p_key); end if;
  select id into v_id from vault.secrets where name = 'NAVER_SEARCHAD_SECRET';
  if v_id is null then perform vault.create_secret(p_secret, 'NAVER_SEARCHAD_SECRET', '네이버 검색광고 비밀키 (ad-autopilot)'); else perform vault.update_secret(v_id, p_secret); end if;
end $$;
create or replace function public.ad_naver_keys_get()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'key', (select decrypted_secret from vault.decrypted_secrets where name = 'NAVER_SEARCHAD_KEY' limit 1),
    'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'NAVER_SEARCHAD_SECRET' limit 1))
$$;
revoke all on function public.ad_naver_keys_set(text, text), public.ad_naver_keys_get() from public, anon, authenticated;
grant execute on function public.ad_naver_keys_set(text, text) to authenticated;
grant execute on function public.ad_naver_keys_get() to service_role;

-- 설정 저장: 네이버 고객 번호 칸 더함 (같은 시그니처로 다시 만듦)
create or replace function public.ad_autopilot_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text := coalesce(p->>'mode', 'suggest');
        v_month int := coalesce((p->>'monthly_cap')::int, 0);
        v_day int := coalesce((p->>'daily_cap')::int, 0);
        v_acct text := nullif(regexp_replace(coalesce(p->>'meta_account_id', ''), '^act_', ''), '');
        v_naver text := nullif(regexp_replace(coalesce(p->>'naver_customer_id', ''), '\D', '', 'g'), '');
begin
  if not (select public.is_admin()) then raise exception '관리자만 바꿀 수 있습니다.'; end if;
  if v_mode = 'auto' and (v_month <= 0 or v_day <= 0) then raise exception '자동 실행은 월 한도와 하루 한도를 먼저 정해야 합니다.'; end if;
  if v_day > 0 and v_month > 0 and v_day > v_month then raise exception '하루 한도가 월 한도보다 클 수 없습니다.'; end if;
  update public.ad_autopilot_settings set
    mode = v_mode, monthly_cap = v_month, daily_cap = v_day,
    max_step_pct = coalesce((p->>'max_step_pct')::int, 20),
    kill_switch = coalesce((p->>'kill_switch')::boolean, false),
    target_cpl = nullif((p->>'target_cpl')::int, 0),
    min_spend = coalesce((p->>'min_spend')::int, 30000),
    meta_account_id = v_acct,
    naver_customer_id = v_naver,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
end $$;

-- 화면 현황: 네이버 열쇠 · 이번 달 네이버 광고비 더함
create or replace function public.ad_autopilot_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.ad_autopilot_settings s where id = 1),
    'token', exists (select 1 from vault.secrets where name = 'META_ADS_TOKEN'),
    'naver_token', exists (select 1 from vault.secrets where name = 'NAVER_SEARCHAD_KEY') and exists (select 1 from vault.secrets where name = 'NAVER_SEARCHAD_SECRET'),
    'info', (select value from public.app_settings where key = 'ad_autopilot_info'),
    'mtd_spend', (select coalesce(sum(cost), 0) from public.ad_daily where platform in ('Meta', 'Naver') and date >= date_trunc('month', (now() at time zone 'Asia/Seoul'))::date),
    'waiting', (select count(*) from public.ad_autopilot_actions where status = '제안')
  ) where (select public.is_admin())
$$;

-- 예약: 메타나 네이버 중 하나라도 연결돼 있으면 돈다
create or replace function private.ad_autopilot_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (
    select 1 from public.ad_autopilot_settings s where s.id = 1 and s.mode <> 'off' and (
      (s.meta_account_id is not null and exists (select 1 from vault.secrets where name = 'META_ADS_TOKEN'))
      or (s.naver_customer_id is not null and exists (select 1 from vault.secrets where name = 'NAVER_SEARCHAD_KEY'))))
  then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'GDRIVE_SYNC_KEY';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/ad-autopilot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function private.ad_autopilot_tick() from public;

notify pgrst, 'reload schema';
