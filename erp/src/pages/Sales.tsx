import { useEffect, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { afterSalesDraftConfirmed, closeSalesDraft, readSalesView, salesViewUrl } from '../lib/salesNavigation'
import { SALES_COMPANIES, SALES_SOURCES, SALES_STAGES, canEditSales, needsFollowup, newSalesDraft, validateSales, type SalesDraft, type SalesFilter, type SalesOpportunity } from '../lib/sales'
import { Button, Field, Modal } from '../components/ui'
import { ProspectingPlanner } from '../components/ProspectingPlanner'
import { Shell } from '../components/Shell'
import { GrowthWorkspace } from '../components/GrowthWorkspace'
import './Sales.css'

export default function Sales() {
  const { query, navigate } = useRouter()
  const tab = query.has('id') || query.get('new') === '1' ? 'pipeline' : ['contacts', 'tenders'].includes(query.get('tab') ?? '') ? query.get('tab')! : 'pipeline'
  const tabs = [['pipeline', '수주 파이프라인'], ['contacts', '민간 영업 후보'], ['tenders', '나라장터 공고']] as const
  return <Shell active="sales"><div className="sales-page">
    <header className="sales-heading"><h1 className="t-title">영업 발굴·수주</h1><p>브랜드·행사 발굴과 나라장터 공고를 검토하고, 제안부터 계약까지 연결합니다.</p></header>
    <nav aria-label="영업 업무" className="sales-stages">{tabs.map(([key, label]) => <button type="button" key={key} className={`btn ${tab === key ? '' : 'btn-outline'}`} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(withQuery('/sales', query, { tab: key === 'pipeline' ? null : key, id: null, new: null, research: null }))}>{label}</button>)}</nav>
    <p className="sales-notice">조사 결과 검토 → 영업 기회 연결 → 접촉·미팅 → 제안·협상 → 수주·프로젝트 연결. 발굴 후보는 수주 확정이나 연락 동의를 의미하지 않습니다.</p>
    {tab === 'pipeline' ? <SalesPipeline /> : <GrowthWorkspace key={tab} kind={tab === 'tenders' ? 'tender' : 'contact'} />}
  </div></Shell>
}

