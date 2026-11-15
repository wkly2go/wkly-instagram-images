import type {SalesContactDiscovery as Report} from '../lib/salesExecution'
import {safeWebUrl} from '../lib/growth'
const roles={partnership:'제휴·사업 관련 문구 발견',general:'일반 연락 후보',non_sales:'채용·개인정보 등 비영업 창구'}
export function SalesContactDiscovery({report}:{report:Report}){
 return <section className="sales-contact-evidence" aria-label="자동 탐색한 회사 연락 창구">
  <h4>자동 탐색한 회사 연락 창구</h4><p>{report.scope}</p>
  <p>회사 {report.companies.length}/{report.total}개 · 원문 검색·연락처 정리는 시스템이 처리합니다.</p>
  {!report.companies.length&&<p>연결된 회사가 없습니다. 시스템의 회사 식별·도메인 확보가 필요합니다.</p>}
  <ol>{report.companies.map(company=><li key={company.id}>
   <h5>{company.company}</h5><p>{company.note}<br/>최근 24시간 자동 시도 {company.attempts}/2회 · {company.checked_at?new Date(company.checked_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'확보 결과 없음'}</p>
   {company.website&&safeWebUrl(company.website)&&<a href={company.website} target="_blank" rel="noreferrer">DB에 저장된 회사 사이트 · 소유 검증 전</a>}
   {company.limited&&<p>조회 상한에 도달해 일부 페이지만 확인했습니다.</p>}
   <ul>{company.candidates.map(candidate=><li key={candidate.email}>
    <strong>{candidate.email}</strong> · {candidate.excluded?'수신 거부 · 연락 제외':roles[candidate.role]}<p>{candidate.excerpt}</p>
    <p>{candidate.domain_match?'사이트와 이메일 도메인 일치':'사이트와 이메일 도메인 불일치'} · 회사 소유·담당 역할·제안 목적 자동 대조 필요</p>
    {safeWebUrl(candidate.url)&&<a href={candidate.url} target="_blank" rel="noreferrer">후보가 발견된 페이지</a>}
   </li>)}</ul>
   {!company.candidates.length&&<p>{company.state==='done'?'확인한 범위에서 이메일 후보를 확보하지 못했습니다. 다른 공식 출처의 자동 탐색이 필요합니다.':'아직 확보된 이메일 후보가 없습니다.'}</p>}
  </li>)}</ol>
  <p>후보를 기존 회사·사람 연락처에 확정 등록하거나 발송 대상으로 사용하려면 별도 검증이 필요합니다. 웹사이트 공개 주소만으로 수신 허용을 판단하지 않습니다.</p>
 </section>
}
