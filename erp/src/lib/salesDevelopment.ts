// Versioned development evidence, not live worker telemetry or a time estimate.
export const developmentGates = ['구현', '로컬 검증', '운영 배포', '실제 흐름 검증'] as const
export type DevelopmentMilestone = {name:string; gates:readonly [boolean,boolean,boolean,boolean]; evidence:string}
export const salesDevelopmentCheckpoint = {
  targetPercent: 70,
  updatedAt: '2026-11-15T21:50:00Z',
  status: '수집·기획·대화형 승인 운영 중 · 메일 발송은 대표 지시로 보류',
  currentBatch: {completed:['네이버 뉴스로 팝업·매장 오픈·박람회 소식 자동 수집 (하루 2회)','보도에서 브랜드·행사 자동 추출 → 영업 대상 등록 (기사에 적힌 이름만 인정)','대화형 기획: 대화 안에서 승인·반려, 반려 사유로 자동 재기획','기획·대화 상위 모델 적용, 주간 AI 한도 15달러 · 자동 갱신','건설업 면허가 필요한 공사 공고 제외, 회사 보유 자격을 기획 지침에 반영','공개 페이지 읽기 운영 환경 수리, 승인 건 메일 전송 연결(스위치 꺼짐)','새로 보도된 브랜드를 기획의 우선 근거로 사용','브랜드 자체 사이트·공개 문의 창구 자동 확보 (네이버·카카오 무료 검색)','반려한 안 숨김 · 사유를 반영한 개선안','영업 방법 9종과 결정 학습으로 기획 구체화 (실명 대상 · 날짜 · 금액 근거)','팝업·행사 수요가 있는 곳만 대상으로 한정','영업 방법을 DB로 옮기고, 주 1회 AI가 승인·반려 결과를 검토해 방법 추가·수정·중지를 승인 카드로 제안','나라장터 공고마다 업종 제한·참가 가능 지역을 조회해 참여 가능·불가·확인 필요를 자동 판정 (규칙 판정 · AI 비용 없음)','제안서·연락 문안을 고객이 그대로 읽는 완성 문장으로 작성, 자리 표시·내부 메모·수신 거부 안내 누락을 자동 점검','보도된 브랜드의 공식 공개 문의 주소를 실행 묶음의 수신 후보로 연결 (개인정보·채용·자동 발신 주소 제외)','받은 메일 후보에서 서비스 자동 알림·우리에게 온 광고 메일을 영업 대상에서 제외','브랜드 자체 사이트 판정 강화: 사이트가 그 브랜드 이름으로 자신을 소개할 때만 인정, 매거진·블로그 주소 제외, 기존 결과 재확인','뉴스 검색어를 운영 성과로 조정: 성과 없는 3개를 브랜드 팝업·쇼룸 검색어로 교체','연락처 확보 강화: 같은 사이트 안 이동 따라가기·문의 페이지 읽기, 행사 참가 브랜드까지 확대, 나라장터 공고 담당자 연락처 저장'],remaining:['수신자 범위 규칙 확정 후 실제 발송·회신·후속 관리 검증','블로그·행사장 목록 등 수집 경로 확대','Instagram DM']},
  blocker: '메일 발송은 대표 지시로 꺼 두었습니다. 수신자 범위 규칙이 정해지기 전에는 실행 묶음이 승인 단계로 넘어가지 않습니다.',
  next: '국가 데이터로 법인 정보 보강(활용 신청 후) → 수신자 범위 규칙(대표 결정 후) → 브랜드 이름 중복 정리',
  source: 'https://github.com/wkly2go/wkly-instagram-images/pull/420',
  milestones: [
    {name:'다양한 영업 기획 자동 생성',gates:[true,true,true,true],evidence:'운영에서 자동·수동 기획안이 생성되어 승인 대기 목록에 표시됨. 2026-11-15 상위 모델과 사고 여유 적용.'},
    {name:'출처 보존·중복 제거·변경 이력',gates:[true,true,true,true],evidence:'운영에서 영업 대상 2,000여 건의 출처 변경 이력이 누적되는 것을 확인.'},
    {name:'AI 업무 대화·근거 보고서',gates:[true,true,true,true],evidence:'운영 계정에서 지시 → 보고서 완료 확인. 답이 중간에 잘려 실패하던 문제 수정. 대화 안 승인·반려 화면 반영.'},
    {name:'나라장터 공식 API 수집',gates:[true,true,true,true],evidence:'2026-11-16 운영 실행: 용역 검색어 8개 수집 완료, 공고 107건 저장, 참가 자격 판정(참여 가능 50 · 확인 필요 56 · 불가 1). 08시 자동 실행 경로는 다음 날 아침 확인 대상.'},
    {name:'행사 참여 기업·누락 연락처 자동 확보',gates:[true,true,true,true],evidence:'운영에서 뉴스 → 브랜드 등록 → 네이버·카카오 검색 → 자체 사이트와 공개 문의 창구 기록까지 확인(초기 8곳 중 5곳 사이트 확인). 서울시 행사 페이지 조사는 서버 응답이 없어 보류.'},
    {name:'기존 회사·사람 DB 연결',gates:[true,true,true,true],evidence:'운영 기획안의 대상이 기존 거래처·저장 연락처에 자동 연결된 것을 확인. 새 브랜드는 이름이 정확히 같은 거래처에만 연결.'},
    {name:'검토 자료·실행안 버전·승인 보호',gates:[true,true,true,true],evidence:'2026-11-16 운영 시험: 브랜드 근거 기획 → 검토 자료 준비 완료 → 실행 묶음 생성까지 자동으로 이어짐을 확인. 발송 전 차단 사유(연락처·발신 권한·수신 자격)가 묶음에 표시됨.'},
    {name:'승인 후 이메일 발송·중복 발송 방지',gates:[false,false,false,false],evidence:'대기열·중복 방지·전송 연결까지 운영에 올렸으나 발송 스위치는 대표 지시로 꺼 둠. 수신자 범위 규칙이 없어 구현 완료로 세지 않음.'},
    {name:'허용된 Instagram DM 발송',gates:[false,false,false,false],evidence:'계정 연결·대화 자격·발송 처리·실제 전달 검증 필요.'},
    {name:'회신·수신 거부·CRM 자동 갱신',gates:[false,false,false,false],evidence:'회신 감지·중단 차단·CRM 기록·후속안 준비를 운영에 올렸으나 발송이 없어 예약을 꺼 둠. 후속 발송 승인 연결 미완성.'},
    {name:'08시 수집·09시 실행 현황 보고',gates:[true,true,true,true],evidence:'운영에서 08시 수집과 09시 브리핑이 11/14 · 11/15 이틀 연속 정시 실행된 것을 확인.'},
    {name:'전체 흐름·장애 복구·3일 연속 운영',gates:[false,false,false,false],evidence:'수집→검증→승인→발송→회신→보고 통합 운영 검증 전.'},
  ] satisfies DevelopmentMilestone[],
}

export function developmentProgress(milestones:readonly DevelopmentMilestone[]){
  const total=milestones.length*developmentGates.length
  const byGate=developmentGates.map((_,index)=>milestones.filter(row=>row.gates[index]).length)
  const completed=byGate.reduce((sum,count)=>sum+count,0)
  const percent=total?Math.floor(completed/total*100):0
  return {total,completed,percent,remaining:100-percent,byGate}
}

export function developmentTarget(milestones:readonly DevelopmentMilestone[],target:number){
 if(!Number.isInteger(target)||target<0||target>100)throw new Error('Invalid development target')
 const progress=developmentProgress(milestones),required=Math.ceil(progress.total*target/100)
 return {required,remainingGates:Math.max(0,required-progress.completed),minimumPercent:progress.total?Math.floor(required/progress.total*100):0,reached:progress.completed>=required}
}
