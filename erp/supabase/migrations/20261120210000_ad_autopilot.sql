-- 2026-11-20 광고 자동 운영 1단계 (대표 지시 '현재 광고 계정을 너가 전부 컨트롤하면서 광고를 만들고 캠페인을 운영 · 정확하게 고도화')
-- 메타 광고 계정 연결 → 매일 아침 수치 받기(ad_daily · Meta) → 규칙으로 판단(서버 함수 ad-autopilot/rules.ts · AI 없음)
-- → 모드에 따라: 제안만 / 대표 승인 뒤 실행 / 규칙 안에서 자동 실행. 모든 판단 · 실행은 ad_autopilot_actions 에 남김.
-- 안전장치: 월 · 하루 한도(0 이면 증액 없음) · 한 번 바꾸는 폭 5~50% · 긴급 정지 · 한 캠페인 하루 한 가지 · 실행 직전 예산 재확인.
-- 관리자만 보고 고침(RLS is_admin). 열쇠는 금고 META_ADS_TOKEN (다시 보여 주지 않음).

create table if not exists public.ad_autopilot_settings (
  id smallint primary key default 1 check (id = 1),
  mode text not null default 'suggest' check (mode in ('off', 'suggest', 'approve', 'auto')),
  monthly_cap integer not null default 0 check (monthly_cap >= 0),
  daily_cap integer not null default 0 check (daily_cap >= 0),
  max_step_pct integer not null default 20 check (max_step_pct between 5 and 50),
  kill_switch boolean not null default false,
  target_cpl integer check (target_cpl is null or target_cpl > 0),
  min_spend integer not null default 30000 check (min_spend >= 0),
  meta_account_id text check (meta_account_id is null or meta_account_id ~ '^\d{5,20}$'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.ad_autopilot_settings (id) values (1) on conflict do nothing;

create table if not exists public.ad_meta_campaigns (
  id text primary key,
  name text not null,
  status text not null,
  effective_status text,
  objective text,
  daily_budget integer,
  lifetime_budget integer,
  synced_at timestamptz not null default now()
);

create table if not exists public.ad_autopilot_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  day date not null default (now() at time zone 'Asia/Seoul')::date,
  campaign_id text not null,
  campaign_name text not null default '',
  kind text not null check (kind in ('pause', 'scale_up', 'scale_down')),
  from_budget integer,
  to_budget integer,
  reason text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  status text not null default '제안' check (status in ('제안', '실행', '거절', '실패', '만료')),
  auto boolean not null default false,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  executed_at timestamptz,
  result text,
  unique (day, campaign_id)
);
create index if not exists ad_autopilot_actions_recent on public.ad_autopilot_actions (created_at desc);

alter table public.ad_autopilot_settings enable row level security;
alter table public.ad_meta_campaigns enable row level security;
alter table public.ad_autopilot_actions enable row level security;
drop policy if exists ad_autopilot_settings_admin on public.ad_autopilot_settings;
create policy ad_autopilot_settings_admin on public.ad_autopilot_settings for select to authenticated using ((select public.is_admin()));
drop policy if exists ad_meta_campaigns_admin on public.ad_meta_campaigns;
create policy ad_meta_campaigns_admin on public.ad_meta_campaigns for select to authenticated using ((select public.is_admin()));
drop policy if exists ad_autopilot_actions_admin on public.ad_autopilot_actions;
create policy ad_autopilot_actions_admin on public.ad_autopilot_actions for select to authenticated using ((select public.is_admin()));
revoke all on public.ad_autopilot_settings, public.ad_meta_campaigns, public.ad_autopilot_actions from anon;
revoke insert, update, delete on public.ad_autopilot_settings, public.ad_meta_campaigns, public.ad_autopilot_actions from authenticated;

-- 설정 저장 (관리자) — 자동 실행 모드는 월 · 하루 한도가 있어야 함
create or replace function public.ad_autopilot_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text := coalesce(p->>'mode', 'suggest');
        v_month int := coalesce((p->>'monthly_cap')::int, 0);
        v_day int := coalesce((p->>'daily_cap')::int, 0);
        v_acct text := nullif(regexp_replace(coalesce(p->>'meta_account_id', ''), '^act_', ''), '');
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
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
end $$;

-- 긴급 정지만 따로 (한 번 누르면 바로)
create or replace function public.ad_autopilot_kill(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception '관리자만 바꿀 수 있습니다.'; end if;
  update public.ad_autopilot_settings set kill_switch = p_on, updated_by = auth.uid(), updated_at = now() where id = 1;
end $$;

-- 메타 광고 열쇠 (시스템 사용자 토큰 · ads_management · ads_read) — 넣기만, 다시 보여 주지 않음
create or replace function public.ad_meta_token_set(p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (select public.is_admin()) then raise exception '관리자만 넣을 수 있습니다.'; end if;
  p_value := trim(coalesce(p_value, ''));
  if length(p_value) < 20 or length(p_value) > 1000 or p_value ~ '\s' then raise exception '열쇠 형식을 확인해 주세요.'; end if;
  select id into v_id from vault.secrets where name = 'META_ADS_TOKEN';
  if v_id is null then perform vault.create_secret(p_value, 'META_ADS_TOKEN', '메타 광고 계정 열쇠 (ad-autopilot 함수)');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
create or replace function public.ad_meta_token_get()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'META_ADS_TOKEN' limit 1
$$;

-- 화면용 현황 (관리자)
create or replace function public.ad_autopilot_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.ad_autopilot_settings s where id = 1),
    'token', exists (select 1 from vault.secrets where name = 'META_ADS_TOKEN'),
    'info', (select value from public.app_settings where key = 'ad_autopilot_info'),
    'mtd_spend', (select coalesce(sum(cost), 0) from public.ad_daily where platform = 'Meta' and date >= date_trunc('month', (now() at time zone 'Asia/Seoul'))::date),
    'waiting', (select count(*) from public.ad_autopilot_actions where status = '제안')
  ) where (select public.is_admin())
$$;

revoke all on function public.ad_autopilot_save(jsonb), public.ad_autopilot_kill(boolean), public.ad_meta_token_set(text), public.ad_meta_token_get(), public.ad_autopilot_status() from public, anon, authenticated;
grant execute on function public.ad_autopilot_save(jsonb), public.ad_autopilot_kill(boolean), public.ad_meta_token_set(text), public.ad_autopilot_status() to authenticated;
grant execute on function public.ad_meta_token_get() to service_role;

-- 매일 아침 07:07 KST (22:07 UTC · 정각 · 5분 단위 피함): 받기 → 판단 → (자동이면) 실행 → 대표에게 정리 알림
create or replace function private.ad_autopilot_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (select 1 from vault.secrets where name = 'META_ADS_TOKEN') then return; end if;
  if not exists (select 1 from public.ad_autopilot_settings where id = 1 and mode <> 'off' and meta_account_id is not null) then return; end if;
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
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ad_autopilot') then perform cron.unschedule('ad_autopilot'); end if;
  perform cron.schedule('ad_autopilot', '7 22 * * *', 'select private.ad_autopilot_tick()');
end $$;

notify pgrst, 'reload schema';
