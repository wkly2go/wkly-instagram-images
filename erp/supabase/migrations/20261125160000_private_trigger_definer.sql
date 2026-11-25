-- 2026-11-21 인트라넷 점검 · 대표 승인. 운영 DB 에는 같은 날 먼저 적용함
-- (mail_link_security_definer_fix · private_trigger_fns_security_definer). 이 파일은 저장소를 운영과 맞추는 기록이다.
--
-- 증상
--   · 10:18~11:18 메일 동기화(wkly_gmail_sync)가 7번 연속 '메일 목록 저장 실패: permission denied for schema private'
--   · 팀원이 결재 종류 '기타'로 올리면 같은 오류
-- 원인
--   트리거 함수가 호출자 권한(security invoker)으로 돌면서 private 구역의 다른 함수를 부른다.
--   authenticated · service_role 에는 private 구역 사용 권한이 없다(postgres 만 있음).
--   20261121010000_mail_project_manual 이 private.mail_link() 안에 private.mail_apply_overrides 호출을 넣으면서 드러남.
-- 조치
--   private 의 다른 함수를 부르는 트리거 함수 네 개를 security definer 로 맞춘다(같은 마이그레이션의 mail_link_threads 와 같은 방식).
--   모두 search_path = '' 이고 본문은 새 행 값 계산만 한다.
-- 규칙
--   private 구역의 함수 · 표를 쓰는 트리거 함수는 security definer + set search_path = '' 로 만든다.
-- 되돌리기
--   alter function private.<이름>() security invoker;

alter function private.mail_link() security definer;
alter function private.mail_link() set search_path = '';

alter function private.approvals_classify() security definer;
alter function private.sales_brand_score() security definer;
alter function private.sales_mail_noise_gate() security definer;
