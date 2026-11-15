# 영업 실행 자동화 개발 계획

기준일: 2026-11-15. 목표는 자료/대상 DB 확보 → 실행안 검증 → 대표 승인 → 이메일/적격 DM → 회신 처리 → CRM → 활동 보고다. 정상 흐름에서는 대표가 실행 패키지를 승인한다. 외부 연락은 승인한 수신자·문안·첨부·일정·후속 조건 안에서만 수행한다.

필수 개발 규칙: [AGENTS.md](AGENTS.md). 사람 팀원에게 DB/원자료 가공·검색 업무를 맡기지 않는다. 수집·정제·검증·분류·연결·입력은 시스템이 담당하며, 해결되지 않는 자료는 추가 자동 조사 또는 사유가 있는 보류로 처리한다. 사람에게는 완성된 결과의 승인·방향 결정·예외 판단만 요청한다. 모든 단계의 완료 시험에 '사람의 데이터 실무 없이 운영' 조건을 적용한다.

## 단계와 완료 기준

| 단계 | 구현 범위 | 완료 증거 | 상태 |
|---|---|---|---|
| S1a | 기존 대상 DB의 출처 변경 이력, 최초 이관/신규 자료 구분, 검증 현황 조회 | DB 통합 테스트 및 운영 적용 후 재수집 확인 | 구현·로컬 검증 완료, 운영 미적용 |
| S1b | 나라장터·공식 참가사 증분 수집, 회사·사람·담당 역할과 출처 연결 | 원문 → 후보 → 회사/담당자 연결, 중복·거부 보존 | 나라장터 수집 구현·로컬 검증, 참가사/관계 연결 대기 |
| S2 | 승인 전 명단·제안서·문안·첨부·후속 일정 완성 및 버전 고정 | 자료 변경 시 승인 무효화, 준비되지 않은 발송 차단 | 사전 준비·대상 연결·실행안 버전 저장 구현, 발송 자격 검증·전송 연결 대기 |
| S3 | Gmail 발송 작업 큐·발송 결과·회신 처리·CRM 연결 | 승인한 시험 대상 발송 → 실제 회신 → CRM 기록 | 대기 |
| S4 | Instagram 계정 권한·대화 수신·채널 자격·발송·CRM 연결 | 적격 대화 발송 성공, 부적격/기간 만료 발송 차단 | 대기 |
| S5 | 리스트형 승인/활동 보고, 오류 복구, 일일 운영 | 08시 취합·09시 보고 3일 정상, 결과 불명확 시 중복 발송 방지 | 대기 |

계정/API 권한이 준비된 상태에서 전체 1차 운영판은 10~15 작업일 추정이다. 외부 권한 심사 대기는 별도이며 단계별 실증 전에는 완료로 표시하지 않는다. 기획 cron의 3일 검증은 영업 실행 전체 완료를 뜻하지 않는다.

## S1a 구현 내용

- `20261115090101_sales_evidence_history.sql`: 기존 `sales_prospects`를 보존하고 `sales_source_history`를 추가한다. 기존 회사/사람 식별자와 연결을 그대로 기록한다.
- 설치 시 기존 자료는 `baseline`으로 남긴다. 새 자료 집계는 최초 `collection` 버전만 계산한다. 건수는 출처별 자료 수이며 서로 다른 회사 수를 뜻하지 않는다.
- 기존 수집기가 후보를 저장하면 DB 트리거가 변경을 자동 기록한다. 동일 내용 재수집은 이력을 늘리지 않는다. A→B→A 변경은 세 버전을 유지한다.
- 사람의 검토 의견·영업 연결만 바뀐 것은 새 원문 수집으로 기록하지 않는다.
- 활성 회원용 `sales_source_versions` 조회는 20건씩 이전 버전 커서로 탐색한다. 사용자가 이력을 직접 수정/삭제할 수 없다.
- `sales_automation_readiness`는 회사·사람·미분류, 내용 검증, 수신거부/제외, 출처/연락처 누락, 기존 영업 연결 수를 제공한다. 발송 활성 상태는 false다. `SalesDataStatus`에서 보고서와 연결했고, 후보 상세의 `SalesSourceHistory`에서 읽기 전용으로 이력을 펼쳐 확인한다. 조회 실패는 0건으로 대체하지 않으며, 이력은 펼칠 때만 20건씩 조회한다.

## 배포 순서

