-- PC 프로그램(데스크톱) 설치 · 자동 업데이트 파일 공개 보관함 (2026-11-18 · 저장소 비공개 준비 · docs/SECURITY_CHECK_20261117.md)
--  - GitHub 릴리스 주소는 저장소를 비공개로 바꾸면 로그인 없이 못 받음 → 같은 파일을 이 공개 보관함에도 둠
--  - 올리기는 GitHub Actions(이 저장소 main · OIDC 확인)가 서버 함수 public-files 에서 받은 서명 올리기 주소로만
--  - 설치 파일이 82~180MB 라 보관함 한도 300MB (프로젝트 전체 업로드 한도가 이보다 작으면 그 한도가 먼저 걸림 · 대시보드 Storage › Settings)
--  - 다른 보관함은 모두 자기 한도가 따로 있어 전체 한도를 올려도 그대로
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('desktop-releases', 'desktop-releases', true, 314572800,
        array['application/octet-stream', 'application/zip', 'application/x-apple-diskimage', 'text/yaml'])
on conflict (id) do nothing;
