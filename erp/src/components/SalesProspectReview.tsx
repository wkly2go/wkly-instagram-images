import { useRef, useState, useEffect } from 'react'
import { useApp } from '../lib/app'
import { effectiveAssessment, effectiveKind, ENTITY_KINDS, type EntityKind, PROSPECT_ROLES, type ProspectRole, type ProspectVerification, type SalesProspect } from '../lib/salesReport'
import { recommendSalesMethod, salesEvidenceLinks } from '../lib/salesMethods'
import { SalesMethodAdvice } from './SalesMethodAdvice'
import { useDraftGuard } from './SalesEditor'
import { Button, Field } from './ui'

export function SalesProspectReview({prospect:p,onUpdated,onClose,onStart,opening}:{prospect:SalesProspect;onUpdated:(p:SalesProspect)=>void;onClose:()=>void;onStart:()=>void;opening:boolean}){
 const {api,me,profileName}=useApp(),panel=useRef<HTMLElement>(null)
 const initial:ProspectVerification={role:p.verification?.role??'미확인',need:p.verification?.need??'',scope:p.verification?.scope??'',evidence:p.verification?.evidence??'',status:p.verification?.status??'추가 확인'}
 const [kind,setKind]=useState<EntityKind>(effectiveKind(p))
 const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const dirty=kind!==effectiveKind(p)||JSON.stringify(value)!==JSON.stringify(initial),guard=useDraftGuard(dirty,busy||opening)
 const editable=me.role==='admin',method=recommendSalesMethod({...p,assessment:effectiveAssessment(p),verifiedRole:p.verification_current?p.verification?.role:undefined})
 useEffect(()=>{panel.current?.focus()},[p.id])
 const set=<K extends keyof ProspectVerification>(key:K,v:ProspectVerification[K])=>setValue(old=>({...old,[key]:v}))
 const save=async()=>{
  if(busy)return
  setBusy(true);setError('')
  try{const row=await api.verifySalesProspect(p.id,p.revision,value,kind);guard.afterSaved(()=>onUpdated(row))}
  catch(e){setError(e instanceof Error?e.message:'검증 결과를 저장하지 못했습니다.')}
  finally{setBusy(false)}
 }
 return <section ref={panel} tabIndex={-1} className="sales-prospect-verification" aria-label={`내용 검증 · ${p.name}`}>
  <header className="sales-verification-header"><div><span>{effectiveKind(p)} · {effectiveAssessment(p)}</span><h2>{p.name} · 내용 검증</h2></div><Button kind="ghost" disabled={busy||opening} onClick={()=>guard.close('저장하지 않은 검증 내용을 닫을까요?',onClose)}>검증 닫기</Button></header>
  <p><b>어떤 영업인가요?</b> {p.verification_current?`${p.verification?.role} · ${p.verification?.need}`:method.intent}</p>
  <p className="sales-report-note">{p.verification_current?'담당자가 확인한 수요와 범위입니다.':'아직 확인된 발주 건이 아닙니다. 아래 원문을 읽고 실제 수요와 역할을 검증하세요.'}</p>
  <dl className="sales-report-facts"><div><dt>회사·연락처</dt><dd>{p.organization||'소속 미확인'} · {p.contact||'연락처 미확인'}</dd></div><div><dt>자료 시각</dt><dd>{p.source_updated_at?new Date(p.source_updated_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'원문 작성 시각 미확인'}</dd></div></dl>
  <div className="sales-verification-source"><h3>판단에 사용한 원문 기록</h3><blockquote>{p.evidence||'저장된 원문 내용이 없습니다. 출처에서 확인한 뒤 근거를 남겨 주세요.'}</blockquote><p>{p.source}{salesEvidenceLinks(p).map(link=><span key={link.url}> · <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a></span>)}</p><small>수집된 기록을 그대로 표시합니다. 제목·메모만 저장된 자료는 원문 전체와 대조해야 합니다.</small></div>
  <p><b>자동 분류 근거</b> · {p.reasons}</p>
  {p.verification?.verified_at&&<p className="sales-report-note">마지막 검토: {profileName(p.verification.verified_by??'')} · {new Date(p.verification.verified_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {p.verification.status}{!p.verification_current&&p.verification.status==='확인'?' · 원본 또는 제외 상태가 달라져 재검증이 필요합니다.':''}</p>}
  <form className="sales-report-review sales-verification-form" onSubmit={e=>{e.preventDefault();void save()}}>
   <h3>영업 연결 전 확인</h3><p>아는 사실만 기록하세요. 수요가 없거나 확인하지 못했다면 ‘추가 확인’으로 남겨 둡니다.</p>
   <Field label="회사·사람 구분"><select className="select" disabled={!editable||busy} value={kind} onChange={e=>setKind(e.target.value as EntityKind)}>{ENTITY_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field>
   <Field label="상대의 역할"><select className="select" disabled={!editable||busy} value={value.role} onChange={e=>set('role',e.target.value as ProspectRole)}>{PROSPECT_ROLES.map(r=><option key={r}>{r}</option>)}</select></Field>
   <Field label="실제 요청·수요"><textarea className="input" disabled={!editable||busy} value={value.need} maxLength={2000} required={value.status==='확인'} placeholder="예: 12월 팝업 공간 제작 견적 요청. 단순 업체 홍보라면 수요 미확인으로 기록" onChange={e=>set('need',e.target.value)}/></Field>
   <Field label="우리가 맡을 업무 범위"><textarea className="input" disabled={!editable||busy} value={value.scope} maxLength={2000} required={value.status==='확인'} placeholder="예: 공간 설계·제작 견적. 협력사는 실제 고객 건과 공동 수행 범위를 기록" onChange={e=>set('scope',e.target.value)}/></Field>
   <Field label="검증 근거·확인일"><textarea className="input" disabled={!editable||busy} value={value.evidence} maxLength={2000} required placeholder="원문 제목·날짜·담당자 답변 등 확인한 사실과 아직 모르는 사항" onChange={e=>set('evidence',e.target.value)}/></Field>
   <Field label="검증 결과"><select className="select" disabled={!editable||busy} value={value.status} onChange={e=>set('status',e.target.value as ProspectVerification['status'])}><option>추가 확인</option><option disabled={p.blocked}>확인</option><option>보류</option><option>제외</option></select></Field>
   {error&&<p role="alert" className="sales-report-alert">{error}</p>}
   <div className="row wrap">{editable?<Button type="submit" disabled={busy||opening||!value.evidence.trim()||(value.status==='확인'&&(value.role==='미확인'||!value.need.trim()||!value.scope.trim()||p.blocked))}>{busy?'저장 중…':'검증 결과 저장'}</Button>:<p className="sales-report-note">관리자가 공용 영업망의 검증 결과를 저장할 수 있습니다.</p>}
   <Button kind="outline" disabled={busy||opening||dirty||(!p.linked_sales_id&&(!p.verification_current||['제외','보류'].includes(effectiveAssessment(p))))} onClick={onStart}>{p.linked_sales_id?'진행 내용 열기':'검증한 내용으로 영업 시작'}</Button></div>
   {!p.linked_sales_id&&!p.verification_current&&<p className="sales-report-note">역할·실제 수요·수행 범위·근거를 확인으로 저장하면 영업을 시작할 수 있습니다.</p>}
  </form>
  <SalesMethodAdvice input={{...p,assessment:effectiveAssessment(p),verifiedRole:p.verification_current?p.verification?.role:undefined}}/>
 </section>
}
