# 영업·수주 API 자료 조회

영업·수주 → API 자료 조회에서 외부 공고와 입지 자료를 한 출처씩 확인한다. 기업마당 지원사업, 나라장터 사전규격·발주계획, 음식점 인허가 자료는 영업 기회 작성 화면으로 가져올 수 있다. 작성 화면에서 담당자·다음 행동·원문을 검토한 뒤 저장한다. 검색 및 설정 확인은 DB에 쓰지 않는다. 본공고 조회는 기존 나라장터 공고 탭을 사용한다.

### 운영 적용

1. 운영 프로젝트의 Edge Functions에 `sales-api`를 만든다. 대시보드 편집기에서 [단일 배포 파일](../../deploy/sales-api-dashboard.ts)을 전체 붙여넣고 JWT 검증을 켠 상태로 배포한다. CLI 사용 시 프로젝트를 확인한 뒤 `supabase functions deploy sales-api --project-ref hophgcpszenrvchvbkav`를 실행한다.
2. API 자료 조회가 포함된 웹 변경을 배포한다. DB 마이그레이션은 필요 없다.
3. 운영 인트라넷에 로그인하고 `/sales?tab=lookup`을 연다. **API 키 등록 목록**에서 이름별 값 존재 여부를 확인한다. **조회** 버튼을 눌러 각 키로 선택한 API 응답을 확인한다. 값 등록 상태와 실조회 결과는 다르다.
4. 서울 문화행사·상권 인구는 각각 공개 샘플만 표시한다. 공식 문서의 HTTP 주소로 운영 키를 전달하지 않는다. 네이버와 유튜브는 키 등록 상태를 확인할 수 있으며, 계정 유형·이용 허용 범위 확인 후 별도로 연동한다. Anthropic은 기존 기능이 사용한다.

서버의 고정 출처에만 단건 요청을 보내며 응답의 선정된 공개 필드를 반환한다. 출처 에러에는 요청 주소·인증키를 포함하지 않는다. 기업마당 키워드는 현재 페이지에 적용된다. 계약과정은 공고번호 기준, 건축 자료는 주소의 시군구·법정동·지번 기준이다.

### 개발 확인

```sh
node scripts/build-sales-api-dashboard.mjs
node scripts/build-sales-api-dashboard.mjs --check
deno check supabase/functions/sales-api/index.ts
npm run test:all
npm run test:ui
npm run build
```
