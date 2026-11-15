import {useEffect,useRef,useState} from 'react'
import {useApp,useAsync} from '../lib/app'
import {requestViewChange} from '../lib/navigationGuard'
import {useDraftNavigation} from '../lib/useDraftNavigation'
import type {SalesStrategy,StrategyTask} from '../lib/salesStrategy'
import {Button,Field} from './ui'
import './SalesStrategyDesk.css'

const time=(value:string)=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
export function SalesStrategyDesk(){
 const {api,me}=useApp(),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<SalesStrategy|null>(null)
 const request=useRef<{id:string;feedback:string}|null>(null)
 const state=useAsync(()=>api.listSalesStrategies(page),[page],{items:[],total:0,automatic:false})
 const pending=state.data.items.some(p=>p.status==='기획 중'||p.preparation_status==='준비 중')
 useEffect(()=>{setSelected(old=>{if(old?.status!=='승인')return old;const fresh=state.data.items.find(p=>p.id===old.id);return fresh?{...old,preparation:fresh.preparation,preparation_status:fresh.preparation_status,preparation_error:fresh.preparation_error}:old})},[state.data.items])
 useEffect(()=>{if(!pending||state.loading)return;const timer=window.setTimeout(state.reload,6000);return()=>window.clearTimeout(timer)},[pending,state.loading,state.reload])
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.')}finally{setBusy(false)}}
 const generate=(feedback='')=>{if(!requestViewChange('sales-strategy/new'))return;void run(async()=>{if(!request.current||request.current.feedback!==feedback)request.current={id:crypto.randomUUID(),feedback};await api.requestSalesStrategy(request.current.id,feedback);request.current=null;setSelected(null);setPage(0);state.reload()})}
 const inspect=(row:SalesStrategy)=>{if(requestViewChange(`sales-strategy/${row.id}`))setSelected(row)}
 return <article className="sales-strategy-desk" aria-label="AI 영업 기획실">
  <header><div><p className="sales-strategy-eyebrow">AI SALES PLANNING</p><h1>AI 영업 기획실</h1><p>새로운 고객군과 상품·영업 방법을 기획하고, 대표님이 승인한 안을 실행 업무로 연결합니다.</p></div><div className="sales-strategy-schedule"><strong>{state.loading?'설정 확인 중':state.error?'자동 기획 상태 확인 필요':state.data.automatic?'자동 기획 켜짐':'자동 기획 꺼짐'}</strong><span>08:00 자료 취합 · 08:45~08:55 새 기획 · 09:00 보고</span><small>하루 자동 기획 최대 3건 · 수동 포함 최대 6건 · 기존 AI 사용 한도 내 실행</small></div></header>
  <div className="sales-strategy-toolbar"><p>업종을 고정하지 않습니다. 근거·기회·수익화 방법·실행 순서를 한 장으로 제안합니다.</p><div className="row wrap"><Button kind="outline" disabled={busy||state.loading} onClick={state.reload}>기획안 새로고침</Button>{me.role==='admin'&&<><Button disabled={busy||pending||api.mode==='demo'} onClick={()=>generate()}>AI 새 영업안 기획</Button><Button kind="ghost" disabled={busy||state.loading||!!state.error||api.mode==='demo'} onClick={()=>void run(async()=>{await api.setSalesStrategyAutomatic(!state.data.automatic);state.reload()})}>{state.data.automatic?'자동 기획 끄기':'자동 기획 켜기'}</Button></>}</div></div>
  <p className="sales-strategy-note">AI가 제안한 수요·효과는 검증할 가설입니다. 승인하면 AI가 실행 자료를 준비하고 내부 업무로 연결합니다. 외부 발송·게시·예약·견적 확정·계약은 실행하지 않습니다.</p>
  {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  {pending&&<p role="status">AI가 새 영업 기획안 또는 승인된 실행 자료를 작성하고 있습니다. 완료하면 목록이 갱신됩니다.</p>}
  {!state.loading&&!state.error&&!state.data.items.length&&<p>아직 생성된 기획안이 없습니다. 자동 기획 시각에 준비하거나 ‘AI 새 영업안 기획’을 눌러 시작할 수 있습니다.</p>}
  <div className="sales-strategy-scroll"><table><caption className="sr-only">AI 영업 기획안 목록</caption><thead><tr><th>영업 기획안</th><th>누구에게 무엇을 팔까</th><th>지금 검토할 이유</th><th>상태</th><th>검토</th></tr></thead><tbody>{state.data.items.map(row=><tr key={row.id} aria-selected={selected?.id===row.id}><th scope="row">{row.plan?.title||'새 영업 기회 기획'}<small>{row.plan?.category||'AI가 분류를 기획합니다'} · {row.report_date}</small></th><td>{row.plan?.customer||'분석 중'}<small>{row.plan?.offer}</small></td><td>{row.plan?.why_now||row.error||'자료를 읽고 있습니다.'}</td><td>{row.status}</td><td><Button kind="outline" disabled={busy} onClick={()=>inspect(row)}>기획 보고서</Button></td></tr>)}</tbody></table></div>
  {state.data.total>10&&<nav aria-label="영업 기획안 페이지" className="sales-strategy-pagination"><Button disabled={page===0||state.loading} onClick={()=>setPage(n=>n-1)}>이전</Button><span>{page+1} / {Math.ceil(state.data.total/10)}</span><Button disabled={(page+1)*10>=state.data.total||state.loading} onClick={()=>setPage(n=>n+1)}>다음</Button></nav>}
  {selected&&<StrategyReport key={selected.id} row={selected} onClose={()=>{if(requestViewChange('sales-strategy/close'))setSelected(null)}} onDone={()=>{setSelected(null);state.reload()}} onReplan={generate}/>}
 </article>
}

function StrategyReport({row,onClose,onDone,onReplan}:{row:SalesStrategy;onClose:()=>void;onDone:()=>void;onReplan:(feedback:string)=>void}){
 const {api,me,profileName}=useApp(),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),panel=useRef<HTMLElement>(null)
 useDraftNavigation(!!feedback,busy)
 useEffect(()=>panel.current?.focus(),[row.id])
 const decide=async(decision:'승인'|'수정 요청'|'보류')=>{if(busy)return;setBusy(true);setError('');try{await api.decideSalesStrategy(row.id,row.revision,decision,feedback);setFeedback('');onDone()}catch(e){setError(e instanceof Error?e.message:'결정을 저장하지 못했습니다.')}finally{setBusy(false)}}
 const p=row.plan
 return <section ref={panel} tabIndex={-1} className="sales-strategy-report" aria-label="영업 기획 보고서"><header><div><small>{row.status} · {time(row.created_at)}</small><h2>{p?.title||'새 영업 기회 기획'}</h2></div><Button kind="ghost" disabled={busy} onClick={onClose}>기획 보고서 닫기</Button></header>
  {row.error&&<p role="alert">{row.error}</p>}{row.status==='기획 중'&&<p>아직 기획 중입니다. 목록을 새로고침해 결과를 확인해 주세요.</p>}
  {p&&<>
   <p className="sales-strategy-lead">{p.opportunity}</p>
   <dl>{[['고객군',p.customer],['판매할 상품·업무',p.offer],['왜 지금인가',p.why_now],['영업 방법·접촉 경로',p.approach],['기대 효과 가설',p.effect],['필요 자원·비용 확인',p.resources],['중단·변경 기준',p.stop_rule]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   <h3>근거로 사용한 저장 자료</h3>{p.evidence_ids.length?<ul className="sales-strategy-evidence">{row.sources.filter(s=>p.evidence_ids.includes(s.id)).map(s=><li key={s.id}><strong>{s.name}</strong><small>{s.source} · {s.source_updated_at?time(s.source_updated_at):'자료 시각 미확인'}</small><p>{s.evidence}</p>{/^https?:\/\//i.test(s.source_url)&&<a href={s.source_url} target="_blank" rel="noopener noreferrer">등록 출처 확인 ↗</a>}</li>)}</ul>:<p>특정 회사의 수요를 뒷받침하는 근거가 없습니다. 고객군·수요 조사부터 진행하는 실험안입니다.</p>}
   <details><summary>자료 취합 범위와 한계</summary>{row.source_status.map(s=><p key={s.source}>{s.source} · {s.status} · {s.source_at?time(s.source_at):'수집 시각 미확인'}<br/>{s.note}</p>)}<p>연결된 자료 안에서 기획했습니다. 전국 행사 전체나 모든 참가 기업을 조회했다는 의미는 아닙니다.</p></details>
   <h3>먼저 확인할 사항</h3><ul>{p.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>
   <h3>승인 후 실행 순서</h3><ol>{p.steps.map((s,i)=><li key={i}><strong>{s.action}</strong> · 승인 {s.day===0?'당일':`${s.day}일 후`}<p>{s.output}</p></li>)}</ol>
   <h3>성과 판단 기준</h3><ul>{p.metrics.map((m,i)=><li key={i}>{m}</li>)}</ul>
   <details><summary>첫 연락 문안 · 발송 전 초안</summary><p className="sales-strategy-message">{p.first_message}</p><p className="sales-strategy-note">실제 수신자와 제안 범위를 확인한 뒤 외부 연락을 승인합니다.</p></details>
  </>}
  {row.feedback&&<p><b>기획 방향·결정 의견</b> · {row.feedback}</p>}
  {row.decided_at&&<p className="sales-strategy-note">{profileName(row.decided_by??'')} · {time(row.decided_at)} · {row.status}</p>}
  {me.role==='admin'&&row.status==='승인 대기'&&<fieldset disabled={busy} className="sales-strategy-decision"><legend>대표 결정</legend><Field label="수정·보류 의견"><textarea className="textarea" maxLength={600} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="수정할 방향이나 보류 사유. 그대로 승인할 때는 비워도 됩니다."/></Field>{error&&<p role="alert">{error}</p>}<div className="row wrap"><Button onClick={()=>void decide('승인')}>기획 승인·실행 준비</Button><Button kind="outline" disabled={feedback.trim().length<3} onClick={()=>void decide('수정 요청')}>수정 요청</Button><Button kind="outline" disabled={feedback.trim().length<3} onClick={()=>void decide('보류')}>보류</Button></div><p className="sales-strategy-note">승인한 기획을 내부 업무·기한·준비할 산출물로 등록합니다. 실제 발주 확인과 영업 파이프라인 연결은 기존 내용 검증 절차를 따릅니다.</p></fieldset>}
  {me.role==='admin'&&['수정 요청','보류','생성 실패'].includes(row.status)&&<Button disabled={busy} onClick={()=>onReplan(`이전 안: ${p?.title??'기획 실패'}. 수정 방향: ${row.feedback||'기존 제안과 다른 기회를 근거 중심으로 기획해 주세요.'}`.slice(0,600))}>의견 반영해 새로 기획</Button>}
  {row.status==='승인'&&<><h3>AI가 준비한 실행 자료 · {row.preparation_status??'미요청'}</h3>{row.preparation_status==='준비 중'&&<p role="status">저장 자료 검토 요약·제안서 초안·첫 연락 문안을 준비하고 있습니다.</p>}{row.preparation_error&&<p role="alert">{row.preparation_error}</p>}{row.preparation&&<><h4>저장 자료 검토 요약</h4><p className="sales-strategy-message">{row.preparation.research}</p><h4>제안서 초안</h4><p className="sales-strategy-message">{row.preparation.proposal}</p><h4>첫 연락 문안 · 발송 전</h4><p className="sales-strategy-message">{row.preparation.contact_draft}</p><h4>외부 실행 전 확인</h4><ul>{row.preparation.checks.map((x,i)=><li key={i}>{x}</li>)}</ul></>}<StrategyTasks strategyId={row.id} preparationStatus={row.preparation_status}/></>}
 </section>
}

function StrategyTasks({strategyId,preparationStatus}:{strategyId:string;preparationStatus?:string}){
 const {api,me,profileName}=useApp(),state=useAsync(()=>api.listStrategyTasks(strategyId),[strategyId,preparationStatus],[])
 return <section className="sales-strategy-tasks" aria-label="승인된 영업 실행 업무"><h3>승인된 실행 업무</h3><p>준비할 산출물과 실제 진행 결과를 구분합니다. 완료에는 결과 근거가 필요합니다.</p>{state.error&&<p role="alert">{state.error}<Button kind="outline" onClick={state.reload}>실행 업무 다시 조회</Button></p>}{state.data.map(t=><div key={t.id}><h4>{t.ordinal}. {t.title} · {t.status}</h4><p className="sales-strategy-note">{t.due_date}까지 · 확인 담당 {profileName(t.owner_id)}</p><p>준비할 산출물: {t.output}</p>{t.result&&<p className="sales-strategy-message">결과: {t.result}</p>}{me.role==='admin'&&preparationStatus!=='준비 중'&&<TaskResult key={`${t.id}:${t.revision}`} task={t} onDone={state.reload}/>}</div>)}</section>
}
function TaskResult({task,onDone}:{task:StrategyTask;onDone:()=>void}){
 const {api}=useApp(),[status,setStatus]=useState(task.status),[result,setResult]=useState(task.result),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useDraftNavigation(status!==task.status||result!==task.result,busy)
 const save=async()=>{if(busy)return;setBusy(true);setError('');try{await api.updateStrategyTask(task.id,task.revision,status,result);onDone()}catch(e){setError(e instanceof Error?e.message:'결과를 저장하지 못했습니다.')}finally{setBusy(false)}}
 return <details><summary>실행 결과 기록</summary><fieldset disabled={busy}><Field label={`실행 상태 · ${task.ordinal}`}><select className="select" value={status} onChange={e=>setStatus(e.target.value as StrategyTask['status'])}><option>대기</option><option>진행</option><option>완료</option></select></Field><Field label={`결과 근거 · ${task.ordinal}`}><textarea className="textarea" maxLength={3000} value={result} onChange={e=>setResult(e.target.value)} placeholder="확인한 원문, 준비한 문서, 실제 회신·진행 결과"/></Field>{error&&<p role="alert">{error}</p>}<Button disabled={status==='완료'&&result.trim().length<5} onClick={()=>void save()}>실행 결과 저장</Button></fieldset></details>
}
