# 더위클리 사내 인트라넷 (WKLY ERP) — 개발 인수인계

이 저장소에서 일하는 Claude 세션은 먼저 이 문서를 읽고 이어서 작업한다.

## 대화 규칙 (대표 지시)
- 대표(박기호)에게는 항상 **한국어 존댓말**로 답한다.
- 비밀 키 · 토큰 · 비밀번호를 대화로 달라고 하지 않는다. 필요하면 설정 위치만 안내한다.
- 검정 · 다크 디자인 금지 (기본은 늘 밝게. 2026-11-04 부터 휴대폰 '더보기 › 화면 어둡게' 를 본인이 고를 때만 짙은 초록 계열 다크 · `lib/theme.ts`). 주민번호 저장 금지. 알림 제목에 금액 금지.
- 에이전트는 메일을 직접 보내지 않는다 (임시 저장만).
- 구글 드라이브 기존 자료는 수정 · 삭제하지 않는다 (지울 때는 휴지통만).
- 무료 서비스만 쓴다 (유료 검색 도구 금지).
- 커밋 · PR · 코드 주석에 모델 이름을 쓰지 않는다.
- 작업이 끝나면 결과 화면 캡처를 보여 준다.

## 구조
- 2026-11-13 AI 메뉴 통합: `AI 팀·비용`(`/agents`) 안에 팀원·지시·예약 / 사용·비용 및 관리자 점검 메뉴를 함께 표시한다. `/ai-usage`는 `/agents?tab=usage`로 연결하며 비용 집계 범위는 기존 업무 도구만 유지한다. 자세한 안내와 검증 범위는 `erp/docs/AI_WORKSPACE_UNIFICATION.md`.
- 2026-11-13 영업 발굴 고도화: `/sales`의 신규 대상 발굴에서 7개 발굴 경로·검색 링크·공식 일정·검토 준비도·행사 역산 계획을 작성하고 기존 영업 정보로 적용·저장한다. DB/Edge 변경 없음. 자동 수집·캘린더 예약·발송 기능은 아니며 저장 후 일정 변경은 메모·다음 연락일에 직접 반영한다. 상세는 `erp/docs/SALES_PROSPECTING.md`.
- 2026-11-13 콘텐츠 점검: 다른 담당자의 콘텐츠도 세 채널을 읽기 전용으로 열람할 수 있고, 신규·수정 저장 뒤 선택 채널을 유지합니다. 채널 탭은 방향키·Home·End를 지원하며 저장·AI 실행 중 이동은 차단됩니다. 회귀 검사는 `tests/ui/growth-dom.test.mjs`, 사용설명은 `public/manual/growth.html#content`입니다.
- 2026-11-13 서버 후속 배포: `meeting-minutes`·`gmail`·`g2b-search` 실제 운영 배포, 코드 일치·기존 인증 설정·GET 405 확인. 조직 Usage 및 읽기 전용 DB·버킷·예약 조회 완료. 나라장터 서버 키 미등록·실계정 업무 검증은 남음. 이전 배포 대기 문구보다 `erp/docs/SERVER_DEPLOYMENT_20261113.md`를 우선한다. 설치 SQL 재실행·유료 AI 호출·파일 삭제·광고 집행은 하지 않았다.
- `erp/` : React + TypeScript + Vite 웹앱 (Cloudflare Pages · main 에 합치면 자동 배포)
  - `src/pages/` 화면 · `src/components/` 부품 · `src/lib/api.ts` (API 정의) · `supabaseApi.ts` (운영) · `demoApi.ts` (체험 모드)
  - `src/styles.css` : 디자인 토큰 · WKLY v7 디자인 시스템 (사각 모서리, 글자 크기 단계 `--fs-cap 12 · sm 12.5 · body 13.5 · sub 14.5 · title 16 · num 19 · hero 28` (2026-11-09 위계 다시 잡음 · 맨 아래 :root 가 최종값 · 터치 화면은 반 단계 큼))
  - 전체 사용성 보강(2026-11-11): `src/usability.css`를 styles.css 다음에 읽음. 최종 읽기 크기 `cap 12.5 · sm 13 · body 14.5 · sub 15 · title 17`이며 사용자 배율 유지. 좁은 본문 탭·필터 줄바꿈, 폼 자체 폭에 따른 열 수, 오른쪽 KPI 전체 값 표시. `components/ShellUsability.css`는 메뉴 176px·업무별 구분·키보드 조작을 담당함. 공통 변경 시 채팅을 넓혀 실제 본문 340px인 경우도 확인할 것.
  - 검색창 AI 응답 조회는 열린 창의 진행 중 요청 ID 한 건만 조회하며 완료·닫힘 시 중지(`CommandPalette.tsx`). Supabase 용량 점검 안내는 `erp/docs/SUPABASE_CAPACITY_OPTIMIZATION.md`, 읽기 전용 조회는 `erp/supabase/diagnostics/capacity_readonly.sql` (마이그레이션 아님).
  - 조회 속도·전송량 개선(2026-11-11): 메뉴 숫자는 HEAD count(`navigationCounts.ts`), 업무·프로젝트의 동시 조회는 `pendingReads.ts`가 공유하고 각 화면에 응답 복제. 저장·변경 시 `App.bump()`가 공유 대기 요청을 비움. 비공개 파일 URL은 사용자별 `signedUrlCache.ts`로 재사용하며 이미지 오류 재시도는 1회. Slack은 펼친 화면만 60초 확인·변경 시 본문 갱신(최대 5분 재확인). `npm run test:efficiency`로 회귀 검사. 회의 원본 정리 서버 변경(`meeting-minutes/cleanup.ts`)은 별도 Supabase 배포 전까지 운영 미적용.
  - 전송량 절감(2026-11-12): 근태는 `sharedFeed.ts`로 사용자·날짜별 조회/실시간 구독 공유, 숨긴 화면은 중지·복귀 시 재조회. 알림 변경은 전체 화면 갱신 없이 알림함만 갱신하며 `tabTask.ts`의 Web Locks/실행 시각으로 같은 계정 탭의 주기 작업을 합침. 보고서 목록 API는 `ApprovalSummary`/`ResearchSummary`를 반환하고 본문은 `getApproval`/`getResearch`로 선택한 한 건만 받음. 본문 검색은 350ms 대기 후 서버에서 ID만 검색. 사진 원본은 보존하고 새 업로드의 미리보기는 `imagePreview.ts`(긴 변 최대 640px·96KB 이하)로 생성. 기존 사진은 목록에서 원본을 자동 다운로드하지 않고 누르면 열림. 이 변경은 DB 마이그레이션·Edge Function 배포가 필요 없음. `test:efficiency`에 절감 회귀 테스트 포함.
  - `desktop/` : PC 프로그램 (Electron)
  - `android/` : 안드로이드 앱 (TWA · 웹을 앱으로 띄움). main 에 `erp/android/**` 변경이 들어가면 `.github/workflows/android.yml` 이 APK 를 만들어
    릴리스 `android` 의 `wkly-erp.apk` 로 올림. 서명 키는 Vault (함수 `android-key` 가 GitHub OIDC 확인 뒤 넘김) · 지문은 `public/.well-known/assetlinks.json`
  - 휴대폰 설치: 휴대폰 홈 맨 위 버튼 · PC 는 위쪽 바 검색창 옆 '휴대폰 앱'(QR) — 갤럭시는 웹 앱(홈 화면에 추가 · APK 는 예전 방식 링크만) · 아이폰 설치 프로파일 `public/wkly-erp.mobileconfig` · 안내 `public/install.html`
  - 휴대폰 업데이트: `src/lib/update.tsx` 가 30초마다 /version.json 확인 → 새 버전이면 3초 뒤 새로고침 (쓰는 중이면 기다림) · 홈 맨 아래 '인트라넷 버전' 으로 확인
  - 휴대폰 공통 장치: `lib/stackTables.ts` (표 → 위아래 카드) · `lib/foldLong.ts` (긴 글 접기)
  - 현장 실측 체크리스트: `src/components/SiteSurvey.tsx` (표 site_survey_items · 0084 · 표준 38항목)
  - 세금계산서 대장: 결제 › '세금계산서' 탭 (`src/components/TaxInvoices.tsx` · 표 tax_invoices · 0091 · 관리자 전용). 홈택스 목록 엑셀(.xls)을 올리면 승인번호 기준으로 쌓임 (엑셀 읽기 xlsx 라이브러리 · 올릴 때만 불러옴)
  - 인사기록 카드(`src/components/Person.tsx`): 사원번호 · 직급 · 급여 계좌 · 연차(발생/사용/대기/남은 · 조정 일수 leave_adjust) — 0092 · 0094 · 본인과 관리자만 봄
  - 개인정보 관리: 업무·근태 › '내 정보 · 연차' (`src/components/MyInfo.tsx`) — 본인이 연락처 · 주소 · 계좌만 고침(RPC hr_self_update · 0095). 휴가 기록은 본인 · 관리자만(0096), 다른 사람 휴가는 달력에 '휴가'로만 (RPC team_leave_days · calendar-feed v4)
  - 캘린더 개인 일정 (`Schedule.tsx` PersonalEventModal · 표 personal_events · 0100 · 본인만): 구글 캘린더 '내 일정' 구독 주소(calendar-feed v13)에 자동 포함 · 팀 주소엔 안 넣음
  - 채팅 고정 칸 (2026-11-10 대표 지시 '별도 탭 말고 왼쪽 고정'): `Shell.tsx` ChatDock — 왼쪽 메뉴 옆 · 핑크 구분선을 끌어 폭 조절 260~720px (wkly-chat-dock-w) · 접기(localStorage wkly-chat-dock) · 1024px 이하·휴대폰은 숨기고 메뉴 '채팅' 사용 · 넓은 화면에선 메뉴 '채팅' 줄 숨김
  - 빠른 창 채팅방 묶음: 진행 중 프로젝트(구분별) · 채팅방 · 사람 팀원 · AI 팀원 · 끝난 프로젝트 (`pages/Quick.tsx` roomGroups)
  - 관리 › 팀원 관리 표에서 직함 · 사원번호 · 직급 · 입사일 · 연락처 바로 고치기, '인사 ▼'로 전체 인사 정보 펼쳐 고치기
  - 입출금 장부(회계장부)는 **연도별** (2026-11-06 대표 지시 '연결장부로 하지 말고 년도별로'): 연도 고르기 · 월 이동은 그 해 1~12월 안에서만 · '연간 장부' 탭(1~12월 · 연 합계 · 연간 엑셀) · 통계도 그 해 안 · 기초 잔액은 해마다 따로 (`src/pages/Ledger.tsx` · `components/LedgerViews.tsx` · `LedgerStats.tsx`)
  - 회계 자료 폴더 자동 기입 (2026-11-11 · 0106 · `components/LedgerFolder.tsx` · `lib/ledgerImport.ts`): 입출금 장부 › '회계 자료' 탭에서 드라이브 '회계 자료 (입출금 장부)' › 은행 거래내역 · 홈택스 자료 폴더 생성 → 장부 열 때 새 파일 자동 읽기 · 분류(결제 대장 매칭 → 낱말 규칙 → 확인 필요) · 카드대금 · 내 통장 이체는 is_transfer(합계 제외) · 세금계산서 · 현금영수증은 증빙으로 붙임 · source_ref 로 중복 막음 · 수정 이력 private.cash_ledger_log · 2026-11-11 대표 지시 '그냥 내가 자료를 인트라넷에 올릴께' → '회계 자료' 탭 맨 위 '은행 · 홈택스 파일 올리기'(여러 개 · 폴더째 · 끌어다 놓기 · 폴더 안 엑셀/CSV 만 읽음)로 바로 기입 (processLedgerFiles 공통 · 드라이브 폴더는 선택) · 2026-11-11 실제 파일 맞춤: 우리카드 명세서(이용일자 MM.DD → 파일 이름 'N월'로 연도) · 머리 줄 없는 기업은행 거래내역(잔액이 맞는 칸 조합 guessBankCols) · 못 알아본 파일은 다시 시도 · 2026-11-11 대사 기준: 회계 분류는 LEDGER_CATEGORIES(공종은 메모 · 외주 · 협력사) · 합계 제외 분류 LEDGER_TRANSFER_CATEGORIES(카드대금 · 내 통장 이체 · 대표 가지급 · 가수) · 팀원 급여 → 인건비 · 회사/사람 계좌이체 기본 외주 · 회사 입금 기본 매출 · 2026-11-12 폴더 전체 읽기: 하위 폴더 끝까지(`lib/folderScan.ts` scanDriveFolder · 최대 8단계) · zip 풀어서 안의 엑셀/CSV · 개인 자료(연말정산 · 근로계약 등) 폴더는 열지 않음 · '폴더 전체 점검' 표(파일마다 읽음/안 읽음/PDF 등) · Claude 스킬 `.claude/skills/ledger-folder-read` (SKILL.md · read-folder.mts) · 2026-11-12 보강: 머리 줄 없는 카드 명세서(기업카드 · 가려진 카드 번호로 판별 guessCardGrid) · 거래 내역 아닌 엑셀(운행기록부 · 매입장 · 잔액 확인 등 REFERENCE_RE)은 '참고 자료'로 거름 · zip 안 한글 이름 복원(zipName) · 읽는 법을 바꾸면 `LedgerFolder.tsx` READER_VERSION 을 올려 못 읽은 파일 다시 시도 · 2026-11-12 대사: 더위클리컴퍼니는 거래처(가민 프로젝트 · 매출 계산서 8억 3천 = 입금 순액)라 '내 통장 이체' 아님 · 신탁사 대리 입금은 매출 · 세금계산서 짝짓기는 이름 맞는 것 먼저, 금액만 맞는 것은 개인 사업자 · 신탁사만 7일 안 (attachEvidence) · 통장을 새로 넣으면 예전 계산서도 다시 맞춤 · 2026-11-12 대표 지시 '계산서 발행을 우선으로 반영해': 입출금 장부 › '계산서 기준' 탭(`components/LedgerInvoice.tsx` · 발행일 · 공급가액 기준 월별 매출 · 매입 · 미수 · 미지급, matchInvoices) · 짝지어진 통장 줄은 거래처 · 품목 · 공급가 · 부가세를 계산서 기준으로 씀(통장 이름은 메모) · 2026-11-12 '계산서와 은행거래장부와 대조해서 장부 완성해': 0108 tax_invoices.settled · ledger_ids · settle_how (`lib/invoiceSettle.ts` settleInvoices · runSettlement — 수정 발행 취소 · 한 번에 · 나눠서 · 대표 이름 · 금액 하나뿐 · 카드 · 두 번에 · 여러 계산서 한 번에 · 늦게 받은 계산서 · 끝전 차이) · 자료 올리면 자동 · '계산서 기준' 탭 '다시 대사' 버튼 · 2026-11-12 '못 읽는 이유 분석하고 학습시켜': 홈택스 '매출(매입)처별 세금계산서 합계표'(.xls · 거래처별 반기 합계 · 날짜 없음)를 종류 '계산서 합계표'로 알아봄(detectKind · parseInvoiceSummary) → 0109 tax_invoice_summaries(방향 · 기간 · 사업자번호 기준 덮어쓰기) · '계산서 기준' 탭 '홈택스 합계표 대조'(거래처별 홈택스 매수 · 금액 vs 인트라넷 계산서 목록, 차이 큰 순) · 여러 파일은 4개씩 동시에 읽고 DB 기입만 차례로(빠른 반영) · 2026-11-12 'pdf 카드내역을 주면 작업 가능하게': PDF 카드 명세서 읽기(`lib/pdfGrid.ts` · pdfjs-dist 4.10.38 올릴 때만 불러옴 · 한글 CMap `public/pdf-cmaps`) — 글자 위치로 줄 · 칸 나눔 → 날짜로 시작하는 줄 = 이용 한 건(날짜 · 가맹점 · 첫 금액 · 8자리 승인번호, 합계 · 소계 · 청구 줄 제외, 연도 없는 날짜는 명세서 안 가장 늦은 날짜 기준) · 비밀번호 PDF 는 그 자리에서 물어봄(저장 안 함) · 스캔 PDF 는 못 읽음 안내 · 엑셀로 이미 들어간 카드 결제(날짜 · 금액 · 카드 같음)는 PDF 에서 다시 안 넣음 · 직접 올리기는 모든 PDF, 드라이브 폴더는 이름에 카드 · 명세 · 이용내역 · 거래내역이 든 PDF 만(PDF_STATEMENT_RE) · 2026-11-12 '보안메일 읽기 기능 만들어': 카드사 보안메일 명세서(YettieSoft VestMail · 우리카드 WooriCard.html · 현대카드 hyundaicard_*.html · 메일 원본 .eml 첨부)를 직접 올리기로 읽음(`lib/secureMail.ts`) — 명세서 안 카드사 자체 코드를 격리 틀(sandbox iframe · allow-scripts 만)에서 돌려 document.write 결과만 받음(암호 방식 SEED-CBC · 비밀번호 SHA256 은 흉내 내지 않음) · 비밀번호는 그 자리에서 묻고 창이 열린 동안 메모리에만(저장 · 전송 안 함) · 여러 파일은 한 개씩 차례로(비밀번호 한 번) · 틀리면 다시 물음(3번) · 풀린 표 → cardGridFromLines(카드사 이름은 머리 글에서) · 건별 내역 없으면 '카드 청구 요약' · 드라이브 자동 읽기는 안 함(비밀번호 필요) · 건별 내역 없는 PDF 는 '카드 청구 요약'(cardBillFromLines)으로 청구액 · 결제일 · 이용기간 · 결제계좌 기록
  - 리서치 · 보고서 메뉴 분리 (2026-11-12 대표 지시 '리서치와 보고서를 두개로 분리해'): 메뉴 '리서치'(`/research` · 예전 `/report-templates` · `/approvals?section=research` 도 여기로 · `pages/ReportTemplates.tsx`) = 리서치 자료 + 리서치 보고서 양식 (리서치 대시보드는 2026-11-12 대표 지시로 삭제) / 메뉴 '보고서'(`/approvals`) = 보고 대시보드 + 결재. 대시보드 `components/ReportDashboard.tsx` (mode report · research)
  - 입출금 장부 › 정기 출금 달력 (2026-11-12 대표 지시 '읽을 수 있게'): 31칸 한 줄 띠 → 요일별 달력(`LedgerViews.tsx` .rec-cal) · 날짜마다 금액 끝자리까지 · 출금 이름 2개(외 N) · 지남 · 예정 · 기록됨 색 구분 · 휴대폰은 금액만
  - 에이전트 정리 (2026-11-12 대표 지시 '결재가 이루어지지 않는 것들은 보고하지 말고 에이전트도 삭제해 · 업체 보고서와 리서치는 유지'): 예약 작업 '마케팅 영업·파트너스' · '마케팅 홍보·검색노출' · '경영 시스템·홈페이지' · '경영 광고' 삭제, 그 대기 결재 36건은 status '취소'(사유 남김). 리서치 · 입찰 · 팀장 · 총괄 작업은 유지
  - 거래처 리포트 에이전트 (2026-11-12 · 0110): 예약 작업 'WKLY-거래처 리포트 작성'(매일 05:33 KST · 한 번에 3곳) — 커넥터 없이 환경 변수(WKLY_ERP_URL · ANON_KEY · AGENT_TOKEN)로 RPC 두 개만 부름: agent_client_report_targets(요청 할 일 '[거래처 리포트] 회사명' → 프로젝트 있는데 리포트 없거나 오래된(90일) 거래처 → 리포트 없는 클라이언트) · agent_client_report_save(research_items kind '거래처 리포트' 저장 · 같은 거래처면 갱신 · 요청 할 일 완료 · agent_reports 한 줄). 결재 · 알림 · 메일 없음. 인터넷 조사는 무료 WebSearch 만. 작성자 표시는 '리서치팀장 (AI)' · 0111(2026-11-12 '한계 설명 · 발주처 리포트 작성'): 예약 작업은 Gmail 커넥터를 못 쓰므로 인트라넷 메일 색인(mail_index, 8월~) · 담당자(contacts 이름 · 직함만)를 client_report_context 로 함께 넘김 · agent_client_report_context(token, ids[] 최대 20) 일괄 작성용 · 발주처(클라이언트) 먼저 · 이 환경은 외부 사이트 직접 접속(WebFetch) 불가 → 검색 결과로만 조사
  - 리서치 에이전트 통합 (2026-11-12 대표 지시 '업무량 파악해서 통합 운영'): 6개 → 2개 · 'ARTERIOR 인테리어 리서치 (통합) · 이채원'(매일 07:43 · 디자인 리서치 + 시장조사·디자인자동화 + 디자인사례·공공데이터 · 디자인 사례 하루 최대 5건) · 'WKLY 공통 트렌드리서치 (통합) · 김정연'(매일 01:03 · 트렌드리서처 + 월·목 글로벌 트렌드 슬라이드 + 리서치 팀장의 요청 배분만) · 나머지 4개 삭제 · 각 파트는 agent_reports 를 원래 job_name 으로 남김(트렌드리포트 발행 · 인테리어 팀장이 그 이름으로 읽음) · 원문 백업 `erp/docs/agent-prompts-archive/2026-11-12-research-merge/`
  - 링크 활성화 (2026-11-12 대표 지시 '모든 링크는 활성화 시켜'): 공통 `Linkify`(components/ui.tsx FULL_LINK_RE) 가 https:// · [이름](주소) 에 더해 'www.…' · 'xxx.co.kr/…' 처럼 주소만 적힌 것(흔한 끝자리만 · 파일 이름 · 숫자는 제외), 메일 주소(mailto)까지 링크로 · 거래처 리포트 본문(ReportBody) · 리서치 자료 요약 · 본문 · 키값 · 거래처 리포트 요약 · 광고 보고 요약 · 업무 기록 · 연락 이력 · 홈 한마디에 적용 · 리서치 종류 'SEO 개선' · '촬영 요청' 자료는 대표 지시로 삭제(2026-11-12) · 0112 research_items_block_kinds 트리거가 이 두 종류 저장을 거절 · 에이전트 GFX(콘텐츠 디자인·영상) · LEAD-CON 에 '만들지 말 것' 지시(agent_directives · set_by 대표)
  - 직원 근태 결재를 대표 '내 업무'에 (2026-11-12 대표 지시 '직원 근태관리는 내 업무에 포함해'): 홈 '오늘 업무 › 내 업무' 맨 위(관리자만 · `components/AttendanceTodo.tsx`) — 휴가 신청 · 외근/재택/현장 직출 신청(지난 31일까지 · 지난 날짜는 빨강) · 휴대폰 출근 확인을 그 자리에서 승인 · 반려 + '오늘 근태' 한 줄(출근 n/전체 · 휴가 · 외근 · 출근 시각 지난 뒤 미출근 · 지각 이름 → 업무·근태). 업무·근태 '승인할 신청' 목록도 오늘 이후만 보이던 것을 지난 31일 대기 신청까지 보이게 고침(`CheckIn.tsx` · PLAN_LOOKBACK)
  - 광고 화면은 팀원 모두 볼 수 있음 (0093 · 읽기만) · 입출금 장부 · 관리는 관리자만
  - 금액 표시 `manwon()` 은 반올림하지 않음 (2026-11-06 대표 지시: 1,490만 4,545원 처럼 끝자리까지)
  - 현장 실측 화면 `/site` (아래 메뉴 '현장'): `src/pages/Site.tsx` · 사진 위 치수 선(site_photos.marks) · 도면(site_plans) 위 사진 핀 · 0087 · 저장소 site-photos
