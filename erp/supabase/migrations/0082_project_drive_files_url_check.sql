-- 프로젝트 연결 문서(project_drive_files) 등록 오류 수정
-- url · icon_url 검사식의 반복 횟수 {1,1000} · {1,500} 이 Postgres 정규식 상한(255)을 넘어
-- 모든 등록이 "invalid repetition count(s)" 로 실패하던 문제. 반복 횟수 대신 길이 검사로 바꾼다.

alter table public.project_drive_files drop constraint if exists project_drive_files_url_check;
alter table public.project_drive_files add constraint project_drive_files_url_check
  check (url ~ '^https://(drive|docs)\.google\.com/[^\s<>"]+$' and length(url) <= 1100);

alter table public.project_drive_files drop constraint if exists project_drive_files_icon_url_check;
alter table public.project_drive_files add constraint project_drive_files_icon_url_check
  check (icon_url is null or (icon_url ~ '^https://[^\s<>"]+$' and length(icon_url) <= 510));
