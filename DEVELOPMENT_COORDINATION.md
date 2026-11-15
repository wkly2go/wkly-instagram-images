# 공동 개발 인수인계

2026-11-15 사용자 확정 분담. 이 문서는 공유 규칙이며 자동 파일 잠금이나 상대 세션과의 실시간 통신 기능은 아니다.

| 담당 | 브랜치/범위 | 다른 작업자의 접근 |
|---|---|---|
| 설계 담당 | `claude/design-integration`, DB `design`, 설계·견적 메뉴와 관련 파일 | 수정·삭제·정리 금지 |
| 영업 담당 | `codex/sales-evidence-foundation-20261115`, Sales·Growth 화면과 관련 테이블 | 변경 요청과 PR로 조정 |
| 공유 경계 | 라우터·메뉴·공통 타입·스타일·패키지·배포 설정 | 변경 목적/파일을 명시하고 통합 시 상호 대조 |

## 영업 쪽 현재 상태

- PR #397은 main에 병합되어 자동 기획이 운영 중이다. 영업 전체 실행 자동화가 완성된 것은 아니다.
- PR #399는 개발 초안이다. `20261115090101_sales_evidence_history.sql`과 DB 테스트, 개발 규칙을 포함한다. 해당 변경은 아직 운영 미적용이다. 상대 작업에 같은 번호가 있으면 영업 쪽 미적용 파일의 번호를 변경한다.
- 출처 이력과 검증 현황 API 및 Sales 보고서/후보 상세의 읽기 전용 화면 연결이 준비됐으며 운영 미적용, 발송은 비활성이다. 화면 변경은 `SalesReport`·`SalesProspectReview`·신규 `SalesEvidence`·영업 API에 한정하며 공유 메뉴/라우터/전역 스타일은 변경하지 않았다. 전체 계획은 `SALES_AUTOMATION_PLAN.md`를 따른다.
- 사람 팀원에게 원자료 검색·가공·DB 정리를 넘기지 않는 규칙은 `AGENTS.md`에 있다.

## 같은 Mac에서 작업하는 방법

각자의 기존 독립 작업 폴더를 유지한다. 다른 담당자의 브랜치를 체크아웃하거나 그 폴더에서 명령을 실행하지 않는다. git worktree의 별도 디렉터리 또는 독립 clone을 사용한다. 개발 서버 포트와 브라우저 탭도 분리한다. 운영 SQL 편집기나 배포 화면은 동시에 조작하지 않는다.

## 병합 전 인수인계 항목

PR에는 기준 main SHA, 수정 파일, 새/변경 DB 객체, migration 번호와 적용 여부, 실행한 검증, 운영 배포 필요 여부를 기록한다. 최신 main과 상대의 공개된 PR을 대조해 번호 및 공유 파일 충돌을 확인한다. 아직 공개되지 않은 변경은 상대가 번호·파일 목록을 알려줄 때까지 통합 확인 미완료로 남긴다. 병합 대상 변경과 무관한 영업 개발은 계속할 수 있다.

`node erp/scripts/check-migration-numbers.mjs --base-ref origin/main`

상대 브랜치를 읽을 수 있게 된 뒤에는 해당 ref를 `--base-ref`로 한 번 더 실행한다. 같은 파일명의 상이한 수정, SQL 객체 충돌, 메뉴 기능 보존은 별도 diff/통합 테스트로 확인한다. 이 스크립트는 번호 중복 검사만 담당한다.

## 현재 적용 순서 — 2026-11-15

위의 짧은 영업 번호는 **운영 미적용 상태에서 다시 변경했다**. 최신 공개 설계 `7e5a5f540092c08c0613f0310a15a99039b7c65c`가 0125~0131을 사용하여, 영업 미적용 파일 5개를 시간표시 번호로 이동했다. 설계 파일은 변경하지 않았다. 현재 적용 순서는 다음과 같으며 이전 0131~0135 영업 파일을 따로 적용하지 않는다.

1. 20261115090101_sales_evidence_history.sql
2. 20261115090102_sales_desk.sql
3. 20261115090103_sales_g2b_collection.sql
4. 20261115090104_sales_preapproval.sql
5. 20261115090105_sales_execution_packages.sql