- `erp/supabase/migrations/` : DB 변경 (번호 순서, 다음 번호는 마지막 파일 + 1)
- `erp/supabase/functions/` : 서버 함수 (gdrive · gmail · drive-upload · agent-chat 등)
- Supabase 프로젝트 id: `hophgcpszenrvchvbkav`

## 작업 순서
1. `cd erp && npx tsc --noEmit -p . && npm run build`
2. 화면 확인: `npx vite --port 5179` → Playwright 로 열어 '관리자 (대표)로 입장'(체험 모드) → 캡처
3. 커밋 → 작업 브랜치에 push → PR → squash 합치기 → main 을 작업 브랜치에 다시 합치기
4. DB 변경은 마이그레이션 파일을 만들고 Supabase 에 적용
5. 서버 함수는 `deno check` 후 Supabase 에 배포 (DB 와 함수는 main 합치기와 별개로 직접 배포해야 함)

## 개발 일정 (2026-11-05 대표 지시)
- **`erp/docs/ROADMAP.md`** : 1단계 슬랙 · 카카오톡 연결 → 2단계 프로젝트별 외부 협업 채팅방(자료 · 일정 공유) → 3단계 협업 화이트보드(Excalidraw)
  - 단계별 날짜는 대표 구글 캘린더(info@thewklyn.com)에 '[인트라넷 …]' 일정 + 알림으로 등록됨. 날짜를 바꾸면 캘린더도 같이 고칠 것
  - 카카오톡 대화 가져오기(로드맵 1-3 · 0105 · `components/KakaoSection.tsx` · `lib/kakao.ts`): 프로젝트 화면 '카카오톡 대화' — 내보내기 .txt/.csv 올리면 저장 · 원본 · 사진은 드라이브 수신방 (2026-11-11 적용)
  - 슬랙 가져오기(0088 · slack-import(verify_jwt false) · SlackSection) 운영 적용 완료 (2026-11-06). 회사 슬랙 앱 설치 · 토큰 입력은 대표가 프로젝트 화면에서

