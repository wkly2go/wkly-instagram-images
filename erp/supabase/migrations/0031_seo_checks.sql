-- WKLY ERP 0031: 검색 노출 점검 — SEO(검색 엔진) · AEO(답변 엔진) · GEO(생성형 AI) 측정 항목
--   WKLY 총괄이 매주 월요일 측정해 기록. 관리자만 열람. 항목은 같은 날 같은 이름이면 덮어씀.

create table if not exists public.seo_checks (
  checked_on  date not null default ((now() at time zone 'Asia/Seoul')::date),
  kind        text not null check (kind in ('SEO', 'AEO', 'GEO')),
  item        text not null check (char_length(item) between 1 and 120),
  score       integer check (score is null or score between 0 and 100),
  status      text not null default '미측정' check (status in ('양호', '주의', '미흡', '미측정')),
  value       text,
  target      text,
  note        text,
  source      text,
  updated_at  timestamptz not null default now(),
  primary key (checked_on, kind, item)
);
comment on table public.seo_checks is '검색 노출 점검: SEO · AEO · GEO 측정 항목 (WKLY 총괄이 매주 기록, 점수 0~100)';
create index if not exists seo_checks_date_idx on public.seo_checks (checked_on desc);
alter table public.seo_checks enable row level security;
drop policy if exists seo_checks_admin on public.seo_checks;
create policy seo_checks_admin on public.seo_checks for select to authenticated using ((select public.is_admin()));
grant select on public.seo_checks to authenticated;
revoke all on public.seo_checks from anon;
