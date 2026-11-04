# 더위클리 사내 인트라넷 (WKLY ERP) — 개발 인수인계

이 저장소에서 일하는 Claude 세션은 먼저 이 문서를 읽고 이어서 작업한다.

## 대화 규칙 (대표 지시)
- 대표(박기호)에게는 항상 **한국어 존댓말**로 답한다.
- 비밀 키 · 토큰 · 비밀번호를 대화로 달라고 하지 않는다. 필요하면 설정 위치만 안내한다.
- 검정 · 다크 디자인 금지. 주민번호 저장 금지. 알림 제목에 금액 금지.
- 에이전트는 메일을 직접 보내지 않는다 (임시 저장만).
- 구글 드라이브 기존 자료는 수정 · 삭제하지 않는다 (지울 때는 휴지통만).
- 무료 서비스만 쓴다 (유료 검색 도구 금지).
- 커밋 · PR · 코드 주석에 모델 이름을 쓰지 않는다.
- 작업이 끝나면 결과 화면 캡처를 보여 준다.

## 구조
- `erp/` : React + TypeScript + Vite 웹앱 (Cloudflare Pages · main 에 합치면 자동 배포)
  - `src/pages/` 화면 · `src/components/` 부품 · `src/lib/api.ts` (API 정의) · `supabaseApi.ts` (운영) · `demoApi.ts` (체험 모드)
  - `src/styles.css` : 디자인 토큰 · WKLY v7 디자인 시스템 (사각 모서리, 글자 크기 단계 `--fs-cap 11 · sm 12 · body 13 · sub 15 · title 18 · num 22`)
  - `desktop/` : PC 프로그램 (Electron)
  - `android/` : 안드로이드 앱 (TWA · 웹을 앱으로 띄움). main 에 `erp/android/**` 변경이 들어가면 `.github/workflows/android.yml` 이 APK 를 만들어
    릴리스 `android` 의 `wkly-erp.apk` 로 올림. 서명 키는 Vault (함수 `android-key` 가 GitHub OIDC 확인 뒤 넘김) · 지문은 `public/.well-known/assetlinks.json`
  - 휴대폰 설치: 홈 맨 위 '휴대폰 앱 받기'(갤럭시 APK · 아이폰 설치 프로파일 `public/wkly-erp.mobileconfig` 웹 클립) · 안내 `public/install.html`
  - 현장 실측 체크리스트: `src/components/SiteSurvey.tsx` (표 site_survey_items · 0084 · 표준 38항목)
- `erp/supabase/migrations/` : DB 변경 (번호 순서, 다음 번호는 마지막 파일 + 1)
- `erp/supabase/functions/` : 서버 함수 (gdrive · gmail · drive-upload · agent-chat 등)
- Supabase 프로젝트 id: `hophgcpszenrvchvbkav`

## 작업 순서
1. `cd erp && npx tsc --noEmit -p . && npm run build`
2. 화면 확인: `npx vite --port 5179` → Playwright 로 열어 '관리자 (대표)로 입장'(체험 모드) → 캡처
3. 커밋 → 작업 브랜치에 push → PR → squash 합치기 → main 을 작업 브랜치에 다시 합치기
4. DB 변경은 마이그레이션 파일을 만들고 Supabase 에 적용
5. 서버 함수는 `deno check` 후 Supabase 에 배포 (DB 와 함수는 main 합치기와 별개로 직접 배포해야 함)

## 남은 일 (2026-11-01 기준)
- 수신방 날짜별 폴더 (`수신방/YYMMDD/연번 프로젝트/분류`): drive-upload · gdrive(v9) 배포됨,
  **gmail 함수는 코드만 고쳐 두었고 아직 배포 안 됨** → 배포 필요
- gdrive 수신방 자동 분류: 다른 프로젝트에 먼저 있던 파일(이름 · 크기 같음)을 복사해 넣으면 수신 자료로 올리지 않음
  (2026-11-01 로제코 폴더 '견적서 참고/실행내역' 에 나름대로 사본 34개 → 나름대로 05.견적서 로 옮김)
- 오른쪽 '프로젝트 일정' 칸: 디자인 단순화 + 스크롤이 안 돼 지난 · 앞으로 일정이 안 보이는 오류 수정
  (`src/components/ProjectViz.tsx` scheduleCard · `RightSchedule.tsx` · `styles.css` `.web-panel` / `.right-sched`)
- 끌어다 놓기 → 수신방 업로드는 실제 회사 계정으로 한 번 시험 필요