1. 운영의 0131 설치 여부와 현재 대상 건수를 읽기 전용으로 확인한다. 전체 migration 재실행을 하지 않는다.
2. 신규 migration만 적용하고 baseline 건수와 기존 대상 건수를 대조한다.
3. 기존 취합 1회 후 원문이 같은 대상의 이력 수, 달라진 대상의 새 버전을 확인한다.
4. 연결된 원문 이력·검증 현황을 운영 계정으로 확인한다. DB 설치 전 조회 오류가 정상 건수로 표시되지 않는지 확인한다.
5. S1b의 각 출처를 실제 결과와 함께 연결한다. 수집 실패는 0건 성공과 구분한다.

## 이후 필수 구현 계약

- 수신자·내용·첨부·발송 일정·횟수·예산을 승인 스냅샷에 고정한다. 새 대상/가격/계약 조건은 변경 승인 대상이다.
- 승인 전 리서치와 자료 준비를 끝낸다. 현재 기획 승인 후 자료 준비 흐름은 S2에서 이동한다.
- 메일 발송 권한은 현재 읽기 권한과 별도로 확인한다. DM은 공식 API가 허용한 수신자와 조건만 사용한다.
- 발송 작업에는 고유 키·시도 기록·공급자 메시지 ID를 둔다. 응답 유실은 불확실 상태로 보류하고 발송함을 대조하며 무조건 재전송하지 않는다.
- 회신/수신거부/반송은 기존 후속 연락을 중단한다. 승인된 범위 안의 회신 처리와 다음 행동만 자동화한다.
- 영업 단계는 실제 이벤트와 연결한다. 발송 접수를 전달/열람/수주로 오인하지 않는다.
- 09시 보고는 신규 자료·검증 완료·승인 대기·발송·회신·CRM 변화·실패 원인과 다음 행동을 동일 활동 기록에서 집계한다.

## 이번 검증

`node --experimental-strip-types --test tests/sales-evidence-db.test.mjs tests/sales-report-db.test.mjs`: 16개 통과. baseline, 회사/사람 관계, 반복 수집, 원문 복원 이력, 검토와 수집 구분, 제외 이력, 권한, 기존 검증·파이프라인 회귀를 확인했다.

추가 화면 검증: `npm run build` 성공, 출처 이력/현황 및 기존 영업 기획 DOM 테스트 2개 통과, migration 번호 검사 테스트 4개 통과. DOM 테스트의 Vite 보조 WebSocket은 sandbox 포트 제한 경고를 냈지만 테스트는 모두 정상 종료했다.

현재 기획 기능은 운영 배포됐지만 이번 S1a 변경은 별도 개발 브랜치의 DB·화면 작업이다. 새 수집기·발송 기능·CRM 자동 실행이 완성됐다고 표시하지 않는다.


## 2026-11-15 사용자 추가 요청: AI 영업 기획실 대화

- 기본 `/sales` 화면은 AI 영업 기획실만 표시한다. 기존 영업 자료/진행 기록은 삭제하지 않고 접힌 DB 조회 영역과 기존 상세 링크로 유지한다.
- 실제 활성 AI 팀원을 선택해 자연어 지시를 저장한다. 저장 DB 조회, 분석 보고서 작성, 기존 자료 취합 요청을 구분한다.
- 지시·조회 시점의 근거·처리 상태·분석 보고서는 `sales_desk_messages`에 저장한다. 대화는 작성자 범위로 보호하며 서버 작업만 결과를 기록한다.
- 보고서는 기존 AI 한도와 중복 요청 방지를 적용한다. 출처 ID를 서버에서 검사하고 원자료 지시를 실행하지 않는다. 성공한 보고서는 같은 대화에서 읽고 Markdown으로 저장한다.
- 조회 범위: 지시문 키워드와 일치하는 저장 자료 중 최신 12건, ‘이번 주’ 요청은 KST 이번 주 최초 등록 자료. 실시간 인터넷 검색, 전체 DB 의미 검색, 신규 나라장터/참가사 수집기를 완성한 것은 아니다.
- 기존 출처 migration은 설계 측 번호와 겹쳐 미적용 파일만 0131로 변경했다. 대화는 0132로 분리했다.
- 운영 배포 전: 0131/0132와 sales-desk 함수 설치, 기존 JWT 검증 유지, 실제 계정 조회/보고서 생성/새로고침 후 재열람을 확인한다. 기존 DB나 설계 스키마를 재설치하지 않는다.

