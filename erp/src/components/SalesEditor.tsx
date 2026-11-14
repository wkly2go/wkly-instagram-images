import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { registerDraftNavigation, requestViewChange } from '../lib/navigationGuard'
import { afterSalesDraftConfirmed, closeSalesDraft } from '../lib/salesNavigation'
import { SALES_COMPANIES, SALES_SOURCES, SALES_STAGES, canEditSales, newSalesDraft, validateSales, validateSalesProject, type SalesDraft, type SalesOpportunity } from '../lib/sales'
import { validateGrowth, type GrowthItem } from '../lib/growth'
import { emptySalesPlan, readSalesPlan, SALES_PLAN_LIMITS, seedSalesPlanFromCandidate, validateSalesPlan, writeSalesPlan } from '../lib/salesPlan'
import { Button, Field, Modal } from './ui'
import { SalesOrigins } from './SalesOrigins'
import { SalesPlaybook } from './SalesPlaybook'
import { SalesMethodAdvice } from './SalesMethodAdvice'
import { methodInputFromDraft, methodInputFromGrowth } from '../lib/salesMethods'
import { SalesPlanOutput, SalesPlanSheet } from './SalesPlanSheet'
import { ProspectingPlanner } from './ProspectingPlanner'
import { SalesActivities } from './SalesActivities'
import { ProjectForm } from '../pages/Projects'
import '../pages/Sales.css'

export function SalesPanel({ inline, title, onClose, actions, children }: {
  inline?: boolean; title: string; onClose: () => void; actions: ReactNode; children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (inline && panel.current && !panel.current.contains(document.activeElement)) panel.current.focus()
  }, [inline])
  if (!inline) return <Modal title={title} onClose={onClose} wide actions={actions}>{children}</Modal>
  return <section className="sales-work-panel" ref={panel} tabIndex={-1} aria-labelledby={titleId}>
    <header className="sales-work-panel-header"><h2 className="t-sub" id={titleId}>{title}</h2><div className="row wrap">{actions}</div></header>
    {children}
  </section>
}

export function useDraftGuard(dirty: boolean, busy: boolean) {
  const state = useRef({ dirty, busy })
  state.current = { dirty, busy }
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('저장하지 않은 내용이 있습니다. 이동할까요?')), [])
  return {
    close: (message: string, action: () => void) => closeSalesDraft(state, () => window.confirm(message), action),
    afterSaved: (action: () => void) => afterSalesDraftConfirmed(state, action),
  }
}

type ContactPlanActions = { close: () => void; refresh: (row: GrowthItem) => void; editCandidate: () => void }

export function ContactSalesPlan({ candidate, actions }: { candidate: GrowthItem; actions: ContactPlanActions }) {
  const { api, me, profileName } = useApp()
  // Keep the current editor mounted as the candidate is confirmed or linked.
  const initialSalesId = useRef(candidate.linked_sales_id)
  const salesId = initialSalesId.current
  const state = useAsync(() => salesId ? api.getSales(salesId) : Promise.resolve(null), [salesId], null)
  const title = `영업 계획 · ${candidate.title}`
  const row = state.data
  const editableCandidate = me.active && (me.role === 'admin' || candidate.owner_id === me.id)
  const seed = useMemo<SalesDraft>(() => ({
    ...newSalesDraft(candidate.owner_id),
    title: candidate.title,
    division: candidate.document.division,
    source: '기타',
    source_url: candidate.document.source_url,
    description: writeSalesPlan(candidate.document.note, { ...emptySalesPlan(), ...seedSalesPlanFromCandidate(candidate) }),
  }), [candidate])
  if (state.loading) return <section className="sales-work-panel" aria-label={title}><p role="status">영업 계획을 불러오는 중…</p></section>
  if (state.error) return <SalesPanel inline title={title} onClose={actions.close} actions={<Button kind="ghost" onClick={actions.close}>닫기</Button>}>
    <p role="alert" className="sales-error">{state.error}</p><Button kind="outline" onClick={state.reload}>다시 확인</Button>
  </SalesPanel>
  if ((row && !canEditSales(row, me)) || (!row && !editableCandidate)) {
    const draft = row ?? seed
    return <SalesPanel inline title={title} onClose={actions.close} actions={<><Button kind="outline" onClick={actions.editCandidate}>후보 정보</Button><Button kind="ghost" onClick={actions.close}>닫기</Button></>}>
      <p className="sales-notice">읽기 전용 · 담당자 또는 관리자가 계획을 작성할 수 있습니다.</p>
      <SalesPlanOutput draft={draft} ownerName={profileName(draft.owner_id)} />
      {row && <SalesActivities id={row.id} editable={false} />}
    </SalesPanel>
  }
  return <SalesEditor inline title={title} initial={row} seed={seed} candidate={row ? candidate : undefined}
    contact={{ candidate, actions, editableCandidate }} onClose={actions.close} />
}

