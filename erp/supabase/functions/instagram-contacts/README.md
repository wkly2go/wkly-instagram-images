# 인스타그램 대화 참여자 → 연락처 검토함

코드 및 모의 응답/로컬 DB 검증 단계입니다. 운영 함수 배포·서버 설정·Meta 권한·실제 응답·예약 실행은 아직 확인하지 않았습니다. 모든 팔로워나 인스타그램에 저장된 사람을 가져오는 기능이 아닙니다. 연결된 업무 계정에서 API로 조회 가능한 대화의 참여자를 후보로 저장합니다. 개인 계정/보관된 메모/연락처 전체에 접근할 수 있다고 표시하지 않습니다.

## 설치 순서

1. 최신 main의 `0117_growth_approval_context.sql`, `0118_instagram_contact_capture.sql`과 아래 읽기 전용 사전 점검을 비교합니다. 0117은 콘텐츠 승인 문맥 검증 보강, 0118은 인스타그램 후보·체크포인트 전용입니다. 설치 여부가 확인된 **0107/0113/0114/0115를 재실행하거나 전체 db push 하지 않습니다.** 0116을 포함한 다른 작업의 이력을 수정하지 않습니다. 새 두 파일도 설치 여부를 확인한 뒤 각각 한 번만 적용합니다. SQL Editor 수동 실행은 migration 이력 자동 등록을 뜻하지 않습니다.
2. `npm run build:instagram-dashboard`와 `node scripts/build-instagram-dashboard.mjs --check`로 단일 배포본을 확인합니다. `supabase/deploy/instagram-contacts-dashboard.ts` 전체를 **새 함수 `instagram-contacts`**의 index.ts에 배포합니다. 기존 gmail/growth-ai/meeting-minutes를 덮어쓰지 않습니다.
3. 이 함수는 활성 관리자 JWT를 내부에서 검증합니다. 관리자 수동 호출만 쓸 때는 JWT 검증을 ON으로 유지할 수 있습니다. 별도 예약 토큰을 쓸 때만 이 함수의 플랫폼 JWT 검증을 OFF로 설정하고 내부 인증을 유지합니다. 다른 함수의 JWT 설정을 변경하지 않습니다.
4. 아래 값을 Supabase 서버 Secrets에 입력합니다. 프론트엔드·코드·채팅에는 키를 넣지 않습니다.

| 서버 값 | 의미 |
|---|---|
| `WKLY_INSTAGRAM_DIVISION` | 수집 계정의 회사: 더위클리 `TW` 또는 아트리어 `AR`. 기존 수집 계정의 회사를 임의로 바꾸면 수집을 중단합니다. |
| `WKLY_META_PAGE_ID` | 업무용 Instagram 계정과 연결된 Facebook 페이지 ID |
| `WKLY_INSTAGRAM_ACCOUNT_ID` | 해당 Instagram professional 계정 ID. 페이지 ID와 다릅니다. |
| `WKLY_META_PAGE_TOKEN` | 해당 페이지 MESSAGING 권한을 가진 Page access token |
| `WKLY_META_API_VERSION` | 앱에서 사용 승인된 Graph API 버전(예: v27.0). 자동 업그레이드하지 않습니다. |
| `WKLY_INSTAGRAM_CONTACT_OWNER_ID` | 수집 후보를 검토할 활성 사람 팀원의 profiles UUID |
| `WKLY_INSTAGRAM_SYNC_TOKEN` | 예약 호출을 연결할 경우에만 설정하는 충분히 긴 별도 임의 토큰 |

Meta 앱 권한과 App Review/Advanced Access는 실제 업무 계정에서 확인해야 합니다. 개발자·테스터 계정에서 목록이 보이는 것만으로 일반 고객의 대화 접근 권한이 입증되지는 않습니다. 대화 본문·사진·연락처 이름·이메일을 추정하거나 가져오지 않습니다.

## 사용

