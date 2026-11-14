import { showPanel } from '../components/WebSearch'
import { SalesReport } from '../components/SalesReport'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { SalesPanel, useDraftGuard, ContactSalesPlan, SalesEditor } from '../components/SalesEditor'
import { readSalesView, salesViewUrl } from '../lib/salesNavigation'
import { SALES_COMPANIES, SALES_SOURCES, SALES_STAGES, canEditSales, newSalesDraft, type SalesDraft, type SalesFilter, type SalesOpportunity } from '../lib/sales'
import { SalesActivities } from '../components/SalesActivities'
import { type GrowthItem } from '../lib/growth'
import { emptySalesPlan, readSalesPlan, reviewSalesQueue, writeSalesPlan } from '../lib/salesPlan'
import { Button, Field } from '../components/ui'
import { SalesOrigins } from '../components/SalesOrigins'
import { SalesPlaybook } from '../components/SalesPlaybook'
import { SalesPlanOutput } from '../components/SalesPlanSheet'
import { Shell } from '../components/Shell'
import { GrowthWorkspace } from '../components/GrowthWorkspace'
import { SeoulPopulationCompare } from '../components/SeoulPopulationCompare'
import { SeoulEventDiscovery } from '../components/SeoulEventDiscovery'
import { SEOUL_EVENT_DATASET, SEOUL_POPULATION_DATASET, type SeoulEvent } from '../lib/seoulSales'
import './Sales.css'

export default function Sales() {
  const { query, navigate } = useRouter()
  const { me, api } = useApp()
  const [wide, setWide] = useState(true)
  useEffect(()=>{const show=()=>setWide(false);window.addEventListener('wkly-show-right-panel',show);return()=>window.removeEventListener('wkly-show-right-panel',show)},[])
  const [seoulDraft, setSeoulDraft] = useState<SalesDraft | null>(null)
  const [candidatePlan, setCandidatePlan] = useState<{ id: string; candidate: GrowthItem } | null>(null)
  const tab = query.has('id') || query.get('new') === '1' ? 'pipeline' : ['contacts', 'tenders', 'seoul'].includes(query.get('tab') ?? '') ? query.get('tab')! : 'pipeline'
  const tabs = [['pipeline', '수주 파이프라인'], ['contacts', '민간 영업 후보'], ['tenders', '나라장터 공고'], ['seoul', '서울 행사·입지']] as const
  useEffect(() => { if (tab !== 'seoul') setSeoulDraft(null) }, [tab])

  const reviewEvent = (event: SeoulEvent) => {
    const today = todayKey()
    const ended = Boolean(event.end && event.end < today)
    const nextAction = ended ? '다음 회차 일정과 주최기관 문의처 확인' : '주최기관 원문에서 모집 상태와 미발주 범위 확인'
    const notes = [
      `행사: ${event.title}`,
      `일정: ${event.start || '미확인'} ~ ${event.end || '미확인'}`,
      `장소: ${[event.district, event.venue].filter(Boolean).join(' · ') || '미확인'}`,
      `출처: ${SEOUL_EVENT_DATASET}`,
    ].join('\n')
    setSeoulDraft({
      ...newSalesDraft(me.id),
      title: event.title.slice(0, 160),
      source_url: event.url || SEOUL_EVENT_DATASET,
      next_date: today,
      next_action: nextAction,
      description: writeSalesPlan(notes, {
        ...emptySalesPlan(),
        target: event.organization.slice(0, 160),
        targetDate: event.start,
        evidence: '서울 열린데이터광장의 문화행사 공개 일정',
      }),
    })
  }

  const useLocationEvidence = (description: string) => {
    setSeoulDraft({
      ...newSalesDraft(me.id),
      source_url: SEOUL_POPULATION_DATASET,
      next_action: '후보 공간의 대관비·사용 가능일·반입 및 시공 조건 확인',
      description,
    })
  }
  return <Shell active="sales"><div className={`sales-page${wide?' sales-wide':''}`}>
    <div className="sales-page-tools"><Button kind="outline" aria-expanded={!wide} onClick={()=>{setWide(!wide);if(wide)showPanel()}}>{wide?'일정 펼치기':'본문 넓게 보기'}</Button></div>
    <SalesReport />
    <header className="sales-heading"><h2 className="t-title">진행 중인 영업</h2><p>발굴 → 접촉 → 미팅 → 제안 → 협상 → 수주 순서로 진행 상태와 다음 행동을 기록합니다.</p></header>
    <nav aria-label="영업 업무" className="sales-stages">{tabs.map(([key, label]) => <button type="button" key={key} className={`btn ${tab === key ? '' : 'btn-outline'}`} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(withQuery('/sales', query, { tab: key === 'pipeline' ? null : key, id: null, new: null, research: null }))}>{label}</button>)}</nav>
    {tab === 'pipeline' ? <SalesPipeline candidatePlan={candidatePlan} clearCandidate={() => setCandidatePlan(null)} /> : tab === 'seoul' ? <>
      <SeoulEventDiscovery onEvent={reviewEvent} loadEvents={api.getCollectedSeoulEvents} />
      <SeoulPopulationCompare onEvidence={useLocationEvidence} />
      {seoulDraft && <SalesEditor initial={null} seed={seoulDraft} onClose={() => setSeoulDraft(null)} onSaved={id => {
        setSeoulDraft(null)
        navigate(withQuery('/sales', query, { tab: null, new: null, research: null, id }))
      }} />}
    </> : <GrowthWorkspace key={tab} kind={tab === 'tenders' ? 'tender' : 'contact'} embedded
      renderContactPlan={(candidate, actions) => <ContactSalesPlan key={candidate.id} candidate={candidate} actions={actions} />}
      onPlanCandidate={(candidate, id) => {
      setCandidatePlan({ id, candidate })
      navigate(withQuery('/sales', query, { tab: null, new: null, research: null, id }))
    }} />}
  </div></Shell>
}