대화 기능 검증: DB 6개, 보고서 처리기 3개, 대화 화면 및 기본 화면/기존 상세 DOM 2개 통과. 0131 출처 DB 5개와 migration 검사 4개 회귀 통과. 빌드 성공, 배포용 코드 원본 일치 확인. 브라우저의 시험 지시/응답은 화면용 예시이며 실제 AI 보고서 생성 성공으로 집계하지 않는다.


## 2026-11-15 나라장터 자동 수집 연결

- 기존 08:00/08:20/08:40 한국 시간 취합과 대화창 수집 요청에 서버 큐를 연결했다. 사람에게 명단 검색·엑셀 정리를 요구하지 않는다. 수집 접수와 실제 완료는 별도 상태다.
- 공식 BidPublicInfoService02 v02 API에서 용역 6개 검색어(행사·전시·축제·박람회·홍보·컨퍼런스), 공사 2개(전시장·인테리어)의 최근 7일 공고를 조회한다. 2026-11-10 공지의 7일 제한을 따른다. 출처: https://www.data.go.kr/data/15129394/openapi.do
- 30건씩 최대 20페이지. 조건당 하루 최대 3회, 완료 조건은 당일 재실행하지 않는다. 조회량 상한·누락·오류·응답 변경은 일부 수집/실패이며 기존 저장은 보존한다. 600건 초과의 기간 분할과 과거 누락분 복구는 후속 개발이다. 전체 전국 입찰 수집 완료로 표시하지 않는다.
- 분류·공고번호·차수로 중복을 제거하고 원문 변경은 기존 출처 이력에 기록한다. 기존 제외/거래처/담당자 연결을 보존한다. 공고는 영업 기회로 저장하며 발주처를 검증된 고객이나 담당자로 자동 확정하지 않는다. 입찰 자격·과업·참가 기업·연락처 확보는 후속 검증 대상이다.
- 1회 토큰, 서버 전용 저장 RPC, 페이지 재전송 방지, 응답 크기/시간 제한, 만료 감시를 적용한다. API 키나 외부 오류 원문은 보고서에 저장하지 않는다. 마감된 공고는 근거를 보존하고 영업 평가를 보류한다.
- 최신 설계 브랜치의 0128 추가를 확인하여 미적용 영업 파일을 0131(출처) → 0132(대화) → 0133(나라장터)로 조정했다. 이전 0128/0129/0130 영업 파일을 별도로 적용하지 않는다.
- 검증: 신규 DB 8개·수집 처리기 6개, 기존 API 14개·대화 DB 6개·출처 DB 5개, 총 39개 통과. migration 검사 4개 별도 통과. API 요청은 시험 응답을 사용했으며 실제 공공데이터 키로 수집 성공한 것은 아니다.
- **Claude 배포 중이라는 사용자 확인에 따라 운영 반영 대기.** PR 업로드와 독립 개발만 진행한다. 운영 반영 시 sales-desk/sales-g2b 함수 및 서버 키 준비, 0131~0133 적용 여부 확인, 실제 계정 조회 → 수집 → DB/보고서 반영을 검증해야 한다. 이메일·DM·회신 CRM 실행은 이 변경에 포함하지 않는다.


## 2026-11-15 승인 전 자료 준비와 시스템 업무 소유권