추가 실행안은 sales_execution_packages/events 및 sales_execution_* 함수, 2분 간격의 준비 자료 갱신 예약을 추가한다. 수신자·문안·제안서 원문·제안 시각을 버전별로 저장하고 변경 시 이전 버전을 재검토로 남긴다. 실제 발송 연결·수신 자격 검증은 미완성이므로 승인은 차단한다. 승인 RPC는 서버에서 준비 상태와 정확한 버전을 재검사한다. 프런트는 Sales 보고서 내부의 실행안 열람 영역만 추가한다. 운영 보류는 유지하며 공유 메뉴·라우터·패키지·설계 파일 변경 없음.


최신 확인 main: `4b2a31d080ef0957262ee84512e62df0404f6e1e`. 공개된 설계 브랜치 기준 새 번호 중복은 없으며 병합 직전에 다시 확인한다. 기존 main의 0079/0080 중복은 변경하지 않는다. 미공개 상대 작업은 확인 완료로 표시하지 않는다.

**사용자가 Claude 배포 중이라고 확인했으므로 main 병합·운영 SQL·서버 배포를 보류한다. 위 5개 영업 migration은 모두 운영 미적용이다.** 실제 API 키/권한 및 운영 계정 수집→보고→실행안은 확인 전이다. sales-desk/sales-g2b/sales-planner 서버도 이 개발 버전의 운영 적용이 필요하다.

## Dispatch queue handoff — 2026-11-15

Add `20261115090106_sales_dispatch_queue.sql` after the five existing Sales timestamp migrations. All six remain UNAPPLIED. The fifth unapplied migration additionally fixes reviewed-window drift across midnight. The sixth adds only Sales private queue/audit objects, service-only claim/result functions, an expiry watchdog, and sanitized read history. No send transport or HTTP worker entry point is deployed or enabled. The internal worker core is local/tested only.

Latest read-only comparison: main `4b2a31d080ef0957262ee84512e62df0404f6e1e`, design `66073967fa3003be08116ddb26d957bc55e0043f`, design migrations through 0133. No new number collision; recheck before merge. No design/menu/shared Shell/package edits. The explicit production hold is unchanged.

## Readiness handoff — 2026-11-15

Seventh unapplied Sales migration: `20261115090107_sales_readiness.sql`. Apply only after 090101–090106 when the production hold is explicitly cleared. New `sales-readiness` worker is a diagnostic-only endpoint with an active-human-admin JWT check; deployment artifact is `erp/supabase/deploy/sales-readiness-dashboard.ts`. It reuses existing company OAuth secret RPCs and does not expand scopes or send. Optional `SALES_SENDER_EMAIL` pins the expected primary mailbox. No new secret values were read or changed during development.

Latest compared main: `aa8d513f2f5c0ad854c26ad6735ffc1594c78e67`; design: `2a770c6ae1dbaef245f9dd215ca54643b529030c`, migrations through 0133. No new number collision and no overlap in the readiness-edited Sales files. Main has incorporated design/shared Shell changes; do not overwrite them with an old Sales checkout. Production hold remains until explicit coordination clearance. All seven Sales migrations and the new worker are still operationally unapplied.

## Contact evidence handoff — 2026-11-15

The user's answer to deployment coordination was to continue the recommended development direction, not a confirmation that the design deployment ended. Continue independent development without repeating the same confirmation question; preserve the production hold until explicit clearance.

Eighth UNAPPLIED Sales migration: `20261115090108_sales_contact_evidence.sql`, after 090101–090107. It reads the existing mail_index and modifies only Sales functions/private preparation metadata. Deploy the newly generated sales-planner worker before enabling this migration's contact-aware preparation claims; the new worker remains compatible with older jobs lacking the optional packet. Allow/verify old in-flight claims before rollout. Latest checked main `0848bb2379c7aaca74fbee333bfbb9bf772696f0`, design `a3dc077982520cc763d197b65b4211801fe1522d`; migration numbering has no new collision. Shared mail/design/package files untouched. All eight migrations and updated workers remain operationally unapplied.

