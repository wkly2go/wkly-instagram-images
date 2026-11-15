import {useEffect,useRef,useState} from 'react'
import {useAsync} from '../lib/app'
import {useDraftNavigation} from '../lib/useDraftNavigation'
import type {SalesStrategyApi} from '../lib/salesStrategy'
import type {SalesDeskAction,SalesDeskMessage} from '../lib/salesDesk'
import {Button,Field} from './ui'
import './SalesDeskChat.css'
const time=(v:string)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
export function SalesDeskChat({api,agents,canSubmit,operational}:{api:SalesStrategyApi;agents:{id:string;name:string}[];canSubmit:boolean;operational:boolean}){
 const [instruction,setInstruction]=useState(''),[agent,setAgent]=useState(''),[action,setAction]=useState<SalesDeskAction>('보고서'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursors,setCursors]=useState<(number|null)[]>([null])
 const before=cursors[cursors.length-1],state=useAsync(()=>api.listSalesDesk(before),[api,before],[])
 const request=useRef<{id:string;signature:string}|null>(null)
 const conversation=useRef<HTMLDivElement>(null),followLatest=useRef(true)
 const pending=state.data.some(m=>m.status==='처리 중')
 useDraftNavigation(!!instruction.trim(),busy)
 useEffect(()=>{if(!state.loading&&conversation.current&&followLatest.current)conversation.current.scrollTop=conversation.current.scrollHeight},[state.data,state.loading])
 useEffect(()=>{if(!pending)return;const timer=window.setInterval(()=>{if(!document.hidden)state.reload()},6000);return()=>window.clearInterval(timer)},[pending,state.reload])
 const send=async()=>{
  if(busy||pending||!canSubmit||!operational||instruction.trim().length<2)return
  setBusy(true);setError('')
  const signature=JSON.stringify([agent,action,instruction.trim()])
  if(request.current?.signature!==signature)request.current={id:crypto.randomUUID(),signature}
  try{await api.submitSalesDesk(request.current.id,agent||null,action,instruction.trim());request.current=null;followLatest.current=true;setInstruction('');setCursors([null]);state.reload()}
  catch(e){setError(e instanceof Error?e.message:'업무 지시를 저장하지 못했습니다.');state.reload()}
  finally{setBusy(false)}
 }
 return <section className="sales-desk-chat" aria-label="AI 팀원 업무 대화">
  <header><div><h2>AI 팀원에게 업무 지시</h2><p>필요한 자료를 불러오고, 분석 결과를 보고서로 받아보세요. 지시와 결과는 저장됩니다.</p></div><Button kind="outline" disabled={state.loading||busy} onClick={state.reload}>대화 새로고침</Button></header>
  {!operational&&<p role="status">체험 화면입니다. 실제 DB 조회·보고서 생성은 운영 계정에서 사용할 수 있습니다.</p>}
  {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  <div ref={conversation} className="sales-desk-conversation" aria-label="저장된 지시와 결과" aria-busy={state.loading} onScroll={e=>{const n=e.currentTarget;followLatest.current=n.scrollHeight-n.scrollTop-n.clientHeight<80}}>
   {state.loading?<p role="status">대화 기록을 불러오고 있습니다.</p>:!state.error&&!state.data.length?<p>아직 업무 지시가 없습니다. 아래에 원하는 결과를 적어 주세요.</p>:!state.error&&state.data.map(m=><article key={m.id} className="sales-desk-exchange"><header><strong>내 지시 · {m.action}</strong><small>{time(m.created_at)}</small></header><p className="sales-desk-text">{m.instruction}</p><div className="sales-desk-answer"><strong>{m.agent_name} · {m.status}</strong>{m.status==='처리 중'?<p role="status">저장된 자료를 바탕으로 보고서를 작성하고 있습니다.</p>:<p className="sales-desk-text">{m.reply}</p>}{m.report&&<DeskReportView message={m}/>}<details><summary>조회한 DB 자료와 수집 상태 · {m.snapshot.sources.length}건</summary><p>{m.snapshot.scope} · 일치 {m.snapshot.matched_total}건 · {time(m.snapshot.at)}</p>{m.snapshot.sources.length?<ul>{m.snapshot.sources.map(s=><li key={s.id}><strong>{s.name}</strong> · {s.entity_kind} · {s.organization||'소속 미확인'}<small>{s.source} · {s.source_updated_at?time(s.source_updated_at):'자료 시각 미확인'}</small><p className="sales-desk-text">{s.evidence}</p>{/^https?:\/\//i.test(s.source_url)&&<a href={s.source_url} target="_blank" rel="noopener noreferrer">등록 출처 열기 ↗</a>}</li>)}</ul>:<p>조건에 맞는 저장 자료가 없습니다. 새로운 고객 수요가 확인됐다는 의미가 아닙니다.</p>}<h4>출처별 최근 수집 상태</h4>{m.snapshot.coverage.map(s=><p key={s.source}>{s.source} · {s.status}<br/>{s.note}</p>)}<h4>전체 영업 진행 단계</h4><p>{m.snapshot.pipeline.map(p=>`${p.stage} ${p.count}건`).join(' · ')||'등록된 진행 영업 없음'}</p></details></div></article>)}
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