- `20261115090104_sales_preapproval.sql`: 새 기획 생성 직후 기존 한도 안에서 자료 검토 요약·제안서·연락 초안을 자동 준비한다. 준비 중/실패 상태는 승인을 차단한다. 보류·수정 결정 뒤 늦은 작성 결과는 덮어쓰지 않는다. 기존 운영 기획은 보존하며 설치 순간 유료 작업을 일괄 실행하지 않는다.
- 인용 근거의 기존 회사·담당자 ID로 대상 DB 스냅샷을 만든다. 연락처는 담당자/브랜드/거래처의 구조화된 이메일 필드에서만 가져온다. 이름 유사성으로 다른 회사를 합치거나 본문의 주소를 추정하지 않는다. 빈 연락처·수신 거부·관계 불일치는 보완/제외로 구분한다. 발송 적격 여부는 모두 false이며 저장 연락처를 발주 의향으로 해석하지 않는다.
- 결정 시 최신 근거·제외 상태·회사/담당자/이메일을 재대조한다. 달라졌으면 이전 자료로 승인할 수 없다. 채택된 기획·준비 자료·대상·근거를 승인 스냅샷에 고정한다. 현재 scope는 **기획 채택, 외부 발송 미승인**이다. 최종 발송 대상/내용/첨부/일정 검증과 실행 승인은 다음 단계다.
- 새 실행 업무의 executor는 system, owner_id는 null이다. 사람에게 원자료 조사나 입력을 배정하지 않으며 수동 완료 처리도 차단한다. 대기 상태는 자동 실행 완료를 뜻하지 않는다. 후속 조사 작업의 실제 처리기는 아직 미구현이다. 기존 수동 업무는 이력 보존을 위해 legacy로 유지한다.
- 영업 보고서에 회사·사람·저장 연락처·처리 상태를 리스트로 표시하고 준비 자료를 대표 결정 버튼보다 위에 둔다. 준비 완료 뒤 열어 둔 보고서의 새 revision을 반영하며 입력 중인 의견을 보존한다.
- 검증: 신규 DB 7개, 기획 처리기 6개, 기존 기획 DB 12개 총 25개 통과. 사전 준비/시스템 업무 및 대화 DOM 2개 통과, 프런트 빌드 성공. 로컬 브라우저의 예시 데이터로 보고서 확인. 실제 AI 호출·운영 DB·메일/DM 발송 검증 아님.
- 배포 대기는 유지한다. 영업 DB 적용 순서는 0131→0132→0133→0134이며, 0134에는 sales-planner 서버 배포도 필요하다. 기존 미적용 파일 외 설계 파일을 수정하지 않았다.


## 2026-11-15 외부 연락 실행안 버전 관리

- 준비 자료가 완성되면 수신 이메일·제목·본문·제안 자료 원문·제안 시각·횟수·후속 조건을 자동 저장한다. 같은 이메일은 한 번만 포함하고 여러 회사가 같은 이메일로 연결되면 관계 검증 필요로 표시한다.
- 제안 시각은 다음 월~금 오전 10시(KST), 종료는 4시간 후, 수신자당 1회, 후속 발송 없음이다. **예약 실행이 아닌 검토용 제안값**이다. 실제 발송 연결 전이며 공휴일 달력은 아직 연결하지 않았다.
- 저장된 제안서 Markdown 원문을 같은 화면에서 열람·다운로드한다. 실제 메일 첨부나 전송 완료를 뜻하지 않는다.
- 내용·대상·근거·제안 시각·준비 조건의 SHA-256 지문을 사용한다. 같은 자료 재취합은 버전을 늘리지 않고, 변경되면 새 버전을 만들며 이전 기록은 보존한다. 보류 결정은 새 버전에도 유지한다.
- 읽을 때와 결정할 때 최신 내용과 다시 비교한다. 운영 미연결·수신 자격 미검증은 승인 대기처럼 보이지 않으며 서버에서도 승인을 거부한다. 준비/변경/보류 기록은 DB에 남는다. 실제 발송·회신·CRM 이벤트는 다음 단계다.
- 준비 갱신 예약은 최근 30일의 진행 기획을 오래 확인하지 않은 순서로 최대 20개씩 처리한다. 설치 순간 외부 API나 메일 호출은 없다.
- 설계 0131과 재충돌을 피하기 위해 미적용 영업 파일을 20261115090101~20261115090105로 변경했다. 이전 짧은 번호 영업 파일은 적용하지 않는다. 공동 개발 문서의 최신 적용 순서를 따른다.


실행안 단계 검증: DB 9개 및 번호 변경에 영향을 받는 기존 DB/번호 검사 30개, 화면 DOM 2개 — 총 41개 통과. 프런트 빌드 및 기존 서버 번들 일치 확인 성공. Chrome 로컬 예시 화면에서 수신자·문안·제안서 열람과 승인 차단 표시 확인. 실제 발송 승인 성공/외부 전송 검증을 완료한 것은 아니다.

### Execution reporting integration
The 09:00 planning notification and saved chat snapshots now distinguish review-ready plans, preparation in progress, recovery needs, and latest execution-package states. Unconnected delivery totals are null, not zero or a prepared-package count. The report prompt explicitly preserves this distinction. Latest validation: 47 distinct related DB, worker, migration and UI tests passed across this development turn; production build and generated worker-source checks passed. Production SQL, server deployment and live delivery remain on hold.

## Persistent development checkpoint — 2026-11-15