function SalesPipeline() {
  const { api, me, profileName, version } = useApp()
  const [filter, setFilter] = useState<SalesFilter>({ page: 0 })
  const [search, setSearch] = useState('')
  const { query, navigate } = useRouter()
  const view = readSalesView(query)
  const selection = view.kind === 'detail' ? view.id : null
  const adding = view.kind === 'new'
  useEffect(() => {
    const t = window.setTimeout(() => setFilter(f => f.search === search ? f : ({ ...f, page: 0, search })), 350)
    return () => window.clearTimeout(t)
  }, [search])
  const { data, loading, error, reload } = useAsync(() => api.listSales(filter), [filter, version], { items: [], hasMore: false })
  const change = (p: Partial<SalesFilter>) => setFilter(f => ({ ...f, ...p, page: 0 }))
  const openOpportunity = (id: string) => {
    if (selection === id && !adding) return
    navigate(salesViewUrl(query, { kind: 'detail', id }))
  }
  const startAdding = (research = false) => {
    if (adding) return
    const next = new URLSearchParams(query)
    if (research) next.set('research', '1'); else next.delete('research')
    navigate(salesViewUrl(next, { kind: 'new' }))
  }
  const closePanel = () => navigate(salesViewUrl(query, { kind: 'list' }), { replace: true })
  return <div className="sales-pipeline">
    <div className="sales-header"><div className="sales-heading"><h2 className="t-sub">수주 파이프라인</h2><p className="t-small">거래처별 기회와 다음 행동을 관리합니다.</p></div><a href="/manual/growth.html#sales" target="_blank" rel="noreferrer" className="btn btn-outline">화면 사용설명</a><Link to="/clients" className="btn btn-outline">거래처·담당자</Link><Button kind="outline" onClick={() => startAdding(true)}>신규 대상 발굴</Button><Button onClick={() => startAdding()}>+ 영업 기회</Button></div>
    {api.mode === 'demo' && <p className="sales-notice">체험 모드 · 이 브라우저에만 저장됩니다. 실제 회사 자료와 분리됩니다.</p>}
    <div className="sales-filters">
      <Field label="영업 건 검색"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="영업 건 이름" /></Field>
      <Field label="수행 회사"><select className="select" value={filter.division ?? ''} onChange={e => change({ division: e.target.value as SalesFilter['division'] })}><option value="">전체 회사</option>{Object.entries(SALES_COMPANIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="유입 경로 필터"><select className="select" value={filter.source ?? ''} onChange={e => change({ source: e.target.value as SalesFilter['source'] })}><option value="">전체 경로</option>{SALES_SOURCES.map(source => <option key={source}>{source}</option>)}</select></Field>
      <Field label="진행 단계"><select className="select" value={filter.stage ?? ''} onChange={e => change({ stage: e.target.value as SalesFilter['stage'] })}><option value="">전체 단계</option>{SALES_STAGES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <label className="row"><input type="checkbox" checked={!!filter.dueBefore} onChange={e => change({ dueBefore: e.target.checked ? todayKey() : undefined })} />오늘까지 후속 연락</label>
    </div>
    <div className="sales-stages" aria-label="진행 단계 필터">{SALES_STAGES.map(s => <button type="button" key={s} className={`btn ${filter.stage === s ? '' : 'btn-outline'}`} aria-pressed={filter.stage === s} onClick={() => change({ stage: filter.stage === s ? '' : s })}>{s}</button>)}</div>
    {error && <div className="sales-error" role="alert">{error} <Button kind="outline" onClick={reload}>다시 확인</Button></div>}
    {loading ? <p role="status">영업 기회를 불러오는 중…</p> : !error && <>
      <p className="t-cap">{filter.page + 1}페이지 · {data.items.length}건 · 예상 금액은 확정 매출과 별도로 관리합니다.</p>
      {!data.items.length && <div className="sales-empty"><strong>표시할 영업 기회가 없습니다.</strong><p>새 영업 기회를 등록하거나 검색 조건을 바꿔 주세요.</p></div>}
      <div className="sales-list">{data.items.map(row => <button key={row.id} type="button" className="sales-item" onClick={() => openOpportunity(row.id)}>
        <span className="sales-item-main"><strong>{row.title}</strong><span>{SALES_COMPANIES[row.division]} · {profileName(row.owner_id)} · {row.source}</span></span>
        <span className="sales-stage">{row.stage}</span>
        <span className={needsFollowup(row, todayKey()) ? 'sales-due' : ''}>{row.next_date ?? '연락일 미정'}<small>{row.next_action || '다음 행동 미등록'}</small></span>
        <span className="sales-amount">{row.expected_amount === null ? '금액 미확인' : `예상 ${row.expected_amount.toLocaleString()}원`}</span>
      </button>)}</div>
      <div className="row wrap sales-pager"><Button kind="outline" disabled={!filter.page} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>이전</Button><span>{filter.page + 1}페이지</span><Button kind="outline" disabled={!data.hasMore} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>다음</Button></div>
    </>}
    {adding && <SalesEditor discovery={query.get('research') === '1'} initial={null} onClose={closePanel} onSaved={id => { navigate(salesViewUrl(query, { kind: 'detail', id }), { replace: true }); reload() }} />}
    {selection && <SalesDetail key={selection} id={selection} onClose={closePanel} onChanged={reload} />}
    {!me.active && <p role="alert">비활성 계정은 저장할 수 없습니다.</p>}
  </div>
}

function SalesDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, me, profileName } = useApp()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<'메모' | '전화' | '메일' | '미팅'>('메모')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const request = useRef({ id: crypto.randomUUID(), signature: '' })
  const state = useAsync(async () => ({ row: await api.getSales(id), activities: await api.listSalesActivities(id) }), [id], null)
  const guard = useDraftGuard(!!body.trim(), busy)
  const close = () => { if (!lock.current) guard.close('저장하지 않은 활동 내용이 있습니다. 닫을까요?', onClose) }
  if (editing && state.data) return <SalesEditor initial={state.data.row} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.reload(); onChanged() }} />
  const row = state.data?.row
  const add = async () => {
    if (lock.current) return
    const signature = `${kind}:${body.trim()}`
    if (request.current.signature !== signature) request.current = { id: crypto.randomUUID(), signature }
    lock.current = true; setBusy(true); setError('')
    try {
      await api.addSalesActivity(request.current.id, id, kind, body)
      setBody(''); request.current = { id: crypto.randomUUID(), signature: '' }; state.reload()
    } catch (e) { setError(friendlyError(e)) } finally { lock.current = false; setBusy(false) }
  }
  return <Modal title={row?.title ?? '영업 기회'} onClose={close} wide actions={<><Button kind="ghost" disabled={busy} onClick={close}>닫기</Button>{row && canEditSales(row, me) && <Button disabled={busy || !!body.trim()} onClick={() => setEditing(true)}>영업 정보 수정</Button>}</>}>
    {state.loading && <p role="status">상세 정보를 불러오는 중…</p>}
    {state.error && <div role="alert" className="sales-error">{state.error}<Button kind="outline" onClick={state.reload}>다시 확인</Button></div>}
    {row && <div className="sales-detail">
      <dl><dt>회사·단계</dt><dd>{SALES_COMPANIES[row.division]} · {row.stage}</dd><dt>담당자</dt><dd>{profileName(row.owner_id)}</dd><dt>예상 금액</dt><dd>{row.expected_amount === null ? '미확인' : `${row.expected_amount.toLocaleString()}원`}</dd><dt>다음 행동</dt><dd>{row.next_date ?? '날짜 미정'} · {row.next_action || '미등록'}</dd><dt>유입 경로</dt><dd>{row.source}{row.source_url && <> · <a href={row.source_url} target="_blank" rel="noreferrer">출처 보기</a></>}</dd></dl>
      <div className="row wrap">{row.client_id && <Link to={`/clients?id=${row.client_id}`} className="btn btn-outline">연결 거래처</Link>}{row.project_id && <Link to={`/projects?id=${row.project_id}`} className="btn btn-outline">연결 프로젝트</Link>}</div>
      <section><h3 className="t-sub">요청 내용</h3><p className="sales-copy">{row.description || '등록된 요청 내용이 없습니다.'}</p></section>
      {row.result_note && <section><h3 className="t-sub">결과·사유</h3><p className="sales-copy">{row.result_note}</p></section>}
      {canEditSales(row, me) && <section><h3 className="t-sub">활동 기록</h3><Field label="활동 종류"><select className="select" value={kind} disabled={busy} onChange={e => setKind(e.target.value as typeof kind)}>{['메모', '전화', '메일', '미팅'].map(k => <option key={k}>{k}</option>)}</select></Field><Field label="활동 내용"><textarea className="textarea" rows={3} maxLength={4000} disabled={busy} value={body} onChange={e => setBody(e.target.value)} placeholder="연락 결과와 다음에 확인할 내용을 적어 주세요." /></Field><Button disabled={busy || !body.trim()} onClick={add}>{busy ? '저장 중…' : '활동 저장'}</Button>{error && <p role="alert" className="sales-error">{error}</p>}</section>}
      <section><h3 className="t-sub">최근 이력 · 최대 50건</h3>{state.data?.activities.map(a => <article className="sales-activity" key={a.id}><strong>{a.kind}</strong> · {profileName(a.created_by)} <time>{new Date(a.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time><p className="sales-copy">{a.body}</p></article>)}</section>
    </div>}
  </Modal>
}

function useDraftGuard(dirty: boolean, busy: boolean) {
  const state = useRef({ dirty, busy })
  state.current = { dirty, busy }
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('저장하지 않은 내용이 있습니다. 이동할까요?')), [])
  return {
    close: (message: string, action: () => void) => closeSalesDraft(state, () => window.confirm(message), action),
    afterSaved: (action: () => void) => afterSalesDraftConfirmed(state, action),
  }
}