연락처 검토함 → **인스타그램 담당자 후보 연결**을 엽니다. `연결 상태 다시 확인`은 서버 설정·DB 상태만 조회하며 Meta를 호출하지 않습니다. `서버 설정 있음`은 Meta 권한 검증 성공을 뜻하지 않습니다.

관리자의 `대화 후보 가져오기` 한 번은 페이지와 Instagram 계정 연결 확인 1회, 대화 목록 25개 조회 1회를 수행합니다. 성공 후 새 후보는 `검토` 상태입니다. 이름·브랜드·담당자 여부를 사람이 확인하고 기존 `확인 → 영업 연결` 흐름으로 이어갑니다. `다음 대화 후보 가져오기`로 다음 페이지를 처리합니다.

`POST {"action":"status"}`는 읽기 전용 상태, `POST {"action":"sync"}`는 한 페이지 저장입니다. 일반 팀원/비활성 계정은 실행할 수 없습니다. GET은405입니다. 회사 계정 외 대상 ID·주소를 요청 본문으로 지정할 수 없습니다.

## 예약 자동 수집 연결

예약 설치·실행은 이 변경에 포함되어 있지 않습니다. 실제 계정 첫 페이지 결과를 확인한 뒤 기존 예약과 중복이 없는지 확인하고, 서버 예약에서 위 POST sync를 호출하도록 설정할 수 있습니다. 인증은 `x-sync-token` 헤더로 보내며 토큰은 Vault 등 서버 비밀 저장소에서만 읽습니다. 한 번에 25개 대화이므로 빈도는 실제 건수·Meta 쿼터를 확인해 정합니다. 고정 cursor를 요청에 넣지 않습니다. 전체 순회가 끝나면 다음 예약은 최신 대화부터 시작하고 기존 후보는 다시 만들지 않습니다. 예약 성공은 함수 응답·저장된 후보까지 함께 확인해야 합니다.

## 실패·보존 규칙

- 후보 저장과 cursor 갱신은 한 DB 트랜잭션입니다. 잘못된 응답/권한 실패/저장 실패에는 cursor를 넘기지 않습니다.
- `(계정 ID, 참여자 ID)`로 중복을 막습니다. 계정명이 바뀌어도 이전 후보를 덮어쓰거나 재생성하지 않습니다. 이메일로 등록된 기존 후보도 동일 Instagram 계정명이면 재사용하며 제외 상태를 유지합니다.
- 동시 수집은 revision 비교로 한 작업만 저장합니다. 응답 유실 시 상태를 다시 읽은 뒤 남은 위치부터 계속합니다. 전체 원문을 서버나 브라우저에 보관하지 않습니다.
- 페이지 cursor 만료, 참여자 권한/필드 누락, 반복 cursor는 확인 오류입니다. 실패 ID나 cursor를 자동 폐기하지 않습니다. 운영 확인 없이 초기화하는 기능은 제공하지 않습니다.
- 외부 응답 링크는 따라가지 않습니다. 정해진 Graph host/경로만 사용하고 토큰은 Authorization 헤더에 둡니다. 대화 응답은 1MiB, 각 외부 요청은 12초 제한입니다.

## 검증

`node --experimental-strip-types --test tests/instagram-contacts.test.ts tests/instagram-dashboard.test.mjs tests/growth-db.test.mjs`, `npm run test:ui`, Deno check 원본/단일 배포본. 모의 Meta/인증, PGlite 및 jsdom 결과입니다. 운영 RLS·실제 계정 동기화·예약 실행의 증거가 아닙니다.

공식 근거(2026-11-13 확인): [Meta Conversations API collection](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a), [Conversation fields/permissions](https://developers.facebook.com/docs/graph-api/reference/conversation), [Page conversations edge](https://developers.facebook.com/docs/graph-api/reference/page/). 실제 응답 계약과 앱 승인 범위는 운영 계정 검증이 남아 있습니다.
