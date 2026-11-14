import { useEffect, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { afterSalesDraftConfirmed, closeSalesDraft, readSalesView, salesViewUrl } from '../lib/salesNavigation'
import { SALES_COMPANIES, SALES_SOURCES, SALES_STAGES, canEditSales, needsFollowup, newSalesDraft, validateSales, validateSalesProject, type SalesActivity, type SalesDraft, type SalesFilter, type SalesOpportunity } from '../lib/sales'
import { isSalesActivityUnconfirmed, normalizeSalesActivityBody, type SalesActivityRequest } from '../lib/salesActivityRecovery'
import { Button, Field, Modal } from '../components/ui'
import { SalesOrigins } from '../components/SalesOrigins'
import { SalesPlaybook } from '../components/SalesPlaybook'
import { ProspectingPlanner } from '../components/ProspectingPlanner'
import { Shell } from '../components/Shell'
import { GrowthWorkspace } from '../components/GrowthWorkspace'
import './Sales.css'

export default function Sales() {
  const { query, navigate } = useRouter()
  const tab = query.has('id') || query.get('new') === '1' ? 'pipeline' : ['contacts', 'tenders'].includes(query.get('tab') ?? '') ? query.get('tab')! : 'pipeline'
  const tabs = [['pipeline', '수주 파이프라인'], ['contacts', '민간 영업 후보'], ['tenders', '나라장터 공고']] as const
  return <Shell active="sales"><div className="sales-page">
    <header className="sales-heading"><h1 className="t-title">영업 발굴·수주</h1><p>팝업스토어 대행이 필요한 브랜드를 발굴하고, 첫 연락부터 제안·계약까지 관리합니다.</p></header>
    <nav aria-label="영업 업무" className="sales-stages">{tabs.map(([key, label]) => <button type="button" key={key} className={`btn ${tab === key ? '' : 'btn-outline'}`} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(withQuery('/sales', query, { tab: key === 'pipeline' ? null : key, id: null, new: null, research: null }))}>{label}</button>)}</nav>
    <p className="sales-notice">브랜드의 오픈 계기와 미발주 범위 확인 → 담당자와 다음 연락일 지정 → 대행 제안·견적 → 계약·프로젝트 연결.</p>
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
      <label className="row"><input type="checkbox" checked={!!filter.dueBefore} onChange={e => change({ dueBefore: e.target.checked ? todayKey() : undefined, work: '' })} />오늘까지 후속 연락</label>
    </div>
    <div className="sales-stages" aria-label="영업 실행 목록">
      <Button kind={!filter.work && !filter.dueBefore ? 'blue' : 'outline'} onClick={() => change({ work: '', dueBefore: undefined, stage: '' })}>전체 기회</Button>
      <Button kind={filter.work === 'unscheduled' ? 'blue' : 'outline'} onClick={() => change({ work: 'unscheduled', dueBefore: undefined, stage: '' })}>연락일 미정</Button>
      <Button kind={filter.work === 'handoff' ? 'blue' : 'outline'} onClick={() => change({ work: 'handoff', dueBefore: undefined, stage: '' })}>수주 후 프로젝트 연결 대기</Button>
      <label className="row"><input type="checkbox" checked={!!filter.ownerId} onChange={e => change({ ownerId: e.target.checked ? me.id : undefined })} />내 담당만</label>
    </div>
    {filter.work === 'unscheduled' && <p className="sales-notice">연락일이 없는 진행 중 영업입니다. 상세 → 영업 정보 수정에서 다음 행동과 연락일을 지정하세요. 후보에서 연결한 신규 건도 여기에서 확인할 수 있습니다.</p>}
    {filter.work === 'handoff' && <p className="sales-notice">수주로 기록했지만 프로젝트를 연결하지 않은 건입니다. 계약 근거를 확인하고 같은 회사·거래처의 프로젝트를 연결하세요.</p>}
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
  const [pending, setPending] = useState<SalesActivityRequest | null>(null)
  const state = useAsync<SalesOpportunity | null>(() => api.getSales(id), [id], null)
  const activities = useAsync<SalesActivity[]>(() => api.listSalesActivities(id), [id], [])
  const guard = useDraftGuard(!!body.trim(), busy)
  const close = () => { if (!lock.current) guard.close(pending ? '활동 저장 결과를 아직 확인하지 못했습니다. 닫으면 요청 정보가 사라지므로 다시 입력하기 전에 최근 이력을 확인해야 합니다. 닫을까요?' : '저장하지 않은 활동 내용이 있습니다. 닫을까요?', onClose) }
  if (editing && state.data) return <SalesEditor initial={state.data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.reload(); activities.reload(); onChanged() }} />
  const row = state.data
  const confirmed = () => {
    setBody(''); setPending(null); setError(''); request.current = { id: crypto.randomUUID(), signature: '' }; activities.reload()
  }
  const add = async () => {
    if (lock.current) return
    const signature = JSON.stringify([kind, normalizeSalesActivityBody(body), me.id])
    if (request.current.signature !== signature) request.current = { id: crypto.randomUUID(), signature }
    const submitted = pending ?? { id: request.current.id, opportunityId: id, kind, body, actorId: me.id }
    lock.current = true; setBusy(true); setError('')
    try {
      await api.addSalesActivity(submitted.id, submitted.opportunityId, submitted.kind, submitted.body, submitted.actorId)
      confirmed()
    } catch (e) {
      if (isSalesActivityUnconfirmed(e)) setPending(submitted)
      setError(friendlyError(e))
    } finally { lock.current = false; setBusy(false) }
  }
  const check = async () => {
    if (lock.current || !pending) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (await api.checkSalesActivity(pending.id, pending.opportunityId, pending.kind, pending.body, pending.actorId)) confirmed()
      else setError('아직 같은 활동을 확인하지 못했습니다. 원래 요청이 처리 중일 수 있으므로 내용을 유지하고 상태 확인 또는 같은 내용 재시도를 이용해 주세요.')
    } catch (e) { setError(friendlyError(e)) } finally { lock.current = false; setBusy(false) }
  }
  return <Modal title={row?.title ?? '영업 기회'} onClose={close} wide actions={<><Button kind="ghost" disabled={busy} onClick={close}>닫기</Button>{row && canEditSales(row, me) && <Button disabled={busy || !!body.trim()} onClick={() => setEditing(true)}>영업 정보 수정</Button>}</>}>
    {state.loading && <p role="status">상세 정보를 불러오는 중…</p>}
    {state.error && <div role="alert" className="sales-error">{state.error}<Button kind="outline" onClick={state.reload}>다시 확인</Button></div>}
    {row && <div className="sales-detail">
      <dl><dt>회사·단계</dt><dd>{SALES_COMPANIES[row.division]} · {row.stage}</dd><dt>담당자</dt><dd>{profileName(row.owner_id)}</dd><dt>예상 금액</dt><dd>{row.expected_amount === null ? '미확인' : `${row.expected_amount.toLocaleString()}원`}</dd><dt>다음 행동</dt><dd>{row.next_date ?? '날짜 미정'} · {row.next_action || '미등록'}</dd><dt>유입 경로</dt><dd>{row.source}{row.source_url && <> · <a href={row.source_url} target="_blank" rel="noreferrer">출처 보기</a></>}</dd></dl>
      <div className="row wrap">{row.client_id && <Link to={`/clients?id=${row.client_id}`} className="btn btn-outline">연결 거래처</Link>}{row.project_id && <Link to={`/projects?id=${row.project_id}`} className="btn btn-outline">연결 프로젝트</Link>}</div>
      <SalesPlaybook draft={row} />
      <SalesOrigins id={row.id} /><section><h3 className="t-sub">요청 내용</h3><p className="sales-copy">{row.description || '등록된 요청 내용이 없습니다.'}</p></section>
      {row.result_note && <section><h3 className="t-sub">결과·사유</h3><p className="sales-copy">{row.result_note}</p></section>}
      {canEditSales(row, me) && <section><h3 className="t-sub">활동 기록</h3><Field label="활동 종류"><select className="select" value={kind} disabled={busy || !!pending} onChange={e => setKind(e.target.value as typeof kind)}>{['메모', '전화', '메일', '미팅'].map(k => <option key={k}>{k}</option>)}</select></Field><Field label="활동 내용"><textarea className="textarea" rows={3} maxLength={4000} disabled={busy || !!pending} value={body} onChange={e => setBody(e.target.value)} placeholder="연락 결과와 다음에 확인할 내용을 적어 주세요." /></Field>{pending && <p role="status" className="sales-notice">저장 여부가 확인될 때까지 원래 활동 내용과 요청 ID를 유지합니다. 같은 내용 재시도는 중복 활동을 만들지 않습니다.</p>}<div className="row wrap"><Button disabled={busy || !body.trim()} onClick={add}>{busy ? '확인 중…' : pending ? '동일 내용으로 재시도' : '활동 저장'}</Button>{pending && <Button kind="outline" disabled={busy} onClick={check}>저장 상태 확인</Button>}</div>{error && <p role="alert" className="sales-error">{error}</p>}</section>}
      <section><h3 className="t-sub">최근 이력 · 최대 50건</h3>{activities.loading && <p role="status">활동 이력을 불러오는 중…</p>}{activities.error && <div role="alert" className="sales-error">{activities.error}<Button kind="outline" disabled={activities.loading || busy} onClick={activities.reload}>활동 이력 다시 확인</Button></div>}{activities.data.map(a => <article className="sales-activity" key={a.id}><strong>{a.kind}</strong> · {profileName(a.created_by)} <time>{new Date(a.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time><p className="sales-copy">{a.body}</p></article>)}{!activities.loading && !activities.error && !activities.data.length && <p>등록된 활동이 없습니다.</p>}</section>
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
  const projectIssue = validateSalesProject(draft, refs.data.projects)
  const eligibleProjects = refs.data.projects.filter(p => p.division === draft.division && p.client_id === draft.client_id)
  const close = () => { if (!lock.current) guard.close('저장하지 않은 변경이 있습니다. 닫을까요?', onClose) }
  const save = async () => {
    if (lock.current) return
    if (refs.loading || refs.error) { setError('연결 자료를 다시 확인한 뒤 저장해 주세요.'); return }
    if (prospectPending) { setError('발굴 계획을 영업 정보에 먼저 적용해 주세요.'); return }
    const invalid = validateSales(draft) ?? projectIssue
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
    {refs.error && <div role="alert" className="sales-error">{refs.error}<Button kind="outline" disabled={busy || refs.loading} onClick={refs.reload}>연결 자료 다시 확인</Button></div>}
    <SalesPlaybook draft={draft} onApply={set} disabled={busy} />
    <fieldset disabled={busy} className="sales-fieldset form-grid">
      <Field label="영업 건 이름 *" className="full"><input className="input" autoFocus={!discovery} maxLength={160} value={draft.title} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label="수행 회사"><select className="select" value={draft.division} onChange={e => set({ division: e.target.value as SalesDraft['division'], project_id: null })}>{Object.entries(SALES_COMPANIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="담당자"><select className="select" value={draft.owner_id} disabled={me.role !== 'admin'} onChange={e => set({ owner_id: e.target.value })}>{profiles.filter(p => p.active && !p.is_agent).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="거래처"><select className="select" value={draft.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null, contact_id: null, project_id: null })}><option value="">아직 미연결</option>{refs.data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="거래처 담당자"><select className="select" value={draft.contact_id ?? ''} disabled={!draft.client_id} onChange={e => set({ contact_id: e.target.value || null })}><option value="">미연결</option>{refs.data.contacts.filter(c => c.client_id === draft.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="진행 단계"><select className="select" value={draft.stage} onChange={e => set({ stage: e.target.value as SalesDraft['stage'], project_id: e.target.value === '수주' ? draft.project_id : null })}>{SALES_STAGES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="유입 경로"><select className="select" value={draft.source} onChange={e => set({ source: e.target.value as SalesDraft['source'] })}>{SALES_SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="예상 금액 (원 · 미확인은 빈칸)"><input className="input" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={draft.expected_amount ?? ''} onChange={e => set({ expected_amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      {!['수주', '실주', '보류'].includes(draft.stage) && !draft.next_date && <p className="sales-notice full">다음 연락일을 정하면 ‘오늘까지 후속 연락’에 표시됩니다. 미정인 채 저장해도 ‘연락일 미정’ 목록에서 다시 찾을 수 있습니다.</p>}
      <Field label="다음 연락일"><input className="input" type="date" value={draft.next_date ?? ''} onChange={e => set({ next_date: e.target.value || null })} /></Field>
      <Field label="다음 행동" className="full"><input className="input" maxLength={500} value={draft.next_action} onChange={e => set({ next_action: e.target.value })} placeholder="예: 공간 후보와 견적 전달" /></Field>
      <Field label="출처 주소" className="full"><input className="input" type="url" maxLength={2000} value={draft.source_url} onChange={e => set({ source_url: e.target.value })} placeholder="https://" /></Field>
      <Field label="요청 내용·메모" className="full"><textarea className="textarea" rows={4} maxLength={10000} value={draft.description} onChange={e => set({ description: e.target.value })} /></Field>
      <Field label="결과·사유 (수주·실주·보류 필수)" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={draft.result_note} onChange={e => set({ result_note: e.target.value })} /></Field>
      {draft.stage === '수주' && <div className="full"><Field label="수주 프로젝트 연결"><select className="select" value={draft.project_id ?? ''} disabled={refs.loading} onChange={e => set({ project_id: e.target.value || null })}><option value="">아직 미연결</option>{draft.project_id && !eligibleProjects.some(p => p.id === draft.project_id) && <option value={draft.project_id}>기존 선택 · 회사·거래처 확인 필요</option>}{eligibleProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><span className="t-cap">{SALES_COMPANIES[draft.division]} · {refs.data.clients.find(c => c.id === draft.client_id)?.name ?? '거래처 미연결'}와 같은 프로젝트를 연결합니다. 새 창에서 프로젝트를 만든 후 목록을 새로고침하고 선택·저장하세요. 영업 입력 내용은 이 창에 유지됩니다.</span><div className="row wrap">{busy ? <span className="btn btn-outline" aria-disabled="true">새 프로젝트 만들기</span> : <a className="btn btn-outline" href="/projects?new=1" target="_blank" rel="noopener noreferrer" onClick={e => { if (lock.current) e.preventDefault() }}>새 프로젝트 만들기</a>}<Button kind="outline" disabled={busy || refs.loading} onClick={() => { if (!lock.current) refs.reload() }}>{refs.loading ? '프로젝트 목록 확인 중…' : '프로젝트 목록 새로고침'}</Button></div>{!refs.loading && projectIssue && <span role="alert" className="sales-error">{projectIssue}</span>}</div>}
    </fieldset>
  </Modal>
}