## 남은 일 (2026-11-01 기준)
- 수신방 날짜별 폴더 (`수신방/YYMMDD/연번 프로젝트/분류`): drive-upload · gdrive(v9) 배포됨,
  gmail 함수도 배포됨 (2026-11-11 v12 · 프로젝트 메일 '새로고침' action refresh 포함)
- 메일 청구서 (2026-11-13 · gmail v14 · 0116): 서비스 알림 메일(구글 · Anthropic · Supabase 등)이라도 제목이 인보이스 · 영수증 · 청구서면 PDF 만 `수신방/청구서/YYYY-MM/<회사>` 에 저장 (mail_files.kind '청구서'). gmail 함수는 `npm run build:gmail-dashboard` 로 만든 `supabase/deploy/gmail-dashboard.ts` 한 파일로 배포
- 현장 실측 사진 → 드라이브 (2026-11-13 · 함수 site-photos-drive · verify_jwt false): 짧은 열쇠(app_settings 'site_photos_drive_token' · 만료 · 허용 폴더)로만 동작. prepare → 프로젝트 `03.현장일보/01.현장사진/YYMMDD_실측사진/{원본,치수선}` 폴더 + 사진 받기 주소, put → 허용 폴더에 올림. 치수선 사진은 앱과 같은 모양(노란 선 · 초록 이름표)으로 그려 올림. 쓰고 나면 열쇠 행을 지움
- gdrive 수신방 자동 분류: 다른 프로젝트에 먼저 있던 파일(이름 · 크기 같음)을 복사해 넣으면 수신 자료로 올리지 않음
  (2026-11-01 로제코 폴더 '견적서 참고/실행내역' 에 나름대로 사본 34개 → 나름대로 05.견적서 로 옮김)
- 오른쪽 '프로젝트 일정' 칸: 디자인 단순화 + 스크롤이 안 돼 지난 · 앞으로 일정이 안 보이는 오류 수정
  (`src/components/ProjectViz.tsx` scheduleCard · `RightSchedule.tsx` · `styles.css` `.web-panel` / `.right-sched`)
- 끌어다 놓기 → 수신방 업로드는 실제 회사 계정으로 한 번 시험 필요
