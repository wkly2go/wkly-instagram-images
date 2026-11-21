-- 메타 광고 만들기 (2026-11-21 대표 지시 '모든 광고와 마케팅은 더위클리로' · 메타 연결 뒤 바로 시작)
--  - 광고 준비(marketing_campaigns · 준비 완료 · 매체 메타) → 서버 함수 ad-autopilot 'meta_create' 가 메타에 캠페인 · 광고 세트 · 소재 · 광고를 '멈춤'으로 만듦
--  - 켜기는 대표(관리자) 승인 'meta_launch' — 긴급 정지 · 하루 한도 확인 뒤 / 끄기 'meta_pause'
--  - 광고 계정 · 페이스북 페이지 · 인스타그램은 더위클리 것 (자동 운영 설정에 페이지 번호 · 인스타그램 번호 칸 추가)
--  - DROP 없음 · 설정 저장 함수는 같은 시그니처로 다시 만듦(네이버 칸 유지)

alter table public.ad_autopilot_settings add column if not exists meta_page_id text check (meta_page_id is null or meta_page_id ~ '^\d{5,25}$');
alter table public.ad_autopilot_settings add column if not exists meta_ig_user_id text check (meta_ig_user_id is null or meta_ig_user_id ~ '^\d{5,25}$');
update public.ad_autopilot_settings set meta_ig_user_id = coalesce(meta_ig_user_id, '17841475999645207') where id = 1;

create table if not exists public.ad_meta_drafts (
  campaign_id uuid primary key references public.marketing_campaigns (id) on delete cascade,
  status text not null default '만드는 중' check (status in ('만드는 중', '멈춤', '켜짐', '실패')),
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  daily_budget integer,
  images integer not null default 0,
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  launched_by uuid references public.profiles (id) on delete set null,
  launched_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ad_meta_drafts enable row level security;
drop policy if exists ad_meta_drafts_admin on public.ad_meta_drafts;
create policy ad_meta_drafts_admin on public.ad_meta_drafts for select to authenticated using ((select public.is_admin()));
revoke all on public.ad_meta_drafts from anon;
revoke insert, update, delete on public.ad_meta_drafts from authenticated;

create or replace function public.ad_autopilot_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text := coalesce(p->>'mode', 'suggest');
        v_month int := coalesce((p->>'monthly_cap')::int, 0);
        v_day int := coalesce((p->>'daily_cap')::int, 0);
        v_acct text := nullif(regexp_replace(coalesce(p->>'meta_account_id', ''), '^act_', ''), '');
        v_naver text := nullif(regexp_replace(coalesce(p->>'naver_customer_id', ''), '\D', '', 'g'), '');
        v_page text := nullif(regexp_replace(coalesce(p->>'meta_page_id', ''), '\D', '', 'g'), '');
        v_ig text := nullif(regexp_replace(coalesce(p->>'meta_ig_user_id', ''), '\D', '', 'g'), '');
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
    meta_page_id = v_page,
    meta_ig_user_id = v_ig,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
end $$;

notify pgrst, 'reload schema';