function SalesEditor({ initial, onClose, onSaved, discovery = false }: { discovery?: boolean; initial: SalesOpportunity | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { api, me, profiles } = useApp()
  const [draft, setDraft] = useState<SalesDraft>(() => {
    if (!initial) return newSalesDraft(me.id)
    const { id: _id, revision: _revision, created_by: _cb, updated_by: _ub, created_at: _ca, updated_at: _ua, ...d } = initial
    return d
  })
  const original = useRef(JSON.stringify(draft))
  const id = useRef(initial?.id ?? crypto.randomUUID())
  const revision = useRef(initial?.revision ?? 0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [prospectPending, setProspectPending] = useState(false)
  const dirty = JSON.stringify(draft) !== original.current || prospectPending
  const guard = useDraftGuard(dirty, busy)
  const set = (patch: Partial<SalesDraft>) => setDraft(d => ({ ...d, ...patch }))
  const refs = useAsync(async () => {
    const [clients, contacts, projects] = await Promise.all([api.listClients(), api.listContacts(), api.listProjects()])
    return { clients, contacts, projects }
  }, [], { clients: [], contacts: [], projects: [] })
  const close = () => { if (!lock.current) guard.close('저장하지 않은 변경이 있습니다. 닫을까요?', onClose) }
  const save = async () => {
    if (lock.current) return
    if (prospectPending) { setError('발굴 계획을 영업 정보에 먼저 적용해 주세요.'); return }
    const invalid = validateSales(draft)
    if (invalid) { setError(invalid); return }
    lock.current = true; setBusy(true); setError('')
    let saved = false
    try {
      const row = await api.saveSales(id.current, draft, revision.current)
      revision.current = row.revision
      original.current = JSON.stringify(draft)
      saved = true
      guard.afterSaved(() => onSaved(row.id))
    } catch (e) { setError(saved ? '저장은 완료했습니다. 화면을 다시 열어 결과를 확인해 주세요.' : friendlyError(e)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Modal title={revision.current ? '영업 정보 수정' : '새 영업 기회'} onClose={close} wide actions={<><Button kind="ghost" disabled={busy} onClick={close}>취소</Button><Button disabled={busy || prospectPending || refs.loading || !!refs.error} onClick={save}>{busy ? '저장 중…' : '저장'}</Button></>}>
    {error && <p role="alert" className="sales-error">{error}</p>}
    {discovery && !initial && <ProspectingPlanner owner={draft.owner_id} disabled={busy} onPending={setProspectPending} onApply={seed => {
      if (JSON.stringify(draft) !== original.current && !window.confirm('입력한 제목·회사·출처·다음 행동·메모를 발굴 계획으로 바꿀까요? 회사가 바뀌면 거래처·담당자·프로젝트 연결은 해제합니다.')) return false
      setDraft(d => ({ ...d, title: seed.title, division: seed.division, source: seed.source, source_url: seed.source_url, next_date: seed.next_date, next_action: seed.next_action, description: seed.description, ...(d.division !== seed.division ? { client_id: null, contact_id: null, project_id: null } : {}) })); setError(''); return true
    }} />}
    {prospectPending && <p role="status" className="sales-notice">발굴 계획의 변경을 적용하면 저장할 수 있습니다. 닫으면 미저장 계획은 사라집니다.</p>}
    {refs.error && <div role="alert" className="sales-error">{refs.error}<Button kind="outline" onClick={refs.reload}>연결 자료 다시 확인</Button></div>}
    <fieldset disabled={busy} className="sales-fieldset form-grid">
      <Field label="영업 건 이름 *" className="full"><input className="input" autoFocus={!discovery} maxLength={160} value={draft.title} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label="수행 회사"><select className="select" value={draft.division} onChange={e => set({ division: e.target.value as SalesDraft['division'], project_id: null })}>{Object.entries(SALES_COMPANIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="담당자"><select className="select" value={draft.owner_id} disabled={me.role !== 'admin'} onChange={e => set({ owner_id: e.target.value })}>{profiles.filter(p => p.active && !p.is_agent).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="거래처"><select className="select" value={draft.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null, contact_id: null, project_id: null })}><option value="">아직 미연결</option>{refs.data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="거래처 담당자"><select className="select" value={draft.contact_id ?? ''} disabled={!draft.client_id} onChange={e => set({ contact_id: e.target.value || null })}><option value="">미연결</option>{refs.data.contacts.filter(c => c.client_id === draft.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="진행 단계"><select className="select" value={draft.stage} onChange={e => set({ stage: e.target.value as SalesDraft['stage'], project_id: e.target.value === '수주' ? draft.project_id : null })}>{SALES_STAGES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="유입 경로"><select className="select" value={draft.source} onChange={e => set({ source: e.target.value as SalesDraft['source'] })}>{SALES_SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="예상 금액 (원 · 미확인은 빈칸)"><input className="input" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={draft.expected_amount ?? ''} onChange={e => set({ expected_amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      <Field label="다음 연락일"><input className="input" type="date" value={draft.next_date ?? ''} onChange={e => set({ next_date: e.target.value || null })} /></Field>
      <Field label="다음 행동" className="full"><input className="input" maxLength={500} value={draft.next_action} onChange={e => set({ next_action: e.target.value })} placeholder="예: 공간 후보와 견적 전달" /></Field>
      <Field label="출처 주소" className="full"><input className="input" type="url" maxLength={2000} value={draft.source_url} onChange={e => set({ source_url: e.target.value })} placeholder="https://" /></Field>
      <Field label="요청 내용·메모" className="full"><textarea className="textarea" rows={4} maxLength={10000} value={draft.description} onChange={e => set({ description: e.target.value })} /></Field>
      <Field label="결과·사유 (수주·실주·보류 필수)" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={draft.result_note} onChange={e => set({ result_note: e.target.value })} /></Field>
      {draft.stage === '수주' && <Field label="수주 프로젝트 연결" className="full"><select className="select" value={draft.project_id ?? ''} onChange={e => set({ project_id: e.target.value || null })}><option value="">아직 미연결</option>{refs.data.projects.filter(p => p.division === draft.division && p.client_id === draft.client_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="t-cap">같은 회사·거래처의 기존 프로젝트를 연결합니다. 새 프로젝트는 프로젝트 메뉴에서 등록합니다.</span></Field>}
    </fieldset>
  </Modal>
}
