# THE WKLY 사내 미니홈피 (ERP)

싸이월드 미니홈피 구성 + 카카오톡식 말풍선 + WKLY v7 디자인 시스템(검정 미사용)으로 만든 사내 업무 시스템입니다.

- **홈 · 승인 대시보드**: 승인 대기 건을 바로 승인/반려, 오늘의 현황(업무 기록·마감·프로젝트·안 읽은 채팅), 일일 보고, 팀 한마디
- **승인**: 업무 보고 · 일일 보고 · 메일 발송 · 프로젝트 · 거래처 · 할 일 · 지출 · 기타. 종류별 승인 담당 자동 지정, 반려 사유, 승인된 메일은 "Gmail로 보내기", 승인된 지출은 결제 대장에 자동 등록
- **채팅**: 채널형 채팅방, 실시간, 안 읽은 수, 프로젝트 연결
- **업무 일지**: "나와의 채팅"처럼 아래 입력창에 쓰면 바로 기록. 업무/메일 발신/메일 수신/미팅/전화/메신저/기타, 거래처·프로젝트 연결, 소요 시간, 업무 보고 제출, 팀원 파도타기
- **빠른 기록 창**: 크롬·엣지(PC)에서 다른 프로그램 위에 항상 떠 있는 작은 창 (그 외 브라우저는 작은 팝업)
- **프로젝트 대시보드**: 담당자별 진행상황, 프로젝트별 수익성(마진율 · 목표 마진), 예산 초과 항목, 업체별 결제 현황, 월별 수금·지급, 다가오는 결제 (재무는 관리자만)
- **프로젝트 · 일정**: 상태별 목록, 미니 달력, 할 일(할 일 → 진행 중 → 완료) + 알람, 프로젝트 채팅방, 재무(계약액·공사 구분별 실행 예산·결제 내역)
- **결제 대장 (관리자)**: 회사 엑셀 결제 대장과 같은 항목(결제요청일 · 공사 구분 · 업체 · 계약형태 · 계좌 · 금액/VAT · 지급완료 · 지급예정일 · 세금계산서). 지급예정일은 차주 월요일 자동, **이번 주 지급**(월요일 이체 목록을 받는 계좌별로 묶어 은행 일괄이체용 CSV, 지급 완료 일괄 처리), **점검**(연체·계좌 누락·세금계산서·예산 초과·노무비 예금주 등 12가지 자동 확인), 대지급 정산, 노무비 대장(월별 요약 + 세무사용 CSV), **엑셀 가져오기**
- **거래처**: 담당자, 커뮤니케이션 이력(업무 일지 자동 모음), 전화·Gmail 바로가기
- **자료실**: AI 에이전트가 모은 리서치(검토 → 할 일 · 프로젝트 연결 · 채팅 공유 · 브랜드 담당자 저장), 브랜드 담당자(출처 기록 · 수신거부 잠금 · CSV 가져오기 · 템플릿 메일), 메일 템플릿, 에이전트 연결 안내
- **알림**: 종 모양 알림함(할 일 배정 · 알람 · 승인 · 일일 보고 · @멘션 · 결제), PC 알림, 매일 09:00 요약
- **팀 · 관리**: TODAY IS 상태, 오늘의 한마디 / 관리자 화면에서 팀원(사람·AI) 추가, 권한, 승인 담당, AI 에이전트 연결 키, 데이터 백업, DB 사용량
- **AI 팀원**: 'WKLY 총괄'(AI 프로젝트 총괄)이 연결 키로 할 일 배정 · 일일 보고 · 리서치 등록 · 재무 위험 알림 (`docs/AGENTS.md`). 관리 화면에서 계정과 키를 한 번에 등록
- **사용법**: 상단 '사용법' 버튼 — 직원용 설명과 관리자용 설명(관리자에게만 보임)
- PC·휴대폰 모두 사용 가능, 앱처럼 설치(PWA) 가능

화면 설계(Figma): WKLY BRANDING 파일 › **WKLY 사내 ERP 미니홈피** 페이지 — https://www.figma.com/design/fePgvTp53M3PmbQ2R8TsDs/WKLY-BRANDING?node-id=238-1180

---

## 비용

| 구성 | 서비스 | 무료 한도 (요약) |
|---|---|---|
| DB·로그인·실시간 | Supabase Free | DB 500MB, 파일 1GB, 7일간 접속 없으면 일시정지 |
| 웹 호스팅 | Cloudflare Pages Free | 상업적 사용 가능, 대역폭 무제한 |
| 도메인 | 기존 thewklyn.com | `erp.thewklyn.com` 하위 주소 추가 (무료) |

