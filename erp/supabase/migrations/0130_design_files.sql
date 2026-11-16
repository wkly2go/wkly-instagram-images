-- 0130 산출물 파일 보관: 맥의 작업 처리기가 만든 견적서 · 발주서 파일을 설계 구역에 넣어 두고, 화면에서 바로 내려받는다.
-- (맥의 백그라운드 프로그램은 구글 드라이브 폴더에 쓸 권한이 없어 드라이브 사본을 못 만든다 — 2026-11-15 확인)
-- 작은 문서(8MB 이하)만 넣는다. 발주서(실행 단가 포함)는 관리자만 내려받는다.
begin;
create table design.files (
  document_id uuid primary key references design.documents(id) on delete cascade,
  name text not null,
  mime text not null,
  bytes int not null,
  content bytea not null,
  created_at timestamptz not null default now()
);
alter table design.files enable row level security;
revoke all on design.files from public, anon;
grant select on design.files to authenticated;
grant all on design.files to service_role;
grant select, insert, update, delete on design.files to design_worker;
create policy files_read on design.files for select to authenticated using (
  (select public.is_admin())
  or ((select public.is_active_member()) and exists (select 1 from design.documents d where d.id = document_id and d.kind not like 'po%')));
-- 발주서 기록 자체도 팀원에게는 가린다(파일 이름에 협력사가 드러남)
alter policy documents_read on design.documents using (
  (select public.is_admin()) or ((select public.is_active_member()) and kind not like 'po%'));
alter policy documents_write on design.documents using (
  (select public.is_admin()) or ((select public.is_active_member()) and kind not like 'po%'))
  with check ((select public.is_admin()) or ((select public.is_active_member()) and kind not like 'po%'));

create function public.design_file(p_document uuid)
returns table (name text, mime text, base64 text) language sql stable set search_path = '' as $$
  select f.name, f.mime, encode(f.content, 'base64') from design.files f where f.document_id = p_document
$$;
revoke all on function public.design_file(uuid) from public, anon;
grant execute on function public.design_file(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