function SalesPipeline({ candidatePlan, clearCandidate }: { candidatePlan: { id: string; candidate: GrowthItem } | null; clearCandidate: () => void }) {
  const { api, me, profileName, version } = useApp()
  const [filter, setFilter] = useState<SalesFilter>({ page: 0 })
  const [search, setSearch] = useState('')
  const { query, navigate } = useRouter()
  const view = readSalesView(query)
  const today = todayKey()
  const selection = view.kind === 'detail' ? view.id : null
  const adding = view.kind === 'new'
  const opener = useRef<HTMLElement | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const active = Boolean(adding || selection)
  const hadPanel = useRef(active)
  useEffect(() => {
    if (!active && hadPanel.current) {
      const target = opener.current?.isConnected ? opener.current : toolbar.current?.querySelector('button:last-child')
      if (target instanceof HTMLElement) target.focus()
      opener.current = null
    }
    hadPanel.current = active
  }, [active])
  const rememberOpener = () => {
    if (!active && document.activeElement instanceof HTMLElement) opener.current = document.activeElement
  }
  useEffect(() => {
    const t = window.setTimeout(() => setFilter(f => f.search === search ? f : ({ ...f, page: 0, search })), 350)
    return () => window.clearTimeout(t)
  }, [search])
  const { data, loading, error, reload } = useAsync(() => api.listSales(filter), [filter, version], { items: [], hasMore: false })
  const queue = reviewSalesQueue(data.items, today, filter.work === 'handoff' ? 'handoff' : 'all')
  const change = (p: Partial<SalesFilter>) => setFilter(f => ({ ...f, ...p, page: 0 }))
  const openOpportunity = (id: string) => {
    if (selection === id && !adding) return
    rememberOpener()
    navigate(salesViewUrl(query, { kind: 'detail', id }))
  }
  const startAdding = (research = false) => {
    if (adding && (query.get('research') === '1') === research) return
    rememberOpener()
    const next = new URLSearchParams(query)
    if (research) next.set('research', '1'); else next.delete('research')
    navigate(salesViewUrl(next, { kind: 'new' }))
  }
  const closePanel = () => {
    clearCandidate()
    navigate(withQuery('/sales', query, { id: null, new: null, research: null }), { replace: true })
  }
  return <div className="sales-pipeline">
    <div className="sales-header" ref={toolbar}>
      <h2 className="t-sub sales-heading">수주 파이프라인</h2>
      <a href="/manual/growth.html#sales" target="_blank" rel="noreferrer" className="sales-help-link">화면 사용설명</a>
      <Button kind="outline" onClick={() => startAdding(true)}>신규 대상 발굴</Button>
      <Button onClick={() => startAdding()}>+ 영업 기회</Button>
    </div>
    {api.mode === 'demo' && <p className="sales-notice">체험 모드 · 이 브라우저에만 저장됩니다. 실제 회사 자료와 분리됩니다.</p>}
    <div className={active ? 'sales-desk sales-desk-active' : 'sales-desk'}>
      {adding && <SalesEditor key={query.get('research') ?? 'new'} inline discovery={query.get('research') === '1'} initial={null} onClose={closePanel} onSaved={id => {
        navigate(withQuery('/sales', query, { new: null, research: null, id }), { replace: true })
        reload()
      }} />}
      {selection && <SalesDetail key={selection} id={selection} candidate={candidatePlan?.id === selection ? candidatePlan.candidate : undefined}
        onClose={closePanel} onCandidateUsed={clearCandidate} onChanged={reload} />}
      <section className="sales-queue" aria-label="영업 실행 목록">
        <div className="sales-stages sales-work-filters">
          <Button kind={!filter.work && !filter.dueBefore ? 'blue' : 'outline'} aria-pressed={!filter.work && !filter.dueBefore} onClick={() => change({ work: '', dueBefore: undefined, stage: '' })}>전체 기회</Button>
          <Button kind={filter.dueBefore ? 'blue' : 'outline'} aria-pressed={Boolean(filter.dueBefore)} onClick={() => change({ work: '', dueBefore: today, stage: '' })}>오늘까지 후속 연락</Button>
          <Button kind={filter.work === 'unscheduled' ? 'blue' : 'outline'} aria-pressed={filter.work === 'unscheduled'} onClick={() => change({ work: 'unscheduled', dueBefore: undefined, stage: '' })}>연락일 미정</Button>
          <Button kind={filter.work === 'handoff' ? 'blue' : 'outline'} aria-pressed={filter.work === 'handoff'} onClick={() => change({ work: 'handoff', dueBefore: undefined, stage: '' })}>수주 후 프로젝트 연결 대기</Button>
        </div>
        <div className="sales-search">
          <Field label="영업 건 검색"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="영업 건 이름" /></Field>
          <label className="row"><input type="checkbox" checked={!!filter.ownerId} onChange={e => change({ ownerId: e.target.checked ? me.id : undefined })} />내 담당만</label>
        </div>
        <details className="sales-options">
          <summary>상세 필터</summary>
          <div className="sales-filters">
            <Field label="수행 회사"><select className="select" value={filter.division ?? ''} onChange={e => change({ division: e.target.value as SalesFilter['division'] })}><option value="">전체 회사</option>{Object.entries(SALES_COMPANIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="유입 경로 필터"><select className="select" value={filter.source ?? ''} onChange={e => change({ source: e.target.value as SalesFilter['source'] })}><option value="">전체 경로</option>{SALES_SOURCES.map(source => <option key={source}>{source}</option>)}</select></Field>
            <Field label="진행 단계"><select className="select" value={filter.stage ?? ''} onChange={e => change({ stage: e.target.value as SalesFilter['stage'] })}><option value="">전체 단계</option>{SALES_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></Field>
          </div>
        </details>
        {error && <div className="sales-error" role="alert">{error} <Button kind="outline" onClick={reload}>다시 확인</Button></div>}
        {loading ? <p role="status">영업 기회를 불러오는 중…</p> : !error && <>
          <p className="t-cap">{filter.page + 1}페이지 · {data.items.length}건{queue.counts.due > 0 && ` · 연락 예정일 도래 ${queue.counts.due}건`}{queue.counts.unscheduled > 0 && ` · 연락일 미정 ${queue.counts.unscheduled}건`}</p>
          {!data.items.length && <div className="sales-empty"><strong>표시할 영업 기회가 없습니다.</strong><p>새 영업 기회를 등록하거나 검색 조건을 바꿔 주세요.</p></div>}
          <div className="sales-list">{queue.rows.map(({ row, kind, label }) => <button key={row.id} type="button" className="sales-item" aria-current={selection === row.id ? 'true' : undefined} onClick={() => openOpportunity(row.id)}>
            <span className="sales-item-main"><strong>{row.title}</strong><span>{SALES_COMPANIES[row.division]} · {profileName(row.owner_id)} · {row.source}</span></span>
            <span className="sales-stage">{row.stage}</span>
            <span className={kind === 'due' ? 'sales-due' : ''}>{label}{row.next_date && (kind === 'due' || kind === 'upcoming') ? ` · ${row.next_date}` : ''}<small>{row.next_action || '다음 행동 미등록'}</small></span>
            <span className="sales-amount">{row.expected_amount === null ? '금액 미확인' : `예상 ${row.expected_amount.toLocaleString()}원`}</span>
          </button>)}</div>
          <div className="row wrap sales-pager"><Button kind="outline" disabled={!filter.page} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>이전</Button><span>{filter.page + 1}페이지</span><Button kind="outline" disabled={!data.hasMore} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>다음</Button></div>
        </>}
      </section>
    </div>
    {!me.active && <p role="alert">비활성 계정은 저장할 수 없습니다.</p>}
  </div>
}

function SalesDetail({ id, candidate, onClose, onCandidateUsed, onChanged }: {
  id: string; candidate?: GrowthItem; onClose: () => void; onCandidateUsed: () => void; onChanged: () => void
}) {
  const { api, me, profileName } = useApp()
  const [editing, setEditing] = useState(Boolean(candidate))
  const [activity, setActivity] = useState({ dirty: false, busy: false })
  const activityChanged = useCallback((dirty: boolean, busy: boolean) => setActivity({ dirty, busy }), [])
  const state = useAsync<SalesOpportunity | null>(() => api.getSales(id), [id], null)
  const guard = useDraftGuard(activity.dirty, activity.busy)
  const close = () => guard.close('저장하지 않은 활동 내용이 있습니다. 닫을까요?', onClose)
  const row = state.data
  if (editing && row && canEditSales(row, me)) return <SalesEditor inline initial={row} candidate={candidate}
    onClose={() => { onCandidateUsed(); setEditing(false) }}
    onSaved={() => { onCandidateUsed(); setEditing(false); state.reload(); onChanged() }} />
  const savedPlan = row && readSalesPlan(row.description)
  return <SalesPanel inline title={row?.title ?? '영업 기회'} onClose={close} actions={<><Button kind="ghost" disabled={activity.busy} onClick={close}>닫기</Button>{row && canEditSales(row, me) && <Button disabled={activity.busy || activity.dirty} onClick={() => setEditing(true)}>영업 정보 수정</Button>}</>}>
    {state.loading && <p role="status">상세 정보를 불러오는 중…</p>}
    {state.error && <div role="alert" className="sales-error">{state.error}<Button kind="outline" onClick={state.reload}>다시 확인</Button></div>}
    {row && <div className="sales-detail">
      <dl><dt>회사·단계</dt><dd>{SALES_COMPANIES[row.division]} · {row.stage}</dd><dt>담당자</dt><dd>{profileName(row.owner_id)}</dd><dt>예상 금액</dt><dd>{row.expected_amount === null ? '미확인' : `${row.expected_amount.toLocaleString()}원`}</dd><dt>다음 행동</dt><dd>{row.next_date ?? '날짜 미정'} · {row.next_action || '미등록'}</dd><dt>유입 경로</dt><dd>{row.source}{row.source_url && <> · <a href={row.source_url} target="_blank" rel="noreferrer">출처 보기</a></>}</dd></dl>
      <div className="row wrap">{row.client_id && <Link to={`/clients?id=${row.client_id}`} className="btn btn-outline">연결 거래처</Link>}{row.project_id && <Link to={`/projects?id=${row.project_id}`} className="btn btn-outline">연결 프로젝트</Link>}</div>
      <SalesPlanOutput draft={row} ownerName={profileName(row.owner_id)} />
      {savedPlan?.notes && <section><h3 className="t-sub">요청 내용</h3><p className="sales-copy">{savedPlan.notes}</p></section>}
      <details className="sales-options"><summary>출처와 단계 안내</summary><SalesOrigins id={row.id} /><SalesPlaybook draft={row} /></details>
      {row.result_note && <section><h3 className="t-sub">결과·사유</h3><p className="sales-copy">{row.result_note}</p></section>}
      <SalesActivities id={row.id} editable={canEditSales(row, me)} onDraftChange={activityChanged} />
    </div>}
  </SalesPanel>
}
