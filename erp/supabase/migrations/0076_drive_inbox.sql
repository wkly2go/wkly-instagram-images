-- 드라이브에 넣은 자료도 수신방으로 (대표 지시 2026-11-01 "자료를 구글드라이브에 넣으면 분리해서 자동으로 수신방에 저장되도록해")
--  ① 프로젝트 폴더에 새로 넣은 파일 → 수신방 / <거래처> / <연번 프로젝트> / <분류> 에 바로가기 (원본은 그대로)
--  ② 수신방 맨 위에 바로 넣은 파일 → 파일 이름의 연번 · 프로젝트 · 거래처로 찾아 수신방 / <거래처> / <연번 프로젝트> / <분류> 로 옮김
--     (못 찾으면 수신방 / 미분류) · 프로젝트를 찾으면 프로젝트 폴더 01.협의자료/01.수신 에 바로가기
--  분류: 세금계산서 · 계약서 · 견적서 · 도면 · 일정표 · 사진 · 첨부
alter table public.mail_files alter column mail_id drop not null;
alter table public.mail_files add column if not exists source text not null default 'mail';
alter table public.mail_files add column if not exists source_file_id text;
alter table public.mail_files drop constraint if exists mail_files_source_check;
alter table public.mail_files add constraint mail_files_source_check check (source in ('mail', 'drive'));
alter table public.mail_files drop constraint if exists mail_files_kind_check;
alter table public.mail_files add constraint mail_files_kind_check check (kind in ('첨부', '세금계산서', '계약서', '견적서', '도면', '일정표', '사진'));
alter table public.mail_files add constraint mail_files_source_file_key unique (source_file_id);
comment on column public.mail_files.source is 'mail = 메일 첨부 · drive = 드라이브에 넣은 자료';
comment on column public.mail_files.source_file_id is '드라이브에 넣은 원본 파일 id (한 번만 정리)';

-- 드라이브 목록에 '처음 본 때' (새로 넣은 파일만 수신방으로 · 예전 자료는 제외)
alter table public.drive_index add column if not exists first_seen_at timestamptz not null default now();
update public.drive_index set first_seen_at = '2000-01-01' where first_seen_at >= now() - interval '1 minute';
create index if not exists drive_index_first_seen_idx on public.drive_index (first_seen_at);
