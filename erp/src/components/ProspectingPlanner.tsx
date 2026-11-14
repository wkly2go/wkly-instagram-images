import { useState } from 'react'
import { todayKey } from '../lib/date'
import { PROSPECT_PLAYS, RESEARCH_SOURCES, newProspectPlan, prospectPlay, researchLinks, prospectTimeline, researchReadiness, buildProspectDraft, validDate, type ProspectPlan } from '../lib/prospecting'
import type { SalesDraft } from '../lib/sales'
import { safeWebUrl } from '../lib/growth'
import { ProspectSearchResults, type ProspectSearchResult } from './ProspectSearchResults'
import { Button, Field } from './ui'
import './ProspectingPlanner.css'

const searchKeywords: Record<ProspectPlan['play'], string> = {
  'popup-agency': '팝업', launch: '신제품', exhibition: '전시', space: '매장',
  office: '오피스', retail: '인테리어', season: '캠페인', public: '행사', partner: '공간', return: '브랜드',
}

export function ProspectingPlanner({ owner, disabled, onPending, onApply }: { owner: string; disabled: boolean; onPending: (pending: boolean) => void; onApply: (draft: SalesDraft, plan: ProspectPlan) => boolean }) {
  const [plan, setPlan] = useState(newProspectPlan)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)
  const [searchText, setSearchText] = useState<string | null>(null)
  const [sources, setSources] = useState({ local: true, official: true, publicTender: false })
  const [search, setSearch] = useState<{ query: string; sources: typeof sources; sequence: number } | null>(null)
  const [selectionMessage, setSelectionMessage] = useState('')
  const patch = (value: Partial<ProspectPlan>) => { setPlan(p => ({ ...p, ...value })); setApplied(false); onPending(true); setError('') }
  const play = prospectPlay(plan.play), today = todayKey(), timeline = prospectTimeline(plan, today), readiness = researchReadiness(plan, today)
  const searchQuery = searchText ?? (plan.target.trim() || searchKeywords[plan.play])
  const searchEnabled = !disabled && Boolean(searchQuery.trim()) && (sources.local || sources.official || sources.publicTender)
  const searchNow = () => {
    if (!searchEnabled) return
    setSelectionMessage('')
    setSearch(previous => ({ query: searchQuery.trim(), sources: { ...sources }, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const chooseResult = (result: ProspectSearchResult) => {
    if (disabled) return
    // A search candidate must never make a previously confirmed plan appear verified.
    if (plan.certainty === '확인' || plan.verifiedOn.trim()) {
      setSelectionMessage('출처 확인일 또는 확인한 일정이 있어 후보를 자동 적용하지 않았습니다. 기존 확인 내용을 검토한 뒤 필요한 내용을 직접 반영해 주세요.')
      return
    }
    const additions: Partial<ProspectPlan> = {}
    const fields: string[] = []
    // An official record with an explicitly missing organizer must stay unassigned.
    const target = result.target === undefined ? result.title : result.target
    if (!plan.target.trim() && target.trim()) {
      additions.target = target.trim().slice(0, 80)
      fields.push('대상 브랜드·기관')
    }
    if (!plan.event.trim() && result.event?.trim()) {
      additions.event = result.event.trim().slice(0, 120)
      fields.push('행사·사업명')
    }
    if (!plan.contact.trim() && result.contact?.trim()) {
      additions.contact = result.contact.trim().slice(0, 300)
      fields.push('담당 부서·공개 문의 창구')
    }
    if ((plan.event.trim() || additions.event) && !plan.start && result.start && validDate(result.start) && (!plan.end || result.start <= plan.end)) {
      additions.start = result.start
      fields.push('시작일 후보')
    }
    const start = plan.start || additions.start
    if ((plan.event.trim() || additions.event) && start && !plan.end && result.end && validDate(result.end) && result.end >= start) {
      additions.end = result.end
      fields.push('종료일 후보')
    }
    if (!plan.sourceUrl.trim() && result.sourceUrl && result.sourceUrl.length <= 2000 && safeWebUrl(result.sourceUrl)) {
      additions.sourceUrl = result.sourceUrl
      fields.push('출처 주소')
    }
    if (!plan.evidence.trim()) {
      additions.evidence = [`[검색 후보 · 사실 확인 필요] ${result.title}`, `자료 출처: ${result.sourceLabel}`, result.snippet].filter(Boolean).join('\n').slice(0, 2000)
      fields.push('확인 근거 초안')
    }
    if (fields.length) patch(additions)
    setSelectionMessage(fields.length
      ? `${fields.join('·')}의 빈칸에 후보를 반영했습니다. 기존 입력은 유지했습니다. 선택한 후보와 대상이 일치하는지, 원문·일정·담당자를 확인해 주세요. 확인일과 확인 상태는 자동 변경하지 않습니다.`
      : '입력된 대상·출처·근거를 유지했습니다. 후보 내용을 확인하고 필요한 부분을 직접 반영해 주세요.')
  }
  const apply = () => {
    try { const draft = buildProspectDraft(plan, owner, today); if (onApply(draft, plan)) { onPending(false); setApplied(true); setError('') } }
    catch (e) { setError(e instanceof Error ? e.message : '발굴 계획을 확인해 주세요.') }
  }
  const field = (label: string, key: 'target'|'industry'|'region'|'event'|'contact'|'sourceUrl'|'verifiedOn'|'start'|'end'|'month'|'agencyScope'|'agencyBudget'|'agencyDecision', type = 'text', max = 80) => <Field label={label}><input className="input" type={type} maxLength={max} value={plan[key] ?? ''} onChange={e => patch({ [key]: e.target.value })} /></Field>
  return <section className="prospect-planner" aria-label="신규 대상 발굴 계획">
    <h3 className="t-sub">대상 찾기 → 공식 일정 확인 → 맞춤 제안</h3>
    <a href="/manual/growth.html#prospecting" target="_blank" rel="noopener noreferrer">발굴 계획 따라 하기</a>
    <p className="t-small">기존 거래처와 공식 행사·공고를 이 화면에서 찾아 후보를 검토하세요. 선택한 자료는 빈칸에만 반영됩니다. 원문을 확인한 뒤 영업 정보에 적용하고 저장하세요. 검색은 AI 호출·저장·발송을 실행하지 않습니다.</p>
    <fieldset disabled={disabled} className="sales-fieldset form-grid">
      <Field label="발굴 경로" className="full"><select className="select" autoFocus value={plan.play} onChange={e => { const selected = prospectPlay(e.target.value as ProspectPlan['play']); patch({ play: selected.id, leadDays: selected.lead }) }}>{PROSPECT_PLAYS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      <div className="full prospect-strategy"><strong>찾아볼 대상: {play.target}</strong><p>제안: {play.offer}</p><p>확인 자료: {play.evidence}</p><p>첫 질문: {play.question}</p></div>
      {field('대상 브랜드·기관 *', 'target')}{field('업종·제품', 'industry')}{field('관심 지역', 'region')}{field('검색 연월', 'month', 'month')}
      <section className="full prospect-native-search" aria-label="인트라넷 대상 검색">
        <h4>이 화면에서 영업 대상 찾기</h4>
        <div className="prospect-search-controls">
          <Field label="발굴 검색어"><input className="input" value={searchQuery} maxLength={100} onChange={event => {
            setSearchText(event.target.value); setSearch(null)
          }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); searchNow() } }} placeholder="브랜드명 또는 짧은 업무 키워드" /></Field>
          <Button kind="outline" disabled={!searchEnabled} onClick={searchNow}>이 화면에서 대상 찾기</Button>
        </div>
        <div className="row wrap" role="group" aria-label="발굴 검색 출처">
          <label className="row"><input type="checkbox" checked={sources.local} onChange={event => {
            setSources(current => ({ ...current, local: event.target.checked })); setSearch(null)
          }} />기존 거래처·담당자</label>
          <label className="row"><input type="checkbox" checked={sources.official} onChange={event => {
            setSources(current => ({ ...current, official: event.target.checked })); setSearch(null)
          }} />공식 문화행사</label>
          <label className="row"><input type="checkbox" checked={sources.publicTender} onChange={event => {
            setSources(current => ({ ...current, publicTender: event.target.checked })); setSearch(null)
          }} />나라장터 공고</label>
        </div>
        <p className="t-cap">브랜드나 기관을 알면 이름으로, 아직 모르면 팝업·전시·인테리어처럼 짧은 키워드로 찾아보세요. 검색 범위와 최신성은 자료 출처마다 다릅니다.</p>
        {search && <><p className="t-small">표시 중인 검색어: <strong>{search.query}</strong></p><ProspectSearchResults key={search.sequence} query={search.query} sources={search.sources} onSelect={chooseResult} disabled={disabled} /></>}
        {selectionMessage && <p role="status" className="sales-notice">{selectionMessage}</p>}
      </section>
      <details className="full sales-options"><summary>외부 검색 참고</summary>
        <p className="t-small">연결된 자료에서 찾지 못한 대상은 외부 검색으로 확인할 수 있습니다. 아래 링크는 새 창에서 열립니다.</p>
        <div className="prospect-searches"><h4>검색할 항목</h4>{researchLinks(plan).map(link => <div key={link.label}><strong>{link.label}</strong><small>{link.query}</small><a href={link.google} target="_blank" rel="noopener noreferrer">Google 검색</a> · <a href={link.naver} target="_blank" rel="noopener noreferrer">네이버 검색</a></div>)}</div>
        <div className="prospect-sources"><h4>공식 일정·사업 확인</h4>{RESEARCH_SOURCES.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a> · {source.hint}</p>)}</div>
      </details>
      {field('행사·사업명', 'event', 'text', 120)}
      <Field label="일정 확인 상태"><select className="select" value={plan.certainty} onChange={e => patch({ certainty: e.target.value as ProspectPlan['certainty'] })}>{['미확인','예정','확인'].map(x => <option key={x}>{x}</option>)}</select></Field>
      {field('행사·사업 시작일', 'start', 'date')}{field('종료일 (선택)', 'end', 'date')}
      {field('공식 출처 주소', 'sourceUrl', 'url', 2000)}{field('출처 확인일', 'verifiedOn', 'date')}
      <Field label="확인 근거" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={plan.evidence} onChange={e => patch({ evidence: e.target.value })} placeholder="공식 공지의 날짜·장소와 변경 여부. 검색 요약만으로 확정하지 마세요." /></Field>
      {field('담당 부서·공개 문의 창구', 'contact', 'text', 300)}
      <Field label="권장 준비 기간 (일)"><input className="input" type="number" min={7} max={180} step={1} value={plan.leadDays} onChange={e => patch({ leadDays: Number(e.target.value) })} /><small>업무별 제안값입니다. 실제 일정에 맞게 조정하세요.</small></Field>
      <Field label="수요·접근 계기" className="full"><textarea className="textarea" rows={3} maxLength={1000} value={plan.need} onChange={e => patch({ need: e.target.value })} placeholder="왜 지금 연락해야 하는지, 어떤 도움을 제안할지 적어 주세요." /></Field>
      {plan.play === 'popup-agency' && <>
        {field('미발주 대행 범위', 'agencyScope', 'text', 500)}
        {field('고객 예산 범위', 'agencyBudget', 'text', 200)}
        {field('대행사 선정 목표일', 'agencyDecision', 'date')}
        {plan.agencyDecision && plan.agencyDecision <= today && <p className="sales-notice full">선정 목표일이 도래했습니다. 대행사 확정 여부와 추가 발주 가능 범위를 먼저 확인하세요.</p>}
      </>}
      <div className="full prospect-readiness"><strong>검토 준비도 {readiness.score}/100</strong><p className="t-cap">입력 충실도이며 수주 확률·검증된 신뢰 점수가 아닙니다.</p>{readiness.checks.map(c => <span key={c.label}>{c.done ? '✓' : '○'} {c.label} {c.points}점</span>)}</div>
      <div className="full"><h4>행사일에서 역산한 제안 일정</h4>{timeline.length ? <><p className="t-cap">{plan.certainty === '확인' ? '입력한 확인 일정 기준' : '미확정 일정 기준 가안'} · 한국 날짜 · 계약 마감과 입찰 마감은 별도 확인</p><ol className="prospect-timeline">{timeline.map((item,i) => <li key={i}><time>{item.date}</time><strong>{item.label}</strong>{item.overdue && <span className="sales-due">경과 · 일정 재조정</span>}</li>)}</ol></> : <p>행사 시작일을 확인하면 권장 일정이 표시됩니다.</p>}{plan.start && (plan.end || plan.start) < today && <p className="sales-notice">종료된 행사입니다. 결과 분석·다음 회차 제안으로 전환하세요.</p>}</div>
      <div className="full row wrap"><Button kind="outline" onClick={apply}>발굴 계획을 영업 정보에 적용</Button>{applied && <span role="status">적용했습니다. 아래 영업 정보를 확인한 뒤 저장하세요.</span>}</div>
      {error && <p role="alert" className="full sales-error">{error}</p>}
    </fieldset>
  </section>
}
