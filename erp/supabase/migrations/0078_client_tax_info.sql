-- 매출 세금계산서 발행 정보 (대표 지시 2026-11-02 "매출에는 세금계산서 발행해야 하니 사업자등록증이랑 메일주소 올리는 칸")
alter table public.clients add column if not exists tax_email text;
alter table public.clients add column if not exists biz_cert_url text;
alter table public.clients add column if not exists biz_cert_name text;
comment on column public.clients.tax_email is '세금계산서 받을 메일 주소';
comment on column public.clients.biz_cert_url is '사업자등록증 파일 (구글 드라이브 주소)';
comment on column public.clients.biz_cert_name is '사업자등록증 파일 이름';
