-- 0035 · 프로젝트 ↔ 구글 드라이브 폴더 연동 (대표 지시 2026-10-17)
-- 폴더 주소가 없으면 화면에서 '연번 이름'으로 드라이브 검색 링크를 대신 보여 준다.
-- 운영 DB: 같은 날 드라이브 #ARTERIOR_2026 · #WKLY_2026 폴더 이름(연번 + 프로젝트명)과 맞춰 21건 채움,
-- '파트너스 크루 · 공간 제휴' 는 더위클리 프로젝트로 연번 TW2610 + 새 폴더
alter table public.projects add column if not exists drive_url text;
