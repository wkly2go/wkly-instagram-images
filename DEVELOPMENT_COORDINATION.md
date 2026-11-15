# 공동 개발 인수인계

2026-11-15 사용자 확정 분담. 이 문서는 공유 규칙이며 자동 파일 잠금이나 상대 세션과의 실시간 통신 기능은 아니다.

| 담당 | 브랜치/범위 | 다른 작업자의 접근 |
|---|---|---|
| 설계 담당 | `claude/design-integration`, DB `design`, 설계·견적 메뉴와 관련 파일 | 수정·삭제·정리 금지 |
| 영업 담당 | `codex/sales-evidence-foundation-20261115`, Sales·Growth 화면과 관련 테이블 | 변경 요청과 PR로 조정 |
| 공유 경계 | 라우터·메뉴·공통 타입·스타일·패키지·배포 설정 | 변경 목적/파일을 명시하고 통합 시 상호 대조 |

## 영업 쪽 현재 상태

- PR #397은 main에 병합되어 자동 기획이 운영 중이다. 영업 전체 실행 자동화가 완성된 것은 아니다.
- PR #399는 개발 초안이다. `0128_sales_evidence_history.sql`과 DB 테스트, 개발 규칙을 포함한다. 0128은 아직 운영 미적용이며 이번 작업에서 예약한 번호다. 상대 작업에 같은 번호가 있으면 영업 쪽 미적용 파일의 번호를 변경한다.
- 출처 이력과 검증 현황 API 및 Sales 보고서/후보 상세의 읽기 전용 화면 연결이 준비됐으며 운영 미적용, 발송은 비활성이다. 화면 변경은 `SalesReport`·`SalesProspectReview`·신규 `SalesEvidence`·영업 API에 한정하며 공유 메뉴/라우터/전역 스타일은 변경하지 않았다. 전체 계획은 `SALES_AUTOMATION_PLAN.md`를 따른다.
- 사람 팀원에게 원자료 검색·가공·DB 정리를 넘기지 않는 규칙은 `AGENTS.md`에 있다.

## 같은 Mac에서 작업하는 방법

각자의 기존 독립 작업 폴더를 유지한다. 다른 담당자의 브랜치를 체크아웃하거나 그 폴더에서 명령을 실행하지 않는다. git worktree의 별도 디렉터리 또는 독립 clone을 사용한다. 개발 서버 포트와 브라우저 탭도 분리한다. 운영 SQL 편집기나 배포 화면은 동시에 조작하지 않는다.

## 병합 전 인수인계 항목

PR에는 기준 main SHA, 수정 파일, 새/변경 DB 객체, migration 번호와 적용 여부, 실행한 검증, 운영 배포 필요 여부를 기록한다. 최신 main과 상대의 공개된 PR을 대조해 번호 및 공유 파일 충돌을 확인한다. 아직 공개되지 않은 변경은 상대가 번호·파일 목록을 알려줄 때까지 통합 확인 미완료로 남긴다. 병합 대상 변경과 무관한 영업 개발은 계속할 수 있다.

`node erp/scripts/check-migration-numbers.mjs --base-ref origin/main`

상대 브랜치를 읽을 수 있게 된 뒤에는 해당 ref를 `--base-ref`로 한 번 더 실행한다. 같은 파일명의 상이한 수정, SQL 객체 충돌, 메뉴 기능 보존은 별도 diff/통합 테스트로 확인한다. 이 스크립트는 번호 중복 검사만 담당한다.

## 현재 대조 결과 (2026-11-15)

설계 브랜치가 원격에 공개됐다. `1fb7568c45c036ad2cb0f27ff564cadd840713ee`에서 설계 측 `0125_design_schema.sql`, `0126_design_project_info.sql`, `0127_design_actions.sql`을 읽기 전용으로 확인했다. 상대 파일은 수정하지 않고 운영 미적용 영업 출처 이력 파일을 **0128**로 변경했다. 신규 영업 대화 DB는 **0129_sales_desk.sql**이다. 이 기준으로 새 migration 번호 충돌이 없다. main 병합 직전에 양쪽 최신 SHA를 다시 확인한다.

영업 대화 변경은 Sales 화면·영업 API·sales-desk 함수에 한정한다. 상대 변경의 App/Shell/api/demoApi/supabaseApi 및 design 파일과 겹치지 않는다. 대화는 기존 ai_agents 설정을 읽지만 수정하지 않는다. 새 객체는 public.sales_desk_messages, private.sales_desk_jobs 및 sales_desk_* 함수다. design 스키마 참조/수정은 없다.

0128·0129 운영 미적용. 운영 DB 적용 및 서버 배포 순서는 확인 중이며 실제 적용으로 표시하지 않는다. 대화창은 자료 조회·분석 보고서·기존 수집 요청을 지원한다. 새 나라장터 수집기는 아직 개발 중이며 운영 연결 완료로 표시하지 않는다.

현재 main의 기존 번호 중복: `0079_festival_links.sql`/`0079_field_survey.sql`, `0080_field_survey_realtime.sql`/`0080_project_room_closed.sql`. 기존 파일은 변경하지 않았다. 검사기는 기준 ref에 이미 있는 중복을 경고하고, 새 중복을 만들면 실패한다. 같은 파일명 아래 내용 충돌과 SQL 객체 충돌은 별도 검토한다.
