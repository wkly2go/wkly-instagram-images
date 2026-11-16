import type { SeoCheck } from './types'
/** 항목 이름 · 종류에 맞는 개선 방향 한 줄 */
export function seoAction(c:{kind:SeoCheck['kind'];item:string}){
 const item=c.item.toLowerCase()
 return /색인|robots|크롤|noindex/.test(item)?'공개 랜딩의 접근·색인 차단과 canonical을 확인합니다. 로그인·개인정보 페이지의 보호 설정은 유지합니다.':/속도|lcp|vitals|모바일/.test(item)?'모바일 실측에서 큰 이미지·지연 스크립트·레이아웃 이동을 확인하고 변경 전후 같은 조건으로 재측정합니다.':/제목|설명|키워드/.test(item)?'서비스·지역·고객 의도가 제목과 본문에서 일치하도록 검토용 초안을 만듭니다.':c.kind==='AEO'?'고객 질문에 직접 답하는 요약과 실제 제공 조건·문의 경로를 보강합니다.':c.kind==='GEO'?'공식 회사 정보·검증 가능한 실적·원문 출처·갱신일을 정리하고 실제 AI 답변의 인용 여부를 별도 확인합니다.':'현재 원문 근거와 목표를 대조해 한 항목씩 수정하고 재측정합니다.'
}
export function seoRecommendations(checks:SeoCheck[],today:string){
 const current=Date.parse(today+'T00:00:00Z'), latest=new Map<string,SeoCheck>()
 for(const c of checks){const key=c.kind+':'+c.item,old=latest.get(key);if(!old||c.checked_on>old.checked_on||(c.checked_on===old.checked_on&&c.updated_at>old.updated_at))latest.set(key,c)}
 return [...latest.values()].flatMap(c=>{
  const date=Date.parse(c.checked_on+'T00:00:00Z'),age=(current-date)/86400000
  let sourced=false;try{const u=new URL(c.source??'');sourced=['https:','http:'].includes(u.protocol)&&!u.username&&!u.password}catch{}
  if(!Number.isFinite(age)||age<0||age>14||!sourced||c.status==='미측정')return [{...c,priority:2,reason:'최근 측정·원문 근거 확인 필요',action:'공개 페이지의 실제 측정 결과·원문 URL·측정일을 다시 기록한 뒤 개선 여부를 판단합니다.'}]
  if(c.status==='양호')return []
  const action=seoAction(c)
  return [{...c,priority:c.status==='미흡'?0:1,reason:c.status+' · '+c.checked_on+' 측정',action}]
 }).sort((a,b)=>a.priority-b.priority||a.item.localeCompare(b.item,'ko')).slice(0,8)
}
