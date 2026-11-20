# 영업 자동화 개발 규칙

사용자 지시 2026-11-15. 인트라넷 영업 자동화의 설계, 구현, 화면, 검증, 운영 절차에 적용한다.

> 2026-11-20 정리: Codex(영업 담당) 공동 개발은 끝났다(2026-11-16 종료 · 2026-11-20 대표 지시 'codex 작업은 끝났어 정리해'). 영업 · 설계를 포함한 모든 인트라넷 개발은 Claude 세션이 맡는다. 예전 공동 개발 분담 · main 병합 보류 규칙은 `erp/docs/archive/DEVELOPMENT_COORDINATION_20261115.md` 에 기록으로만 남긴다. 대화 · 작업 규칙의 기준은 `CLAUDE.md`.

## 개발 진행 방식 — 사용자 추가 지시 2026-11-15

- **지속 진행은 상시 규칙이다.** 승인된 범위의 구현·검증·수정·PR 기록을 이어가고 매 단계마다 계속할지 묻지 않는다. 필수 승인·사용자 결정 또는 독립 해결이 불가능한 실제 장애가 있을 때만 해당 작업을 멈춘다. 턴 종료 후에도 실행 중이라고 주장하지 않고 실제 실행 상태를 보고한다.
- 실제 승인 요청 전에는 구현·검증과 검토 가능한 결과 준비를 마친다. 진행 보고는 완료한 변경, 확인한 증거, 남은 한계를 구분한다.
- 여러 세션이 함께 일할 때는 각자 별도 브랜치를 쓰고 다른 세션의 진행 중 변경을 덮어쓰지 않는다. main 병합 전 `node erp/scripts/check-migration-numbers.mjs --base-ref origin/main` 으로 마이그레이션 번호 중복을 확인하고, 겹치면 자신의 미적용 파일 번호만 바꾼다.

## 사람 팀원에게 데이터 실무를 넘기지 않는다

- 사람 팀원은 DB 데이터나 원자료(raw data)를 직접 가공하거나 검색하는 업무를 담당하지 않는다.
- 자료 검색·수집·추출·정제·형식 변환·분류·중복 제거·회사/사람 연결·출처 대조·DB 입력/갱신은 시스템 책임이다.
- 사람에게 엑셀 정리, 후보 명단 작성, 연락처 찾기, 원문 검색, 필드 매핑, 복사·붙여넣기, DB 직접 수정 등을 요구해야 정상 작동하는 기능은 미완성이다.
- 사람의 기본 역할은 완성된 실행안 승인, 사업 방향/범위 결정, 예외 판단이다. 승인 화면에 대상 명단·근거 요약·제안 자료·문안·첨부·일정·후속 조건을 시스템이 준비한다.
- 필수 정보가 부족하면 시스템이 추가 출처 조사·재수집·재검증을 수행한다. 해결되지 않으면 원인과 실행 가능한 대안을 요약해 보류한다. 사람에게 자료 검색이나 가공을 대신 수행하도록 떠넘기지 않는다.
- 사람의 예외 판단에는 필요한 사실·근거·선택지·권고안을 포함한다. 원자료 열람은 선택적인 감사 기능이며 정상 업무의 필수 단계로 만들지 않는다.
- 최초 계정 연결·권한 동의 및 사업상 승인과 데이터 실무를 구분한다. 접근 불가·권한 부족은 정직하게 표시하고 데이터 확보 또는 검증이 완료됐다고 주장하지 않는다.
- 계약 조건·구매 의향·예산 등 확인할 수 없는 사실을 자동화 편의를 위해 추정하여 확정하지 않는다. 확인 가능한 사실과 가설을 분리한다.

## 완료 판정

- 사람 팀원이 원자료 검색·정제·DB 가공 없이 승인과 예외 판단만으로 정상 흐름을 운영할 수 있어야 한다.
- 실제 또는 통합 시험에서 수집 → 검증 → 실행안 준비 → 승인 → 허용된 발송 → 회신/CRM → 보고까지 사람의 데이터 작업 없이 연결되는지 확인한다.
- 자동 처리 불가 건은 사유와 다음 자동 처리 계획이 있는 보류 상태로 보고한다. 수동 가공 대기열을 만들어 자동화 완료로 표시하지 않는다.
- 구현·테스트·운영 배포·실제 외부 실행 확인을 구분하여 보고한다.

## Approval-only human role — explicit user correction, 2026-11-15

- Human teammates only approve or reject system-prepared, verified execution packages. Do not use human research, contact lookup, raw-source review, spreadsheet cleanup, field mapping, drafting, reply classification or CRM updates as a required fallback.
- The system owns research, collection, cleansing, target/company/person linking, planning, proposal/message preparation, validation, approval routing, authorized delivery, reply handling, pipeline updates, follow-up and reporting.
- An AI recommendation or a task row saying “research next” is not implemented execution. Connect it to an actual bounded system worker and persist the result before claiming automation completion.
- Missing evidence triggers automated re-collection/research/verification. Errors trigger bounded recovery with visible reasons. When recovery is impossible, preserve records and report the blocking dependency plus a prepared alternative; do not hand data-processing work to a person.
- Approval must cover the exact recipients, purpose/evidence, message, attachments, schedule and follow-up conditions. Changed material requires a fresh approval. An internal planning decision must never be presented as authorization to send.
- Full completion requires an end-to-end run from target acquisition to follow-up/reporting with approval/rejection as the only recurring human action. Independent implementation/local validation does not establish deployment or operational completion.

## 답하는 말

대표에게는 한국어 존댓말로 답한다(2026-11-15 '한글로 답해'). 코드 이름 · 기술 자료는 영어여도 된다.
