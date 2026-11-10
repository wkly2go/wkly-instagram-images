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
- `erp/` : React + TypeScript + Vite 웹앱 (Cloudflare Pages · main 에 합치면 자동 배포)
  - `src/pages/` 화면 · `src/components/` 부품 · `src/lib/api.ts` (API 정의) · `supabaseApi.ts` (운영) · `demoApi.ts` (체험 모드)
  - `src/styles.css` : 디자인 토큰 · WKLY v7 디자인 시스템 (사각 모서리, 글자 크기 단계 `--fs-cap 12 · sm 12.5 · body 13.5 · sub 14.5 · title 16 · num 19 · hero 28` (2026-11-09 위계 다시 잡음 · 맨 아래 :root 가 최종값 · 터치 화면은 반 단계 큼))
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
  - 빠른 창 채팅방 묶음: 진행 중 프로젝트(구분별) · 채팅방 · 사람 팀원 · AI 팀원 · 끝난 프로젝트 (`pages/Quick.tsx` roomGroups)
  - 관리 › 팀원 관리 표에서 직함 · 사원번호 · 직급 · 입사일 · 연락처 바로 고치기, '인사 ▼'로 전체 인사 정보 펼쳐 고치기
  - 입출금 장부(회계장부)는 **연도별** (2026-11-06 대표 지시 '연결장부로 하지 말고 년도별로'): 연도 고르기 · 월 이동은 그 해 1~12월 안에서만 · '연간 장부' 탭(1~12월 · 연 합계 · 연간 엑셀) · 통계도 그 해 안 · 기초 잔액은 해마다 따로 (`src/pages/Ledger.tsx` · `components/LedgerViews.tsx` · `LedgerStats.tsx`)
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
  - 슬랙 가져오기(0088 · slack-import(verify_jwt false) · SlackSection) 운영 적용 완료 (2026-11-06). 회사 슬랙 앱 설치 · 토큰 입력은 대표가 프로젝트 화면에서

## 남은 일 (2026-11-01 기준)
- 수신방 날짜별 폴더 (`수신방/YYMMDD/연번 프로젝트/분류`): drive-upload · gdrive(v9) 배포됨,
  **gmail 함수는 코드만 고쳐 두었고 아직 배포 안 됨** → 배포 필요
- gdrive 수신방 자동 분류: 다른 프로젝트에 먼저 있던 파일(이름 · 크기 같음)을 복사해 넣으면 수신 자료로 올리지 않음
  (2026-11-01 로제코 폴더 '견적서 참고/실행내역' 에 나름대로 사본 34개 → 나름대로 05.견적서 로 옮김)
- 오른쪽 '프로젝트 일정' 칸: 디자인 단순화 + 스크롤이 안 돼 지난 · 앞으로 일정이 안 보이는 오류 수정
  (`src/components/ProjectViz.tsx` scheduleCard · `RightSchedule.tsx` · `styles.css` `.web-panel` / `.right-sched`)
- 끌어다 놓기 → 수신방 업로드는 실제 회사 계정으로 한 번 시험 필요
