# 나라장터 공고 조회 — 배포 준비

공식 요청 명세: <https://www.data.go.kr/data/15129394/openapi.do>, 2026-11-12 확인. 2026-11-10 변경된 `BidPublicInfoService02`의 용역/공사 검색과 최대 7일 조회 기간을 사용합니다. 이 함수는 조회 결과만 반환하며 DB 저장·입찰 제출·영업 발송을 하지 않습니다.

필요한 환경값은 Supabase 기본 `SUPABASE_URL`, `SUPABASE_ANON_KEY`와 공공데이터포털 해당 서비스 활용 승인을 받은 **Decoding** 키 `DATA_GO_KR_SERVICE_KEY`입니다. 키를 프론트엔드·소스·채팅에 넣지 않습니다. service_role 키는 쓰지 않습니다. 함수 배포와 실제 승인된 계정 응답 확인이 별도로 필요합니다. 기존 SQL 재실행이나 새 DB 설치는 필요하지 않습니다.

인증한 활성 팀원만 호출할 수 있습니다. 요청은 `POST {category:"service"|"construction",startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",keyword:"",page:1}`입니다. 한 요청은 공식 API 한 번, 30건, 12초, 응답 2 MiB로 제한합니다. 날짜는 한국시간 00:00~23:59, 시작일·종료일 포함 최대7일이며 페이지는1~20입니다. 같은 실행 인스턴스에서 같은 팀원의 2초 이내 연속 호출을 막지만 조직 전체 쿼터를 보장하는 방식은 아닙니다. 예약 수집·자동 재시도는 없습니다.

응답 `items`에는 `title,number,round,agency,deadline,amount,source_url,notice_date,warnings`를 반환합니다. 결과를 기존 공고 작성 화면으로 가져온 뒤 원문·마감·조건을 검토하고 저장합니다. 참가자격 판단은 항상 별도 검토입니다. 누락/맞지 않는 필드는 경고 또는 제외하며 `omitted`를 표시합니다. `hasMore`가 있으면 다음 페이지, `limited`가 있으면 날짜·검색어를 좁혀 조회합니다. 원문 링크는 공식 `g2b.go.kr` 도메인만 허용합니다.

페이지 조회가 실패하면 마지막 성공 결과를 유지합니다. `실패한 공고 페이지 다시 조회`를 눌러 같은 조건·실패한 페이지로 수동 재시도합니다. 조건을 바꾸면 기존 결과와 재시도 대상이 초기화되며 조회 중에는 후보 선택·조건 변경·닫기가 차단됩니다.

**검증 한계:** 공식 요청 경로와 입력 명세는 확인했으나 실제 계정 응답·상세 참고문서의 최신 응답 필드 대조는 아직 수행하지 않았습니다. `bidNtceNo/bidNtceOrd/bidNtceNm/dminsttNm/ntceInsttNm/bidClseDt/presmptPrce/bidNtceDtlUrl/bidNtceDt` 매핑은 엄격한 형식 검사와 모의 응답 테스트로 준비한 상태입니다. 실제 연동 완료·자동 수집 운영으로 표시하지 않습니다. 공공데이터포털 형식이 다르면 빈 목록으로 성공 처리하지 않고 확인 오류를 반환합니다.

대시보드용 단일 배포 파일은 `node scripts/build-g2b-dashboard.mjs`로 생성하고 `node scripts/build-g2b-dashboard.mjs --check`로 원본 일치를 확인합니다. `supabase/deploy/g2b-search-dashboard.ts` 전체를 함수 `g2b-search`의 `index.ts`에 넣는 방식입니다. JWT 검증을 유지하고 키는 기존 Secrets 화면에서 서버 값으로 관리합니다. 다른 함수·기존 편집 파일을 덮어쓰지 않으며 실제 배포는 별도입니다.

검증: `node --experimental-strip-types --test tests/g2b-handler.test.ts tests/g2b-dashboard.test.mjs tests/tender-search.test.mjs` (erp 폴더). 테스트는 모의 인증·응답만 사용하며 운영 API·DB·AI를 호출하지 않습니다. 테스트 통과는 Edge 배포 성공이나 실제 공고 수집 성공을 뜻하지 않습니다.
