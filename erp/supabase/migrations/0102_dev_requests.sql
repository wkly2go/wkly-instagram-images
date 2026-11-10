-- 인트라넷 수정 요청 (대표 지시 2026-11-10 "대표의 지시에 예외 없이 · 인트라넷 수정도 할 수 있게")
--   WKLY 총괄 AI 가 대표 지시를 받아 넣고(request_intranet_change · 서비스 키), 매시 Claude Code 예약 작업이 처리 → 결과 기록 · 대표 알림
create table if not exists public.dev_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id),
  content text not null check (char_length(content) between 1 and 4000),
  room_id uuid,
  status text not null default '대기' check (status in ('대기', '진행', '완료', '보류')),
  result text,
  pr_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.dev_requests enable row level security;
drop policy if exists dev_requests_admin_read on public.dev_requests;
create policy dev_requests_admin_read on public.dev_requests for select to authenticated using ((select public.is_admin()));
grant select on public.dev_requests to authenticated;
comment on table public.dev_requests is '대표 → 총괄 AI → Claude Code 인트라넷 수정 요청';
