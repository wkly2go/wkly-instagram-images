import {useState} from 'react'
import {useAsync} from '../lib/app'
import type {SalesReportApi,SalesDataReadiness,SalesSourceVersion} from '../lib/salesReport'
import {Button} from './ui'
import './SalesEvidence.css'
const time=(value:string|null)=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'확인되지 않음'
export function SalesDataStatus({api,revision}:{api:SalesReportApi;revision:unknown}){
 const state=useAsync<SalesDataReadiness|null>(()=>api.getSalesDataReadiness(),[api,revision],null),d=state.data
 return <section className="sales-data-status" aria-label="영업 자료 자동화 준비 현황">
  <header><h2>영업 자료 자동화 준비 현황</h2><Button kind="outline" disabled={state.loading} onClick={state.reload}>자료 상태 새로고침</Button></header>
  {state.loading?<p role="status">현재 자료 상태를 확인하고 있습니다.</p>:state.error?<p role="alert">{state.error}</p>:d&&<>
   <dl>{[['통합 자료',d.counts.total],['회사',d.counts.companies],['사람',d.counts.people],['미분류',d.counts.unclassified],['내용 검증 완료',d.counts.content_verified],['수신거부·제외',d.counts.blocked],['출처·근거 보완 필요',d.counts.missing_source],['연락 창구 보완 필요',d.counts.missing_contact],['진행 영업 연결',d.counts.linked_opportunities]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString('ko-KR')}건</dd></div>)}</dl>
   <p>오늘 신규 자료 {d.new_today.toLocaleString('ko-KR')}건 · 최초 이관 자료 {d.baseline.toLocaleString('ko-KR')}건</p>
   <p className="sales-report-note">출처별 자료 건수입니다. 같은 회사의 여러 자료가 포함되며 최초 이관 자료는 신규 발굴에서 제외합니다. 보완 항목은 서로 겹칠 수 있습니다.</p>
   <p><strong>{d.sending_enabled?'발송 연결 활성':'발송 연결 전'}</strong> · {d.sending_status}</p>
   <p className="sales-report-note">내용 검증은 발송 승인이 아닙니다. 자료 보완·자동 검증 연결은 개발 중이며, 현재 이 현황은 담당자에게 원자료 가공 업무를 배정하지 않습니다.</p>
  </>}
 </section>
}
export function SalesSourceHistory({api,id}:{api:SalesReportApi;id:string}){
 const [open,setOpen]=useState(false)
 return <section className="sales-source-history" aria-label="출처 변경 이력"><Button kind="outline" onClick={()=>setOpen(v=>!v)}>{open?'출처 이력 닫기':'출처 변경 이력 보기'}</Button>{open&&<HistoryPage key={id} api={api} id={id}/>}</section>
}
function HistoryPage({api,id}:{api:SalesReportApi;id:string}){
 const [cursors,setCursors]=useState<(number|null)[]>([null]),cursor=cursors[cursors.length-1]
 const state=useAsync<SalesSourceVersion[]|null>(()=>api.getSalesSourceVersions(id,cursor),[api,id,cursor],null),rows=state.data??[]
 return <>
  <p>시스템이 보존한 자료의 변경 이력입니다. 원문 열람은 선택 사항이며 입력이나 재가공은 필요하지 않습니다.</p>
  {state.loading?<p role="status">출처 이력을 확인하고 있습니다.</p>:state.error?<div><p role="alert">{state.error}</p><Button kind="outline" onClick={state.reload}>이력 다시 조회</Button></div>:<>
   {!rows.length&&<p>이 페이지에 저장된 출처 이력이 없습니다.</p>}
   <ol>{rows.map(row=><li key={row.id}><strong>버전 {row.version} · {row.origin==='baseline'?'기존 자료 최초 이관':'자료 수집·변경'}</strong><p>{time(row.captured_at)} · {row.snapshot.source} · {row.snapshot.name}</p><p>{row.snapshot.organization||'소속 미확인'} · {row.snapshot.entity_kind} · {row.snapshot.blocked?'수집 당시 제외 상태':'수집 당시 제외 표시 없음'}</p>
    <details><summary>보존된 원문과 연락 창구</summary><p className="sales-evidence-text">{row.snapshot.evidence||'보존된 본문 없음'}</p><p>{row.snapshot.contact||'연락 창구 미확인'}</p>{/^https?:\/\//i.test(row.snapshot.source_url)&&<a href={row.snapshot.source_url} target="_blank" rel="noopener noreferrer">당시 출처 열기 ↗</a>}<p>원문 시각 {time(row.source_updated_at)} · 마지막 수집 {time(row.last_collected_at)}</p></details>
   </li>)}</ol>
  </>}
  <nav aria-label="출처 이력 페이지"><Button kind="outline" disabled={state.loading||cursors.length===1} onClick={()=>setCursors(v=>v.slice(0,-1))}>최근 이력</Button><span>{cursors.length}페이지</span><Button kind="outline" disabled={state.loading||!!state.error||rows.length<20} onClick={()=>setCursors(v=>[...v,rows[rows.length-1].version])}>이전 이력 더 보기</Button></nav>
 </>
}
