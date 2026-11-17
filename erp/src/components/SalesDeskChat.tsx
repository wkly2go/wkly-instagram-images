import {useEffect,useRef,useState,type ReactNode} from 'react'
import {useAsync} from '../lib/app'
import {useDraftNavigation} from '../lib/useDraftNavigation'
import type {SalesDeskFold,SalesStrategy,SalesStrategyApi,StrategyPlan} from '../lib/salesStrategy'
import {parseStageQuestion} from '../lib/salesStrategy'
import type {SalesDeskAction,SalesDeskMessage} from '../lib/salesDesk'
import type {SalesExecutionPackage} from '../lib/salesExecution'
import {Button,Field} from './ui'
import './SalesDeskChat.css'
/** One-tap instructions for the most common questions. */
const REJECTED=['수정 요청','보류']
/** Common reasons, so a rejection takes one tap and still tells the planner what to change. */
const REASONS=['대상이 너무 넓다. 더 좁고 구체적으로','근거가 약하다. 확인된 수요가 있는 곳으로','우리 수행 분야와 맞지 않는다','규모가 작다. 더 큰 건으로']
const QUICK=['이번 주 새로 확인된 팝업·매장 오픈 브랜드와 접근 방법','참여 가능한 나라장터 용역 공고 정리','승인 대기 중인 기획안 요약과 우선순위']
const time=(v:string)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
/** Plans join the conversation as proposals the administrator approves or rejects in place. */
export interface DeskPlans {items:SalesStrategy[];busy:boolean;error:string;onApprove:(row:SalesStrategy,feedback?:string)=>void;/** The prepared execution package of a plan, for one-step approval. */loadExecution?:(row:SalesStrategy)=>Promise<SalesExecutionPackage|null>;onApproveExecute?:(row:SalesStrategy,pkg:SalesExecutionPackage)=>void;onReject:(row:SalesStrategy,reason:string,replan:boolean)=>void;onOpen:(row:SalesStrategy)=>void;onPlan:(direction:string)=>void;execution?:(row:SalesStrategy)=>ReactNode}
export function SalesDeskChat({api,agents,canSubmit,operational,plans}:{api:SalesStrategyApi;agents:{id:string;name:string}[];canSubmit:boolean;operational:boolean;plans?:DeskPlans}){
 const [instruction,setInstruction]=useState(''),[agent,setAgent]=useState(''),[action,setAction]=useState<SalesDeskAction>('보고서'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursors,setCursors]=useState<(number|null)[]>([null])
 const before=cursors[cursors.length-1],state=useAsync(()=>api.listSalesDesk(before),[api,before],[])
 const request=useRef<{id:string;signature:string}|null>(null)
 const [showRejected,setShowRejected]=useState(false),rejected=plans?.items.filter(p=>REJECTED.includes(p.status)).length??0
 // 접어 보관 (2026-11-16 대표 지시): 보관한 대화 · 기획은 목록에서 빠지고 보관함에 남는다(사람마다 DB 저장). 지난 대화는 한 줄로 접힘
 const foldState=useAsync(async()=>api.listSalesDeskFolds?await api.listSalesDeskFolds():[] as SalesDeskFold[],[api],[] as SalesDeskFold[])
 const [folds,setFolds]=useState<SalesDeskFold[]|null>(null),allFolds=folds??foldState.data
 const folded=(kind:SalesDeskFold['kind'],id:string)=>allFolds.some(f=>f.kind===kind&&f.id===id)
 const [opened,setOpened]=useState<string[]>([]),toggle=(key:string)=>setOpened(v=>v.includes(key)?v.filter(x=>x!==key):[...v,key])
 const fold=async(kind:SalesDeskFold['kind'],id:string,on:boolean,label:string)=>{
  const before=allFolds
  setFolds(on?[{kind,id,label,folded_at:new Date().toISOString()},...before.filter(f=>!(f.kind===kind&&f.id===id))]:before.filter(f=>!(f.kind===kind&&f.id===id)))
  try{await api.foldSalesDesk?.(kind,id,on,label)}catch(e){setFolds(before);setError(e instanceof Error?e.message:'보관하지 못했습니다.')}
 }
 const waiting=plans?.items.filter(p=>p.status==='승인 대기'&&!folded('plan',p.id))??[],running=plans?.items.filter(p=>p.status==='승인'&&!folded('plan',p.id)).length??0
 const conversation=useRef<HTMLDivElement>(null),followLatest=useRef(true),sent=useRef(false)
 const pending=state.data.some(m=>m.status==='처리 중')
 const canFold=!!api.foldSalesDesk
 const newest=state.data.filter(m=>!folded('message',m.id)).at(-1)?.id
 // Proposals appear only beside the latest conversation page, in the order things happened.
 const timeline=[...state.data.filter(m=>!folded('message',m.id)).map(m=>({at:m.created_at,message:m,plan:null as SalesStrategy|null})),...(plans&&cursors.length===1?plans.items.filter(p=>p.status!=='생성 실패'&&!folded('plan',p.id)&&(showRejected||!REJECTED.includes(p.status))).map(p=>({at:p.created_at,message:null as SalesDeskMessage|null,plan:p})):[])].sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0)
 useDraftNavigation(!!instruction.trim(),busy)
 // After the user sends an instruction, bring the newest exchange into view once; never move the page on a plain reload.
 useEffect(()=>{if(state.loading||!followLatest.current||!sent.current)return;sent.current=false;conversation.current?.lastElementChild?.scrollIntoView?.({block:'nearest'})},[state.data,state.loading])
 useEffect(()=>{if(!pending)return;const timer=window.setInterval(()=>{if(!document.hidden)state.reload()},6000);return()=>window.clearInterval(timer)},[pending,state.reload])
 const send=async(preset?:string)=>{
  const text=(preset??instruction).trim()
  if(busy||pending||!canSubmit||!operational||text.length<2)return
  setBusy(true);setError('')
  const signature=JSON.stringify([agent,preset?'보고서':action,text])
  if(request.current?.signature!==signature)request.current={id:crypto.randomUUID(),signature}
  try{await api.submitSalesDesk(request.current.id,agent||null,preset?'보고서':action,text);request.current=null;followLatest.current=true;sent.current=true;setInstruction('');setCursors([null]);state.reload()}
  catch(e){setError(e instanceof Error?e.message:'업무 지시를 저장하지 못했습니다.');state.reload()}
  finally{setBusy(false)}
 }
 return <section className="sales-desk-chat" aria-label="AI 팀원 업무 대화">
  <header><div><h2>AI 팀원과 영업 대화</h2><p>지시하면 AI가 자료를 찾아 보고하고, 기획안을 제안합니다. 대화 안에서 승인하거나 반려하면 다음 단계는 시스템이 이어서 처리합니다.</p></div><Button kind="outline" disabled={state.loading||busy} onClick={state.reload}>대화 새로고침</Button></header>
  {!operational&&<p role="status">체험 화면입니다. 실제 DB 조회·보고서 생성은 운영 계정에서 사용할 수 있습니다.</p>}
  {(error||state.error||plans?.error)&&<p role="alert">{error||state.error||plans?.error}</p>}
  {plans&&(waiting.length>0||running>0)&&<p className="sales-desk-summary" role="status"><strong>승인 대기 {waiting.length}건</strong> · 실행 준비·진행 {running}건{waiting.length>0&&<Button kind="outline" onClick={()=>document.getElementById('sales-plan-'+waiting[0].id)?.scrollIntoView?.({block:'center'})}>승인할 기획안 보기</Button>}</p>}
  {rejected>0&&cursors.length===1&&<p className="sales-desk-note">반려한 기획안 {rejected}건은 숨겼습니다. 반려 사유는 다음 기획에 반영됩니다. <Button kind="ghost" onClick={()=>setShowRejected(v=>!v)}>{showRejected?'반려한 안 숨기기':'반려한 안 보기'}</Button></p>}
  <div ref={conversation} className="sales-desk-conversation" aria-label="저장된 지시와 결과" aria-busy={state.loading}>
   {state.loading?<p role="status">대화 기록을 불러오고 있습니다.</p>:!state.error&&!timeline.length?<p>아직 대화가 없습니다. 아래에 원하는 결과를 적어 주세요.</p>:!state.error&&timeline.map(item=>item.plan?<PlanProposal key={'plan:'+item.plan.id} row={item.plan} plans={plans!} canDecide={canSubmit&&operational} compact={!['승인 대기','승인','기획 중'].includes(item.plan.status)&&!opened.includes('plan:'+item.plan.id)} onToggle={()=>toggle('plan:'+item.plan!.id)} onFold={canFold?()=>void fold('plan',item.plan!.id,true,`${item.plan!.plan?.title||'기획안'} · ${item.plan!.status}`):undefined}/>:(m=>m.id!==newest&&m.status!=='처리 중'&&!opened.includes('msg:'+m.id)?<article key={m.id} className="sales-desk-exchange sales-desk-compact"><button type="button" className="sales-desk-compact-open" onClick={()=>toggle('msg:'+m.id)} aria-expanded={false}><span className="sales-desk-compact-what">{m.action} · {m.instruction}</span><small>{m.agent_name} · {m.status} · {time(m.created_at)}</small></button>{canFold&&<Button kind="ghost" onClick={()=>void fold('message',m.id,true,`${m.action} · ${m.instruction}`.slice(0,200))}>보관</Button>}</article>:<article key={m.id} className="sales-desk-exchange"><div className="sales-desk-mine"><header><strong>내 지시 · {m.action}</strong><small>{time(m.created_at)}</small>{m.id!==newest&&<Button kind="ghost" onClick={()=>toggle('msg:'+m.id)}>접기</Button>}{canFold&&m.status!=='처리 중'&&<Button kind="ghost" onClick={()=>void fold('message',m.id,true,`${m.action} · ${m.instruction}`.slice(0,200))}>보관</Button>}</header><p className="sales-desk-text">{m.instruction}</p></div><div className="sales-desk-answer"><strong>{m.agent_name} · {m.status}</strong>{m.status==='처리 중'?<p role="status">저장된 자료를 바탕으로 보고서를 작성하고 있습니다.</p>:<p className="sales-desk-text">{m.reply}</p>}{m.report&&<DeskReportView message={m}/>}{m.report&&plans&&canSubmit&&<p className="sales-desk-actions"><Button kind="outline" disabled={plans.busy} onClick={()=>plans.onPlan(`대화 지시: ${m.instruction} · 보고서: ${m.report!.title} · 제안: ${m.report!.recommendations.slice(0,2).join(' / ')}`.slice(0,600))}>이 내용으로 기획안 만들기</Button></p>}<details><summary>조회한 DB 자료와 수집 상태 · {m.snapshot.sources.length}건</summary><p>{m.snapshot.scope} · 일치 {m.snapshot.matched_total}건 · {time(m.snapshot.at)}</p>{m.snapshot.sources.length?<ul>{m.snapshot.sources.map(s=><li key={s.id}><strong>{s.name}</strong> · {s.entity_kind} · {s.organization||'소속 미확인'}<small>{s.source} · {s.source_updated_at?time(s.source_updated_at):'자료 시각 미확인'}</small><p className="sales-desk-text">{s.evidence}</p>{/^https?:\/\//i.test(s.source_url)&&<a href={s.source_url} target="_blank" rel="noopener noreferrer">등록 출처 열기 ↗</a>}</li>)}</ul>:<p>조건에 맞는 저장 자료가 없습니다. 새로운 고객 수요가 확인됐다는 의미가 아닙니다.</p>}<h4>출처별 최근 수집 상태</h4>{m.snapshot.coverage.map(s=><p key={s.source}>{s.source} · {s.status}<br/>{s.note}</p>)}<h4>전체 영업 진행 단계</h4><p>{m.snapshot.pipeline.map(p=>`${p.stage} ${p.count}건`).join(' · ')||'등록된 진행 영업 없음'}</p>{m.snapshot.execution&&<><h4>외부 연락 준비 현황</h4><p>{m.snapshot.execution.scope} · 검증 대기 {m.snapshot.execution.needs_verification}건 · 재검토 {m.snapshot.execution.recheck}건 · 보류 {m.snapshot.execution.held}건</p><p>{m.snapshot.execution.note}</p></>}</details></div></article>)(item.message!))}
  </div>
  {allFolds.length>0&&<details className="sales-desk-archive"><summary>보관함 · {allFolds.length}건 <small>접어 둔 대화와 기획 · 다시 꺼내거나 이어서 지시할 수 있어요</small></summary><ul>{allFolds.map(f=><li key={f.kind+f.id}><span className="sales-desk-archive-kind">{f.kind==='plan'?'기획':'대화'}</span><span className="sales-desk-archive-label">{f.label||'(제목 없음)'}</span><small>{time(f.folded_at)}</small><span className="sales-desk-archive-actions"><Button kind="outline" onClick={()=>void fold(f.kind,f.id,false,f.label)}>다시 꺼내기</Button>{f.kind==='message'&&canSubmit&&<Button kind="ghost" onClick={()=>{setInstruction(`[보관한 대화 이어서 · ${time(f.folded_at)}] ${f.label}\n`);document.querySelector<HTMLTextAreaElement>('.sales-desk-chat textarea')?.focus()}}>이어서 지시</Button>}{f.kind==='plan'&&plans&&canSubmit&&<Button kind="ghost" disabled={plans.busy} onClick={()=>plans.onPlan(`보관했던 기획을 다시 검토해 개선: ${f.label}`.slice(0,600))}>이 기획으로 새 안 받기</Button>}</span></li>)}</ul></details>}
  <nav aria-label="영업 대화 페이지"><Button kind="outline" disabled={state.loading||state.data.length<30} onClick={()=>setCursors(v=>[...v,state.data[0].sequence])}>이전 대화</Button><span>{cursors.length===1?'최근 대화':`${cursors.length}페이지`}</span><Button kind="outline" disabled={state.loading||cursors.length===1} onClick={()=>setCursors(v=>v.slice(0,-1))}>최근 대화로</Button></nav>
  <form onSubmit={e=>{e.preventDefault();void send()}}><fieldset disabled={busy||!canSubmit||!operational}>
   <div className="sales-desk-chips" aria-label="자주 쓰는 지시">{QUICK.map(q=><Button key={q} kind="outline" disabled={pending} onClick={()=>void send(q)}>{q}</Button>)}{plans&&<Button kind="outline" disabled={plans.busy} onClick={()=>plans.onPlan('')}>새 기획안 받기</Button>}</div>
   <Field label="AI 팀원에게 지시할 내용"><textarea className="textarea" maxLength={1200} value={instruction} onChange={e=>setInstruction(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send()}}} placeholder="예: 이번 주 팝업 관련 자료를 분석하고 우선 영업 대상과 접근 방법을 보고서로 만들어 줘."/></Field>
   <details className="sales-desk-more"><summary>담당 AI 팀원 · 업무 종류 바꾸기</summary>
   <div className="sales-desk-options"><Field label="지시할 AI 팀원"><select className="select" value={agent} onChange={e=>setAgent(e.target.value)}><option value="">영업 기획 AI</option>{agents.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></Field><Field label="요청할 업무"><select className="select" value={action} onChange={e=>setAction(e.target.value as SalesDeskAction)}><option value="보고서">분석 보고서 작성</option><option value="조회">저장 자료 불러오기</option><option value="수집">자료 취합 요청</option></select></Field></div>
   </details>
   <div className="sales-desk-send"><small>{instruction.length}/1,200자 · Ctrl+Enter로 보내기 · 보고서는 AI 사용 한도 안에서 작성합니다.</small><Button type="submit" disabled={pending||instruction.trim().length<2}>{busy?'지시 저장 중…':'업무 지시 보내기'}</Button></div>
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
/** 기획안 구분 (대표 지시 2026-11-17 '기획안은 구분을 해줘'): 공공/민간 · 영업 방식(category) · 우선순위(제목 끝 괄호) · 상태 색 */
function planTags(p:StrategyPlan|null|undefined){
 const raw=p?.title||'기획 중',m=raw.match(/\s*[([]\s*(낮은|중간|보통|높은)\s*우선\s*순위\s*[)\]]\s*$/)
 const cat=p?.category?.trim()||''
 return {title:m?raw.slice(0,m.index).trim():raw,priority:m?(m[1]==='높은'?'높음':m[1]==='낮은'?'낮음':'보통'):'',sector:/공공|입찰|조달|나라장터/.test(cat+' '+raw)?'공공':'민간',category:cat}
}
const stateTone=(row:SalesStrategy)=>row.status==='승인 대기'?(row.preparation_before_approval&&row.preparation_status!=='완료'?'prep':'wait'):row.status==='승인'?'ok':row.status==='기획 중'?'prep':'off'
function PlanTags({row}:{row:SalesStrategy}){
 const t=planTags(row.plan)
 return <span className="sales-plan-tags"><span className={`sales-plan-tag sector-${t.sector==='공공'?'public':'private'}`}>{t.sector}</span>{t.category&&<span className="sales-plan-tag cat">{t.category}</span>}{t.priority&&<span className={`sales-plan-tag pri-${t.priority==='높음'?'high':t.priority==='낮음'?'low':'mid'}`}>우선순위 {t.priority}</span>}<span className={`sales-plan-tag state-${stateTone(row)}`}>{planState(row)}</span></span>
}
function PlanProposal({row,plans,canDecide,compact=false,onToggle,onFold}:{row:SalesStrategy;plans:DeskPlans;canDecide:boolean;compact?:boolean;onToggle?:()=>void;onFold?:()=>void}){
 const [rejecting,setRejecting]=useState(false),[reason,setReason]=useState(''),p=row.plan
 const waiting=row.status==='승인 대기',ready=!row.preparation_before_approval||row.preparation_status==='완료'
 // The package is loaded only for a plan that is waiting and prepared; what is shown here is exactly what one approval covers.
 const [pkg,setPkg]=useState<SalesExecutionPackage|null>(null)
 const load=plans.loadExecution
 useEffect(()=>{let live=true;setPkg(null);if(!load||!canDecide||!waiting||!ready||!row.preparation_before_approval)return;load(row).then(v=>{if(live)setPkg(v)}).catch(()=>undefined);return()=>{live=false}},[row.id,row.revision,row.preparation_status,waiting,ready,canDecide])
 const sendable=!!pkg&&pkg.can_approve&&pkg.payload.messages.length>0&&(!pkg.readiness||pkg.readiness.sender.can_send||!!pkg.payload.sender)
 if(compact)return <article id={'sales-plan-'+row.id} className={`sales-desk-exchange sales-desk-compact sales-desk-plan plan-${stateTone(row)}`}><button type="button" className="sales-desk-compact-open" onClick={onToggle} aria-expanded={false}><span className="sales-plan-badge">기획안</span><span className="sales-desk-compact-what">{planTags(p).title}</span><PlanTags row={row}/><small>{time(row.created_at)}</small></button>{onFold&&<Button kind="ghost" onClick={onFold}>보관</Button>}</article>
 return <article id={'sales-plan-'+row.id} className={`sales-desk-exchange sales-desk-plan plan-${stateTone(row)}`} aria-label={`기획안 제안 · ${p?.title||'기획 중'}`}><div className="sales-desk-answer">
  <header className="sales-plan-head"><span className="sales-plan-badge">기획안</span><PlanTags row={row}/><small className="sales-plan-when">영업 기획 AI · {time(row.created_at)}</small>{onToggle&&!['승인 대기','승인','기획 중'].includes(row.status)&&<Button kind="ghost" onClick={onToggle}>접기</Button>}{onFold&&<Button kind="ghost" onClick={onFold} title="검토하지 않고 보관함에 넣기 · 나중에 다시 꺼낼 수 있어요">보관</Button>}</header>
  {row.status==='기획 중'?<p role="status">자료를 읽고 기획안을 작성하고 있습니다.</p>:!p?<p className="sales-desk-text">기획안을 완성하지 못했습니다. 아래에서 다시 지시하거나 ‘AI 새 영업안 기획’으로 새 안을 받을 수 있습니다.</p>:<>
   <h3>{planTags(p).title}</h3>
   <dl><div><dt>대상</dt><dd>{p.customer}</dd></div><div><dt>제안</dt><dd>{p.offer}</dd></div><div><dt>지금 하는 이유</dt><dd>{p.why_now}</dd></div></dl>
   {canDecide&&waiting&&!rejecting&&!!p.questions?.some(q=>q.includes('|'))&&<PlanQuestions key={row.id+':'+row.revision} questions={p.questions} busy={plans.busy} onRevise={text=>plans.onReject(row,text,true)} onApprove={text=>plans.onApprove(row,text)}/>}
   {!!p.steps?.length&&<details className="sales-desk-stages" open={row.status==='승인 대기'}><summary>영업 단계별 아이디어와 계획 · {p.steps.length}단계</summary><ol>{p.steps.map((s,i)=><li key={i}><strong>{s.action}</strong>{s.output&&<span> → {s.output}</span>}<small> · 승인 {s.day===0?'당일':`${s.day}일 뒤`}</small></li>)}</ol></details>}
  </>}
  {waiting&&!ready&&<p className="sales-desk-note">{row.preparation_status==='확인 필요'?(row.preparation_error||'자료 준비를 끝내지 못했습니다.')+' 반려하고 다시 기획할 수 있습니다.':'AI가 대상과 제안 자료를 준비하고 있습니다. 준비가 끝나면 승인할 수 있습니다.'}</p>}
  {waiting&&!row.preparation_before_approval&&<p className="sales-desk-note">승인하면 시스템이 이 기획으로 수행 계획과 디자인된 메일 초안을 작성합니다(2~3분). 메일은 미리보기를 보고 한 번 더 승인하셔야 나갑니다.</p>}
  {row.status==='승인'&&<p className="sales-desk-note">{row.preparation_status==='완료'?'승인됨 · 수행 계획과 메일 초안이 준비됐습니다. 아래 실행 묶음에서 메일 미리보기를 확인하고 보내기를 승인해 주세요.':row.preparation_status==='확인 필요'?`승인됨 · 초안 작성이 막혔습니다: ${row.preparation_error||'원인 확인 중'} (시스템이 자동으로 다시 시도합니다)`:'승인됨 · 시스템이 수행 계획과 디자인 메일 초안을 작성하고 있습니다. 끝나면 아래에 메일 미리보기와 보내기 승인 버튼이 나옵니다.'}</p>}
  {['수정 요청','보류'].includes(row.status)&&<p className="sales-desk-note">반려됨{row.feedback?` · ${row.feedback}`:''}</p>}
  {canDecide&&REJECTED.includes(row.status)&&p&&<p className="sales-desk-actions"><Button kind="outline" disabled={plans.busy} onClick={()=>plans.onPlan(`이전 안: ${p.title}. 수정 방향: ${row.feedback||'다른 대상과 방법으로 근거 중심 재기획'}`.slice(0,600))}>사유를 반영한 개선안 받기</Button></p>}
  {canDecide&&waiting&&ready&&pkg&&(sendable?<section className="sales-desk-send-summary" aria-label="승인하면 실행되는 내용"><strong>승인하면 이대로 실행됩니다</strong>
   <dl><div><dt>받는 곳</dt><dd>{pkg.payload.messages.map(m=>`${m.company||m.person||'수신자'} (${m.recipient})`).join(' · ')}</dd></div><div><dt>제목</dt><dd>{pkg.payload.messages[0].subject}</dd></div><div><dt>발송 예정</dt><dd>{time(pkg.payload.schedule.at)} · 보내는 계정 {pkg.payload.sender}</dd></div><div><dt>첨부</dt><dd>{pkg.payload.attachments.map(a=>a.name).join(', ')||'없음'}</dd></div></dl>
   <details><summary>보낼 문안 보기</summary><p className="sales-desk-text">{pkg.payload.messages[0].body}</p></details></section>
   :<p className="sales-desk-note">승인하면 기획이 확정되고, 실행은 다음이 해결되면 이어집니다: {pkg.blockers.slice(0,3).join(' / ')||'실행 준비 확인 중'}</p>)}
  {p&&<p className="sales-desk-actions">{canDecide&&waiting&&!rejecting&&<>{sendable&&plans.onApproveExecute?<Button disabled={plans.busy} aria-label={`${p.title} 승인하고 실행`} onClick={()=>plans.onApproveExecute!(row,pkg!)}>승인하고 실행</Button>:<Button disabled={plans.busy||!ready} aria-label={`${p.title} 승인`} onClick={()=>plans.onApprove(row)}>승인</Button>}<Button kind="outline" disabled={plans.busy} aria-label={`${p.title} 반려`} onClick={()=>setRejecting(true)}>반려</Button></>}<Button kind="ghost" disabled={plans.busy} onClick={()=>plans.onOpen(row)}>자세히 보기</Button></p>}
  {canDecide&&waiting&&rejecting&&<fieldset className="sales-desk-reject" disabled={plans.busy}><div className="sales-desk-chips" aria-label="자주 쓰는 반려 사유">{REASONS.map(r=><Button key={r} kind="outline" onClick={()=>setReason(v=>v?v+' '+r:r)}>{r}</Button>)}</div><Field label="반려 사유 · 바꿀 방향"><textarea className="textarea" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 대상이 너무 넓다. 성수동 팝업을 여는 식음료 브랜드로 좁혀서 다시."/></Field><p className="sales-desk-actions"><Button disabled={reason.trim().length<3} onClick={()=>{plans.onReject(row,reason.trim(),true);setRejecting(false);setReason('')}}>반려하고 개선안 받기</Button><Button kind="outline" disabled={reason.trim().length<3} onClick={()=>{plans.onReject(row,reason.trim(),false);setRejecting(false);setReason('')}}>반려만 하기</Button><Button kind="ghost" onClick={()=>setRejecting(false)}>취소</Button></p></fieldset>}
  {plans.execution&&row.preparation_before_approval&&ready&&['승인 대기','승인'].includes(row.status)&&<PlanExecution open={row.status==='승인'}>{()=>plans.execution!(row)}</PlanExecution>}
 </div></article>
}
/** The execution package is fetched only when its section is opened. */
function PlanExecution({open,children}:{open:boolean;children:()=>ReactNode}){
 const [shown,setShown]=useState(open)
 return <details open={shown} onToggle={e=>setShown(e.currentTarget.open)}><summary>실행 묶음 · 수신자·문안·발송 승인</summary>{shown&&children()}</details>
}

/** Planning as a conversation: the AI asks one question per sales stage, the administrator taps an option or writes
 * a line, then either gets a revised plan or approves with these answers (drafting follows them first). */
function PlanQuestions({questions,busy,onRevise,onApprove}:{questions:string[];busy:boolean;onRevise:(text:string)=>void;onApprove:(text:string)=>void}){
 const items=questions.slice(0,5).map(parseStageQuestion)
 const [answers,setAnswers]=useState<string[]>(()=>items.map(()=>''))
 const set=(i:number,v:string)=>setAnswers(a=>a.map((x,k)=>k===i?v:x))
 const text=items.map((q,i)=>answers[i].trim()?`${q.stage||q.question.slice(0,20)}: ${answers[i].trim()}`:'').filter(Boolean).join(' / ').slice(0,600)
 return <section className="sales-desk-ask" aria-label="대표님 의견을 여쭤요">
  <strong>기획을 같이 정해요 · 단계별로 의견을 여쭤요</strong>
  {items.map((q,i)=><div key={i} className="sales-desk-q">
   <p>{q.stage&&<b>{q.stage}</b>} {q.question}</p>
   {!!q.options.length&&<div className="sales-desk-chips">{q.options.map(o=><Button key={o} kind={answers[i]===o?'blue':'outline'} aria-pressed={answers[i]===o} onClick={()=>set(i,answers[i]===o?'':o)}>{o}</Button>)}</div>}
   <input className="input" maxLength={160} placeholder="직접 쓰기 (선택)" value={q.options.includes(answers[i])?'':answers[i]} onChange={e=>set(i,e.target.value)} aria-label={`${q.stage||'질문'} 직접 답하기`}/>
  </div>)}
  <p className="sales-desk-actions"><Button kind="outline" disabled={busy||!text} onClick={()=>onRevise(text)}>이 의견으로 다시 기획</Button><Button disabled={busy||!text} onClick={()=>onApprove(text)}>이 의견으로 승인</Button></p>
  {!text&&<small>하나 이상 고르거나 적으시면 버튼이 켜집니다. 그대로 괜찮으면 아래 '승인'을 누르세요.</small>}
 </section>
}
