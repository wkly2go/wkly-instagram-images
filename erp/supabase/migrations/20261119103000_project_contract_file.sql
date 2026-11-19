-- 프로젝트 계약서 파일 (2026-11-19 대표 지시 '계약서도 저장하게 만들어' · 매출 줄 '세금계산서 발행 정보'에 사업자등록증과 나란히).
-- 파일은 드라이브 수신방(프로젝트 › 계약서)에 올리고, 여기에는 주소 · 이름만. 프로젝트 고치기 권한(활성 팀원) 그대로.
alter table public.projects add column if not exists contract_file_url text;
alter table public.projects add column if not exists contract_file_name text;
comment on column public.projects.contract_file_url is '계약서 파일 (드라이브 주소 · 세금계산서 발행 정보 칸에서 올림)';
