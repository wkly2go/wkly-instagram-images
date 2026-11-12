# 2026-11-12 개발 중단 지점과 복구 순서
한국시간. 일정: 오늘 개발·기본 검증 완료 목표 / 내일 점검·보완. 예약 작업 제목도 인트라넷 점검·보완으로 변경됨.

## 정확한 상태
- 기존 원격 개발 브랜치: codex/intranet-sprint-20261112, PR #354 (초안).
- 이번 원격 커밋은 일정·복구 기록만 추가한다. 아래 신규 구현 파일은 아직 원격에 업로드하지 못했다.
- 개발 컴퓨터 연결이 중간에 unavailable로 바뀌었다. exec 결과: No usable execution environment is available.
- 운영 DB·서버 함수·웹 배포는 실행하지 않았다. 새 API 유료 호출·외부 발행·광고 집행·추가 결제도 하지 않았다.
- 0107은 재실행하지 않는다.

## 복구할 로컬 위치
/Users/kiho02/Documents/Codex/2026-11-12/new-chat/work/sprint/repo
로컬 Git 마지막 커밋: 6d62210 (최신 회계와 PDF 읽기 변경 보존).
로컬에는 최신 main 7d5c52fb6461fca6cf4bc161bff1c33acd085732 (#358)까지의 회계·PDF·보안메일 읽기 변경을 기존 영업 코드 위에 보존했다. 원격 PR에는 이 병합도 아직 올리지 않았다.
최신 main은 복구 후 다시 확인한다. 로컬 Git는 원격 이력과 같은 SHA를 갖지 않는 스냅샷 이력이므로 원격에 그대로 force push하지 않는다.

## 작성한 신규 파일과 변경
- erp/src/lib/growth.ts: 공고·콘텐츠·연락처 타입/검증, 중복 연락처 추출, 채널 승인 해제.
- erp/src/lib/growthApi.ts: 운영 RPC/조회와 체험 저장, 영업 연결, AI 설정/실행/정산.
- erp/src/components/GrowthWorkspace.tsx, GrowthWorkspace.css: 나라장터, 콘텐츠·채널 편집, 연락처 검토함과 텍스트 추출.
- erp/src/components/GrowthAi.tsx: 업무별 선택 실행, 요청문 복사/결과 검수, 기간 예산·모델 설정, 불확실 요청 정산.
- erp/src/pages/Growth.tsx, App.tsx, Shell.tsx: /tenders, /leads, /ai-usage.
- Ads.tsx: 기존 광고 화면에 콘텐츠·배포 탭 추가. Sales.tsx: id 링크로 영업 상세 열기·화면 매뉴얼 링크.
- api.ts, demoApi.ts, supabaseApi.ts: 공용 API 확장.
- 0111_growth_workspace.sql: RLS, 담당자/관리자 수정, 감사 이력, 공고/연락처 중복 방지, 콘텐츠 관리자 승인, 영업 연결 원자화, 기존 mail_index 동기화 발신자→검토함 트리거.
- 0112_growth_ai_budget.sql: 기간 예산·모델·사용 이력, 원자적 비용 예약, 중복 요청 차단, 불확실 비용 유지, 관리자 확인·정산.
- supabase/functions/growth-ai/index.ts, policy.ts: 인증, 서버 키, 단일 호출, 입력·출력 상한, 시간 제한, 비용 예약·정산. 기본 예산/모델은 미설정으로 비활성.
- tests/growth.test.ts, growth-db.test.mjs: 신규 17개.
- public/manual/growth.html 및 sales.png,tender.png,contact.png,content.png,ai.png,mobile.png: 실제 체험 화면 포함 사용설명. 공개 매뉴얼 이미지에는 연습 데이터만 있다.
- package.json: test:growth 추가.

## 검증 결과와 미해결 결함
- 초기 신규 테스트 16개 모두 통과. 그 뒤 시간대·과금 정산 보강을 추가했다.
- 최종 전체 검사: 151개 중 140개 통과, 11개 실패. 신규 DB 테스트 before hook에서 SQL syntax error at or near "then"이 발생하여 11개가 함께 실패했다. 모두 통과라고 보고하지 않는다.
- 원인 후보: 0111 파일을 JavaScript String.replace의 문자열 replacement로 수정하면서 SQL 정규식 끝의 dollar+single-quote가 replacement 확장 문법으로 처리되어 내용이 섞였을 가능성. 또한 0112 추가 함수의 $$가 $로 바뀌는 문제를 발견해 수정했다. 파일 전체를 직접 확인하고 SQL 원문으로 복구한다. replacement callback을 사용하거나 apply_patch로 수정하여 dollar를 문자 그대로 보존한다.
- 0111의 마감 시각 검증은 빈 값 또는 timezone Z/+09:00 포함 값을 받아야 한다. 입력 화면은 한국시간을 +09:00으로 저장하도록 수정됨.
- 0111 backfill 조회에서 내부 발신자·noreply·SENT/SPAM/TRASH를 걸러 다음 묶음 진행이 막히지 않도록 확인한다. 반환 숫자는 확인한 메일 수이며 신규 저장 수와 구분한다.
- 최종 타입 검사 통과. 마지막 프로덕션 빌드는 환경 연결 해제로 시작하지 못했다.
- 서버 Deno check는 npm 의존성 해석 문제로 아직 미통과. /tmp/wkly-deno/deno (2.9.6) 설치 완료. 분리 cwd에서 --no-config --no-lock --node-modules-dir=none으로 다시 검사한다. 공유 node_modules를 임의 변경하지 않는다.
- UI: 체험 공고 등록→영업 연결→상세 이동, 콘텐츠 저장→관리자 승인→본문 수정 시 초안 복귀, 이메일 중복 3개→후보 2개→저장 확인, 모바일 390px 공고 수정·저장 확인.
- 개발 중 HMR에서 AppProvider 오류가 나 새로고침 후 정상 복구됨. 프로덕션 빌드에서도 재현되는지 확인한다.
- 사용 매뉴얼은 파일 생성 완료, 마지막 HTML 화면 검수 전. 영상은 아직 만들지 않음.
- 예약 비용이 unknown일 때 사용자 재시도로 유료 호출하지 않음. 정산 RPC의 권한/감사 테스트를 추가했으나 SQL hook 오류로 해당 최종 실행은 미완료.

## 다음 순서
1. 기존 로컬 파일을 먼저 확보하고 git diff/status 확인. 작업을 덮어쓰거나 다시 초기화하지 않는다.
2. 0111/0112 SQL 문법 복구 → 신규 17개 테스트 → 전체 151개 → 타입 → 빌드 → 서버 함수 검사.
3. AI 정산 UI, 콘솔/예산 값 구분, 입력 시간대, 공고·연락처 일괄 가져오기·상세 수정, 모바일·PC 화면을 추가 확인.
4. 신규 구현을 원격 브랜치에 올리기 전에 최신 main 변경을 보존하고 PR 충돌을 해소한다. GitHub tree는 최신 base tree 위에 변경 파일만 적용하고 ref는 expected_sha로 이동한다.
5. DB 실제 이력 및 0110~0112 번호 충돌을 확인한 후 적용. DB·서버 함수·웹은 별도로 검증하고 미완료를 숨기지 않는다.
6. 내일 점검은 오늘의 실제 결과에서 이어간다. 오늘 미완료를 완료로 간주하지 않는다.

## 범위와 비용
팝업 스케줄·외국어 홈페이지·릴스 편집 엔진 제외. 기존 완료 기능 보존.
기존 API $100 및 Max 사용, 서버 기본 $25 목표. 제공 크레딧 여부·잔액·만료일은 실제 Console 확인 전 확정하지 않는다. 사용자 화면은 최근30일 총 $67.66이며 잔액이 아니다.
API 시험 제안 상한 $10은 실제 사용 가능 잔액/타 업무 배정액 안에서만 설정한다. 현재 아무 예산·모델도 활성화하지 않았다.
기존 AI 팀원/다른 키 호출을 새 비용 대시보드의 집계로 오인하지 않는다.
공식 나라장터 자동 수집, 인스타 계정 자동 수집, 매체 자동 발행은 아직 실제 연결 미완료. 현재 공고 직접 등록·보관 자료 연락처 추출·게시 결과 기록 경로를 구현한 상태다.