The Sales page now keeps a sticky progress strip above the AI room and saved DB. Its expandable list shows 12 capabilities with four equally weighted completion gates: implementation, local validation, production deployment, and live-flow verification. Current recorded evidence is 15/48 gates, rounded down to 31% complete / 69% remaining (7 implemented, 7 locally validated, 1 previously deployed, 0 live-flow verified). This is a checklist ratio, not a time estimate or a claim that 31% of production automation works.

`erp/src/lib/salesDevelopment.ts` owns the dated checkpoint and evidence. Update it with every relevant development handoff; only advance gates after recording evidence, and revise the denominator if scope changes. It is versioned with the frontend, not live agent/worker telemetry. A newly published checkpoint requires reopening the page. The UI states this limitation and preserves the production hold. Pending delivery, DM, reply/opt-out CRM, enrichment and end-to-end recovery remain visibly incomplete.

Validation: two progress calculation/evidence checks and the production build pass. Browser fixture verified sticky visibility after scrolling and an expandable in-page checklist. No new dependencies, DB migrations, shared Shell changes or design files. Production remains on hold.

## Approval-bound dispatch foundation — 2026-11-15

Standing continuation rule was explicitly saved in AGENTS.md and personal memory at the user's request. Continue authorized implementation, validation and development-PR updates without repeated continuation questions; preserve required approvals, the production hold and design ownership.

The sixth unapplied Sales migration, `20261115090106_sales_dispatch_queue.sql`, adds a private approval-bound queue and audit history. The exact package fingerprint, sender gate, purpose-specific recipient verification, exclusions, timing and active approving administrator are rechecked before a single-use worker claim. Holds/new versions cancel unsent queued work. Per-strategy recipient uniqueness blocks duplicate queued, claimed, provider-accepted or unknown outcomes across package versions. Timeout results become unknown, never automatic resends; late receipts can reconcile them. Provider acceptance is explicitly distinct from delivery/read confirmation. Ordinary clients cannot read worker leases or mutate jobs.

The existing unapplied execution-material migration now preserves a reviewed time window across midnight; it previously drifted to the following day. Expired windows still require a new version/approval. No applied migration was modified.

The internal dispatch worker core transmits at most once per claimed job and retries only the idempotent result write. It has no HTTP entry point, provider implementation, OAuth expansion or send scheduler. The current production material builder remains transport-disabled and cannot authorize real sending. Recipient-verification records in tests are fictional adapters, not a production validator. Account readiness, recipient eligibility automation, Gmail transport, provider receipt reconciliation and reply/CRM integration remain next work. The progress checklist stays 31% because the full email capability is incomplete.

Validation: 23 execution/queue DB tests, six worker tests, one execution UI test and two progress tests pass; production build passes. A browser fixture verified visible processing outcomes without any external send. Migration numbering was checked against main `4b2a31d080ef0957262ee84512e62df0404f6e1e` and published design `66073967fa3003be08116ddb26d957bc55e0043f` (design now uses through 0133); no new collisions. Design files were untouched. Production remains on hold.

## Sender readiness and recipient diagnostics — 2026-11-15

The seventh unapplied migration, `20261115090107_sales_readiness.sql`, adds a private, expiring sender-capability record and read-only recipient diagnostics. The authenticated `sales-readiness` worker accepts active human administrators only, refreshes the existing company OAuth grant without asking for extra scopes, and reads the authenticated Gmail profile. Exact send scopes, profile access, missing scope metadata, account mismatch, expired tokens and provider failures are distinguished. Credentials and raw provider errors are never included in stored or public diagnostic results. Single-flight two-minute leases, a one-minute request interval and a maximum 15-minute capability lifetime prevent overlapping/stale writes.

When an administrator opens an execution plan with an unverified/stale diagnostic, the frontend runs the check once and reads back its result. Checking state polls until completion/expiry; reconnect and error states remain visible. No account changes occur automatically. Queue approval and claim now require a fresh matching sender record in addition to existing exact-material and recipient-proof gates.

Recipient diagnostics use current DB links and exclusions to distinguish excluded contacts, missing contact details, ambiguous company relationships, missing identity links and unverified contact purpose. They do not manufacture consent, permission or buying intent from a public/stored email address. Automatic source collection for purpose-specific evidence remains unfinished; no human raw-data work is assigned. The report and server still state that real transport is disconnected.