export function SalesEditor({ initial, seed, candidate, onClose, onSaved, discovery = false, inline, title, contact }: {
  seed?: SalesDraft; candidate?: GrowthItem; discovery?: boolean; inline?: boolean; title?: string
  contact?: { candidate: GrowthItem; actions: ContactPlanActions; editableCandidate: boolean }
  initial: SalesOpportunity | null; onClose: () => void; onSaved?: (id: string) => void
}) {
  const { api, me, profiles, profileName } = useApp()
  const baseline = useRef<SalesDraft>(seed ?? newSalesDraft(me.id))
  const [draft, setDraft] = useState<SalesDraft>(() => {
    if (!initial) return baseline.current
    const { id: _id, revision: _revision, created_by: _cb, updated_by: _ub, created_at: _ca, updated_at: _ua, ...d } = initial
    baseline.current = d
    if (!candidate) return d
    const { notes, plan } = readSalesPlan(d.description)
    const additions = seedSalesPlanFromCandidate(candidate)
    const defaults = emptySalesPlan()
    for (const key of Object.keys(additions) as (keyof typeof additions)[]) {
      if (plan[key] !== defaults[key]) delete additions[key]
    }
    return { ...d, description: writeSalesPlan(notes, { ...plan, ...additions }) }
  })
  const original = useRef(JSON.stringify(baseline.current))
  const previousSeed = useRef(seed)
  const id = useRef(initial?.id ?? crypto.randomUUID())
  const revision = useRef(initial?.revision ?? 0)
  const linkedSalesId = useRef(initial?.id ?? null)
  const [savedRow, setSavedRow] = useState(initial)
  const [creatingProject, setCreatingProject] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [prospectPending, setProspectPending] = useState(false)
  const [prospectApplied, setProspectApplied] = useState(false)
  useEffect(() => {
    const before = previousSeed.current
    previousSeed.current = seed
    if (!contact || linkedSalesId.current || !before || !seed || before === seed) return
    // Candidate metadata can change while its info dialog is open. Refresh only fields the user hasn't changed.
    const previous = readSalesPlan(before.description)
    const next = readSalesPlan(seed.description)
    original.current = JSON.stringify(seed)
    setDraft(current => {
      const updated = readSalesPlan(current.description)
      const keys = ['target', 'contact'] as const
      for (const key of keys) {
        if (updated.plan[key] === previous.plan[key]) updated.plan[key] = next.plan[key]
      }
      return {
        ...current,
        title: current.title === before.title ? seed.title : current.title,
        source_url: current.source_url === before.source_url ? seed.source_url : current.source_url,
        owner_id: current.owner_id === before.owner_id ? seed.owner_id : current.owner_id,
        division: current.division === before.division && !current.project_id ? seed.division : current.division,
        description: writeSalesPlan(updated.notes === previous.notes ? next.notes : updated.notes, updated.plan),
      }
    })
  }, [contact, seed])
  const dirty = JSON.stringify(draft) !== original.current || prospectPending
  const guard = useDraftGuard(dirty, busy)
  const set = (patch: Partial<SalesDraft>) => { setNotice(''); setDraft(d => ({ ...d, ...patch })) }
  const refs = useAsync(async () => {
    const [clients, contacts, projects] = await Promise.all([api.listClients(), api.listContacts(), api.listProjects()])
    return { clients, contacts, projects }
  }, [], { clients: [], contacts: [], projects: [] })
  const projectIssue = validateSalesProject(draft, refs.data.projects)
  const eligibleProjects = refs.data.projects.filter(p => p.division === draft.division && p.client_id === draft.client_id)
  const close = () => { if (!lock.current && requestViewChange('sales:close')) onClose() }
  const confirmCandidate = async () => {
    if (!contact?.editableCandidate || lock.current || contact.candidate.status !== '검토') return
    const { id, revision, kind, title, owner_id, document, campaign_id } = contact.candidate
    const confirmed = { kind, title, owner_id, status: '확인', document, campaign_id }
    const invalid = validateGrowth(confirmed)
    if (invalid) { setError(`${invalid} 후보 정보에서 확인해 주세요.`); return }
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      contact.actions.refresh(await api.saveGrowth(id, confirmed, revision))
      setNotice('영업 대상으로 확인했습니다. 계획을 저장하면 파이프라인에도 등록됩니다.')
    } catch (e) { setError(friendlyError(e)) }
    finally { lock.current = false; setBusy(false) }
  }
  const canSaveContact = !contact || Boolean(linkedSalesId.current) || (contact.editableCandidate && contact.candidate.status === '확인')
  const save = async () => {
    if (lock.current || !canSaveContact) return
    if (refs.loading || refs.error) { setError('연결 자료를 다시 확인한 뒤 저장해 주세요.'); return }
    if (prospectPending) { setError('발굴 계획을 영업 정보에 먼저 적용해 주세요.'); return }
    const invalid = validateSalesPlan(readSalesPlan(draft.description).plan) ?? validateSales(draft) ?? projectIssue
    if (invalid) { setError(invalid); return }
    lock.current = true; setBusy(true); setError(''); setNotice('')
    let saved = false
    try {
      if (contact && !initial && revision.current === 0) {
        const source = contact.candidate
        if (!linkedSalesId.current) linkedSalesId.current = await api.linkGrowthSales(source.id, source.revision)
        const linked = await api.getSales(linkedSalesId.current)
        if (linked.revision !== 1 || !canEditSales(linked, me)) {
          throw new Error('연결된 계획에 다른 작업의 변경이 있습니다. 작성 내용을 복사한 뒤 후보를 다시 열어 최신 계획을 확인해 주세요.')
        }
        id.current = linked.id
        revision.current = linked.revision
      }
      const row = await api.saveSales(id.current, draft, revision.current)
      revision.current = row.revision
      setSavedRow(row)
      original.current = JSON.stringify(draft)
      saved = true
      if (contact) {
        setNotice('영업 계획을 저장했습니다.')
        if (contact.candidate.linked_sales_id !== row.id) {
          try {
            contact.actions.refresh(await api.getGrowth(contact.candidate.id))
          } catch {
            setNotice('영업 계획을 저장했습니다. 후보를 다시 열면 연결 상태를 확인할 수 있습니다.')
          }
        }
      } else if (onSaved) guard.afterSaved(() => onSaved(row.id))
    } catch (e) {
      const detail = friendlyError(e)
      setError(saved ? '저장은 완료했습니다. 화면을 다시 열어 결과를 확인해 주세요.'
        : contact && !initial && linkedSalesId.current ? `영업은 연결됐습니다. 작성한 계획은 화면에 유지됩니다. ${detail}` : detail)
    } finally { lock.current = false; setBusy(false) }
  }
  const { notes, plan } = readSalesPlan(draft.description)
  const changeSource = (source: SalesDraft['source']) => {
    if ((source === '나라장터') !== (draft.source === '나라장터') && plan.decisionDate) {
      if (!window.confirm('유입 경로를 바꾸면 기존 선정일 또는 제출 마감일을 비웁니다. 변경할까요?')) return
      set({ source, description: writeSalesPlan(notes, { ...plan, decisionDate: '' }) })
      return
    }
    set({ source })
  }
  return <SalesPanel inline={inline} title={title ?? (revision.current ? '영업 정보 수정' : '새 영업 기회')} onClose={close} actions={<>
    {contact && <Button kind="outline" disabled={busy} onClick={contact.actions.editCandidate}>후보 정보</Button>}
    <Button kind="ghost" disabled={busy} onClick={close}>{contact ? '닫기' : '취소'}</Button>
    {contact?.editableCandidate && !linkedSalesId.current && contact.candidate.status === '검토' && <Button kind="outline" disabled={busy} onClick={confirmCandidate}>영업 대상 확인</Button>}
    <Button disabled={busy || prospectPending || refs.loading || !!refs.error || !canSaveContact} onClick={save}>{busy ? (contact ? '처리 중…' : '저장 중…') : '저장'}</Button>
  </>}>
    {error && <p role="alert" className="sales-error">{error}</p>}
    {notice && <p role="status" className="sales-notice">{notice}</p>}
    {contact && !canSaveContact && <p className="t-small">{contact.candidate.status === '제외' ? '제외된 후보입니다. 후보 정보를 확인해 주세요.' : '계획은 바로 작성·출력할 수 있습니다. 저장하려면 영업 대상을 확인해 주세요.'}</p>}
    {discovery && !initial && <ProspectingPlanner owner={draft.owner_id} disabled={busy} onPending={setProspectPending} onApply={(seed, prospect) => {
      if (JSON.stringify(draft) !== original.current && !window.confirm('입력한 제목·회사·출처·다음 행동·메모를 발굴 계획으로 바꿀까요? 회사가 바뀌면 거래처·담당자·프로젝트 연결은 해제합니다.')) return false
      const description = writeSalesPlan(seed.description, {
        ...emptySalesPlan(),
        target: prospect.target.slice(0, SALES_PLAN_LIMITS.target),
        scope: (prospect.agencyScope ?? '').slice(0, SALES_PLAN_LIMITS.scope),
        demand: prospect.need.slice(0, SALES_PLAN_LIMITS.demand),
        contact: prospect.contact.slice(0, SALES_PLAN_LIMITS.contact),
        targetDate: prospect.start,
        decisionDate: prospect.agencyDecision ?? '',
        budget: (prospect.agencyBudget ?? '').slice(0, SALES_PLAN_LIMITS.budget),
        evidence: prospect.evidence.slice(0, SALES_PLAN_LIMITS.evidence),
      })
      setDraft(d => ({ ...d, title: seed.title, division: seed.division, source: seed.source, source_url: seed.source_url, next_date: seed.next_date, next_action: seed.next_action, description, ...(d.division !== seed.division ? { client_id: null, contact_id: null, project_id: null } : {}) }))
      setProspectApplied(true)
      setError('')
      return true
    }} />}
    {prospectPending && <p role="status" className="sales-notice">발굴 계획의 변경을 적용하면 저장할 수 있습니다. 닫으면 미저장 계획은 사라집니다.</p>}
    {refs.error && <div role="alert" className="sales-error">{refs.error}<Button kind="outline" disabled={busy || refs.loading} onClick={refs.reload}>연결 자료 다시 확인</Button></div>}
    <fieldset disabled={busy} className="sales-fieldset form-grid sales-editor-basics">
      <Field label="영업 건 이름 *" className="full"><input className="input" autoFocus={!inline && !discovery} maxLength={160} value={draft.title} onChange={e => set({ title: e.target.value })} /></Field>
      <Field label="진행 단계"><select className="select" value={draft.stage} onChange={e => set({ stage: e.target.value as SalesDraft['stage'], project_id: e.target.value === '수주' ? draft.project_id : null })}>{SALES_STAGES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="유입 경로"><select className="select" value={draft.source} onChange={e => changeSource(e.target.value as SalesDraft['source'])}>{SALES_SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>

      <Field label="출처 주소" className="full"><input className="input" type="url" maxLength={2000} value={draft.source_url} onChange={e => set({ source_url: e.target.value })} placeholder="https://" /></Field>
    </fieldset>
    {(!discovery || prospectApplied) && <SalesMethodAdvice input={contact?methodInputFromGrowth(contact.candidate):methodInputFromDraft(draft)} disabled={busy || prospectPending} onApplyNext={value=>{
      if(draft.next_action&&draft.next_action!==value&&!window.confirm('기존 다음 행동을 제안한 영업 방법으로 바꿀까요?'))return
      set({next_action:value})
    }}/>}
    {(!discovery || prospectApplied) && <SalesPlanSheet draft={draft} onChange={set} disabled={busy || prospectPending} ownerName={profileName(draft.owner_id)} />}
    <fieldset disabled={busy} className="sales-fieldset form-grid sales-editor-basics">
      <Field label="다음 연락일"><input className="input" type="date" value={draft.next_date ?? ''} onChange={e => set({ next_date: e.target.value || null })} /></Field>
      <Field label="다음 행동" className="full"><input className="input" maxLength={500} value={draft.next_action} onChange={e => set({ next_action: e.target.value })} placeholder="예: 공간 후보와 견적 전달" /></Field>
    </fieldset>
    <details className="sales-options" open={!!contact || ['수주', '실주', '보류'].includes(draft.stage) || undefined}>
      <summary>회사·담당자·금액·결과</summary>
      <fieldset disabled={busy} className="sales-fieldset form-grid">
        <Field label="수행 회사"><select className="select" value={draft.division} onChange={e => set({ division: e.target.value as SalesDraft['division'], project_id: null })}>{Object.entries(SALES_COMPANIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="담당자"><select className="select" value={draft.owner_id} disabled={me.role !== 'admin'} onChange={e => set({ owner_id: e.target.value })}>{profiles.filter(p => p.active && !p.is_agent).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="거래처"><select className="select" value={draft.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null, contact_id: null, project_id: null })}><option value="">아직 미연결</option>{refs.data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="거래처 담당자"><select className="select" value={draft.contact_id ?? ''} disabled={!draft.client_id} onChange={e => set({ contact_id: e.target.value || null })}><option value="">미연결</option>{refs.data.contacts.filter(c => c.client_id === draft.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="예상 금액 (원 · 미확인은 빈칸)"><input className="input" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={draft.expected_amount ?? ''} onChange={e => set({ expected_amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        <Field label="요청 내용·메모" className="full"><textarea className="textarea" rows={3} maxLength={10000 - (draft.description.length - notes.length)} value={notes} onChange={e => set({ description: writeSalesPlan(e.target.value, plan) })} /></Field>
        <Field label="결과·사유 (수주·실주·보류 필수)" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={draft.result_note} onChange={e => set({ result_note: e.target.value })} /></Field>
        {draft.stage === '수주' && <div className="full"><Field label="수주 프로젝트 연결"><select className="select" value={draft.project_id ?? ''} disabled={refs.loading} onChange={e => set({ project_id: e.target.value || null })}><option value="">아직 미연결</option>{draft.project_id && !eligibleProjects.some(p => p.id === draft.project_id) && <option value={draft.project_id}>기존 선택 · 회사·거래처 확인 필요</option>}{eligibleProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><span className="t-cap">{SALES_COMPANIES[draft.division]} · {refs.data.clients.find(c => c.id === draft.client_id)?.name ?? '거래처 미연결'}와 같은 프로젝트를 연결합니다. 프로젝트를 여기에서 만들고 연결할 수 있습니다.</span><div className="row wrap"><Button kind="outline" disabled={busy} onClick={() => setCreatingProject(true)}>새 프로젝트 만들기</Button><Button kind="outline" disabled={busy || refs.loading} onClick={() => { if (!lock.current) refs.reload() }}>{refs.loading ? '프로젝트 목록 확인 중…' : '프로젝트 목록 새로고침'}</Button></div>{!refs.loading && projectIssue && <span role="alert" className="sales-error">{projectIssue}</span>}</div>}
      </fieldset>
    </details>
    {contact && <section className="growth-candidate-detail" aria-label="연결 자료">
      <h3 className="t-sub">연결 자료</h3>
      <dl>
        <dt>거래처</dt><dd>{refs.data.clients.find(c => c.id === draft.client_id)?.name || '미연결'}</dd>
        <dt>거래처 연락처</dt><dd>{[refs.data.clients.find(c => c.id === draft.client_id)?.phone, refs.data.clients.find(c => c.id === draft.client_id)?.email].filter(Boolean).join(' · ') || '미등록'}</dd>
        <dt>담당자 연락처</dt><dd>{[refs.data.contacts.find(c => c.id === draft.contact_id)?.phone, refs.data.contacts.find(c => c.id === draft.contact_id)?.email].filter(Boolean).join(' · ') || '미등록'}</dd>
        <dt>프로젝트</dt><dd>{refs.data.projects.find(p => p.id === draft.project_id)?.name || '미연결'}</dd>
      </dl>
    </section>}
    {contact && savedRow && <SalesActivities id={savedRow.id} editable={canEditSales(savedRow, me)} />}
    {creatingProject && <ProjectForm project={null} clients={refs.data.clients} division={draft.division} initialClientId={draft.client_id}
      onClose={() => setCreatingProject(false)} onSaved={async projectId => {
        refs.reload()
        setNotice('프로젝트를 만들었습니다. 회사·거래처가 일치하면 연결 후 영업 계획을 저장해 주세요.')
        try {
          const project = (await api.listProjects()).find(p => p.id === projectId)
          if (project?.division === draft.division && project.client_id === draft.client_id) set({ project_id: projectId })
        } catch (e) { setError(friendlyError(e)) }
      }} />}
    <details className="sales-options" open={!!contact || undefined}>
      <summary>출처와 단계 안내</summary>
      {savedRow && <SalesOrigins id={savedRow.id} inlineSources={!!contact} />}
      <SalesPlaybook draft={draft} onApply={set} disabled={busy} />
    </details>
  </SalesPanel>
}