> 무료 한도는 바뀔 수 있으니 가입 시 각 서비스 요금표를 확인하세요.

---

## 1. 체험(데모) 모드로 먼저 보기

Supabase 없이도 실행됩니다. 환경변수를 비워 두면 **데모 모드**로 열리고, 데이터는 그 브라우저에만 저장됩니다.

```bash
npm install
npm run dev        # http://localhost:5173
```

Cloudflare Pages에 환경변수 없이 배포해도 데모 모드로 열립니다.

## 2. Supabase 준비 (약 10분)

1. https://supabase.com 가입 → **New project** (Region: Northeast Asia (Seoul))
2. 왼쪽 **SQL Editor** → 아래 파일 내용을 순서대로 붙여넣고 **Run** (파일마다 New query)
   1. `supabase/migrations/0001_init.sql` — 기본 (팀원·거래처·프로젝트·업무 일지·채팅·승인)
   2. `supabase/migrations/0002_minihompy.sql` — 미니홈피 상태·안 읽은 채팅
   3. `supabase/migrations/0003_finance_admin.sql` — 재무 (계약·실행 예산·결제 대장), 관리자 현황
   4. `supabase/migrations/0004_workspace_agents.sql` — 자료실·브랜드 담당자·알림·알람·AI 에이전트·일일 보고
   (여러 번 실행해도 안전합니다)
   - 알람(5분마다)·매일 09:00 요약을 서버에서 보내려면 0004 실행 전에 **Database → Extensions(또는 Integrations → Cron) → pg_cron 켜기**.
     나중에 켰다면 0004 를 한 번 더 실행하세요. 켜지 않아도 누군가 ERP를 열어 둔 동안에는 1분마다 알람을 확인합니다.
3. **Authentication → Sign In / Providers → Email**
   - **Allow new users to sign up: 끄기** (아무나 가입 못 하게)
4. **Authentication → Users → Add user → Create new user**
   - 이메일 + 비밀번호 입력, **Auto Confirm User 체크**
   - **가장 먼저 만든 계정이 관리자(admin)** 가 됩니다. 대표님 계정을 먼저 만드세요.
   - 직원 계정은 아래 '팀원 추가 기능 켜기'를 해 두면 관리 화면에서 바로 만들 수 있습니다.
     (안 켜도 같은 방법으로 대시보드에서 추가 가능 → 첫 로그인 후 팀 화면에서 비밀번호 변경)
5. **Project Settings → API** 에서 두 값을 복사
   - Project URL → `VITE_SUPABASE_URL`
   - anon / publishable key → `VITE_SUPABASE_ANON_KEY`
   (service_role / secret 키는 절대 넣지 마세요)

로컬에서 확인하려면 `.env.example` 을 `.env` 로 복사해 두 값을 넣고 `npm run dev`.

### 팀원 추가 기능 켜기 (선택, 약 3분)

관리 화면의 "팀원 추가"는 Supabase Edge Function `admin-create-user` 로 계정을 만듭니다.
service_role 키는 이 함수 안에서만 쓰이고 브라우저로 나가지 않습니다.

- **대시보드에서**: Edge Functions → **Deploy a new function → Via Editor** → 이름 `admin-create-user`
  → `supabase/functions/admin-create-user/index.ts` 내용을 붙여넣고 **Deploy**
- **또는 터미널에서**: `npx supabase functions deploy admin-create-user --project-ref <프로젝트 ref>`

필요한 값(SUPABASE_URL · ANON · SERVICE_ROLE 키)은 Supabase 가 함수에 자동으로 넣어 줍니다.

## 3. Cloudflare Pages 배포 (무료, 상업적 사용 가능)

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**
2. 이 저장소(`wkly2go/wkly-instagram-images`) 선택 · Production branch: `main` (PR을 합친 뒤) 또는 지금 브랜치
3. 빌드 설정
   - Framework preset: **Vite** (또는 None)
   - **Root directory: `erp`** (ERP 코드가 저장소의 erp 폴더에 있음)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Node 버전은 `.node-version` 파일로 22 고정)
4. **Save and Deploy** → `https://<프로젝트명>.pages.dev` 주소가 생깁니다.

`public/_redirects` 가 있어 새로고침해도 화면이 유지됩니다.

## 4. 회사 도메인 연결 (erp.thewklyn.com)

