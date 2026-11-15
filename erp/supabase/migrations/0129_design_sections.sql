-- 0129 견적 구분(section) · 비고(note): 실제 견적서처럼 'A 진행·기획 / B 렌탈 / C 구매·소품 / D 설치·철거'로 묶어 낸다.
-- 설계 구역만 바꾼다. 보기는 끝에 열만 덧붙인다.
begin;
alter table design.placements add column section text, add column note text;
alter table design.estimate_lines add column section text, add column note text;
alter table design.documents add column drive_path text;   -- 구글 드라이브 프로젝트 폴더 안 위치
create or replace view public.design_documents with (security_invoker = true) as select * from design.documents;
create or replace view public.design_placements with (security_invoker = true) as select * from design.placements;
create or replace view public.design_estimate_lines with (security_invoker = true) as select * from design.estimate_lines;
notify pgrst, 'reload schema';
commit;
