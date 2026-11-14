import { useEffect, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { todayKey } from '../lib/date'
import { ASSESSMENTS, ENTITY_KINDS, EMPTY_REPORT, effectiveAssessment, effectiveKind, sourceIsStale, type Assessment, type EntityKind, type ReportFilter, type SalesProspect } from '../lib/salesReport'
import { Button, Field } from './ui'
import { SalesEditor, useDraftGuard } from './SalesEditor'
import { SALES_STAGES, type SalesOpportunity } from '../lib/sales'
import './SalesReport.css'

const time=(s:string|null)=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'확인 전'
export function SalesReport(){
 const {api,me,version}=useApp()
 const [filter,setFilter]=useState<ReportFilter>({search:'',kind:'',assessment:'',page:0})
 const [input,setInput]=useState('')
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[actionError,setActionError]=useState('')
 const [selected,setSelected]=useState<SalesOpportunity|null>(null)
 const {data,loading,error,reload}=useAsync(()=>api.getSalesReport(filter),[filter,version],EMPTY_REPORT)
 useEffect(()=>{const t=window.setTimeout(()=>setFilter(f=>({...f,search:input,page:0})),300);return()=>window.clearTimeout(t)},[input])
 const pending=data.sources.some(s=>s.status==='수집 중')
 useEffect(()=>{if(!pending)return;const t=window.setInterval(reload,15000);return()=>window.clearInterval(t)},[pending,reload])
 const run=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setActionError('');try{await task()}catch(e){setActionError(e instanceof Error?e.message:'처리하지 못했습니다. 다시 확인해 주세요.')}finally{setBusy(false)}}
 const open=async(p:SalesProspect)=>run(async()=>{const id=p.linked_sales_id??await api.startSalesProspect(p.id);setSelected(await api.getSales(id));reload()})
 const automatic=data.schedules.length===3&&data.schedules.every(s=>s.active)
 const briefing=data.briefing
 const current=briefing?.report_date===todayKey()
 const stale=data.sources.filter(s=>sourceIsStale(s)||s.status==='실패')
 const change=(patch:Partial<ReportFilter>)=>setFilter(f=>({...f,...patch,page:0}))
 return <article className="sales-report" aria-label="영업 일일 보고서">
  <header className="sales-report-masthead">
   <div><p className="sales-report-eyebrow">THE WKLY · DAILY SALES REPORT</p><h1>오늘의 영업 보고</h1><p>{new Date().toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'long'})}</p></div>
   <div className="sales-report-schedule"><strong>{automatic?'매일 자동 보고':'자동 보고 설정 확인 중'}</strong><span>08:00 자료 취합 → 09:00 브리핑 · 한국 시간</span><small>이 화면을 닫아도 서버에서 실행합니다.</small></div>
  </header>
  <div className="sales-report-toolbar"><p>현황을 읽고, 아래 항목에서 바로 영업을 진행하세요.</p><div className="row wrap"><Button kind="outline" disabled={busy||loading} onClick={reload}>새로고침</Button>{me.role==='admin'&&<Button kind="outline" disabled={busy||pending||api.mode==='demo'} onClick={()=>run(async()=>{await api.collectSalesReport();setNotice('자료 취합을 시작했습니다. 외부 자료가 도착하면 자동으로 갱신됩니다.');reload()})}>지금 자료 취합</Button>}<Button kind="outline" onClick={()=>window.print()}>보고서 인쇄</Button></div></div>
  {api.mode==='demo'&&<p className="sales-report-note">체험 화면입니다. 운영 계정에서 실제 수집 자료와 매일 브리핑이 표시됩니다.</p>}
  {(error||actionError)&&<p role="alert" className="sales-report-alert">{actionError||error}</p>}
  {notice&&<p role="status" className="sales-report-note">{notice}</p>}
  <section className="sales-report-summary" aria-labelledby="sales-brief-title">
   <div className="sales-report-section-title"><span>01</span><h2 id="sales-brief-title">{current?'오늘의 브리핑':briefing?`${briefing.report_date} 브리핑`:'브리핑 준비 중'}</h2><small>{briefing?`${time(briefing.created_at)} 작성`:'매일 오전 9시에 작성됩니다'}</small></div>
   <p className="sales-report-lead">{briefing?.summary??'연결된 영업 자료를 취합하면 신규 후보와 우선순위를 이곳에서 확인할 수 있습니다.'}</p>
   <p>{briefing?.direction??'회사·담당자·공개 행사 자료를 분석하고, 후속 연락과 신규 발굴의 실행 순서를 정리합니다.'}</p>
   {!current&&briefing&&<p className="sales-report-note">오늘 브리핑이 아직 없습니다. 위 내용은 마지막 발행본이며 아래 현황은 현재 자료입니다.</p>}
   <div className="sales-report-metrics" aria-label="현재 영업 현황">{[['오늘 신규',data.counts.new,'건'],['우선 검토',data.counts.priority,'건'],['후속 연락',data.due,'건'],['회사',data.counts.companies,'곳'],['사람',data.counts.people,'명']].map(([label,value,unit])=><div key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>)}</div>
  </section>
  <section className="sales-report-section" aria-labelledby="sales-action-title"><div className="sales-report-section-title"><span>02</span><h2 id="sales-action-title">오늘의 실행 순서</h2></div>
   {data.due>0&&<p className="sales-report-priority">진행 영업 {data.due}건의 후속 연락일이 도래했습니다. 아래 ‘진행 중인 영업’에서 담당자·다음 행동을 먼저 확인하세요.</p>}
   {briefing?.actions.length?<ol className="sales-report-actions">{briefing.actions.map(p=><li key={p.id}><div><strong>{p.name}</strong><span>{p.organization||p.source} · {p.assessment}</span><p>{p.next_action}</p></div><Button kind="outline" onClick={()=>{setInput(p.name);change({kind:'',assessment:''})}}>자료 확인</Button></li>)}</ol>:<p className="sales-report-empty">브리핑 발행 후 오늘의 우선 검토 대상과 실행 방법이 표시됩니다.</p>}
   <div className="sales-report-method"><strong>제안 준비 방법</strong><p>① 공식 일정과 기존 접촉 이력 확인 → ② 담당 부서·미발주 범위·예산·결정일 확인 → ③ 팝업 기획·공간 제작·운영·홍보 중 필요한 범위 제안 → ④ 다음 연락일 기록</p></div>
  </section>
  <section className="sales-report-section" aria-labelledby="sales-network-title"><div className="sales-report-section-title"><span>03</span><h2 id="sales-network-title">신규 영업처와 영업망</h2><small>총 {data.counts.total}건 · 조회 {data.total}건</small></div>
   <p className="sales-report-note">‘우선 검토’는 공개된 단서에 따른 검토 순서입니다. 실제 수요·예산·담당 권한은 확인이 필요합니다. 동명이인은 자동으로 합치지 않습니다.</p>
   <div className="sales-report-filters"><Field label="회사·이름·연락처 검색"><input className="input" value={input} onChange={e=>setInput(e.target.value)} placeholder="찾을 회사나 담당자"/></Field><Field label="대상 구분"><select className="select" value={filter.kind} onChange={e=>change({kind:e.target.value})}><option value="">전체</option>{ENTITY_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field><Field label="영업 가능성"><select className="select" value={filter.assessment} onChange={e=>change({assessment:e.target.value})}><option value="">전체</option>{ASSESSMENTS.map(k=><option key={k}>{k}</option>)}</select></Field></div>
   {loading&&<p role="status">자료를 읽고 있습니다…</p>}
   {!loading&&!error&&!data.prospects.length&&<p className="sales-report-empty">{filter.search||filter.kind||filter.assessment?'이 조건에 맞는 자료가 없습니다. 검색 조건을 바꿔 주세요.':'아직 취합된 자료가 없습니다. 자동 취합 후 표시됩니다.'}</p>}
   <div className="sales-report-network">{data.prospects.map(p=><ProspectRow key={p.id} prospect={p} disabled={busy||!!selected} onOpen={()=>void open(p)} onChanged={reload}/>)}</div>
   {data.total>20&&<div className="sales-report-pagination"><Button kind="outline" disabled={filter.page===0||loading} onClick={()=>setFilter(f=>({...f,page:f.page-1}))}>이전</Button><span>{filter.page+1} / {Math.ceil(data.total/20)}</span><Button kind="outline" disabled={(filter.page+1)*20>=data.total||loading} onClick={()=>setFilter(f=>({...f,page:f.page+1}))}>다음</Button></div>}
  </section>
  {selected&&<SalesEditor key={`${selected.id}:${selected.revision}`} initial={selected} inline title="영업 진행 내용" onClose={()=>setSelected(null)} onSaved={id=>void run(async()=>{setSelected(await api.getSales(id));reload()})}/>}
  <section className="sales-report-section" aria-labelledby="sales-pipeline-overview"><div className="sales-report-section-title"><span>04</span><h2 id="sales-pipeline-overview">수주 파이프라인 요약</h2><small>현재 진행 상태</small></div><div className="sales-report-pipeline">{SALES_STAGES.map(stage=><div key={stage}><span>{stage}</span><strong>{data.pipeline.find(p=>p.stage===stage)?.count??0}<small>건</small></strong></div>)}</div><p className="sales-report-note">이 보고서 아래 ‘진행 중인 영업’에서 단계·담당자·금액·다음 연락일을 수정할 수 있습니다.</p></section>
  <section className="sales-report-section" aria-labelledby="sales-source-title"><div className="sales-report-section-title"><span>05</span><h2 id="sales-source-title">자료 취합 현황</h2><small>{pending?'수집 진행 중':stale.length?`${stale.length}개 출처 확인 필요`:'출처별 수집 결과'}</small></div>
   {data.sources.map(s=><div className="sales-report-source" key={s.source}><div><strong>{s.source}</strong><span className={sourceIsStale(s)||s.status==='실패'?'sales-report-warn':''}>{s.status} · {s.count}건 · 자료 시각 {time(s.source_at)}</span></div><p>{s.note}</p></div>)}
   {!data.sources.length&&<p className="sales-report-empty">수집 이력이 아직 없습니다.</p>}
   <p className="sales-report-note">서울시·코엑스 공개 목록과 인트라넷에 연결된 영업 자료를 취합합니다. 공개 목록의 제공 범위와 오류를 표시하며, 미연결 외부 자료는 포함하지 않습니다.</p>
  </section>
 </article>
}
function ProspectRow({prospect:p,disabled,onOpen,onChanged}:{prospect:SalesProspect;disabled:boolean;onOpen:()=>void;onChanged:()=>void}){
 const {api,me}=useApp()
 const [editing,setEditing]=useState(false),[kind,setKind]=useState<EntityKind>(effectiveKind(p)),[assessment,setAssessment]=useState<Assessment>(effectiveAssessment(p)),[note,setNote]=useState(p.review_note),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [editRevision,setEditRevision]=useState(p.revision)
 const dirty=editing&&(kind!==effectiveKind(p)||assessment!==effectiveAssessment(p)||note!==p.review_note)
 const guard=useDraftGuard(dirty,busy)
 useEffect(()=>{if(!editing){setKind(effectiveKind(p));setAssessment(effectiveAssessment(p));setNote(p.review_note)}},[p,editing])
 const save=async()=>{setBusy(true);setError('');try{await api.reviewSalesProspect(p.id,editRevision,kind,assessment,note);guard.afterSaved(()=>{setEditing(false);onChanged()})}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}}
 return <section className="sales-report-prospect" aria-label={`영업처 · ${p.name}`}>
  <div className="sales-report-prospect-head"><div><span className="sales-report-kind">{effectiveKind(p)}</span><h3>{p.name}</h3><p>{p.organization||'소속 회사 확인 필요'}{p.contact&&` · ${p.contact}`}</p></div><div className="sales-report-prospect-action"><strong className={`sales-report-assessment ${effectiveAssessment(p)==='우선 검토'?'priority':''}`}>{effectiveAssessment(p)}</strong><Button kind="outline" disabled={disabled||(!p.linked_sales_id&&['제외','보류'].includes(effectiveAssessment(p)))} onClick={onOpen}>{p.linked_sales_id?'진행 내용 열기':'영업 시작'}</Button></div></div>
  <dl className="sales-report-facts"><div><dt>판단 근거</dt><dd>{p.reasons}{p.review_note&&<p>담당 검토: {p.review_note}</p>}</dd></div><div><dt>다음 행동</dt><dd>{p.next_action}</dd></div><div><dt>원본 정보</dt><dd>{p.evidence||'추가 자료 확인 필요'}</dd></div><div><dt>출처</dt><dd>{p.source} · {time(p.source_updated_at)}{p.source_url&&<span className="sales-report-url">{p.source_url}</span>}</dd></div></dl>
  {me.role==='admin'&&!editing&&<Button kind="ghost" size="sm" onClick={()=>{setEditRevision(p.revision);setEditing(true)}}>분류 수정</Button>}
  {editing&&<form className="sales-report-review" onSubmit={e=>{e.preventDefault();void save()}}><Field label="회사·사람 구분"><select className="select" value={kind} disabled={busy} onChange={e=>setKind(e.target.value as EntityKind)}>{ENTITY_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field><Field label="검토 결과"><select className="select" value={assessment} disabled={busy||p.blocked} onChange={e=>setAssessment(e.target.value as Assessment)}>{ASSESSMENTS.map(k=><option key={k}>{k}</option>)}</select></Field><Field label="판단 근거"><textarea className="input" required maxLength={2000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} placeholder="소속·담당 역할·실제 수요를 확인한 근거"/></Field>{error&&<p role="alert">{error}</p>}<div className="row"><Button type="submit" disabled={busy||!note.trim()}>분류 저장</Button><Button kind="outline" disabled={busy} onClick={()=>{guard.close('분류 변경을 취소할까요?',()=>setEditing(false))}}>취소</Button></div></form>}
 </section>
}
