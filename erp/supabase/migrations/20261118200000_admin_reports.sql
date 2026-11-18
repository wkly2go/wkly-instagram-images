-- 관리자 보고서 (2026-11-18 대표 지시 '보고서로 만들어서 인트라넷 관리자 전용 관리에 저장해')
--  관리 › 관리자 화면의 '관리자 보고서' 칸에 쌓는 내부 보고서(공정률 · 비교 분석 등). 관리자만 읽고 씀. 본문은 마크다운(ReportBody).
--  보고서 내용은 데이터로만 넣고 이 파일에는 넣지 않는다.
create table if not exists public.admin_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  category text not null default '분석',
  summary text,
  body text not null default '',
  report_date date not null default (now() at time zone 'Asia/Seoul')::date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_reports enable row level security;
create policy admin_reports_all on public.admin_reports for all using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on table public.admin_reports from anon;
