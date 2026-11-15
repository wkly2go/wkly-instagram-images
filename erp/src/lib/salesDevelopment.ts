// Versioned development evidence, not live worker telemetry or a time estimate.
export const developmentGates = ['구현', '로컬 검증', '운영 배포', '실제 흐름 검증'] as const
export type DevelopmentMilestone = {name:string; gates:readonly [boolean,boolean,boolean,boolean]; evidence:string}
export const salesDevelopmentCheckpoint = {
  targetPercent: 40,
  updatedAt: '2026-11-15T06:22:09Z',
  status: '40% 목표 · 독립 개발 기록 · 운영 보류',
  blocker: 'Claude 배포와 겹치지 않도록 운영 반영 보류. 이번 영업 DB·서버 변경은 운영 미적용입니다.',
  next: '수신 목적 검증·후속 실행안·CRM 파이프라인 연결 개발 → 배포 차례 확정 후 운영 검증',
  source: 'https://github.com/wkly2go/wkly-instagram-images/pull/399',
  milestones: [
    {name:'다양한 영업 기획 자동 생성',gates:[true,true,true,false],evidence:'기존 기획 운영 반영 기록: PR #397. 실제 계정 전체 흐름 재검증 필요.'},
    {name:'출처 보존·중복 제거·변경 이력',gates:[true,true,false,false],evidence:'출처 DB 검증 5개 통과. 새 DB 변경 운영 미적용.'},
    {name:'AI 업무 대화·근거 보고서',gates:[true,true,false,false],evidence:'대화 DB·처리기·화면 검증 통과. 운영 서버·계정 확인 대기.'},
    {name:'나라장터 공식 API 수집',gates:[true,true,false,false],evidence:'수집 DB 검증 8개 통과. 실제 제공 API 호출과 운영 수집 미검증.'},
    {name:'행사 참여 기업·누락 연락처 자동 확보',gates:[false,false,false,false],evidence:'저장 사이트의 연락 후보 자동 탐색·근거·분류 구현/검증. 미등록 도메인 발굴·회사 소유 판정은 미완성. 사람에게 검색 업무를 넘기지 않음.'},
    {name:'기존 회사·사람 DB 연결',gates:[true,true,false,false],evidence:'기존 식별자·구조화된 연락처 연결 검증. 새로운 대상의 발송 적격성은 별도 검증 필요.'},
    {name:'검토 자료·실행안 버전·승인 보호',gates:[true,true,false,false],evidence:'사전 준비·실행안·연락 근거 DB 검증 통과. 저장 이력·메일 원문 자동 확보와 변경 시 재준비 1회 구현. 진위·요청 의사 판정 미완료. 발송 연결 전 승인은 차단.'},
    {name:'승인 후 이메일 발송·중복 발송 방지',gates:[false,false,false,false],evidence:'승인 대기열·중복 방지·발신 계정 권한 진단·대상별 누락 점검 구현/검증. Gmail 전송 어댑터 로컬 검증 추가. 수신 목적별 근거와 운영 전송 연결은 미완료.'},
    {name:'허용된 Instagram DM 발송',gates:[false,false,false,false],evidence:'계정 연결·대화 자격·발송 처리·실제 전달 검증 필요.'},
    {name:'회신·수신 거부·CRM 자동 갱신',gates:[false,false,false,false],evidence:'제공사 접수→동일 대화 회신→중단 감지·차단→CRM 기록·브리핑 로컬 구현/검증. 전체 파이프라인 연결·후속 실행안 자동 준비는 미완성.'},
    {name:'08시 수집·09시 실행 현황 보고',gates:[true,true,false,false],evidence:'실행안 준비와 발송을 구분한 집계 검증 통과. 새 집계의 운영 반영·정시 실행 검증 대기.'},
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
