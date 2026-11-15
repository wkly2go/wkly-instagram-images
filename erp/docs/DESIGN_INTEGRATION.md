# 설계·견적 통합 (인테리어 디자인 자동화 → 인트라넷)

2026-11-15 시작. 독립 프로그램(저장소 `arterior-design-auto`, DB `arterior-interior`)을 인트라넷(wkly-erp)에 합친다.

## 구조
- DB: 구역 `design` (마이그레이션 0125~0131). 로그인 · 사람 · 프로젝트 · 거래처는 인트라넷 것을 그대로 쓴다.
  `design.projects.id = public.projects.id`. 화면은 `public.design_*` 보기(부른 사람 권한 그대로)와 RPC
  `design_decide` · `design_request_job` · `design_file` · `design_po_lines_for_site` 만 쓴다.
- 권한: 팀원 = 수량 · 견적 · 공정 · 판매 단가 · 자재 · 학습 자료. 관리자만 = 실행 단가 · 실행 내역 · 발주서 · 검토 카드 결정.
- 작업 처리기(맥 · LaunchAgent `kr.arterior.designauto.worker`): `design.jobs` 를 보고 견적 계산(`estimate.build`) · 발주서 초안(`po.build`) ·
  스케치업 수량 받기를 한다. 접속 계정 `design_worker`(설계 구역 + 프로젝트/거래처 읽기만). 비밀번호는 맥의 `worker.env` 에만 있다.
- 금액 계산은 작업 처리기의 견적 엔진만 한다(화면은 계산하지 않는다 · 손익 화면의 합계는 보여 주기용 덧셈).
- 밖으로 보내는 기능은 없다. 발주서 · 견적서는 초안이며 사람이 내려받아 보낸다.

## 실제 자료로 맞춘 것
- 견적 합계 방식: 공사형(공과잡비 + 기업이윤 · 유니셈 내역서) / 행사 · 렌탈형(대행 수수료 뒤 절삭 · 나름대로 팝업 견적서 2026-10-27).
  시험: `AR2609-03` 직접비 13,840,000 → 수수료 10% → 공급가액 15,000,000 (실제 견적서와 일치).
- 제출용 견적서(16:9): 표지 → 견적 개요(사업 개요 · 견적 구분 · 참고 사항 · 대금지불조건) → 구분별 내역 → 합계.
- 실행 내역: 구역 | 품목 | 수량 | 단가 | 업체 | 비고 엑셀 → 업체별 발주서 초안. '구매 (쿠팡)' 등 직접 구매와 업체 빈 줄은 제외.

## Project workspace (2026-11-15, references: Houzz Pro · Programa · Coohom — see the plan doc tab 'UI·UX 리서치')
- `/design` = stage bar (현장 실측 → 평면·3D → 수량표 → 견적 → 도면 → 공정, + 실행·발주 for admin) with per-stage status and a right panel (next action · pending review · warnings · basis).
- 평면·3D: `components/DesignPlan.tsx` (SVG plan editor) + `DesignPlan3D.tsx` (three.js, lazy) + `lib/designPlan.ts` (geometry, quantities; tests `tests/design-plan.test.ts`).
  Saved in `design.spaces` (version 0 = working copy). RPC `design_apply_plan` (0132) creates a new model version like the SketchUp import.
- 도면: `components/DesignDrawings.tsx` + `lib/designDrawings.ts` (sheet list per learned standard, scale pick, DXF R12; tests `tests/design-drawings.test.ts`). A3 print via browser, DXF download. Detail sheets (ID/IF) and DWG are still done in CAD.
- Local screen check without mock data in the repo: keep an untracked fixture (`src/lib/_designFixture.ts`, git-excluded) and wrap `createDemoDesignApi()` temporarily.

## 되돌리기
`drop schema design cascade; drop function public.design_po_lines_for_site(uuid), public.design_decide(uuid, boolean, text),
public.design_request_job(uuid, text), public.design_file(uuid); drop owned by design_worker; drop role design_worker;`

