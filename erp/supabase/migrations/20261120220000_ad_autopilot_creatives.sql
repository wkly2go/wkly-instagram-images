-- 2026-11-20 광고 자동 운영 2단계 (대표 지시 '개발 계속해')
-- ① 소재(광고) 목록 ad_meta_ads · 소재 피로 멈춤 (판단 기록에 ad_id · ad_name)
-- ② 실행 7일 뒤 효과 확인 (effect · effect_note · effect_at) → 화면 '규칙 성적표'
-- 기존 표에는 칸만 더함 (지우기 · 제약 변경 없음)
create table if not exists public.ad_meta_ads (
  id text primary key,
  campaign_id text not null,
  name text not null,
  status text not null,
  effective_status text,
  thumbnail_url text,
  synced_at timestamptz not null default now()
);
create index if not exists ad_meta_ads_campaign on public.ad_meta_ads (campaign_id);
alter table public.ad_meta_ads enable row level security;
create policy ad_meta_ads_admin on public.ad_meta_ads for select to authenticated using ((select public.is_admin()));
revoke all on public.ad_meta_ads from anon;
revoke insert, update, delete on public.ad_meta_ads from authenticated;

alter table public.ad_autopilot_actions add column if not exists ad_id text;
alter table public.ad_autopilot_actions add column if not exists ad_name text;
alter table public.ad_autopilot_actions add column if not exists effect text check (effect is null or effect in ('좋아짐', '나빠짐', '비슷'));
alter table public.ad_autopilot_actions add column if not exists effect_note text;
alter table public.ad_autopilot_actions add column if not exists effect_at timestamptz;

notify pgrst, 'reload schema';
