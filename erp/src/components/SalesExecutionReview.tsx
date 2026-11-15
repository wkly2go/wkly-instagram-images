import {useState} from 'react'
import {useAsync} from '../lib/app'
import type {SalesExecutionApi} from '../lib/salesExecution'
import {Button} from './ui'

const time=(v:string)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
export function SalesExecutionReview({api,strategyId,revision,canDecide}:{api:SalesExecutionApi;strategyId:string;revision:number;canDecide:boolean}){
 const state=useAsync(()=>api.getSalesExecution(strategyId),[strategyId,revision],null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),p=state.data
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
   <p><b>발신 계정</b> · {p.payload.sender||'연결·권한 검증 전'}</p>
   <p><b>제안 시각</b> · {time(p.payload.schedule.at)} (한국 시간, 예약 미실행)<br/>허용 시각 종료 · {time(p.payload.schedule.expires_at)} · 수신자당 {p.payload.schedule.per_recipient_limit}회<br/>후속 발송 · {p.payload.schedule.followups}</p>
   {p.payload.messages.length?<div className="sales-strategy-scroll"><table><caption>준비된 수신자와 연락 문안</caption><thead><tr><th>회사·담당자</th><th>수신 이메일</th><th>연락 내용</th></tr></thead><tbody>{p.payload.messages.map(m=><tr key={m.recipient}><td>{m.company||'회사 미확인'}<small>{m.person||'담당자 미확인'}</small></td><td>{m.recipient}</td><td><strong>{m.subject}</strong><p className="sales-strategy-message">{m.body}</p></td></tr>)}</tbody></table></div>:<p>발송안을 만들 수 있는 수신자가 없습니다. 시스템의 연락처 확보·제외 상태 검증이 필요합니다.</p>}
   {p.payload.attachments.map(file=><details key={file.name}><summary>제안 자료 · {file.name}</summary><p className="sales-strategy-message">{file.content}</p><Button kind="outline" onClick={()=>download(file)}>제안 자료 저장</Button><p>이 실행안에 저장된 원문입니다. 실제 메일 첨부·전송은 아직 실행하지 않았습니다.</p></details>)}
   {canDecide&&<div className="row wrap"><Button disabled={busy||!p.can_approve} onClick={()=>void decide('승인')}>이 버전의 외부 연락 승인</Button><Button kind="outline" disabled={busy||!p.current||p.status==='보류'} onClick={()=>void decide('보류')}>실행안 보류</Button></div>}
   {!p.payload.transport_enabled&&<p className="sales-strategy-note">발송 연결과 검증이 완료되기 전에는 외부 연락 승인이 열리지 않습니다.</p>}
   <details><summary>실행안 준비·변경 기록</summary><ol>{p.events.map(e=><li key={e.id}><strong>{e.kind}</strong> · {time(e.created_at)}<p>{e.note}</p></li>)}</ol></details>
  </>}
 </section>
}