## Read-only mail evidence handoff — 2026-11-15

Ninth UNAPPLIED Sales migration: `20261115090109_sales_mail_evidence.sql`, after 090101–090108. It reads existing mailbox index records; new jobs/functions are Sales-owned. New worker: `sales-mail-evidence`, with generated dashboard source and one-use DB-claimed requests. Deploy that worker and the updated backward-compatible sales-planner before enabling migration 9's cron. Initially establish the company mailbox with the existing administrator readiness diagnostic. Reads then revalidate live account/scope in the worker; no send scope expansion or transport activation is involved.

Compared latest main `797b31748e432803be5d0581b02de3c90a9e80c4` and published design `a6e9ff02d10f4d8a5720bd2ce0468af78945380a`: no new migration-number collision; existing 0079/0080 are untouched. Main's design/menu/files remain protected. Recheck again before actual integration. All nine migrations and new/updated Sales workers remain unapplied; production hold remains active. A main commit advancing is not deployment-order clearance.

## Website contact discovery handoff — 2026-11-15

Tenth UNAPPLIED Sales migration: `20261115090110_sales_contact_discovery.sql`, after 090101–090109. It creates only private Sales jobs/functions and extends the existing Sales report. Existing clients/contacts are read, not altered. New worker `sales-contact-discovery` uses pinned parse5 7.3.0 and Node-compatible HTTPS/DNS modules. Deploy and probe that worker before enabling the migration's ten-minute schedule. The transport must retain custom public-IP lookup and TLS hostname verification in the actual Edge runtime; do not substitute an unpinned fetch fallback. Shared package manifests were not modified; temporary local Node types were isolated outside the repo.

Latest comparison: main `4c0c3db6862488b6ada8a1e5f6621e2733cbfd0a`, published design `f821e295912d8de26ca25c5ed13edda637e78623`. No new migration-number collision; prior 0079/0080 duplicates remain untouched. All ten Sales migrations and new/updated workers are still unapplied. Production hold persists; branch activity is not clearance to deploy. Recheck both branches and runtime behavior at the eventual coordinated rollout.


## Reply/CRM ledger and release preparation — 2026-11-15

The user explicitly reconfirmed **Claude deployment in progress; independent development only** for the 40% target. Production hold is unchanged: no main merge, production SQL, worker deployment, OAuth expansion or actual sends. Completion remains 15/48 (31%); reaching at least 40% requires 20/48 (41%). Partial components do not advance whole-capability gates.

Eleventh UNAPPLIED Sales migration: `20261115090111_sales_reply_crm.sql`, following 090101–090110. New read-only `sales-replies` worker reuses the bounded Gmail evidence reader, with exact reply reference, timestamp, mailbox, address and thread checks, rejecting automated/list replies. Accepted provider IDs create a separate Sales activity ledger, matched inbound text records replies, conservative stop expressions suppress the exact address and cancel queued follow-ups. This does not alter shared contacts or existing sales_opportunities; full pipeline linkage and automated follow-up proposal preparation remain incomplete. The AI report snapshot and established daily briefing now include distinct CRM acceptance/reply/stop counts. No sending or contract/intent inference is enabled.

The Gmail send adapter is local/tested and disabled, with no HTTP entry point or scheduler. It sends at most one exact reviewed MIME payload through the internal dispatcher; uncertain results never automatically resend. Purpose eligibility and production connection remain unfinished.

Release tooling creates an eleven-migration atomic SQL review packet plus seven worker SHA-256 hashes from a clean committed tree. It refuses a partial/already-installed Sales release; tests injected an end-of-transaction failure and verified rollback. Read-only diagnostics check expected objects and grants. This is preparation, never automatic SQL execution.

Compared main `6496f5076264f6a35c6bd54def7f43b5abb76deb` and published design `fac49017d53ac09befe93545575b8cb7961d405c`: identical file trees at this check, no NEW migration-number collision. Existing 0079/0080 remain untouched. All eleven Sales migrations and seven new/updated worker artifacts are operationally unapplied. Check current references again before eventual integration; unpublished Claude work is not verified.
