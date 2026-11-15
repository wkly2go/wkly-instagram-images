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

## 되돌리기
`drop schema design cascade; drop function public.design_po_lines_for_site(uuid), public.design_decide(uuid, boolean, text),
public.design_request_job(uuid, text), public.design_file(uuid); drop owned by design_worker; drop role design_worker;`

## 남은 일
- main 합치기(대표 승인 뒤) · 회사 결재(public.approvals) 연결 · 공정 → 구글 캘린더 · 도면 세트 · 스펙북 · 제안서 · 설계 보고서 · 납품 묶음
- 드라이브 사본: 맥의 백그라운드 프로그램에 드라이브 폴더 접근 권한이 없어 꺼져 있음(권한을 주면 프로젝트 폴더 `05.견적서/자동 견적` 에 사본)
- 나라장터 협력사 후보 함수 · 캘린더 주소를 인트라넷 서버로 옮기기, 그 뒤 `arterior-interior` 삭제(대표가 직접)