## 남은 일
- main 합치기(대표 승인 뒤) · 회사 결재(public.approvals) 연결 · 공정 → 구글 캘린더 · 도면 세트 · 스펙북 · 제안서 · 설계 보고서 · 납품 묶음
- 드라이브 사본: 맥의 백그라운드 프로그램에 드라이브 폴더 접근 권한이 없어 꺼져 있음(권한을 주면 프로젝트 폴더 `05.견적서/자동 견적` 에 사본)
- 나라장터 협력사 후보 함수 · 캘린더 주소를 인트라넷 서버로 옮기기, 그 뒤 `arterior-interior` 삭제(대표가 직접)

## 2026-11-15 보강 (PR #402~#411)
- 제안서: 아트리어 제안서 디자인 시스템 적용(표지 · 본문 · 맺음), 인사이트 인용 칸(0137 `proposal_sections.quotes`), 확정 투시도 슬라이드.
- 평면 · 3D: 벽 마감 · 벽체 유형(W1~W30) · 문 정보(높이 · 위치 · 종류 · 마감) · 실별 마감(재료 번호 · 상세 유형 · 면적 · 걸레받이 길이) — 모두 평면 자료(jsonb) 안에 저장. 투시도 장면 모음(0136 `design.renders`).
- 도면 세트: 재료마감범례표(I-006) · 실내재료마감표(I-008, 표본 양식) · 마감 수량표 · 입면도(치수 · 키 플랜 · 마감) · 바닥 상세(ID-100) · 걸레받이 상세(ID-104~) · 벽체 상세(ID-200) · 도어 리스트(ID-400) · 가구 상세(IF-700) · DXF(평면 + 입면 + 가구).
- 스펙북: 상세 칸 6개(0134) · 샘플 사진(0135 `design.spec_images`) · 조명 수량표 · 인쇄는 CODE LIST + SPEC 카드.
- 수량: 벽 마감 면적 · 실별 바닥/천장/걸레받이 · 조명 수량이 '이 평면의 수량'으로 들어감(공종은 재료 번호 앞 글자 `finishTrade`).
- 학습 자료(design.knowledge) 추가: 벽체 유형 · 바닥/걸레받이 유형 · 마감표 양식 · 천장/도어/가구 상세 구성 · 스펙북 양식. 유형 목록 코드는 `src/lib/designWallTypes.ts`.
- 미검증: 실제 로그인 화면에서 저장 · 인쇄, 캐드 DXF 열기, 피그마 SVG 가져오기. 추가(PR #413): 천장 유형 C1~C5(자체 기호 · 표본 부재 표기) → 천장 상세(ID-300), 제안서 인용을 인트라넷 리서치 자료에서 고르기. 모델 버전 이력(읽기) · 협력사 찾기/공종 거르기(PR #414). 없는 것: 스케치업 모델 파일 보관, DWG 저장, 투시도 원본 큰 그림.

## 2026-11-15 예전 프로젝트(arterior-interior) 정리 준비
- 나라장터 협력사 후보 검색을 인트라넷으로 옮김: 함수 `g2b-vendors`(1회용 토큰 확인 · JWT 검증 끔 · 원본과 같음) + 0138(`private.design_fn_run_tokens` · `public.design_run_token_use` · `private.design_run_g2b_vendors` · 예약 `design_g2b_vendors_weekly` 월요일 01:40 UTC). 시험 호출(dry) 정상 — 인증키 있음, 나라장터 응답 코드 00.
- 자료 대조(예전 → 인트라넷): 거래 협력사 36곳 이름 일치 · 후보 116 = 116 · 자재 126 = 126 · 표본 83 = 83 · 추출 83 = 83 · 학습 자료 9 ⊂ 14. 차이는 모두 의도한 것: '(예시)' 협력사 5곳 · 예시 프로젝트의 견적 · 발주 · 결재, 예시 단가 42 · 원가 14 는 옮기지 않음(대표 지시 '목업 삭제').
- 예전 프로젝트에 남은 것: 예시 프로젝트 1건과 그 견적 · 발주, 함수 g2b-vendors · schedule-feed(구독 주소 발급 0건), 저장 파일 0개, 계정 1개. 삭제는 대표가 직접.
