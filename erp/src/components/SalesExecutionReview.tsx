import {useEffect,useRef,useState} from 'react'
import {useAsync} from '../lib/app'
import type {SalesExecutionApi} from '../lib/salesExecution'
import {Button} from './ui'
import {SalesContactEvidence} from './SalesContactEvidence'
import {SalesCrmReport} from './SalesCrmReport'
import {SalesContactDiscovery} from './SalesContactDiscovery'

const time=(v:string)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const dispatchLabels={queued:'발송 대기',claimed:'처리 중',accepted:'제공사 접수',rejected:'미접수',unknown:'결과 확인 필요',cancelled:'취소',expired:'일정 만료'}
const senderLabels={unverified:'자동 점검 대기',checking:'자동 점검 중',stale:'재점검 필요',ready:'계정 발송 권한 확인',read_only:'발송 권한 없음',scope_unknown:'허용 권한 확인 필요',identity_unverified:'발신 계정 확인 필요',account_mismatch:'지정 발신 계정 불일치',not_connected:'회사 계정 연결 필요',provider_error:'제공사 연결 재확인 필요'}
const recipientLabels={excluded:'접촉 제외',missing_contact:'연락처 보완',ambiguous_company:'회사 관계 대조',identity_unverified:'실명 관계 확인',permission_unverified:'수신 목적·근거 확인'}
export function SalesExecutionReview({api,strategyId,revision,canDecide}:{api:SalesExecutionApi;strategyId:string;revision:number;canDecide:boolean}){
 const state=useAsync(()=>api.getSalesExecution(strategyId),[strategyId,revision],null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),p=state.data
 const attempted=useRef<string|null>(null)
 const checkSender=async()=>{
  if(!api.refreshSalesSender||busy)return;setBusy(true);setError('')
  try{await api.refreshSalesSender();state.reload()}catch(e){setError(e instanceof Error?e.message:'발신 계정을 점검하지 못했습니다.');state.reload()}finally{setBusy(false)}
 }
 useEffect(()=>{
  if(!canDecide||state.loading||state.error||!api.refreshSalesSender||attempted.current===strategyId||!p?.readiness||!['unverified','stale'].includes(p.readiness.sender.code))return
  attempted.current=strategyId;void checkSender()
 },[strategyId,canDecide,state.loading,state.error,p?.readiness?.sender.code])
 useEffect(()=>{if(p?.readiness?.sender.code!=='checking'||state.loading||state.error)return;const timer=window.setTimeout(state.reload,3000);return()=>window.clearTimeout(timer)},[p?.readiness?.sender.code,state.loading,state.error,state.reload])
 const decide=async(decision:'승인'|'보류')=>{
  if(!p||busy)return;setBusy(true);setError('')
  try{await api.decideSalesExecution(p.id,p.version,p.fingerprint,decision);state.reload()}
  catch(e){setError(e instanceof Error?e.message:'결정을 저장하지 못했습니다.');state.reload()}
  finally{setBusy(false)}
 }
 const download=(file:{name:string;mime:string;content:string})=>{
  const url=URL.createObjectURL(new Blob([file.content],{type:file.mime})),link=document.createElement('a')
  link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <section aria-label="외부 연락 실행안" className="sales-execution-review">
  <h3>외부 연락 실행안 {p&&`· ${p.status} · 버전 ${p.version}`}</h3>
  <p>수신자·문안·제안서·예정 시각을 시스템이 묶어 준비합니다. 기획 채택과 외부 연락 승인은 별개입니다.</p>
  {(state.error||error)&&<p role="alert">{error||state.error}</p>}
  <Button kind="outline" disabled={busy||state.loading} onClick={state.reload}>실행안 새로고침</Button>
  {!state.loading&&!state.error&&!p&&<p>검토 자료가 완성되면 시스템이 실행안을 자동 준비합니다.</p>}
  {p&&<>
   {!p.current&&<p role="alert">근거·대상·내용·일정이 변경되었습니다. 아래는 이전 저장본이며 시스템이 새 버전을 준비합니다.</p>}
   {!!p.blockers.length&&<div role="status"><strong>시스템이 해결할 준비 항목</strong><ul>{p.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul></div>}
   {p.mail_evidence&&<p role="status"><strong>메일 원문 자동 확보</strong> · {p.mail_evidence.note}<br/>최근 24시간 조회 시도 {p.mail_evidence.attempts}/3회 · 마지막 결과 {p.mail_evidence.checked_at?time(p.mail_evidence.checked_at):'아직 없음'}</p>}
   {p.contact_discovery&&<SalesContactDiscovery report={p.contact_discovery}/>}
   {p.payload.contact_evidence&&<SalesContactEvidence report={p.payload.contact_evidence} prepared={p.payload.contact_evidence_prepared===true}/>}
   <p><b>발신 계정</b> · {p.payload.sender||'연결·권한 검증 전'}</p>
   {p.readiness&&<section aria-label="발신·수신 준비 점검">
    <h4>발신·수신 준비 점검</h4><p>{p.readiness.scope}</p>
    <p><strong>{senderLabels[p.readiness.sender.code]}</strong> · {p.readiness.sender.email||'확인된 발신 주소 없음'}<br/>마지막 확인 · {p.readiness.sender.checked_at?time(p.readiness.sender.checked_at):'아직 없음'}</p>
    <p>계정 권한 확인은 발송 승인이 아닙니다. 실제 전송 연결과 수신 목적별 검증이 모두 완료되어야 합니다.</p>
    {canDecide&&api.refreshSalesSender&&<Button kind="outline" disabled={busy||state.loading} onClick={()=>void checkSender()}>계정 연결 다시 점검</Button>}
    {p.readiness.recipients.length?<div className="sales-strategy-scroll"><table><caption>현재 DB의 대상별 자동 점검</caption><thead><tr><th>회사·사람</th><th>연락 창구·상태</th><th>시스템 후속 처리</th></tr></thead><tbody>{p.readiness.recipients.map(target=><tr key={target.source_id}><td>{target.company||'회사 미확인'}<small>{target.person||'담당자 미확인'}</small></td><td>{target.email||'연락처 미확보'}<small>{recipientLabels[target.code]} · {target.origin}</small></td><td>{target.next_action}</td></tr>)}</tbody></table></div>:<p>연결된 대상이 없어 시스템의 대상 DB 확보가 필요합니다.</p>}
   </section>}
   <p><b>제안 시각</b> · {time(p.payload.schedule.at)} (한국 시간, 예약 미실행)<br/>허용 시각 종료 · {time(p.payload.schedule.expires_at)} · 수신자당 {p.payload.schedule.per_recipient_limit}회<br/>후속 발송 · {p.payload.schedule.followups}</p>
   {p.payload.messages.length?<div className="sales-strategy-scroll"><table><caption>준비된 수신자와 연락 문안</caption><thead><tr><th>회사·담당자</th><th>수신 이메일</th><th>연락 내용</th></tr></thead><tbody>{p.payload.messages.map(m=><tr key={m.recipient}><td>{m.company||'회사 미확인'}<small>{m.person||'담당자 미확인'}</small></td><td>{m.recipient}</td><td><strong>{m.subject}</strong><p className="sales-strategy-message">{m.body}</p></td></tr>)}</tbody></table></div>:<p>발송안을 만들 수 있는 수신자가 없습니다. 시스템의 연락처 확보·제외 상태 검증이 필요합니다.</p>}
   {p.payload.attachments.map(file=><details key={file.name}><summary>제안 자료 · {file.name}</summary><p className="sales-strategy-message">{file.content}</p><Button kind="outline" onClick={()=>download(file)}>제안 자료 저장</Button><p>이 실행안에 저장된 원문입니다. 실제 메일 첨부·전송은 아직 실행하지 않았습니다.</p></details>)}
   {canDecide&&<div className="row wrap"><Button disabled={busy||!p.can_approve||!!p.readiness&&(p.readiness.sender.code!=='ready'||!p.readiness.sender.can_send)} onClick={()=>void decide('승인')}>이 버전의 외부 연락 승인</Button><Button kind="outline" disabled={busy||!p.current||p.status==='보류'} onClick={()=>void decide('보류')}>실행안 보류</Button></div>}
   {!p.payload.transport_enabled&&<p className="sales-strategy-note">발송 연결과 검증이 완료되기 전에는 외부 연락 승인이 열리지 않습니다.</p>}
   <details><summary>발송 대기열·처리 기록{p.dispatch?` · ${p.dispatch.jobs.length}건`:''}</summary>
    <p>{p.dispatch?.note||'대기열 상태를 제공하는 서버 버전의 운영 반영을 기다리고 있습니다.'}</p>
    {!!p.dispatch?.jobs.length?<div className="sales-strategy-scroll"><table><caption>이 기획의 최근 처리 기록 최대 100건 · 제공사 접수는 수신함 도착·열람 확인이 아닙니다.</caption><thead><tr><th>수신 대상</th><th>처리 상태</th><th>검증·처리 사유</th></tr></thead><tbody>{p.dispatch.jobs.map(job=><tr key={job.id}><td>{job.recipient}<small>{job.package_id===p.id?'현재 실행안':'이전 실행안'}</small></td><td>{dispatchLabels[job.state]}<small>{job.finished_at?time(job.finished_at):time(job.scheduled_at)}</small></td><td>{job.reason}</td></tr>)}</tbody></table></div>:<p>등록된 처리 기록이 없습니다. 준비된 문안은 발송 실적에 포함하지 않습니다.</p>}
    <p>결과가 불명확한 건은 자동 재발송하지 않고 시스템이 제공사 결과를 대조해야 합니다.</p>
   </details>
   {p.crm&&<SalesCrmReport report={p.crm}/>}
   <details><summary>실행안 준비·변경 기록</summary><ol>{p.events.map(e=><li key={e.id}><strong>{e.kind}</strong> · {time(e.created_at)}<p>{e.note}</p></li>)}</ol></details>
  </>}
 </section>
}
