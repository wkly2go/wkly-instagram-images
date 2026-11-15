import type {SalesCrmReport as Report} from '../lib/salesExecution'
const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const signals={reply:'대화 참조 일치',stop:'연락 중단 표현 감지',limited:'원문 일부 확보'}
export function SalesCrmReport({report}:{report:Report}){
 return <section aria-label="자동 CRM 활동 기록" className="sales-crm-report">
  <h4>자동 CRM 활동 기록</h4><p>{report.scope}</p>
  {report.threads.length?<div className="sales-strategy-scroll"><table><caption>이 기획의 접수·회신·연락 중단 기록 · 최대 100개 대화</caption><thead><tr><th>연락 대상</th><th>진행 상태</th><th>시스템 후속 처리·근거</th></tr></thead><tbody>{report.threads.map(row=><tr key={row.dispatch_id}>
   <td>{row.recipient}<small>제공사 접수 · {time(row.created_at)}</small></td>
   <td><strong>{row.stage}</strong><small>저장 회신 {row.reply_count}건</small><small>최근 점검 · {row.checked_at?time(row.checked_at):'자동 조회 대기'}</small></td>
   <td><p>{row.next_action}</p><p>{row.read_note}</p>{row.replies.map(reply=><details key={reply.message_id}><summary>{signals[reply.signal]} · {time(reply.received_at)}</summary><p className="sales-strategy-message">{reply.text}</p><small>자동 대조한 원문입니다. 구매 의향이나 계약 확정으로 간주하지 않습니다.</small></details>)}</td>
  </tr>)}</tbody></table></div>:<p>제공사 접수가 확인된 연락이 없습니다. 준비 중인 제안서는 CRM 접촉 실적에 포함하지 않습니다.</p>}
 </section>
}
