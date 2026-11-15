# 공동 개발 인수인계

2026-11-15 사용자 확정 분담. 이 문서는 공유 규칙이며 자동 파일 잠금이나 상대 세션과의 실시간 통신 기능은 아니다.

| 담당 | 브랜치/범위 | 다른 작업자의 접근 |
|---|---|---|
| 설계 담당 | `claude/design-integration`, DB `design`, 설계·견적 메뉴와 관련 파일 | 수정·삭제·정리 금지 |
| 영업 담당 | `codex/sales-evidence-foundation-20261115`, Sales·Growth 화면과 관련 테이블 | 변경 요청과 PR로 조정 |
| 공유 경계 | 라우터·메뉴·공통 타입·스타일·패키지·배포 설정 | 변경 목적/파일을 명시하고 통합 시 상호 대조 |

## 영업 쪽 현재 상태

- PR #397은 main에 병합되어 자동 기획이 운영 중이다. 영업 전체 실행 자동화가 완성된 것은 아니다.
- PR #399는 개발 초안이다. `0131_sales_evidence_history.sql`과 DB 테스트, 개발 규칙을 포함한다. 0131은 아직 운영 미적용이며 이번 작업에서 예약한 번호다. 상대 작업에 같은 번호가 있으면 영업 쪽 미적용 파일의 번호를 변경한다.
- 출처 이력과 검증 현황 API 및 Sales 보고서/후보 상세의 읽기 전용 화면 연결이 준비됐으며 운영 미적용, 발송은 비활성이다. 화면 변경은 `SalesReport`·`SalesProspectReview`·신규 `SalesEvidence`·영업 API에 한정하며 공유 메뉴/라우터/전역 스타일은 변경하지 않았다. 전체 계획은 `SALES_AUTOMATION_PLAN.md`를 따른다.
- 사람 팀원에게 원자료 검색·가공·DB 정리를 넘기지 않는 규칙은 `AGENTS.md`에 있다.

## 같은 Mac에서 작업하는 방법

각자의 기존 독립 작업 폴더를 유지한다. 다른 담당자의 브랜치를 체크아웃하거나 그 폴더에서 명령을 실행하지 않는다. git worktree의 별도 디렉터리 또는 독립 clone을 사용한다. 개발 서버 포트와 브라우저 탭도 분리한다. 운영 SQL 편집기나 배포 화면은 동시에 조작하지 않는다.

## 병합 전 인수인계 항목

PR에는 기준 main SHA, 수정 파일, 새/변경 DB 객체, migration 번호와 적용 여부, 실행한 검증, 운영 배포 필요 여부를 기록한다. 최신 main과 상대의 공개된 PR을 대조해 번호 및 공유 파일 충돌을 확인한다. 아직 공개되지 않은 변경은 상대가 번호·파일 목록을 알려줄 때까지 통합 확인 미완료로 남긴다. 병합 대상 변경과 무관한 영업 개발은 계속할 수 있다.

`node erp/scripts/check-migration-numbers.mjs --base-ref origin/main`

상대 브랜치를 읽을 수 있게 된 뒤에는 해당 ref를 `--base-ref`로 한 번 더 실행한다. 같은 파일명의 상이한 수정, SQL 객체 충돌, 메뉴 기능 보존은 별도 diff/통합 테스트로 확인한다. 이 스크립트는 번호 중복 검사만 담당한다.

## 현재 대조 결과 (2026-11-15)

최신 확인 main `4b2a31d080ef0957262ee84512e62df0404f6e1e`, 설계 브랜치 `c974f94ec0ca7900a7e91590e3c6872e28e52802`. 설계 측 0125~0128이 공개되었고 0128_design_estimate_rules.sql과 영업의 이전 번호가 겹쳤다. 상대 파일은 변경하지 않고 **운영 미적용인 영업 파일만** 0131_sales_evidence_history.sql → 0132_sales_desk.sql → 0133_sales_g2b_collection.sql로 변경했다. 이 순서가 적용 순서이며 이번 브랜치가 사용한 번호다. 최신 공개 기준 번호 충돌은 없지만 병합 직전에 재확인한다. 아직 공개되지 않은 상대 변경은 확인하지 못했다.

영업 대화 변경은 Sales 화면·영업 API·sales-desk 함수에 한정한다. 상대 변경의 App/Shell/api/demoApi/supabaseApi 및 design 파일과 겹치지 않는다. 대화는 기존 ai_agents 설정을 읽지만 수정하지 않는다. 새 객체는 public.sales_desk_messages, private.sales_desk_jobs 및 sales_desk_* 함수다. design 스키마 참조/수정은 없다.

**사용자가 Claude 배포 중이라고 확인했으므로 main 병합·운영 SQL·서버 배포는 보류한다.** 0131·0132·0133·0134 모두 운영 미적용이다. 대화창의 수집 요청과 기존 일일 취합이 새 나라장터 수집 작업을 등록하도록 개발했으며 로컬 DB/처리기 검증까지 완료했다. 실제 API 키·활용 승인·운영 실행은 확인 전이다.

나라장터 추가 범위는 private.sales_g2b_jobs/pages/items, sales_g2b_* 함수, sales_collection_runs의 내부 취합 완료 트리거, 1분 만료 감시 cron, 새 sales-g2b Edge Function이다. sales_prospects·sales_source_history에 공식 공고를 저장한다. 공유 메뉴·패키지·설계 파일은 변경하지 않는다. 0133은 sales-g2b 서버와 키가 준비된 뒤 적용하고, JWT 검증을 유지한다. 실패/일부 수집은 성공 0건과 구분한다.

현재 main의 기존 번호 중복: `0079_festival_links.sql`/`0079_field_survey.sql`, `0080_field_survey_realtime.sql`/`0080_project_room_closed.sql`. 기존 파일은 변경하지 않았다. 검사기는 기준 ref에 이미 있는 중복을 경고하고, 새 중복을 만들면 실패한다. 같은 파일명 아래 내용 충돌과 SQL 객체 충돌은 별도 검토한다.


추가 영업 변경: **0134_sales_preapproval.sql**은 새 기획의 승인 전 자료 준비, 읽기 전용 회사/담당자/연락처 연결 스냅샷, 기획 결정 스냅샷, 시스템 소유 업무를 추가한다. public.sales_strategies와 sales_strategy_tasks 및 영업 기획 함수만 수정한다. sales-planner 배포 파일과 SalesStrategyDesk/SalesStrategy 타입·프롬프트를 변경한다. 공통 메뉴/라우터/패키지 또는 design은 건드리지 않는다. 실제 발송은 활성화하지 않으며 후속 조사 처리기는 별도 단계다. 최신 공개 설계 c974f94 기준 0131~0134 새 번호 충돌 없음. 사용자 배포 보류는 해제되지 않았다.
