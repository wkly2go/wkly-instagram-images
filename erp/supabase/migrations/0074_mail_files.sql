-- 메일 첨부 → 구글 드라이브 '수신방' 자동 분류 (대표 지시 2026-10-31
--   "이메일 자료 구글 드라이브에 자동으로 분류하고 정리해, 각 업체별로 수신방에 폴더를 만들어서 저장해"
--   결정: 최상위 '수신방' · 세금계산서는 '세금계산서/월별' · 이번 달(10월)부터 · 모두 거래처별로 구분)
--  내 드라이브 / 수신방 / <거래처> / YYMMDD_메일 제목 / 파일
--  내 드라이브 / 수신방 / 세금계산서 / 2026-10 / <거래처> / 파일
--  프로젝트와 연결된 메일 → 프로젝트 폴더 01.협의자료/01.수신 에 바로가기, 계약서는 04.계약서 에도 바로가기
alter table public.mail_index add column if not exists files_done_at timestamptz;
comment on column public.mail_index.files_done_at is '첨부를 드라이브 수신방에 저장(또는 저장할 것 없음 확인)한 때';

create table if not exists public.mail_files (
  id uuid primary key default gen_random_uuid(),
  mail_id text not null references public.mail_index (id) on delete cascade,
  thread_id text,
  name text not null,
  mime text,
  size bigint,
  kind text not null default '첨부' check (kind in ('첨부', '세금계산서', '계약서')),
  vendor text not null,
  client_id uuid references public.clients (id) on delete set null,
  project_ids uuid[] not null default '{}',
  drive_file_id text not null,
  drive_url text not null,
  folder_id text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mail_id, name, size)
);
comment on table public.mail_files is '메일 첨부를 드라이브 수신방에 저장한 기록 (에이전트 · 거래처 · 프로젝트 화면이 지메일 대신 이 표로 파일을 찾음)';
create index if not exists mail_files_client_idx on public.mail_files (client_id, sent_at desc);
create index if not exists mail_files_projects_idx on public.mail_files using gin (project_ids);
create index if not exists mail_index_files_todo_idx on public.mail_index (sent_at) where has_attachment and files_done_at is null;

alter table public.mail_files enable row level security;
create policy mail_files_read on public.mail_files for select to authenticated using (public.is_active_member());
