-- WKLY ERP 0022: 광고 탭 확장 — 광고 소재(우리 · 경쟁사 · 해외) + 광고 분석 보고서(일일 보고 · 경쟁사 분석 · 해외 사례)
--   WKLY 총괄이 매일 08:48 에 기록하고 09:00 전에 관리자에게 알림

create table if not exists public.ad_creatives (
  id          uuid primary key default gen_random_uuid(),
  side        text not null default '우리' check (side in ('우리', '경쟁사', '해외')),
  brand       text not null default '더위클리',
  platform    text,
  campaign    text,
  name        text not null,
  format      text,
  headline    text,
  body        text,
  image_url   text,
  link        text,
  status      text,
  started_on  date,
  last_seen   date,
  impressions integer,
  clicks      integer,
  cost        integer,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (side, brand, name)
);
comment on table public.ad_creatives is '광고 소재: 우리 광고(드라이브 광고소재 폴더) · 경쟁사 · 해외 유사 회사 광고 (WKLY 총괄이 갱신)';

create table if not exists public.ad_reports (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('일일 보고', '경쟁사 분석', '해외 사례')),
  report_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  title       text not null,
  summary     text,
  body        text,
  sources     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kind, report_date, title)
);
comment on table public.ad_reports is '광고 분석 보고서: 매일 09시 개선점 · 경쟁사 현황(일일 보고), 경쟁사 분석, 해외 유사 회사 광고 집행 사례';
create index if not exists ad_reports_date_idx on public.ad_reports (report_date desc);

alter table public.ad_creatives enable row level security;
alter table public.ad_reports enable row level security;
drop policy if exists ad_creatives_admin on public.ad_creatives;
create policy ad_creatives_admin on public.ad_creatives for select to authenticated using ((select public.is_admin()));
drop policy if exists ad_reports_admin on public.ad_reports;
create policy ad_reports_admin on public.ad_reports for select to authenticated using ((select public.is_admin()));
grant select on public.ad_creatives, public.ad_reports to authenticated;
revoke all on public.ad_creatives, public.ad_reports from anon;

-- 새 보고서가 올라오면 관리자에게 알림
create or replace function private.ad_report_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_tab text := case new.kind when '일일 보고' then 'daily' when '경쟁사 분석' then 'competitors' else 'overseas' end;
begin
  for r in select p.id from public.profiles p where p.active and not p.is_agent and p.role = 'admin' loop
    perform public.notify(r.id, '일일 보고', '📊 광고 ' || new.kind || ' · ' || to_char(new.report_date, 'MM-DD'), coalesce(left(new.summary, 300), new.title), '/ads?tab=' || v_tab || '&id=' || new.id);
  end loop;
  return null;
end;
$$;
drop trigger if exists ad_reports_notify on public.ad_reports;
create trigger ad_reports_notify after insert on public.ad_reports
  for each row execute function private.ad_report_notify();
