import type {SalesContactEvidence as Evidence} from '../lib/salesExecution'
import {safeWebUrl} from '../lib/growth'
import './SalesContactEvidence.css'

const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
export function SalesContactEvidence({report,prepared}:{report:Evidence;prepared:boolean}){
 return <section className="sales-contact-evidence" aria-label="대상별 영업 근거 보고서">
  <h4>왜 이 대상에게 제안하는가</h4>
  {report.proposal&&<><p><strong>제안 가설 · {report.proposal.title}</strong><br/>{report.proposal.offer}</p><p>예상 고객 · {report.proposal.customer}<br/>기획 이유 · {report.proposal.why_now}</p></>}
  <p>{prepared?'아래 근거를 자동 초안 준비에 반영했습니다. 사실·수신 자격의 최종 검증은 별도입니다.':'아래 근거가 현재 초안에 반영되었는지는 검증 전입니다. 최신 자료로 자동 재준비가 필요합니다.'}</p>
  <p>{report.scope}</p>
  <p>확인한 연락처 {report.contacts.length} / {report.contact_total}개 · 원문을 대신 검색하거나 가공할 필요 없이 아래 요약과 근거를 검토합니다.</p>
  {(report.contacts_truncated||report.mail_truncated)&&<p role="status">조회 상한으로 일부 자료만 포함했습니다. 이 보고서가 전체 연락처·메일 이력을 확인한 결과는 아닙니다.</p>}
  {!report.contacts.length&&<p>연결된 대상이 없습니다. 시스템의 대상 DB 확보가 필요합니다.</p>}
  <ol>{report.contacts.map(contact=><li key={contact.key}>
   <h5>{contact.companies.join(' / ')||'회사 미확인'} · {contact.email||'연락처 미확보'}</h5>
   <p>담당자 · {contact.people.join(' / ')||'미확인'}<br/>저장 출처 {contact.sources.length}건 · 조회 범위에서 주소가 일치한 메일 {contact.sampled_matches}건</p>
   {contact.mail[0]&&<p><strong>최근 저장 메일 · {contact.mail[0].subject||'제목 없음'}</strong><br/>{contact.mail[0].excerpt}</p>}
   <p><strong>판단 · {contact.assessment}</strong><br/>시스템 후속 처리 · {contact.next_action}</p>
   <details><summary>자동으로 모은 근거 보기 · 출처 {contact.sources.length}건 / 메일 {contact.mail.length}건</summary>
    <ul>{contact.sources.map(source=><li key={source.id}><strong>{source.name} · {source.origin}</strong><p>{source.excerpt||'저장된 근거 문구가 없습니다.'}</p>{source.url&&safeWebUrl(source.url)?<a href={source.url} target="_blank" rel="noreferrer">출처 원문 열기</a>:<span>연결할 공식 원문 주소 없음</span>}</li>)}</ul>
    <ul>{contact.mail.map(mail=><li key={mail.id}><strong>{mail.subject||'제목 없음'}</strong> · {time(mail.sent_at)}<p>{mail.address_match==='from'?'저장 발신 주소 일치':'저장 수신 주소 일치'} · {mail.excerpt}</p><small>자료 ID {mail.id} · 인덱스 저장 {time(mail.synced_at)}</small></li>)}</ul>
    {!contact.mail.length&&<p>조회 범위에서 주소가 정확히 일치하는 저장 메일을 찾지 못했습니다. 연락 이력이 전혀 없다는 뜻은 아닙니다.</p>}
   </details>
  </li>)}</ol>
  <p>메일 제목·미리보기와 주소 일치는 발신 진위, 구매 의향 또는 수신 허용의 증거로 확정하지 않습니다. 외부 연락 승인은 별도 검증이 끝나야 열립니다.</p>
 </section>
}
