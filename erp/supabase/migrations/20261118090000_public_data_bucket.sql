-- 공개 내려받기 보관함 (2026-11-18 · 저장소 비공개 준비 — 대표 우선순위 6)
-- GitHub 저장소가 공개라 쓰던 것들을 Supabase 공개 보관함으로 옮김:
--   seoul-events.json · coex-events.json (서울시 · 코엑스 공개 행사 스냅샷, 원래 data/seoul-events 브랜치)
--   android/wkly-erp.apk (원래 GitHub 릴리스 android)
-- 쓰기는 서버 함수 public-files 만 (GitHub Actions OIDC · 이 저장소 main), 읽기는 누구나(공개 자료만 둠).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-data', 'public-data', true, 10485760, array['application/json', 'application/vnd.android.package-archive'])
on conflict (id) do nothing;
