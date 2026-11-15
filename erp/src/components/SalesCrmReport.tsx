import {safeWebUrl} from '../lib/growth'
import type {SalesCrmReport as Report} from '../lib/salesExecution'
const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const followupStates={waiting:'자동 준비 대기',queued:'처리 대기',claimed:'AI 작성 중',done:'초안 준비',failed:'시스템 복구 대상',stale:'새 근거로 재준비 대상'}
const actions={prepare_reply:'후속 문안 초안',research:'추가 자동 조사 필요',hold:'접촉 보류 제안'}
const signals={reply:'대화 참조 일치',stop:'연락 중단 표현 감지',limited:'원문 일부 확보'}
const researchStates:Record<string,string>={complete:'제한 범위 조회 완료',partial:'일부 자료 확보',blocked:'사이트 접근 제한',unavailable:'자료 확보 대기',queued:'조회 대기',claimed:'자동 조회 중',expired:'재조회 대상',waiting:'필요 시 자동 조사'}
const pageStates={read:'원문 확보',blocked:'접근 제한',failed:'조회 실패'}
function Source({url}:{url:string}){const safe=safeWebUrl(url);return safe?<a href={url} target="_blank" rel="noopener noreferrer">조사 출처 열기</a>:<span>출처 주소 확인 필요</span>}
export function SalesCrmReport({report}:{report:Report}){
 return <section aria-label="자동 CRM 활동 기록" className="sales-crm-report">
  <h4>자동 CRM 활동 기록</h4><p>{report.scope}</p>
  {report.threads.length?<div className="sales-strategy-scroll"><table><caption>이 기획의 접수·회신·연락 중단 기록 · 최대 100개 대화</caption><thead><tr><th>연락 대상</th><th>진행 상태</th><th>시스템 후속 처리·근거</th></tr></thead><tbody>{report.threads.map(row=><tr key={row.dispatch_id}>
   <td>{row.recipient}<small>제공사 접수 · {time(row.created_at)}</small></td>
   <td><strong>{row.stage}</strong><small>저장 회신 {row.reply_count}건</small><small>최근 점검 · {row.checked_at?time(row.checked_at):'자동 조회 대기'}</small></td>
   <td>{row.pipeline_note&&<p><strong>영업 파이프라인 · {row.pipeline_stage||'연결 검증 중'}</strong><br/>{row.pipeline_note}</p>}<p>{row.next_action}</p><p>{row.read_note}</p>{row.replies.map(reply=><details key={reply.message_id}><summary>{signals[reply.signal]} · {time(reply.received_at)}</summary><p className="sales-strategy-message">{reply.text}</p><small>자동 대조한 원문입니다. 구매 의향이나 계약 확정으로 간주하지 않습니다.</small></details>)}{row.research&&<details><summary>자동 추가 조사 · {researchStates[row.research.state]||'상태 확인 중'}</summary><p>{row.research.note}</p><small>최근 24시간 조회 {row.research.attempts}/2회 · 마지막 처리 {row.research.checked_at?time(row.research.checked_at):'대기'}</small><ul>{row.research.pages.map((page,i)=><li key={i}><b>{pageStates[page.status]}</b> · <Source url={page.url}/>{page.excerpt&&<blockquote className="sales-strategy-message">{page.excerpt}</blockquote>}</li>)}</ul><small>공개 자료 일부입니다. 회사 소유·예산·구매 의향·발송 자격을 확정하지 않습니다.</small></details>}{row.followup&&<details><summary>후속 영업안 · {followupStates[row.followup.state]}</summary><p>{row.followup.note}</p>{row.followup.error&&<p role="status">{row.followup.error}</p>}{row.followup.plan&&<>
    <strong>{actions[row.followup.plan.action]}</strong><p>{row.followup.plan.summary}</p><ul>{row.followup.plan.evidence.map((e,i)=><li key={i}><blockquote>{e.quote}</blockquote><p>{e.meaning}</p></li>)}</ul>
    <ul>{row.followup.plan.research_evidence?.map((e,i)=><li key={i}><Source url={e.url}/><blockquote>{e.quote}</blockquote></li>)}</ul>
    <p><b>시스템 다음 작업</b> · {row.followup.plan.next_action}</p>{!!row.followup.plan.missing.length&&<ul>{row.followup.plan.missing.map((m,i)=><li key={i}>미확인 · {m}</li>)}</ul>}
    {row.followup.plan.draft&&<><strong>{row.followup.plan.draft.subject}</strong><p className="sales-strategy-message">{row.followup.plan.draft.body}</p><small>검토용 초안 · 발송 승인 및 전송 미실행</small></>}
   </>}</details>}</td>
  </tr>)}</tbody></table></div>:<p>제공사 접수가 확인된 연락이 없습니다. 준비 중인 제안서는 CRM 접촉 실적에 포함하지 않습니다.</p>}
 </section>
}