Validation: 28 DB tests, eight diagnostic worker tests, one execution UI test and two progress tests passed (39 distinct checks); frontend build, worker type-check and generated dashboard-source check passed. Local browser used fictional account/recipient data only. No live OAuth refresh, Gmail profile read, scope expansion, email send, production SQL or worker deployment was executed.

Implementation references: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile (profile endpoint/scopes), https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send (send scopes), https://developers.google.com/identity/protocols/oauth2/web-server (refresh existing credentials). The diagnostic never calls the send endpoint.

## Contact evidence and automatic draft refresh — 2026-11-15

Migration `20261115090108_sales_contact_evidence.sql` assembles a contact evidence packet from current linked targets, source excerpts and exact normalized from/to address matches in the existing mail index. It does not alter the mail schema or infer outreach permission from an address/history match. Scope is explicit: 180 days, up to 50 grouped contacts, latest 1,000 matching messages examined, five excerpts per contact; drafts, spam, trash and future-dated messages are excluded. Multi-address strings, CC/BCC, full message bodies, message authenticity and live mailbox completeness remain unverified. Truncation is visible.

The packet is part of the execution fingerprint and immutable saved material. New, changed or withdrawn matching evidence invalidates the old package; unrelated mail does not churn it. The same-page list explains the proposed offer as a hypothesis, company/person links, latest excerpts, assessment, next system work and optional source details. Plain text rendering and safe URL checks prevent source HTML/links from becoming executable instructions.

Preparation claims snapshot the packet. The planner receives at most four contacts/two short mail excerpts each under the existing 6,000-character input ceiling, marked as untrusted data and not consent/intent proof. Stale preparation results are discarded. One automatic retry per strategy is allowed, using a new job/token and the existing budget reservation controls. A five-minute watcher examines up to 20 recently prepared plans and starts at most three refreshes per tick after relevant evidence changes. Further changes after that one retry remain visible as a bounded recovery/scope decision; humans are not assigned data processing. Unsent queued jobs are cancelled and approval metadata cleared before refresh. Deliberate execution holds are preserved. Changed source/target identities still need replanning and are not silently overwritten.

Validation: 38 execution/evidence DB tests, seven planning/prompt/worker tests, one execution UI test, two progress tests (48 distinct). Frontend build and planner deployment-source consistency pass. Browser fixture verified the list and expanded sources using fictional data only. Full mail-body verification, official missing-contact discovery, actual provider transport and live end-to-end operation remain unfinished. Completion checklist remains 31%/69%.

## Read-only message evidence — 2026-11-15

The next layer retrieves actual Gmail text for messages already matched to active Sales targets. It does not search the whole mailbox, discover missing contacts, authenticate the human author, infer consent or send. Each provider read refreshes only the existing grant, requires read scope, checks the primary mailbox, and uses a fixed Gmail GET endpoint. IDs, thread, single From/To addresses, labels and the 180-day window are checked. Text is untrusted, including quoted history. HTML-only, non-UTF-8/ASCII, attachments, forwarded message parts and multi-recipient envelopes are not supported; no attachments or remote links are fetched.

The service-only job queue snapshots current target evidence, uses one-use claims and a three-minute lease, caps retrieval at five messages per plan/6,000 characters per message, starts at most three plans per five-minute tick and allows three attempts per rolling 24 hours with a 15-minute minimum interval. It runs from a previously configured readable mailbox even after the short diagnostic expires; every worker call rechecks actual current scope and profile. Opt-outs, target or mailbox changes invalidate pending results. Network failures remain visible and bounded; no staff member is assigned mail search or data entry.

Retrieved text is appended to immutable execution evidence and the bounded preparation context. Changes trigger the existing one-retry draft mechanism. Identical re-reads retain the material's first observation timestamp to avoid needless draft churn; latest attempt time is separately displayed in the execution report. Current caches expire after 24 hours. Retrieval is not a request-purpose/authenticity decision and never enables send approval.

Validation: 46 database checks, six read-only worker checks, seven planner checks, one execution UI check and two progress checks (62 total). Frontend build, worker type-check and generated worker source checks passed. Fixtures only; no company OAuth/provider request, message send or production DB/worker deployment was made. Overall completion remains 31%/69% because discovery, purpose verification, real delivery and CRM remain incomplete.

API references: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get and https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages . These describe GET retrieval, MIME payloads, IDs, labels and timestamps; they do not establish sender authenticity or buying intent.
