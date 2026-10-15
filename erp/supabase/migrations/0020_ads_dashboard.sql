-- WKLY ERP 0020: 광고 · 마케팅 대시보드 (WKLY 총괄이 매일 광고 관리자 숫자를 기록)
create table if not exists public.ad_daily (
  date         date not null,
  platform     text not null check (platform in ('Google', 'Meta', 'Naver', '기타')),
  campaign     text not null,
  impressions  integer,
  clicks       integer,
  cost         integer,
  conversions  numeric,
  note         text,
  updated_at   timestamptz not null default now(),
  primary key (date, platform, campaign)
);
comment on table public.ad_daily is '광고 일별 성과 (원 단위 정수, 전날 기준). WKLY 광고 대시보드 갱신 작업이 기록';

create table if not exists public.ad_campaigns (
  platform      text not null check (platform in ('Google', 'Meta', 'Naver', '기타')),
  campaign      text not null,
  full_name     text,
  status        text,
  daily_budget  integer,
  start_date    date,
  end_date      date,
  flags         text,
  checked_at    timestamptz not null default now(),
  primary key (platform, campaign)
);
comment on table public.ad_campaigns is '광고 캠페인 상태 · 일 예산 · 경고 (WKLY 총괄이 갱신)';

alter table public.ad_daily enable row level security;
alter table public.ad_campaigns enable row level security;
drop policy if exists ad_daily_admin on public.ad_daily;
create policy ad_daily_admin on public.ad_daily for select to authenticated using ((select public.is_admin()));
drop policy if exists ad_campaigns_admin on public.ad_campaigns;
create policy ad_campaigns_admin on public.ad_campaigns for select to authenticated using ((select public.is_admin()));
grant select on public.ad_daily, public.ad_campaigns to authenticated;
revoke all on public.ad_daily, public.ad_campaigns from anon;
