import {useEffect,useRef,useState,type ReactNode} from 'react'
import {useAsync} from '../lib/app'
import {useDraftNavigation} from '../lib/useDraftNavigation'
import type {SalesStrategy,SalesStrategyApi} from '../lib/salesStrategy'
import type {SalesDeskAction,SalesDeskMessage} from '../lib/salesDesk'
import {Button,Field} from './ui'
import './SalesDeskChat.css'
const time=(v:string)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
/** Plans join the conversation as proposals the administrator approves or rejects in place. */
export interface DeskPlans {items:SalesStrategy[];busy:boolean;error:string;onApprove:(row:SalesStrategy)=>void;onReject:(row:SalesStrategy,reason:string,replan:boolean)=>void;onOpen:(row:SalesStrategy)=>void;onPlan:(direction:string)=>void;execution?:(row:SalesStrategy)=>ReactNode}
export function SalesDeskChat({api,agents,canSubmit,operational,plans}:{api:SalesStrategyApi;agents:{id:string;name:string}[];canSubmit:boolean;operational:boolean;plans?:DeskPlans}){
 const [instruction,setInstruction]=useState(''),[agent,setAgent]=useState(''),[action,setAction]=useState<SalesDeskAction>('보고서'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursors,setCursors]=useState<(number|null)[]>([null])
 const before=cursors[cursors.length-1],state=useAsync(()=>api.listSalesDesk(before),[api,before],[])
 const request=useRef<{id:string;signature:string}|null>(null)
 const conversation=useRef<HTMLDivElement>(null),followLatest=useRef(true),sent=useRef(false)
 const pending=state.data.some(m=>m.status==='처리 중')
 // Proposals appear only beside the latest conversation page, in the order things happened.
 const timeline=[...state.data.map(m=>({at:m.created_at,message:m,plan:null as SalesStrategy|null})),...(plans&&cursors.length===1?plans.items.map(p=>({at:p.created_at,message:null as SalesDeskMessage|null,plan:p})):[])].sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0)
 useDraftNavigation(!!instruction.trim(),busy)
 // After the user sends an instruction, bring the newest exchange into view once; never move the page on a plain reload.
 useEffect(()=>{if(state.loading||!followLatest.current||!sent.current)return;sent.current=false;conversation.current?.lastElementChild?.scrollIntoView?.({block:'nearest'})},[state.data,state.loading])
 useEffect(()=>{if(!pending)return;const timer=window.setInterval(()=>{if(!document.hidden)state.reload()},6000);return()=>window.clearInterval(timer)},[pending,state.reload])
 const send=async()=>{
  if(busy||pending||!canSubmit||!operational||instruction.trim().length<2)return
  setBusy(true);setError('')
  const signature=JSON.stringify([agent,action,instruction.trim()])
  if(request.current?.signature!==signature)request.current={id:crypto.randomUUID(),signature}
  try{await api.submitSalesDesk(request.current.id,agent||null,action,instruction.trim());request.current=null;followLatest.current=true;sent.current=true;setInstruction('');setCursors([null]);state.reload()}
  catch(e){setError(e instanceof Error?e.message:'업무 지시를 저장하지 못했습니다.');state.reload()}
  finally{setBusy(false)}
 }
 return <section className="sales-desk-chat" aria-label="AI 팀원 업무 대화">
  <header><div><h2>AI 팀원과 영업 대화</h2><p>지시하면 AI가 자료를 찾아 보고하고, 기획안을 제안합니다. 대화 안에서 승인하거나 반려하면 다음 단계는 시스템이 이어서 처리합니다.</p></div><Button kind="outline" disabled={state.loading||busy} onClick={state.reload}>대화 새로고침</Button></header>
  {!operational&&<p role="status">체험 화면입니다. 실제 DB 조회·보고서 생성은 운영 계정에서 사용할 수 있습니다.</p>}
  {(error||state.error||plans?.error)&&<p role="alert">{error||state.error||plans?.error}</p>}
  <div ref={conversation} className="sales-desk-conversation" aria-label="저장된 지시와 결과" aria-busy={state.loading}>
   {state.loading?<p role="status">대화 기록을 불러오고 있습니다.</p>:!state.error&&!timeline.length?<p>아직 대화가 없습니다. 아래에 원하는 결과를 적어 주세요.</p>:!state.error&&timeline.map(item=>item.plan?<PlanProposal key={'plan:'+item.plan.id} row={item.plan} plans={plans!} canDecide={canSubmit&&operational}/>:(m=><article key={m.id} className="sales-desk-exchange"><div className="sales-desk-mine"><header><strong>내 지시 · {m.action}</strong><small>{time(m.created_at)}</small></header><p className="sales-desk-text">{m.instruction}</p></div><div className="sales-desk-answer"><strong>{m.agent_name} · {m.status}</strong>{m.status==='처리 중'?<p role="status">저장된 자료를 바탕으로 보고서를 작성하고 있습니다.</p>:<p className="sales-desk-text">{m.reply}</p>}{m.report&&<DeskReportView message={m}/>}{m.report&&plans&&canSubmit&&<p className="sales-desk-actions"><Button kind="outline" disabled={plans.busy} onClick={()=>plans.onPlan(`대화 지시: ${m.instruction} · 보고서: ${m.report!.title} · 제안: ${m.report!.recommendations.slice(0,2).join(' / ')}`.slice(0,600))}>이 내용으로 기획안 만들기</Button></p>}<details><summary>조회한 DB 자료와 수집 상태 · {m.snapshot.sources.length}건</summary><p>{m.snapshot.scope} · 일치 {m.snapshot.matched_total}건 · {time(m.snapshot.at)}</p>{m.snapshot.sources.length?<ul>{m.snapshot.sources.map(s=><li key={s.id}><strong>{s.name}</strong> · {s.entity_kind} · {s.organization||'소속 미확인'}<small>{s.source} · {s.source_updated_at?time(s.source_updated_at):'자료 시각 미확인'}</small><p className="sales-desk-text">{s.evidence}</p>{/^https?:\/\//i.test(s.source_url)&&<a href={s.source_url} target="_blank" rel="noopener noreferrer">등록 출처 열기 ↗</a>}</li>)}</ul>:<p>조건에 맞는 저장 자료가 없습니다. 새로운 고객 수요가 확인됐다는 의미가 아닙니다.</p>}<h4>출처별 최근 수집 상태</h4>{m.snapshot.coverage.map(s=><p key={s.source}>{s.source} · {s.status}<br/>{s.note}</p>)}<h4>전체 영업 진행 단계</h4><p>{m.snapshot.pipeline.map(p=>`${p.stage} ${p.count}건`).join(' · ')||'등록된 진행 영업 없음'}</p>{m.snapshot.execution&&<><h4>외부 연락 준비 현황</h4><p>{m.snapshot.execution.scope} · 검증 대기 {m.snapshot.execution.needs_verification}건 · 재검토 {m.snapshot.execution.recheck}건 · 보류 {m.snapshot.execution.held}건</p><p>{m.snapshot.execution.note}</p></>}</details></div></article>)(item.message!))}
  </div>
  <nav aria-label="영업 대화 페이지"><Button kind="outline" disabled={state.loading||state.data.length<30} onClick={()=>setCursors(v=>[...v,state.data[0].sequence])}>이전 대화</Button><span>{cursors.length===1?'최근 대화':`${cursors.length}페이지`}</span><Button kind="outline" disabled={state.loading||cursors.length===1} onClick={()=>setCursors(v=>v.slice(0,-1))}>최근 대화로</Button></nav>
  <form onSubmit={e=>{e.preventDefault();void send()}}><fieldset disabled={busy||!canSubmit||!operational}>
   <div className="sales-desk-options"><Field label="지시할 AI 팀원"><select className="select" value={agent} onChange={e=>setAgent(e.target.value)}><option value="">영업 기획 AI</option>{agents.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></Field><Field label="요청할 업무"><select className="select" value={action} onChange={e=>setAction(e.target.value as SalesDeskAction)}><option value="보고서">분석 보고서 작성</option><option value="조회">저장 자료 불러오기</option><option value="수집">자료 취합 요청</option></select></Field></div>
   <Field label="AI 팀원에게 지시할 내용"><textarea className="textarea" maxLength={1200} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="예: 이번 주 팝업 관련 자료를 분석하고 우선 영업 대상과 접근 방법을 보고서로 만들어 줘."/></Field>
   <div className="sales-desk-send"><small>{instruction.length}/1,200자 · 자료 조회는 저장 DB 기준이며 보고서는 AI 사용 한도 내에서 작성합니다.</small><Button type="submit" disabled={pending||instruction.trim().length<2}>{busy?'지시 저장 중…':'업무 지시 보내기'}</Button></div>
  </fieldset></form>
  {!canSubmit&&<p>업무 지시는 관리자 계정에서 사용할 수 있습니다.</p>}
 </section>
}
function DeskReportView({message:m}:{message:SalesDeskMessage}){
 const r=m.report!
 const download=()=>{const body=[`# ${r.title}`,r.summary,'## 확인 내용',...r.findings.map(f=>`- ${f.text}`),'## 제안',...r.recommendations.map(x=>`- ${x}`),'## 분석 범위와 한계',...r.limitations.map(x=>`- ${x}`),'## 조회 범위',m.snapshot.scope,`조회 시각: ${m.snapshot.at}`,'## 근거 자료',...m.snapshot.sources.filter(s=>r.findings.some(f=>f.evidence_ids.includes(s.id))).map(s=>`${s.name} (${s.source})\n${s.source_url}`)].join('\n\n');const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`영업-분석보고서-${m.id}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="sales-desk-report" aria-label="AI 분석 보고서"><header><h3>{r.title}</h3><Button kind="outline" onClick={download}>보고서 저장 (.md)</Button></header><h4>확인 내용</h4><ul>{r.findings.map((f,i)=><li key={i}>{f.text}<small>근거: {f.evidence_ids.map(id=>m.snapshot.sources.find(s=>s.id===id)?.name).filter(Boolean).join(' · ')||'구체적 근거 없음 · 추가 조사 필요'}</small></li>)}</ul><h4>다음 행동 제안</h4><ul>{r.recommendations.map((x,i)=><li key={i}>{x}</li>)}</ul><h4>분석 범위와 한계</h4><ul>{r.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></section>
}

const planState=(row:SalesStrategy)=>row.status==='승인 대기'&&row.preparation_before_approval&&row.preparation_status!=='완료'?(row.preparation_status==='확인 필요'?'자료 준비 확인 필요':'자료 자동 준비 중'):row.status
function PlanProposal({row,plans,canDecide}:{row:SalesStrategy;plans:DeskPlans;canDecide:boolean}){
 const [rejecting,setRejecting]=useState(false),[reason,setReason]=useState(''),p=row.plan
 const waiting=row.status==='승인 대기',ready=!row.preparation_before_approval||row.preparation_status==='완료'
 return <article className="sales-desk-exchange sales-desk-plan" aria-label={`기획안 제안 · ${p?.title||'기획 중'}`}><div className="sales-desk-answer">
  <header><strong>영업 기획 AI · 기획안 제안</strong><small>{planState(row)} · {time(row.created_at)}</small></header>
  {row.status==='기획 중'?<p role="status">자료를 읽고 기획안을 작성하고 있습니다.</p>:!p?<p className="sales-desk-text">기획안을 완성하지 못했습니다. 아래에서 다시 지시하거나 ‘AI 새 영업안 기획’으로 새 안을 받을 수 있습니다.</p>:<>
   <h3>{p.title}</h3>
   <dl><div><dt>대상</dt><dd>{p.customer}</dd></div><div><dt>제안</dt><dd>{p.offer}</dd></div><div><dt>지금 하는 이유</dt><dd>{p.why_now}</dd></div></dl>
  </>}
  {waiting&&!ready&&<p className="sales-desk-note">{row.preparation_status==='확인 필요'?(row.preparation_error||'자료 준비를 끝내지 못했습니다.')+' 반려하고 다시 기획할 수 있습니다.':'AI가 대상과 제안 자료를 준비하고 있습니다. 준비가 끝나면 승인할 수 있습니다.'}</p>}
  {row.status==='승인'&&<p className="sales-desk-note">승인됨 · 실행 자료와 대상은 시스템이 이어서 준비합니다. 외부 발송은 아래 실행 묶음(수신자·문안·일정)을 승인한 범위에서만 진행됩니다.</p>}
  {['수정 요청','보류'].includes(row.status)&&<p className="sales-desk-note">반려됨{row.feedback?` · ${row.feedback}`:''}</p>}
  {p&&<p className="sales-desk-actions">{canDecide&&waiting&&!rejecting&&<><Button disabled={plans.busy||!ready} aria-label={`${p.title} 승인`} onClick={()=>plans.onApprove(row)}>승인</Button><Button kind="outline" disabled={plans.busy} aria-label={`${p.title} 반려`} onClick={()=>setRejecting(true)}>반려</Button></>}<Button kind="ghost" disabled={plans.busy} onClick={()=>plans.onOpen(row)}>자세히 보기</Button></p>}
  {canDecide&&waiting&&rejecting&&<fieldset className="sales-desk-reject" disabled={plans.busy}><Field label="반려 사유 · 바꿀 방향"><textarea className="textarea" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 대상이 너무 넓다. 성수동 팝업을 여는 식음료 브랜드로 좁혀서 다시."/></Field><p className="sales-desk-actions"><Button disabled={reason.trim().length<3} onClick={()=>{plans.onReject(row,reason.trim(),true);setRejecting(false);setReason('')}}>반려하고 다시 기획</Button><Button kind="outline" disabled={reason.trim().length<3} onClick={()=>{plans.onReject(row,reason.trim(),false);setRejecting(false);setReason('')}}>반려만 하기</Button><Button kind="ghost" onClick={()=>setRejecting(false)}>취소</Button></p></fieldset>}
  {plans.execution&&row.preparation_before_approval&&ready&&['승인 대기','승인'].includes(row.status)&&<PlanExecution open={row.status==='승인'}>{()=>plans.execution!(row)}</PlanExecution>}
 </div></article>
}
/** The execution package is fetched only when its section is opened. */
function PlanExecution({open,children}:{open:boolean;children:()=>ReactNode}){
 const [shown,setShown]=useState(open)
 return <details open={shown} onToggle={e=>setShown(e.currentTarget.open)}><summary>실행 묶음 · 수신자·문안·발송 승인</summary>{shown&&children()}</details>
}