1. Cloudflare Pages 프로젝트 → **Custom domains → Set up a custom domain** → `erp.thewklyn.com`
2. thewklyn.com 을 관리하는 곳(아임웹·가비아 등)의 DNS 설정에 한 줄 추가
   - 타입 `CNAME`, 이름 `erp`, 값 `<프로젝트명>.pages.dev`
3. 기존 홈페이지 레코드는 건드리지 않으므로 thewklyn.com 은 그대로입니다.
4. Supabase → Authentication → URL Configuration → Site URL 을 `https://erp.thewklyn.com` 으로

## 5. 회사 엑셀 결제 대장 옮기기

프로젝트 › **결제 대장 › 엑셀 가져오기** 에서 지금 쓰는 결제 대장 파일(.xlsx)을 그대로 올리면 됩니다.

- 시트를 고르고 현장(프로젝트)을 정하면, 열 이름(결제요청일 · 공사 구분 · 업체명 · 결제금액 · 지급완료 …)으로 맞춰 읽습니다. 시트마다 열 순서가 달라도 됩니다.
- 합계 줄, 표 밖에 적은 금액, 추정치('인건비', '부가세' 같은 줄)는 따로 표시해 주고, 이미 등록된 결제와 겹치는 줄은 미리 빼 둡니다.
- '현장소장 대지급' 정산 줄은 위 항목들에 '대지급자'로 반영해 두 번 더해지지 않게 합니다.
- 파일은 브라우저 안에서만 읽고, 저장되는 건 고른 줄뿐입니다. 계좌번호는 관리자만 볼 수 있습니다.
- 계약금액·수금은 **VAT 포함** 금액으로 보고 공급가액(÷1.1)으로 저장합니다. 세금계산서 '발행'으로 표시된 지급은 VAT 10%를 나눠 저장하고, 표시가 없는 지급은 전액 비용으로 계산합니다 (마진은 공급가액 기준, 화면에서 끌 수 있음).

## 6. 앱처럼 쓰기

- **PC**: 크롬/엣지 주소창 오른쪽 "앱 설치" 아이콘 → 작은 창으로 실행
- **빠른 기록 창**: 상단 "빠른 기록 창 띄우기" → 다른 프로그램 위에 떠 있는 작은 창에서 바로 기록
- **휴대폰**: 공유 → "홈 화면에 추가"
- **PC 알림**: 상단 종 → 아래 'PC 알림 켜기' → 브라우저에서 허용

---

## 개발

```bash
npm run dev        # 개발 서버
npm run build      # 타입 검사 + 빌드 (dist/)
npm run typecheck
```

- React 18 + TypeScript + Vite, Supabase JS, lucide-react 아이콘
- `src/lib/api.ts` 인터페이스 하나로 화면이 동작하고, 구현은 둘입니다.
  - `supabaseApi.ts`: 운영
  - `demoApi.ts`: 데모(브라우저 저장소)
- 보안 경계는 DB의 Row Level Security 입니다 (`supabase/migrations`).
  - 비활성화된 계정과 비로그인 사용자는 아무것도 보거나 쓸 수 없음
  - 거래처·프로젝트 삭제와 권한 변경은 관리자만
  - 업무 일지·채팅은 본인 것만 수정/삭제 (관리자는 삭제 가능)
  - 승인 요청은 요청자·지정 승인자·관리자만 보고, 결정은 승인자/관리자만
  - 계약액·예산·결제 대장(계좌 포함)은 관리자만
  - AI 에이전트는 연결 키에 허락된 일만 (키 원문은 저장하지 않고 해시만 보관)
- 디자인 토큰: `src/styles.css` 상단 (WKLY v7 / 노랑 #FFFF00 · 시리즈 블루 #1C44F1 · 페이퍼 #F4F4EF · 그레이 #62625C · 라인 #D9D9D1)

## AI 에이전트 연결

리서치 에이전트·WKLY 총괄 같은 AI 팀원은 관리 화면에서 만든 **연결 키**로 기록합니다.
관리 › **WKLY 총괄 (AI 프로젝트 총괄)** › 등록하기 를 누르면 AI 팀원 계정과 키가 한 번에 만들어집니다.
방법·예시·Claude 예약 작업 설정은 `docs/AGENTS.md`, WKLY 총괄용 스킬 초안은 `docs/skills/wkly-project-manager/SKILL.md` 에 있습니다.

## 데이터 백업 (무료 플랜)

무료 플랜에는 자동 백업이 없습니다. 월 1회 정도 **관리 › 데이터 백업** 에서 전체(JSON) 또는 표별 CSV 를
내려받아 회사 드라이브에 보관하세요. (Supabase **Table Editor → Export to CSV** 도 가능)
