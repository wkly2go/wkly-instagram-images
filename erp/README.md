# THE WKLY 사내 미니홈피 (ERP)

싸이월드 미니홈피 구성 + 카카오톡식 말풍선 + WKLY v7 디자인 시스템(검정 미사용)으로 만든 사내 업무 시스템입니다.

- **홈 · 승인 대시보드**: 승인 대기 건을 바로 승인/반려, 오늘의 현황(업무 기록·마감·프로젝트·안 읽은 채팅), 팀 한마디
- **승인**: 업무 보고 · 메일 발송 · 프로젝트 · 거래처 · 할 일 · 지출 · 기타. 승인자 지정, 반려 사유, 승인된 메일은 "Gmail로 보내기"
- **채팅**: 채널형 채팅방, 실시간, 안 읽은 수, 프로젝트 연결
- **업무 일지**: "나와의 채팅"처럼 아래 입력창에 쓰면 바로 기록. 업무/메일 발신/메일 수신/미팅/전화/메신저/기타, 거래처·프로젝트 연결, 소요 시간, 업무 보고 제출, 팀원 파도타기
- **빠른 기록 창**: 크롬·엣지(PC)에서 다른 프로그램 위에 항상 떠 있는 작은 창 (그 외 브라우저는 작은 팝업)
- **프로젝트 · 일정**: 상태별 목록, 미니 달력, 할 일(할 일 → 진행 중 → 완료), 프로젝트 채팅방
- **거래처**: 담당자, 커뮤니케이션 이력(업무 일지 자동 모음), 전화·Gmail 바로가기
- **팀**: TODAY IS 상태, 오늘의 한마디, 관리자의 권한·비활성화 관리, 비밀번호 변경
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
2. 왼쪽 **SQL Editor** → 아래 두 파일 내용을 순서대로 붙여넣고 **Run**
   1. `supabase/migrations/0001_init.sql`
   2. `supabase/migrations/0002_minihompy.sql`
   (여러 번 실행해도 안전합니다)
3. **Authentication → Sign In / Providers → Email**
   - **Allow new users to sign up: 끄기** (아무나 가입 못 하게)
4. **Authentication → Users → Add user → Create new user**
   - 이메일 + 비밀번호 입력, **Auto Confirm User 체크**
   - **가장 먼저 만든 계정이 관리자(admin)** 가 됩니다. 대표님 계정을 먼저 만드세요.
   - 직원 계정도 같은 방법으로 추가 → 첫 로그인 후 팀 화면에서 비밀번호 변경
5. **Project Settings → API** 에서 두 값을 복사
   - Project URL → `VITE_SUPABASE_URL`
   - anon / publishable key → `VITE_SUPABASE_ANON_KEY`
   (service_role / secret 키는 절대 넣지 마세요)

로컬에서 확인하려면 `.env.example` 을 `.env` 로 복사해 두 값을 넣고 `npm run dev`.

## 3. Cloudflare Pages 배포 (무료, 상업적 사용 가능)

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**
2. 이 저장소 선택
3. 빌드 설정
   - Framework preset: **Vite** (또는 None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION` = `22`
4. **Save and Deploy** → `https://<프로젝트명>.pages.dev` 주소가 생깁니다.

`public/_redirects` 가 있어 새로고침해도 화면이 유지됩니다.

## 4. 회사 도메인 연결 (erp.thewklyn.com)

1. Cloudflare Pages 프로젝트 → **Custom domains → Set up a custom domain** → `erp.thewklyn.com`
2. thewklyn.com 을 관리하는 곳(아임웹·가비아 등)의 DNS 설정에 한 줄 추가
   - 타입 `CNAME`, 이름 `erp`, 값 `<프로젝트명>.pages.dev`
3. 기존 홈페이지 레코드는 건드리지 않으므로 thewklyn.com 은 그대로입니다.
4. Supabase → Authentication → URL Configuration → Site URL 을 `https://erp.thewklyn.com` 으로

## 5. 앱처럼 쓰기

- **PC**: 크롬/엣지 주소창 오른쪽 "앱 설치" 아이콘 → 작은 창으로 실행
- **빠른 기록 창**: 상단 "빠른 기록 창 띄우기" → 다른 프로그램 위에 떠 있는 작은 창에서 바로 기록
- **휴대폰**: 공유 → "홈 화면에 추가"

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
- 디자인 토큰: `src/styles.css` 상단 (WKLY v7 / 노랑 #FFFF00 · 시리즈 블루 #1C44F1 · 페이퍼 #F4F4EF · 그레이 #62625C · 라인 #D9D9D1)

## 데이터 백업 (무료 플랜)

무료 플랜에는 자동 백업이 없습니다. 월 1회 정도 Supabase **Table Editor → 각 테이블 → Export to CSV** 로
내려받아 Google Drive 에 보관하세요.
