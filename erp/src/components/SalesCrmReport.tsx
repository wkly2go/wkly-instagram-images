import type {SalesCrmReport as Report} from '../lib/salesExecution'
const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const followupStates={waiting:'자동 준비 대기',queued:'처리 대기',claimed:'AI 작성 중',done:'초안 준비',failed:'시스템 복구 대상',stale:'새 근거로 재준비 대상'}
const actions={prepare_reply:'후속 문안 초안',research:'추가 자동 조사 필요',hold:'접촉 보류 제안'}
const signals={reply:'대화 참조 일치',stop:'연락 중단 표현 감지',limited:'원문 일부 확보'}
export function SalesCrmReport({report}:{report:Report}){
 return <section aria-label="자동 CRM 활동 기록" className="sales-crm-report">
  <h4>자동 CRM 활동 기록</h4><p>{report.scope}</p>
  {report.threads.length?<div className="sales-strategy-scroll"><table><caption>이 기획의 접수·회신·연락 중단 기록 · 최대 100개 대화</caption><thead><tr><th>연락 대상</th><th>진행 상태</th><th>시스템 후속 처리·근거</th></tr></thead><tbody>{report.threads.map(row=><tr key={row.dispatch_id}>
   <td>{row.recipient}<small>제공사 접수 · {time(row.created_at)}</small></td>
   <td><strong>{row.stage}</strong><small>저장 회신 {row.reply_count}건</small><small>최근 점검 · {row.checked_at?time(row.checked_at):'자동 조회 대기'}</small></td>
   <td>{row.pipeline_note&&<p><strong>영업 파이프라인 · {row.pipeline_stage||'연결 검증 중'}</strong><br/>{row.pipeline_note}</p>}<p>{row.next_action}</p><p>{row.read_note}</p>{row.replies.map(reply=><details key={reply.message_id}><summary>{signals[reply.signal]} · {time(reply.received_at)}</summary><p className="sales-strategy-message">{reply.text}</p><small>자동 대조한 원문입니다. 구매 의향이나 계약 확정으로 간주하지 않습니다.</small></details>)}{row.followup&&<details><summary>후속 영업안 · {followupStates[row.followup.state]}</summary><p>{row.followup.note}</p>{row.followup.error&&<p role="status">{row.followup.error}</p>}{row.followup.plan&&<>
    <strong>{actions[row.followup.plan.action]}</strong><p>{row.followup.plan.summary}</p><ul>{row.followup.plan.evidence.map((e,i)=><li key={i}><blockquote>{e.quote}</blockquote><p>{e.meaning}</p></li>)}</ul>
    <p><b>시스템 다음 작업</b> · {row.followup.plan.next_action}</p>{!!row.followup.plan.missing.length&&<ul>{row.followup.plan.missing.map((m,i)=><li key={i}>미확인 · {m}</li>)}</ul>}
    {row.followup.plan.draft&&<><strong>{row.followup.plan.draft.subject}</strong><p className="sales-strategy-message">{row.followup.plan.draft.body}</p><small>검토용 초안 · 발송 승인 및 전송 미실행</small></>}
   </>}</details>}</td>
  </tr>)}</tbody></table></div>:<p>제공사 접수가 확인된 연락이 없습니다. 준비 중인 제안서는 CRM 접촉 실적에 포함하지 않습니다.</p>}
 </section>
}
