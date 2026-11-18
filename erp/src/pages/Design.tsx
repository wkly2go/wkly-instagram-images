// 설계·견적 — 인테리어 디자인 자동화 (2026-11-15 통합 1차): 프로젝트별 수량표 → 견적 → 공정, 검토함, 단가 · 협력사 · 자재 · 학습 자료
// 금액 계산은 작업 처리기(견적 엔진)만 한다. 실행 단가 · 발주는 관리자에게만 보인다 (DB 정책 0125).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Shell, type TabKey } from '../components/Shell'
import { Badge, Button, Empty, Field, SectionHead } from '../components/ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { won } from '../lib/date'
import { DesignPriceRefPick } from '../components/DesignPriceRefPick'
import { useRouter, withQuery } from '../lib/router'
import { readXlsx } from '../lib/xlsx'
import { parseCostSheet } from '../lib/designCost'
import { PRICE_REF_GROUPS,
  CARD_LABELS, DOC_LABELS, PO_STATUS, SPACE_LABELS, STAGE_LABELS, VARIANT_LABELS,
  type DesignBase, type DesignCard, type DesignProject, type Estimate, type EstimateRules, type Knowledge, type PriceRefMatch, type SpaceType,
} from '../lib/design'
import { SiteBody } from './Site'
import { DesignPlan } from '../components/DesignPlan'
import { DesignRenders } from '../components/DesignRenders'
import { DesignDrawings } from '../components/DesignDrawings'
import { DesignSpec } from '../components/DesignSpec'
import { DesignProposal } from '../components/DesignProposal'
import { DesignDelivery } from '../components/DesignDelivery'
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import { ask } from '../components/Ask'
import {
  DesignJobStrip, DesignStepBar, DesignStepNav, LoadError, confirmDelete, confirmLeave, useDesignJobs, useDesignWide, useStoredFlag, useUnsaved,
  type StepInfo, type StepState,
} from '../components/DesignWorkspace'
import type { DesignJob } from '../lib/design'
import { DesignPriceSuggest } from '../components/DesignPriceSuggest'
import './Design.css'

type Tab = 'projects' | 'cards' | 'prices' | 'vendors' | 'materials' | 'knowledge'
const EMPTY_BASE: DesignBase = { trades: [], units: [] }
const num = (v: string | number | null | undefined) => (v == null || v === '' ? 0 : Number(v))

/** 왼쪽 메뉴 '설계·견적' 묶음의 화면들 (2026-11-15 대표 지시 '별도의 메뉴로 만들어서 세분화') — 주소가 곧 화면 */
const SECTIONS: Record<string, { tab: Tab | 'orders'; active: TabKey; title: string; lead: string }> = {
  '/design': { tab: 'projects', active: 'design', title: '설계 프로젝트', lead: '프로젝트별 수량표 → 견적 → 공정. 금액은 승인된 단가로만 계산합니다.' },
  '/design-orders': { tab: 'orders', active: 'designOrders', title: '실행 · 발주', lead: '실행 내역(업체별 품목) → 업체별 발주서 초안 · 손익. 관리자만 봅니다.' },
  '/design-cards': { tab: 'cards', active: 'designCards', title: '검토함', lead: '자동으로 만든 단가 · 견적 초안 · 발주서 초안을 확인하는 곳입니다.' },
  '/design-prices': { tab: 'prices', active: 'designPrices', title: '단가', lead: '견적에 쓰는 판매 단가와 발주에 쓰는 실행 단가(관리자만)입니다.' },
  '/design-vendors': { tab: 'vendors', active: 'designVendors', title: '협력사', lead: '거래 협력사와 나라장터 · 검색으로 찾은 후보입니다.' },
  '/design-materials': { tab: 'materials', active: 'designMaterials', title: '자재', lead: '마감재 · 자재 목록과 코드입니다.' },
  '/design-learn': { tab: 'knowledge', active: 'designLearn', title: '학습 자료', lead: '표본 자료에서 뽑아 둔 도면 세트 · 스펙북 · 보고서 구성과 기준입니다.' },
}

export default function Design() {
  const { api, me } = useApp()
  const { path } = useRouter()
  const sec = SECTIONS[path] ?? SECTIONS['/design']
  const { data: base } = useAsync(() => api.getDesignBase(), [], EMPTY_BASE)
  const tab = sec.tab
  return (
    <Shell active={sec.active}>
      <div className="design-page">
        <header className="design-head">
          <h1 className="t-title">{sec.title}</h1>
          <p className="t-cap">{sec.lead}</p>
        </header>
        {tab === 'projects' && <ProjectsTab base={base} mode="design" />}
        {tab === 'orders' && (me.role === 'admin' ? <ProjectsTab base={base} mode="orders" /> : <Empty>실행 · 발주는 관리자만 볼 수 있습니다.</Empty>)}
        {tab === 'cards' && <CardsTab />}
        {tab === 'prices' && <PricesTab base={base} />}
        {tab === 'vendors' && <VendorsTab base={base} />}
        {tab === 'materials' && <MaterialsTab />}
        {tab === 'knowledge' && <KnowledgeTab />}
      </div>
    </Shell>
  )
}

// ─────────────────────────────── 프로젝트
function ProjectsTab({ base, mode }: { base: DesignBase; mode: 'design' | 'orders' }) {
  const { api, version } = useApp()
  const { query, navigate, path } = useRouter()
  const { data: projects, loading, error, reload } = useAsync(() => api.listDesignProjects(), [version], [] as DesignProject[])
  const [starting, setStarting] = useState(false)
  const selected = projects.find(p => p.id === query.get('id')) ?? projects[0] ?? null
  const pickProject = async (id: string) => { if (await confirmLeave()) navigate(withQuery(path, query, { id, view: null })) }
  // 프로젝트 고르기는 위쪽 한 줄 (작업 칸을 넓게 — 오른쪽 일정 칸과 함께 써도 표가 잘리지 않게)
  const pick = (
    <label className="design-pick-select">
      <span>프로젝트</span>
      <select className="select" value={selected?.id ?? ''} onChange={e => void pickProject(e.target.value)} disabled={!projects.length}>
        {projects.length === 0 && <option value="">설계를 시작한 프로젝트가 없습니다</option>}
        {projects.map(p => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' ')} · {STAGE_LABELS[p.stage]}</option>)}
      </select>
    </label>
  )
  const startBtn = mode === 'design' ? <Button size="sm" kind="outline" onClick={() => setStarting(v => !v)}>{starting ? '닫기' : '설계 시작'}</Button> : null
  const startForm = starting ? <StartDesign onDone={id => { setStarting(false); navigate(withQuery(path, query, { id })) }} /> : null
  // 설계 프로젝트가 열려 있으면 고르기 · 요약 · 넓게 보기를 한 줄로 (작업 칸 높이를 아낌)
  if (selected && mode === 'design') return (
    <div className="design-main">
      <ProjectView key={selected.id} project={selected} base={base} pick={pick} count={projects.length} startBtn={startBtn} startForm={startForm} />
    </div>
  )
  return (
    <div className="design-main">
      <div className="design-pick">
        {pick}
        <span className="t-cap">설계 중 {projects.length}건</span>
        {startBtn}
      </div>
      {startForm}
      {selected ? <><ProjectHead project={selected} /><CostView key={selected.id} project={selected} /></>
        : error ? <LoadError message="설계 프로젝트를 불러오지 못했습니다." error={error} onRetry={reload} />
        : !loading && <Empty>아직 설계를 시작한 프로젝트가 없습니다. '설계 시작'에서 인트라넷 프로젝트를 고르세요.</Empty>}
    </div>
  )
}

function StartDesign({ onDone }: { onDone: (id: string) => void }) {
  const { api } = useApp()
  const { run, busy } = useAction()
  const { data: candidates } = useAsync(() => api.listDesignCandidates(), [], [])
  const [pid, setPid] = useState('')
  const [space, setSpace] = useState<SpaceType>('popup')
  const [area, setArea] = useState('')
  return (
    <form className="design-form" onSubmit={e => { e.preventDefault(); if (pid) run(() => api.startDesign(pid, space, area ? Number(area) : null), '설계를 시작했습니다').then(ok => ok && onDone(pid)) }}>
      <Field label="인트라넷 프로젝트 (아트리어)">
        <select className="select" value={pid} onChange={e => setPid(e.target.value)} required>
          <option value="">고르세요</option>
          {candidates.map(c => <option key={c.id} value={c.id}>{[c.code, c.name].filter(Boolean).join(' ')}</option>)}
        </select>
      </Field>
      <div className="row">
        <Field label="공간 종류">
          <select className="select" value={space} onChange={e => setSpace(e.target.value as SpaceType)}>
            {(Object.keys(SPACE_LABELS) as SpaceType[]).map(k => <option key={k} value={k}>{SPACE_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="면적 (㎡)"><input className="input" inputMode="decimal" value={area} onChange={e => setArea(e.target.value.replace(/[^\d.]/g, ''))} placeholder="예: 82.5" /></Field>
      </div>
      <Button type="submit" disabled={busy || !pid}>이 프로젝트로 설계 시작</Button>
      <p className="t-cap">프로젝트 이름 · 거래처 · 기간은 '프로젝트' 메뉴의 내용을 그대로 씁니다.</p>
    </form>
  )
}

function ProjectHead({ project }: { project: DesignProject }) {
  return (
    <div className="design-proj-head">
      <div>
        <h2 className="t-title">{project.name}</h2>
        <p className="t-cap">{[project.code, project.client_name, project.address].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="design-facts">
        <span><i>공간</i>{SPACE_LABELS[project.space_type]}</span>
        <span><i>면적</i>{project.area_m2 != null ? `${project.area_m2}㎡ (${(project.area_m2 / 3.3058).toFixed(1)}평)` : '미입력'}</span>
        <span><i>착공</i>{project.start_date ?? '미정'}</span>
        <span><i>단계</i>{STAGE_LABELS[project.stage]}</span>
        <span><i>모델</i>{project.model_version}번째</span>
      </div>
    </div>
  )
}

// ─────────────────────────────── 견적 자동 다시 계산 (2026-11-17 대표 지시 '견적 · 도면 · 스펙을 모두 연동 · 하나만 고쳐도 모두 연동')
// 수량표가 견적과 달라지면(직접 고침 · 평면 자동 반영 · 스케치업 수량 보내기) 15초 기다렸다가 작업 처리기에 견적 계산을 맡긴다.
// 같은 수량 상태(모델 번호 | 줄 수 | 수량 합)로는 딱 한 번만 맡긴다 — 계산 뒤에도 차이가 남으면 다시 맡기지 않고 사람이 확인 (되풀이 금지)
const AUTO_EST_WAIT = 15_000
const autoEstKey = (projectId: string) => `wkly-design-auto-est:${projectId}`
const readAutoEst = (projectId: string): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(autoEstKey(projectId)) ?? '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}
const writeAutoEst = (projectId: string, list: string[]) => {
  try {
    localStorage.setItem(autoEstKey(projectId), JSON.stringify(list.slice(-30)))
  } catch {
    /* 이 기기에 기억하지 못해도 이 화면이 열린 동안은 다시 맡기지 않는다 */
  }
}
const estJobActive = (jobs: DesignJob[]) => jobs.some(j => j.kind === 'estimate.build' && (j.status === 'queued' || j.status === 'running'))

/** want: 견적이 수량과 다르고 · 수량이 있고 · 견적 계산이 대기 · 진행 중이 아님. 반환: 'wait'(곧 맡김) · 'sent'(이 수량 상태로 맡겼음) · null */
function useAutoEstimate(projectId: string, want: boolean, sig: string, onSent: () => void): 'wait' | 'sent' | null {
  const { api, toast } = useApp()
  const asked = useRef<Set<string> | null>(null)
  if (asked.current === null) asked.current = new Set(readAutoEst(projectId))
  const [sent, setSent] = useState<string | null>(null)
  const say = useRef(toast)
  say.current = toast
  const after = useRef(onSent)
  after.current = onSent
  useEffect(() => {
    const seen = asked.current
    if (!want || !seen || seen.has(sig)) return
    let live = true
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const s of readAutoEst(projectId)) seen.add(s) // 같은 기기의 다른 창이 이미 맡겼으면 건너뜀
        if (seen.has(sig)) { if (live) setSent(sig); return }
        try {
          // 다른 사람 · 다른 창이 방금 맡긴 계산이 있으면 그것을 기다린다 (끝난 뒤에도 다르면 그때 한 번)
          if (estJobActive(await api.listDesignJobs(projectId))) { after.current(); return }
        } catch { /* 확인하지 못해도 맡긴다 */ }
        if (!live) return
        seen.add(sig)
        writeAutoEst(projectId, [...seen])
        try {
          await api.requestDesignJob(projectId, 'estimate.build')
          say.current('수량이 바뀌어 견적을 다시 계산합니다')
        } catch (e) {
          say.current(`견적 자동 계산을 맡기지 못했습니다. 견적에서 '견적 다시 계산'을 눌러 주세요. (${friendlyError(e)})`)
        }
        if (live) setSent(sig)
        after.current()
      })()
    }, AUTO_EST_WAIT)
    return () => { live = false; window.clearTimeout(timer) }
  }, [api, projectId, want, sig])
  // sent 는 맡긴 뒤 화면을 다시 그리게 하는 용도 — 이 기기에서 전에 맡긴 수량 상태면 다시 열어도 'sent'
  if (asked.current?.has(sig) || sent === sig) return 'sent'
  return want ? 'wait' : null
}

type StepKey = 'survey' | 'proposal' | 'model' | 'qty' | 'estimate' | 'drawings' | 'spec' | 'schedule' | 'delivery'
/** 작업 칸을 통째로 쓰는 단계 — '확인할 것'은 기본으로 접어 둔다 */
const WIDE_STEPS: StepKey[] = ['model', 'drawings', 'proposal', 'spec', 'delivery']

/**
 * 프로젝트 작업 화면 (레퍼런스: Houzz Pro · Programa — 세부 개발계획 'UI·UX 리서치' 3 · 5 · 6장)
 *  - 위: 프로젝트 한 줄 · 단계 표시줄(단계마다 상태 · 앞 단계가 바뀌면 뒤 단계에 '갱신 필요') · 작업 진행 띠  - 가운데: 그 단계의 작업  - 접는 칸: 검토 대기 · 경고 · 다음 행동 · 근거
 *  - 2026-11-17 작업 환경: 넓게 보기(채팅 · 일정 칸 숨김) · 단계 표시줄 한 줄 · 작업 상태를 모든 단계에서 확인
 */
function ProjectView({ project, base, pick, count, startBtn, startForm }: { project: DesignProject; base: DesignBase; pick: React.ReactNode; count: number; startBtn: React.ReactNode; startForm: React.ReactNode }) {
  const { api, me, version } = useApp()
  const { query, navigate } = useRouter()
  const view = (['survey', 'proposal', 'model', 'qty', 'estimate', 'drawings', 'spec', 'schedule', 'delivery'].includes(query.get('view') ?? '') ? query.get('view') : 'qty') as StepKey
  const go = async (k: StepKey) => { if (k !== view && await confirmLeave()) navigate(withQuery('/design', query, { view: k === 'qty' ? null : k })) }
  const [wide, setWide] = useDesignWide(true)
  // 작업 처리기에 맡긴 일이 끝나면 견적 · 파일 · 검토함만 다시 읽는다 (평면처럼 고치고 있는 화면은 건드리지 않음)
  const [jobTick, setJobTick] = useState(0)
  const { jobs, reload: reloadJobs } = useDesignJobs(project.id, () => setJobTick(t => t + 1))
  const wideStep = WIDE_STEPS.includes(view)
  const [infoNormal, setInfoNormal] = useStoredFlag('wkly-design-info', true)
  const [infoWide, setInfoWide] = useStoredFlag('wkly-design-info-wide', false)
  const infoOpen = wideStep ? infoWide : infoNormal
  const setInfo = wideStep ? setInfoWide : setInfoNormal
  const { data: survey } = useAsync(() => api.listSurvey(project.id).catch(() => []), [project.id, version], [])
  const { data: rows } = useAsync(() => api.listPlacements(project.id, project.model_version), [project.id, project.model_version, version], [])
  const { data: estimates } = useAsync(() => api.listEstimates(project.id), [project.id, version, jobTick], [] as Estimate[])
  const { data: tasks } = useAsync(() => api.listScheduleTasks(project.id), [project.id, version], [])
  const { data: props } = useAsync(() => api.listProposalSections(project.id), [project.id, version], [])
  const { data: specs } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [])
  const { data: pending } = useAsync(() => api.listDesignCards('pending', project.id), [project.id, version, jobTick], [] as DesignCard[])
  const { data: decided } = useAsync(() => api.listDesignCards('done', project.id), [project.id, version, jobTick], [] as DesignCard[])
  const est = estimates.find(e => e.variant === 'standard') ?? null
  const { data: lines } = useAsync(() => (est ? api.listEstimateLines(est.id) : Promise.resolve([])), [est?.id, jobTick], [])
  const confirmed = est ? decided.some(c => c.kind === 'estimate' && c.ref_id === est.id && c.status === 'approved') : false
  const qtySum = rows.reduce((s, r) => s + r.qty, 0), lineSum = lines.reduce((s, l) => s + l.qty, 0)
  const stale = !!est && lines.length > 0 && (est.model_version !== project.model_version || rows.length !== lines.length || Math.abs(qtySum - lineSum) > 0.0005)
  // 수량이 바뀌면 견적을 저절로 다시 계산 (수동 '견적 다시 계산' 버튼은 그대로)
  const estBusy = estJobActive(jobs)
  const auto = useAutoEstimate(project.id, stale && rows.length > 0 && !estBusy, `${project.model_version}|${rows.length}|${qtySum.toFixed(3)}`, () => void reloadJobs())
  const surveyDone = survey.filter(i => i.status === '확인' || i.status === '해당없음').length
  const missing = lines.filter(l => l.unit_price == null).length
  const state: Record<StepKey, StepState> = {
    survey: survey.length === 0 ? 'none' : surveyDone === survey.length ? 'done' : 'doing',
    proposal: props.length === 0 ? 'none' : props.every(s => s.status !== 'draft') ? 'done' : 'doing',
    model: project.model_version > 0 ? 'done' : 'none',
    qty: rows.length === 0 ? 'none' : est ? 'done' : 'doing',
    estimate: !est ? 'none' : stale ? 'stale' : confirmed ? 'done' : 'review',
    drawings: project.model_version > 0 ? 'doing' : 'none',
    spec: specs.length === 0 ? 'none' : specs.every(i => i.status === 'confirmed' || i.status === 'dropped') ? 'done' : 'doing',
    schedule: tasks.length === 0 ? 'none' : tasks.every(t => t.done) ? 'done' : 'doing',
    delivery: project.stage === 'done' ? 'done' : 'none',
  }
  const steps: StepInfo<StepKey>[] = ([
    { key: 'survey', label: '현장 실측', note: survey.length ? `${surveyDone}/${survey.length}` : '' },
    { key: 'proposal', label: '제안서', note: props.length ? `${props.filter(s => s.status === 'checked').length}항목 확인` : '' },
    { key: 'model', label: '평면 · 3D', note: project.model_version > 0 ? `모델 ${project.model_version}번째` : '' },
    { key: 'qty', label: '수량표', note: rows.length ? `${rows.length}줄` : '' },
    { key: 'estimate', label: '견적', note: est ? `${est.revision}차` : '' },
    { key: 'drawings', label: '도면', note: '' },
    { key: 'spec', label: '스펙북', note: specs.length ? `${specs.length}개` : '' },
    { key: 'schedule', label: '공정', note: tasks.length ? `${tasks.filter(t => t.done).length}/${tasks.length}` : '' },
    { key: 'delivery', label: '납품', note: '' },
  ] as { key: StepKey; label: string; note: string }[]).map(s => ({ ...s, state: state[s.key] }))
  const next: { text: string; to: StepKey } | null =
    rows.length === 0 ? { text: "수량을 넣으세요. '평면 · 3D'에서 그려 반영하거나, 스케치업에서 '수량 보내기', 또는 수량표에서 직접 넣습니다.", to: 'model' }
    : !est ? { text: "수량표에서 '이 수량으로 견적 계산'을 누르세요.", to: 'qty' }
    : stale && estBusy ? { text: '수량이 바뀌어 견적을 다시 계산하고 있습니다. 끝나면 견적 · 견적서 파일이 새로 바뀝니다.', to: 'estimate' }
    : stale && auto === 'wait' ? { text: '수량이 바뀌었습니다. 잠시 뒤 견적을 자동으로 다시 계산합니다.', to: 'estimate' }
    : stale && auto === 'sent' ? { text: "자동으로 다시 계산했지만 견적이 수량과 아직 다릅니다. 견적에서 확인하고 필요하면 '견적 다시 계산'을 누르세요.", to: 'estimate' }
    : stale ? { text: "수량이 견적과 다릅니다. 견적에서 '견적 다시 계산'을 누르세요.", to: 'estimate' }
    : missing ? { text: `단가 없는 항목 ${missing}개에 판매 단가를 넣고 다시 계산하세요.`, to: 'estimate' }
    : !confirmed ? { text: '견적 초안을 검토함에서 확인(확정)하세요.', to: 'estimate' }
    : tasks.length === 0 ? { text: '공정을 넣으세요.', to: 'schedule' } : null
  const warns = [
    ...(stale ? ['수량표가 바뀌어 견적이 최신이 아닙니다.'] : []),
    ...(missing ? [`단가가 없는 항목 ${missing}개는 금액에서 빠져 있습니다.`] : []),
    ...(est?.warnings ?? []).filter(w => w.level !== 'info').map(w => w.message),
    ...(project.area_m2 == null ? ['면적이 비어 있습니다. 평당 단가 점검을 하지 못합니다.'] : []),
  ]
  const rules = project.estimate_rules ?? {}
  const goOrders = async () => { if (await confirmLeave()) navigate(`/design-orders?id=${project.id}`) }
  return (
    <>
      <div className="design-top">
        {pick}
        <h2 className="design-sr">{project.name}</h2>
        <div className="design-facts">
          {(project.client_name || project.address) && <span className="design-facts-who">{[project.client_name, project.address].filter(Boolean).join(' · ')}</span>}
          <span><i>공간</i>{SPACE_LABELS[project.space_type]}</span>
          <span><i>면적</i>{project.area_m2 != null ? `${project.area_m2}㎡ (${(project.area_m2 / 3.3058).toFixed(1)}평)` : '미입력'}</span>
          <span><i>착공</i>{project.start_date ?? '미정'}</span>
          <span><i>단계</i>{STAGE_LABELS[project.stage]}</span>
          <span><i>모델</i>{project.model_version}번째</span>
        </div>
        <span className="design-gap" />
        <span className="t-cap design-top-count">설계 중 {count}건</span>
        <button type="button" className={`btn btn-sm design-wide-btn ${wide ? 'btn-blue' : 'btn-outline'}`} aria-pressed={wide} onClick={() => setWide(!wide)}
          title={wide ? '채팅 칸과 오른쪽 일정 칸을 다시 보입니다' : '채팅 칸과 오른쪽 일정 칸을 숨기고 작업 칸을 넓힙니다'}>
          {wide ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />} {wide ? '기본 화면' : '넓게 보기'}
        </button>
        {startBtn}
      </div>
      {startForm}
      <DesignStepBar steps={steps} current={view} onGo={k => void go(k)} admin={me.role === 'admin'} onOrders={() => void goOrders()} />
      <DesignJobStrip jobs={jobs} />
      {!infoOpen && (
        <button type="button" className="design-info-bar" onClick={() => setInfo(true)} aria-expanded={false} title="다음 할 일 · 검토 대기 · 경고 · 근거 펼치기">
          <b>확인할 것</b>
          <span className="design-info-next">{next ? `다음 할 일: ${next.text}` : '지금 단계에서 급한 일은 없습니다.'}</span>
          <span className="design-info-n">검토 대기 <em>{pending.length}</em></span>
          <span className={`design-info-n${warns.length ? ' red' : ''}`}>경고 <em>{warns.length}</em></span>
          <span className="design-info-open">펼치기 <ChevronDown size={13} aria-hidden="true" /></span>
        </button>
      )}
      <div className={`design-work${infoOpen ? '' : ' wide'}`}>
        <div className="design-work-main">
          {view === 'survey' && <SiteBody projectId={project.id} />}
          {view === 'proposal' && <DesignProposal project={project} />}
          {view === 'model' && <><DesignPlan project={project} base={base} /><DesignRenders project={project} /></>}
          {view === 'qty' && <QuantityView project={project} base={base} />}
          {view === 'estimate' && <EstimateView project={project} base={base} jobs={jobs} jobTick={jobTick} />}
          {view === 'drawings' && <DesignDrawings project={project} base={base} />}
          {view === 'spec' && <DesignSpec project={project} />}
          {view === 'delivery' && <DesignDelivery project={project} base={base} />}
          {view === 'schedule' && <ScheduleView project={project} base={base} />}
          <DesignStepNav steps={steps} current={view} onGo={k => void go(k)} />
        </div>
        {infoOpen && <aside className="design-side" aria-label="확인할 것">
          <button type="button" className="design-side-fold" onClick={() => setInfo(false)} aria-expanded={true}>확인할 것 <span>접기 <ChevronUp size={13} aria-hidden="true" /></span></button>
          <section>
            <h3>다음 할 일</h3>
            {next ? <><p>{next.text}</p>{next.to !== view && <Button size="sm" kind="outline" onClick={() => go(next.to)}>{steps.find(s => s.key === next.to)?.label}(으)로</Button>}</> : <p className="t-cap">지금 단계에서 급한 일은 없습니다.</p>}
          </section>
          <section>
            <h3>검토 대기 <span className="design-side-n">{pending.length}</span></h3>
            {pending.length === 0 ? <p className="t-cap">없습니다.</p> : <ul>{pending.slice(0, 5).map(c => <li key={c.id} className="design-ai"><b>{CARD_LABELS[c.kind] ?? c.kind}</b> {c.title}</li>)}</ul>}
            {pending.length > 0 && <Button size="sm" kind="ghost" onClick={() => navigate('/design-cards')}>검토함 열기</Button>}
          </section>
          <section>
            <h3>경고 <span className={`design-side-n${warns.length ? ' red' : ''}`}>{warns.length}</span></h3>
            {warns.length === 0 ? <p className="t-cap">없습니다.</p> : <ul>{warns.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </section>
          <section>
            <h3>근거</h3>
            <ul className="t-cap">
              <li>수량: 모델 {project.model_version}번째 · 모델 {rows.filter(r => r.source === 'model').length}줄 · 직접 {rows.filter(r => r.source === 'manual').length}줄</li>
              {est && <li>견적: {est.revision}차 · {est.created_at.slice(0, 10)} 계산 · {confirmed ? '확정' : '자동 초안(검토 전)'}</li>}
              <li>합계 방식: {rules.fee_mode === 'agency_fee' ? `대행 수수료 ${Math.round(Number(rules.agency_fee_rate ?? 0) * 1000) / 10}%` : rules.fee_mode === 'overhead_profit' ? '공과잡비 + 기업이윤' : '회사 공통 규칙'}</li>
              <li>단가: 승인된 판매 단가 중 가장 최근 것</li>
            </ul>
          </section>
        </aside>}
      </div>
    </>
  )
}

function tradeName(base: DesignBase, code: string | null) {
  return base.trades.find(t => t.code === code)?.name ?? code ?? ''
}

function QuantityView({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, version } = useApp()
  const { run, busy } = useAction()
  const { data: rows, error, reload } = useAsync(() => api.listPlacements(project.id, project.model_version), [project.id, project.model_version, version], [])
  const [draft, setDraft] = useState({ trade_code: '', item: '', spec: '', unit: '', qty: '', location: '', section: '', note: '' })
  const [find, setFind] = useState('')
  const sections = useMemo(() => [...new Set(rows.map(r => r.section).filter(Boolean))] as string[], [rows])
  const set = (k: keyof typeof draft, v: string) => setDraft(d => ({ ...d, [k]: v }))
  const word = find.trim().toLowerCase()
  const shown = useMemo(() => (word ? rows.filter(r => `${tradeName(base, r.trade_code)} ${r.item} ${r.spec ?? ''} ${r.section ?? ''} ${r.note ?? ''}`.toLowerCase().includes(word)) : rows), [base, rows, word])
  const groups = useMemo(() => base.trades.map(t => ({ trade: t, rows: shown.filter(r => r.trade_code === t.code) })).filter(g => g.rows.length), [base, shown])
  useUnsaved('qty-draft', '수량표에 넣던 줄', !!(draft.item.trim() || draft.spec.trim() || draft.qty || draft.note.trim()))
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const qty = Number(draft.qty)
    if (!draft.trade_code || !draft.item.trim() || !draft.unit || !(qty > 0)) return
    run(() => api.addPlacement({ project_id: project.id, model_version: project.model_version, trade_code: draft.trade_code, item: draft.item.trim(), spec: draft.spec.trim(), unit: draft.unit, qty, location: draft.location.trim() || null, section: draft.section.trim() || null, note: draft.note.trim() || null }), '수량을 넣었습니다')
      .then(ok => ok && setDraft(d => ({ ...d, item: '', spec: '', qty: '', location: '', note: '' })))
  }
  return (
    <div className="design-block">
      <SectionHead title="수량표" count={rows.length} right={<Button size="sm" disabled={busy || rows.length === 0} onClick={() => run(() => api.requestDesignJob(project.id, 'estimate.build'), '견적 계산을 요청했습니다. 잠시 뒤 견적 탭에 나옵니다')}>이 수량으로 견적 계산</Button>} />
      <p className="t-cap">'견적 구분'을 적으면 제출용 견적서가 그 묶음(A · B · C…)으로 나옵니다. 비우면 공종별로 묶습니다. '모델'은 스케치업에서 보낸 수량, '직접'은 여기서 넣은 수량입니다. 스케치업에서 다시 보내면 모델 수량만 바뀌고 직접 넣은 수량은 그대로 남습니다.</p>
      {rows.length > 0 && <TableFind value={find} onChange={setFind} shown={shown.length} total={rows.length} label="수량표 품목 찾기" />}
      {error && rows.length === 0 ? <LoadError message="수량표를 불러오지 못했습니다." error={error} onRetry={reload} />
        : rows.length === 0 ? <Empty>아직 수량이 없습니다. 스케치업에서 '수량 보내기'를 하거나 아래에서 직접 넣으세요.</Empty>
        : shown.length === 0 ? <Empty>찾는 낱말에 맞는 품목이 없습니다.</Empty> : (
        <div className="table-wrap design-table-fix"><table className="table">
          <thead><tr><th>공종</th><th>품목</th><th>규격</th><th className="num">수량</th><th>단위</th><th>견적 구분</th><th>비고</th><th>출처</th><th /></tr></thead>
          <tbody>{groups.flatMap(g => g.rows.map((r, i) => (
            <tr key={r.id}>
              <td className="nowrap strong">{i === 0 ? g.trade.name : ''}</td>
              <td>{r.item}</td><td className="max">{r.spec}</td>
              <td className="num">{r.source === 'manual'
                ? <input className="input xs design-qty" defaultValue={r.qty} inputMode="decimal" aria-label={`${r.item} 수량`}
                    onBlur={e => { const v = Number(e.target.value); if (v >= 0 && v !== r.qty) run(() => api.updatePlacementQty(r.id, v)) }} />
                : r.qty.toLocaleString('ko-KR')}</td>
              <td>{r.unit}</td>
              <td><input className="input xs design-sec" defaultValue={r.section ?? ''} list="design-sections" aria-label={`${r.item} 견적 구분`} onBlur={e => { const v = e.target.value.trim() || null; if (v !== r.section) run(() => api.updatePlacement(r.id, { section: v })) }} /></td>
              <td className="max t-cap">{r.note}</td>
              <td><Badge tone={r.source === 'model' ? 'paper' : 'yellow'}>{r.source === 'model' ? '모델' : '직접'}</Badge></td>
              <td>{r.source === 'manual' && <Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`수량표의 '${r.item}' 줄을`)) run(() => api.deletePlacement(r.id), '지웠습니다') }} aria-label={`${r.item} 지우기`}>지우기</Button>}</td>
            </tr>)))}</tbody>
        </table></div>
      )}
      <DesignPriceRefPick base={base} onPick={r => setDraft(d => ({ ...d, item: r.item, spec: r.spec, unit: r.unit_std && base.units.includes(r.unit_std) ? r.unit_std : d.unit, trade_code: d.trade_code || r.trade || '', note: `물가 기준 ${r.code ?? ''}`.trim() }))} />
      <form className="design-add" onSubmit={add} aria-label="수량 직접 넣기">
        <select className="select" value={draft.trade_code} onChange={e => set('trade_code', e.target.value)} aria-label="공종" required>
          <option value="">공종</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <input className="input" value={draft.item} onChange={e => set('item', e.target.value)} placeholder="품목" aria-label="품목" required />
        <input className="input" value={draft.spec} onChange={e => set('spec', e.target.value)} placeholder="규격" aria-label="규격" />
        <input className="input design-qty" value={draft.qty} onChange={e => set('qty', e.target.value.replace(/[^\d.]/g, ''))} placeholder="수량" aria-label="수량" inputMode="decimal" required />
        <select className="select" value={draft.unit} onChange={e => set('unit', e.target.value)} aria-label="단위" required>
          <option value="">단위</option>{base.units.map(u => <option key={u}>{u}</option>)}
        </select>
        <input className="input" value={draft.section} onChange={e => set('section', e.target.value)} placeholder="견적 구분 (예: 렌탈)" aria-label="견적 구분" list="design-sections" />
        <input className="input" value={draft.note} onChange={e => set('note', e.target.value)} placeholder="비고 (선택)" aria-label="비고" />
        <datalist id="design-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
        <Button type="submit" kind="outline" disabled={busy}>넣기</Button>
      </form>
    </div>
  )
}

function EstimateView({ project, base, jobs, jobTick }: { project: DesignProject; base: DesignBase; jobs: DesignJob[]; jobTick: number }) {
  const { api, me, version } = useApp()
  const { navigate } = useRouter()
  const { run, busy } = useAction()
  // 작업 상태는 프로젝트 화면이 한 곳에서 확인한다 (jobs) — 일이 끝나면 jobTick 이 올라 견적 · 파일을 다시 읽음
  const { data: estimates, error: estError, reload } = useAsync(() => api.listEstimates(project.id), [project.id, version, jobTick], [] as Estimate[])
  const { data: cards } = useAsync(() => api.listDesignCards('done', project.id), [project.id, version, jobTick], [] as DesignCard[])
  const { data: docs } = useAsync(() => api.listDesignDocuments(project.id), [project.id, version, jobTick], [])
  const working = jobs.some(j => j.status === 'queued' || j.status === 'running')
  const revisions = [...new Set(estimates.map(e => e.revision))]
  const [rev, setRev] = useState<number | null>(null)
  const [variant, setVariant] = useState<'economy' | 'standard' | 'premium'>('standard')
  const [find, setFind] = useState('')
  const revision = rev ?? revisions[0] ?? null
  const est = estimates.find(e => e.revision === revision && e.variant === variant) ?? estimates.find(e => e.revision === revision) ?? null
  const { data: lines } = useAsync(() => (est ? api.listEstimateLines(est.id) : Promise.resolve([])), [est?.id, jobTick], [])
  const confirmed = est ? cards.some(c => c.kind === 'estimate' && c.ref_id === est.id && c.status === 'approved') : false
  const bySection = lines.some(l => l.section)
  const word = find.trim().toLowerCase()
  const shown = word ? lines.filter(l => `${tradeName(base, l.trade_code)} ${l.section ?? ''} ${l.item} ${l.spec ?? ''}`.toLowerCase().includes(word)) : lines
  const groups = bySection
    ? [...new Set(lines.map(l => l.section ?? '기타'))].map((s, i) => ({ key: s, name: `${String.fromCharCode(65 + i)}. ${s}`, rows: shown.filter(l => (l.section ?? '기타') === s) })).filter(g => g.rows.length)
    : base.trades.map(t => ({ key: t.code, name: t.name, rows: shown.filter(l => l.trade_code === t.code) })).filter(g => g.rows.length)
  const files = docs.filter(d => d.version === revision)
  const missing = lines.filter(l => l.unit_price == null).length
  const [suggest, setSuggest] = useState<string | null>(null)
  return (
    <div className="design-block">
      <SectionHead title="견적" count={revisions.length ? `${revisions[0]}차` : undefined} right={
        <span className="row">
          {working && <Badge tone="yellow">계산 중</Badge>}
          <Button size="sm" disabled={busy || working} onClick={() => run(() => api.requestDesignJob(project.id, 'estimate.build'), '견적 계산을 요청했습니다')}>견적 다시 계산</Button>
          {me.role === 'admin' && <Button size="sm" kind="outline" onClick={() => navigate(`/design-orders?id=${project.id}`)}>실행 · 발주로</Button>}
        </span>} />
      <RulesForm project={project} />
      <DocForm project={project} />
      {estError && !est ? <LoadError message="견적을 불러오지 못했습니다." error={estError} onRetry={reload} />
        : !est ? <Empty>{working ? '견적을 계산하고 있습니다…' : "아직 견적이 없습니다. 수량표에서 '이 수량으로 견적 계산'을 누르세요."}</Empty> : <>
        <div className="row wrap design-est-pick">
          {revisions.map(r => <button type="button" key={r} className={`chip${r === revision ? ' active' : ''}`} onClick={() => setRev(r)}>{r}차</button>)}
          <span className="design-gap" />
          {(['economy', 'standard', 'premium'] as const).filter(v => estimates.some(e => e.revision === revision && e.variant === v)).map(v => (
            <button type="button" key={v} className={`chip${v === est.variant ? ' active' : ''}`} onClick={() => setVariant(v)}>{VARIANT_LABELS[v]}</button>))}
          {confirmed ? <Badge tone="blue">확정</Badge> : <span className="design-ai-tag">자동 초안 · 검토 전</span>}
        </div>
        <dl className={`design-totals${confirmed ? '' : ' design-ai'}`}>
          <div><dt>직접 공사비</dt><dd>{won(num(est.totals.direct))}</dd></div>
          {est.totals.fee_mode === 'agency_fee'
            ? <div><dt>대행 수수료</dt><dd>{won(num(est.totals.fee))}</dd></div>
            : <><div><dt>공과잡비</dt><dd>{won(num(est.totals.overhead))}</dd></div>
              <div><dt>기업이윤</dt><dd>{won(num(est.totals.profit))}</dd></div></>}
          {num(est.totals.adjustment) !== 0 && <div><dt>단수 정리</dt><dd>{won(num(est.totals.adjustment))}</dd></div>}
          <div><dt>공급가액</dt><dd>{won(num(est.totals.supply))}</dd></div>
          <div><dt>부가세</dt><dd>{won(num(est.totals.vat))}</dd></div>
          <div className="total"><dt>합계</dt><dd>{won(num(est.totals.total))}</dd></div>
        </dl>
        {(missing > 0 || est.warnings.length > 0) && <ul className="design-warns">
          {missing > 0 && <li className="red">단가가 없는 항목 {missing}개는 금액에서 빠졌습니다. 각 줄의 '물가 기준'에서 조달청 단가를 골라 넣거나 '단가' 탭에서 판매 단가를 넣은 뒤 다시 계산하세요.</li>}
          {est.warnings.filter(w => w.level !== 'info').map((w, i) => <li key={i} className={w.level === 'error' ? 'red' : ''}>{w.message}</li>)}
        </ul>}
        {files.length > 0 && <ul className="design-files" aria-label="만들어진 파일">
          {files.map(f => <li key={f.id}><FileButton id={f.id} label={DOC_LABELS[f.kind] ?? f.kind} /> {f.drive_path && <span className="t-cap">드라이브 › {f.drive_path}</span>}</li>)}
          {project.drive_url && <li><a href={project.drive_url} target="_blank" rel="noreferrer">프로젝트 드라이브 폴더 열기</a></li>}
        </ul>}
        <TableFind value={find} onChange={setFind} shown={shown.length} total={lines.length} label="견적 품목 찾기" />
        {word && shown.length === 0 ? <Empty>찾는 낱말에 맞는 품목이 없습니다.</Empty> : (
        <div className="table-wrap design-table-fix"><table className="table">
          <thead><tr><th>{bySection ? '구분' : '공종'}</th><th>품목</th><th>규격</th><th className="num">수량</th><th>단위</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
          <tbody>{groups.flatMap(g => [
            ...g.rows.flatMap((l, i) => [
              <tr key={l.id}><td className="nowrap strong">{i === 0 ? g.name : ''}</td><td>{l.item}</td><td className="max">{l.spec}</td>
                <td className="num">{l.qty.toLocaleString('ko-KR')}</td><td>{l.unit}</td>
                <td className={`num${l.unit_price == null ? ' red' : ''}`}>{l.unit_price == null ? <>단가 없음 <button type="button" className="design-ref-find" onClick={() => setSuggest(suggest === l.id ? null : l.id)}>물가 기준</button></> : l.unit_price.toLocaleString('ko-KR')}</td>
                <td className="num">{l.amount == null ? '' : l.amount.toLocaleString('ko-KR')}</td></tr>,
              ...(suggest === l.id ? [<tr key={`${l.id}-ref`} className="design-suggest-row"><td colSpan={7}><DesignPriceSuggest line={l} onAdded={() => undefined} /></td></tr>] : []),
            ]),
            <tr key={`${g.key}-sum`} className="design-sub"><td colSpan={6}>{g.name} 소계{word ? ' (찾은 줄만)' : ''}</td><td className="num">{g.rows.reduce((s, l) => s + (l.amount ?? 0), 0).toLocaleString('ko-KR')}</td></tr>,
          ])}</tbody>
        </table></div>)}
      </>}
    </div>
  )
}

/** 표 위 찾기 칸 — 품목 · 규격 · 공종 · 구분에서 낱말을 찾는다 */
function TableFind({ value, onChange, shown, total, label }: { value: string; onChange: (v: string) => void; shown: number; total: number; label: string }) {
  return (
    <div className="row design-find">
      <input className="input design-filter" type="search" value={value} onChange={e => onChange(e.target.value)} placeholder="품목 · 규격 · 공종 찾기" aria-label={label} />
      <span className="t-cap">{value.trim() ? `${total}줄 중 ${shown}줄` : `${total}줄`}</span>
      {value.trim() && <Button size="sm" kind="ghost" onClick={() => onChange('')}>모두 보기</Button>}
    </div>
  )
}

function FileButton({ id, label }: { id: string; label: string }) {
  const { api, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const get = async () => {
    setBusy(true)
    try {
      const f = await api.downloadDesignFile(id)
      const url = URL.createObjectURL(f.blob)
      const a = document.createElement('a')
      a.href = url; a.download = f.name
      document.body.appendChild(a); a.click(); a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) { toast(e instanceof Error ? e.message : '내려받지 못했습니다') } finally { setBusy(false) }
  }
  return <Button size="sm" kind="outline" disabled={busy} onClick={get}>{busy ? '받는 중…' : `${label} 내려받기`}</Button>
}

/** 실행 · 발주 (관리자만): 실행 내역(업체가 적힌 품목 목록) → 업체별 발주서 초안 · 손익 */
function CostView({ project }: { project: DesignProject }) {
  const { api, version, toast } = useApp()
  const { run, busy } = useAction()
  const { data: lines, error: linesError, reload: reloadLines } = useAsync(() => api.listCostLines(project.id), [project.id, version], [])
  const { data: estimates } = useAsync(() => api.listEstimates(project.id), [project.id, version], [] as Estimate[])
  const { data: pos } = useAsync(() => api.listPurchaseOrders(project.id), [project.id, version], [])
  const { data: poLines } = useAsync(() => api.listPoLines(pos.map(p => p.id)), [pos.map(p => p.id).join(',')], [])
  const { data: vendors } = useAsync(() => api.listDesignVendors(), [version], [])
  const { data: docs } = useAsync(() => api.listDesignDocuments(project.id), [project.id, version], [])
  const { data: cards } = useAsync(() => api.listDesignCards('done', project.id), [project.id, version], [] as DesignCard[])
  const [by, setBy] = useState<'vendor' | 'zone'>('vendor')
  const est = estimates.find(e => e.variant === 'standard') ?? null
  const confirmed = est ? cards.some(c => c.kind === 'estimate' && c.ref_id === est.id && c.status === 'approved') : false
  const cost = lines.reduce((s, l) => s + l.qty * (l.cost_price ?? 0), 0)
  const supply = est ? num(est.totals.supply) : 0
  const groups = useMemo(() => {
    const m = new Map<string, typeof lines>()
    for (const l of lines) { const k = (by === 'vendor' ? l.vendor_name : l.zone) || (by === 'vendor' ? '업체 미정' : '구역 없음'); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()].map(([name, rows]) => ({ name, rows, sum: rows.reduce((s, l) => s + l.qty * (l.cost_price ?? 0), 0) })).sort((a, b) => b.sum - a.sum)
  }, [lines, by])
  const upload = async (file: File | undefined) => {
    if (!file) return
    try {
      const sheet = parseCostSheet(await readXlsx(await file.arrayBuffer()))
      if (!sheet) { toast("실행 내역을 찾지 못했습니다. '수량' · '단가' 머리 줄이 있는 엑셀(.xlsx)인지 확인하세요"); return }
      if (lines.length && !(await ask(`지금 있는 실행 내역 ${lines.length}줄을 지우고 '${file.name}' ${sheet.rows.length}줄로 바꿉니다. 계속할까요?`))) return
      const checked = sheet.sheetTotal == null ? '' : sheet.sheetTotal === sheet.total ? ' · 엑셀 합계와 일치' : ` · 엑셀 합계(${won(sheet.sheetTotal)})와 다름 — 확인 필요`
      run(() => api.replaceCostLines(project.id, sheet.rows.map(r => ({ ...r, project_id: project.id })), file.name), `${sheet.rows.length}줄 · ${won(sheet.total)}${checked}`)
    } catch (e) { toast(e instanceof Error ? e.message : '파일을 읽지 못했습니다') }
  }
  const vname = (id: string) => vendors.find(v => v.id === id)?.name ?? ''
  const live = pos.filter(p => p.status !== 'cancelled')
  return (
    <div className="design-block">
      <SectionHead title="실행 내역" count={lines.length} right={<span className="row">
        <label className="btn btn-outline btn-sm">엑셀 올리기<input type="file" accept=".xlsx" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>
        <Button size="sm" disabled={busy || !lines.length || !confirmed} title={confirmed ? '' : '견적을 검토함에서 확정하면 만들 수 있습니다'} onClick={() => run(() => api.requestDesignJob(project.id, 'po.build'), '업체별 발주서 초안을 요청했습니다')}>업체별 발주서 초안 만들기</Button>
      </span>} />
      <p className="t-cap">구역별 품목 · 수량 · 단가 · 업체를 적은 엑셀(예: '기자재 리스트 - 실행가')을 올리면 업체별로 묶어 발주서 초안을 만듭니다. '구매 (쿠팡)'처럼 직접 사는 것과 업체가 빈 줄은 발주서에서 빠집니다. 발주서는 초안일 뿐 자동으로 보내지 않습니다.</p>
      <dl className="design-totals">
        <div><dt>견적 공급가액{est ? ` (${est.revision}차)` : ''}</dt><dd>{est ? won(supply) : '견적 없음'}</dd></div>
        <div><dt>실행 합계</dt><dd>{won(cost)}</dd></div>
        <div className="total"><dt>차액 (공급가액 − 실행)</dt><dd>{est ? won(supply - cost) : ''}</dd></div>
        <div><dt>실행 비율</dt><dd>{est && supply > 0 ? `${((cost / supply) * 100).toFixed(1)}%` : ''}</dd></div>
      </dl>
      <p className="t-cap">실행 합계는 여기 올린 실행 내역만 더한 값입니다. 인건비 · 운송 등 내역에 없는 비용은 들어 있지 않습니다.</p>
      {linesError && lines.length === 0 ? <LoadError message="실행 내역을 불러오지 못했습니다." error={linesError} onRetry={reloadLines} />
        : lines.length === 0 ? <Empty>아직 실행 내역이 없습니다. 엑셀을 올리세요.</Empty> : <>
        <div className="row"><button type="button" className={`chip${by === 'vendor' ? ' active' : ''}`} onClick={() => setBy('vendor')}>업체별</button><button type="button" className={`chip${by === 'zone' ? ' active' : ''}`} onClick={() => setBy('zone')}>구역별</button></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{by === 'vendor' ? '업체' : '구역'}</th><th>품목</th><th>{by === 'vendor' ? '구역' : '업체'}</th><th className="num">수량</th><th className="num">단가</th><th className="num">금액</th><th>비고</th><th /></tr></thead>
          <tbody>{groups.flatMap(g => [
            ...g.rows.map((l, i) => <tr key={l.id}><td className="nowrap strong">{i === 0 ? g.name : ''}</td><td>{l.item}</td><td className="nowrap">{by === 'vendor' ? l.zone : l.vendor_name}</td>
              <td className="num">{l.qty.toLocaleString('ko-KR')}</td><td className="num">{l.cost_price == null ? '' : l.cost_price.toLocaleString('ko-KR')}</td><td className="num">{(l.qty * (l.cost_price ?? 0)).toLocaleString('ko-KR')}</td>
              <td className="max t-cap">{l.note}</td><td><Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`실행 내역의 '${l.item}' 줄을`)) run(() => api.deleteCostLine(l.id), '지웠습니다') }} aria-label={`${l.item} 지우기`}>지우기</Button></td></tr>),
            <tr key={`${g.name}-sum`} className="design-sub"><td colSpan={5}>{g.name} 소계 · {g.rows.length}줄</td><td className="num">{g.sum.toLocaleString('ko-KR')}</td><td colSpan={2} /></tr>,
          ])}</tbody>
        </table></div>
      </>}
      <SectionHead title="발주서" count={live.length} />
      {live.length === 0 ? <Empty>아직 발주서가 없습니다.</Empty> : (
        <ul className="design-cards">{live.map(p => {
          const rows = poLines.filter(l => l.po_id === p.id)
          const doc = docs.find(d => d.kind === 'po_pdf' && d.file_path.includes(p.po_number))
          return <li key={p.id}>
            <div className="row wrap"><Badge tone={p.status === 'draft' ? 'outline' : 'blue'}>{PO_STATUS[p.status] ?? p.status}</Badge><b>{vname(p.vendor_id)}</b><span className="t-cap">{p.po_number}</span>
              <span className="design-right t-num">{won(p.total)}</span></div>
            <p className="t-cap">{rows.length}개 품목 · 납기 {p.due_date ?? '미정'} · {p.payment_terms}</p>
            {doc && <div><FileButton id={doc.id} label="발주서 (PDF)" /></div>}
          </li> })}</ul>
      )}
    </div>
  )
}

/** 합계 방식: 실제 견적서 두 가지 — 공사형(공과잡비 + 기업이윤) · 행사/렌탈형(대행 수수료 뒤 절삭) */
function RulesForm({ project }: { project: DesignProject }) {
  const { api } = useApp()
  const { run, busy } = useAction()
  const saved = project.estimate_rules ?? {}
  const pct = (v?: string) => (v ? String(Math.round(Number(v) * 1000) / 10) : '')
  const [mode, setMode] = useState<'' | 'overhead_profit' | 'agency_fee'>(saved.fee_mode ?? '')
  const [fee, setFee] = useState(pct(saved.agency_fee_rate) || '10')
  const [overhead, setOverhead] = useState(pct(saved.overhead_rate))
  const [profit, setProfit] = useState(pct(saved.profit_rate))
  const [unit, setUnit] = useState(saved.total_rounding_unit ?? '')
  const [skip, setSkip] = useState(!!saved.skip_required_trades)
  const rate = (v: string) => (v.trim() === '' ? undefined : String(Number(v) / 100))
  // 저장하지 않고 다른 단계로 가려 하면 묻는다 (지금 고른 방식에 쓰이는 칸만 견줌)
  useUnsaved('estimate-rules', '합계 방식', mode !== (saved.fee_mode ?? '') || unit !== (saved.total_rounding_unit ?? '') || skip !== !!saved.skip_required_trades
    || (mode === 'agency_fee' && fee !== (pct(saved.agency_fee_rate) || '10')) || (mode === 'overhead_profit' && (overhead !== pct(saved.overhead_rate) || profit !== pct(saved.profit_rate))))
  const save = () => {
    const rules: EstimateRules = saved.doc ? { doc: saved.doc } : {}
    if (mode) rules.fee_mode = mode
    if (mode === 'agency_fee') rules.agency_fee_rate = rate(fee) ?? '0.1'
    if (mode === 'overhead_profit') { rules.overhead_rate = rate(overhead); rules.profit_rate = rate(profit) }
    if (unit) rules.total_rounding_unit = unit
    if (skip) rules.skip_required_trades = true
    run(() => api.updateDesignProject(project.id, { estimate_rules: JSON.parse(JSON.stringify(rules)) }), "합계 방식을 저장했습니다. '견적 다시 계산'을 누르면 반영됩니다")
  }
  return (
    <details className="design-rules">
      <summary>합계 방식 · {saved.fee_mode === 'agency_fee' ? `대행 수수료 ${pct(saved.agency_fee_rate)}%` : saved.fee_mode === 'overhead_profit' ? '공과잡비 + 기업이윤' : '회사 공통 규칙'}{saved.total_rounding_unit ? ` · ${Number(saved.total_rounding_unit).toLocaleString('ko-KR')}원 미만 절삭` : ''}</summary>
      <div className="design-rules-body">
        <Field label="합계 방식">
          <select className="select" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
            <option value="">회사 공통 규칙 그대로</option>
            <option value="overhead_profit">공과잡비 + 기업이윤 (공사형)</option>
            <option value="agency_fee">대행 수수료 (행사 · 렌탈형)</option>
          </select>
        </Field>
        {mode === 'agency_fee' && <Field label="수수료 (%)"><input className="input" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        {mode === 'overhead_profit' && <>
          <Field label="공과잡비 (%)"><input className="input" inputMode="decimal" value={overhead} placeholder="공통값" onChange={e => setOverhead(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="기업이윤 (%)"><input className="input" inputMode="decimal" value={profit} placeholder="공통값" onChange={e => setProfit(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        </>}
        <Field label="공급가액 절삭">
          <select className="select" value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="">공통값 (천 원 미만)</option>
            <option value="10000">만 원 미만</option><option value="100000">십만 원 미만</option><option value="1000000">백만 원 미만</option>
          </select>
        </Field>
        <label className="design-check"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> 공사 공종 누락 경고 끄기 (목공 없는 렌탈형)</label>
        <Button size="sm" kind="outline" disabled={busy} onClick={save}>저장</Button>
      </div>
    </details>
  )
}

/** 제출용 견적서에 찍는 글 — 실제 견적서의 사업 개요 · 참고 사항 · 대금지불조건 */
function DocForm({ project }: { project: DesignProject }) {
  const { api } = useApp()
  const { run, busy } = useAction()
  const saved = project.estimate_rules?.doc ?? {}
  const [d, setD] = useState({ title: saved.title ?? '', place: saved.place ?? '', schedule: saved.schedule ?? '', scope: saved.scope ?? '', notes: (saved.notes ?? []).join('\n'), payment: (saved.payment ?? []).join('\n') })
  const linesOf = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)
  useUnsaved('estimate-doc', '제출용 견적서 글', d.title.trim() !== (saved.title ?? '') || d.place.trim() !== (saved.place ?? '') || d.schedule.trim() !== (saved.schedule ?? '') || d.scope.trim() !== (saved.scope ?? '')
    || linesOf(d.notes).join('\n') !== (saved.notes ?? []).join('\n') || linesOf(d.payment).join('\n') !== (saved.payment ?? []).join('\n'))
  const save = () => run(() => api.updateDesignProject(project.id, { estimate_rules: { ...project.estimate_rules, doc: {
    title: d.title.trim() || undefined, place: d.place.trim() || undefined, schedule: d.schedule.trim() || undefined, scope: d.scope.trim() || undefined,
    notes: linesOf(d.notes).length ? linesOf(d.notes) : undefined, payment: linesOf(d.payment).length ? linesOf(d.payment) : undefined } } }), "견적서 글을 저장했습니다. '견적 다시 계산'을 누르면 파일에 반영됩니다")
  return (
    <details className="design-rules">
      <summary>제출용 견적서 글 · {saved.title ?? '제목 · 개요 · 참고 사항 · 대금지불조건'}</summary>
      <div className="design-doc-body">
        <Field label="견적서 제목"><input className="input" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} placeholder={`${project.name} 견적`} /></Field>
        <Field label="장소"><input className="input" value={d.place} onChange={e => setD({ ...d, place: e.target.value })} placeholder={project.address ?? ''} /></Field>
        <Field label="일정"><input className="input" value={d.schedule} onChange={e => setD({ ...d, schedule: e.target.value })} placeholder="설치 · 운영 · 철거 일정" /></Field>
        <Field label="범위"><input className="input" value={d.scope} onChange={e => setD({ ...d, scope: e.target.value })} /></Field>
        <Field label="참고 사항 (한 줄에 하나 · 비우면 회사 기본 문구)"><textarea className="textarea" rows={3} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} /></Field>
        <Field label="대금지불조건 (한 줄에 하나 · 비우면 계약금 40 · 중도금 50 · 잔금 10)"><textarea className="textarea" rows={3} value={d.payment} onChange={e => setD({ ...d, payment: e.target.value })} /></Field>
        <Button size="sm" kind="outline" disabled={busy} onClick={save}>저장</Button>
      </div>
    </details>
  )
}

function ScheduleView({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, version } = useApp()
  const { run, busy } = useAction()
  const { data: tasks, error, reload } = useAsync(() => api.listScheduleTasks(project.id), [project.id, version], [])
  const [d, setD] = useState({ name: '', trade_code: '', start_date: project.start_date ?? '', end_date: project.start_date ?? '' })
  useUnsaved('schedule-draft', '넣던 공정', !!d.name.trim())
  const min = tasks.reduce((m, t) => (t.start_date < m ? t.start_date : m), tasks[0]?.start_date ?? '')
  const max = tasks.reduce((m, t) => (t.end_date > m ? t.end_date : m), tasks[0]?.end_date ?? '')
  const day = (s: string) => Math.round(new Date(`${s}T00:00:00`).getTime() / 86400000)
  const span = tasks.length ? day(max) - day(min) + 1 : 1
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!d.name.trim() || !d.start_date || !d.end_date || d.end_date < d.start_date) return
    run(() => api.addScheduleTask({ project_id: project.id, name: d.name.trim(), trade_code: d.trade_code || null, start_date: d.start_date, end_date: d.end_date, done: false }), '공정을 넣었습니다')
      .then(ok => ok && setD(v => ({ ...v, name: '', start_date: v.end_date })))
  }
  return (
    <div className="design-block">
      <SectionHead title="공정표" count={tasks.length} />
      <p className="t-cap">넣은 공정은 이 프로젝트의 할 일(일정 · 달력)로 자동으로 들어가고, 구글 캘린더 구독에도 보입니다. 인트라넷에서 그 할 일을 끝내면 여기 완료 표시도 같이 바뀝니다.</p>
      {error && tasks.length === 0 ? <LoadError message="공정표를 불러오지 못했습니다." error={error} onRetry={reload} />
        : tasks.length === 0 ? <Empty>아직 공정이 없습니다. 아래에서 공정을 넣으세요.</Empty> : (
        <div className="design-gantt" role="table" aria-label="공정표">
          <div className="design-gantt-scale t-cap"><span>{min}</span><span>{max} · {span}일</span></div>
          {tasks.map(t => (
            <div className={`design-gantt-row${t.done ? ' done' : ''}`} role="row" key={t.id}>
              <label className="design-gantt-name"><input type="checkbox" checked={t.done} disabled={busy} onChange={() => run(() => api.updateScheduleTask(t.id, { done: !t.done }))} /> <span>{t.name}</span></label>
              <div className="design-gantt-track"><i style={{ left: `${((day(t.start_date) - day(min)) / span) * 100}%`, width: `${((day(t.end_date) - day(t.start_date) + 1) / span) * 100}%` }} title={`${t.start_date} ~ ${t.end_date}`} /></div>
              <span className="t-cap design-gantt-date">{t.start_date.slice(5)} ~ {t.end_date.slice(5)}</span>
              <Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`공정 '${t.name}'을(를)`)) run(() => api.deleteScheduleTask(t.id), '지웠습니다') }} aria-label={`${t.name} 지우기`}>지우기</Button>
            </div>))}
        </div>
      )}
      <form className="design-add" onSubmit={add} aria-label="공정 넣기">
        <input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="공정 이름" aria-label="공정 이름" required />
        <select className="select" value={d.trade_code} onChange={e => setD({ ...d, trade_code: e.target.value })} aria-label="공종">
          <option value="">공종 (선택)</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <input className="input" type="date" value={d.start_date} onChange={e => setD({ ...d, start_date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date })} aria-label="시작일" required />
        <input className="input" type="date" value={d.end_date} min={d.start_date} onChange={e => setD({ ...d, end_date: e.target.value })} aria-label="종료일" required />
        <Button type="submit" kind="outline" disabled={busy}>넣기</Button>
      </form>
    </div>
  )
}

// ─────────────────────────────── 검토함
function CardsTab() {
  const { api, me, version } = useApp()
  const { run, busy } = useAction()
  const [mode, setMode] = useState<'pending' | 'done'>('pending')
  const { data: cards, error, reload } = useAsync(() => api.listDesignCards(mode), [mode, version], [] as DesignCard[])
  const [comment, setComment] = useState<Record<string, string>>({})
  const admin = me.role === 'admin'
  const summary = (c: DesignCard) => {
    const p = c.payload as { vendor?: string; file?: string; rows?: { ok?: boolean }[]; totals?: Record<string, { total?: string }> }
    if (p.rows) return `${p.vendor ? `${p.vendor} · ` : ''}${p.file ?? ''} · 가져올 항목 ${p.rows.filter(r => r.ok).length}개`
    if (p.totals?.standard?.total) return `기본안 합계 ${won(num(p.totals.standard.total))}`
    return ''
  }
  return (
    <div className="design-block">
      <div className="row"><button type="button" className={`chip${mode === 'pending' ? ' active' : ''}`} onClick={() => setMode('pending')}>검토 대기</button>
        <button type="button" className={`chip${mode === 'done' ? ' active' : ''}`} onClick={() => setMode('done')}>처리한 것</button></div>
      <p className="t-cap">자동으로 만든 것(가져온 단가 · 견적 초안 · 발주서 초안)은 여기서 확인한 뒤에만 쓰입니다. {admin ? '' : '결정은 관리자가 합니다.'}</p>
      {error && cards.length === 0 ? <LoadError message="검토함을 불러오지 못했습니다." error={error} onRetry={reload} />
        : cards.length === 0 ? <Empty>{mode === 'pending' ? '검토할 것이 없습니다.' : '처리한 기록이 없습니다.'}</Empty> : (
        <ul className="design-cards">{cards.map(c => (
          <li key={c.id}>
            <div className="row wrap"><Badge tone="paper">{CARD_LABELS[c.kind] ?? c.kind}</Badge><b>{c.title}</b>
              {c.status !== 'pending' && <Badge tone={c.status === 'approved' ? 'blue' : 'red'}>{c.status === 'approved' ? '승인' : '반려'}</Badge>}
              <span className="t-cap design-right">{c.requested_at.slice(0, 10)}</span></div>
            <p className="t-cap">{summary(c)}{c.comment ? ` · 메모: ${c.comment}` : ''}</p>
            {admin && c.status === 'pending' && <div className="row wrap">
              <input className="input" placeholder="메모 (선택)" aria-label={`${c.title} 메모`} value={comment[c.id] ?? ''} onChange={e => setComment({ ...comment, [c.id]: e.target.value })} />
              <Button size="sm" disabled={busy} onClick={() => run(() => api.decideDesignCard(c.id, true, comment[c.id] ?? ''), '승인했습니다')}>승인</Button>
              <Button size="sm" kind="outline" disabled={busy} onClick={() => run(() => api.decideDesignCard(c.id, false, comment[c.id] ?? ''), '반려했습니다')}>반려</Button>
            </div>}
          </li>))}</ul>
      )}
    </div>
  )
}

// ─────────────────────────────── 단가
/** 판매 단가 옆 물가 기준: 금액 · 차이(%) · 마우스를 올리면 어떤 품목과 견줬는지 */
function RefCell({ price, m, onFind }: { price: number; m?: PriceRefMatch; onFind: () => void }) {
  if (!m) return <button type="button" className="design-ref-find" onClick={onFind} title="물가 기준에서 이 품목 찾기">찾기</button>
  const gap = m.price > 0 ? Math.round(((price - m.price) / m.price) * 100) : 0
  return <span title={`${m.source_name} · ${m.item} ${m.spec} (${m.unit}) · ${m.notice_date ?? ''} · 비슷함 ${Math.round(m.score * 100)}%`}>
    {Math.round(m.price).toLocaleString('ko-KR')}<small className={`design-ref-gap${Math.abs(gap) >= 30 ? ' far' : ''}`}> {gap > 0 ? '+' : ''}{gap}%</small>
  </span>
}

function PricesTab({ base }: { base: DesignBase }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const [kind, setKind] = useState<'sell' | 'cost' | 'ref' | 'g2b'>('sell')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [trade, setTrade] = useState('')
  useEffect(() => { const t = window.setTimeout(() => setQ(search), 350); return () => window.clearTimeout(t) }, [search])
  const { data: prices } = useAsync(() => (kind === 'sell' ? api.listUnitPrices(q, trade || null) : Promise.resolve([])), [kind, q, trade, version], [])
  const { data: costs } = useAsync(() => (kind === 'cost' && admin ? api.listUnitCosts(q, trade || null) : Promise.resolve([])), [kind, q, trade, version, admin], [])
  const { data: vendors } = useAsync(() => (kind === 'cost' && admin ? api.listDesignVendors() : Promise.resolve([])), [kind, admin], [])
  const [group, setGroup] = useState('')
  const [cls, setCls] = useState('')
  const { data: g2b } = useAsync(() => (kind === 'g2b' ? api.listG2bItems(q, cls) : Promise.resolve({ rows: [], total: 0 })), [kind, q, cls, version], { rows: [], total: 0 })
  const { data: g2bGroups } = useAsync(() => (kind === 'g2b' ? api.listG2bGroups() : Promise.resolve([])), [kind], [])
  const { data: refs } = useAsync(() => (kind === 'ref' ? api.listPriceRefs(q, group) : Promise.resolve({ rows: [], total: 0 })), [kind, q, group, version], { rows: [], total: 0 })
  const { data: matches } = useAsync(() => (kind === 'sell' ? api.comparePriceRefs(prices.map(p => p.id)) : Promise.resolve([])), [kind, prices], [])
  const refOf = new Map(matches.map(m => [m.unit_price_id, m]))
  const vname = (id: string | null) => vendors.find(v => v.id === id)?.name ?? ''
  const count = kind === 'sell' ? prices.length : kind === 'cost' ? costs.length : refs.rows.length
  return (
    <div className="design-block">
      <div className="row wrap">
        <button type="button" className={`chip${kind === 'sell' ? ' active' : ''}`} onClick={() => setKind('sell')}>판매 단가 (견적용)</button>
        {admin && <button type="button" className={`chip${kind === 'cost' ? ' active' : ''}`} onClick={() => setKind('cost')}>실행 단가 (발주용 · 관리자만)</button>}
        <button type="button" className={`chip${kind === 'ref' ? ' active' : ''}`} onClick={() => setKind('ref')}>물가 기준</button>
        <button type="button" className={`chip${kind === 'g2b' ? ' active' : ''}`} onClick={() => setKind('g2b')}>나라장터 자재목록</button>
        <span className="design-gap" />
        <select className="select design-filter" value={trade} onChange={e => setTrade(e.target.value)} aria-label="공종으로 거르기">
          <option value="">모든 공종</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <input className="input design-filter" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={kind === 'ref' ? '기호 · 품목 · 규격 찾기' : kind === 'g2b' ? '품명 · 규격 · 제조사 · 식별번호 찾기' : '품목 · 규격 찾기'} aria-label="품목 · 규격 찾기" />
      </div>
      {kind === 'ref' && <div className="row wrap" role="group" aria-label="물가 기준 묶음">
        <button type="button" className={`chip${group === '' ? ' active' : ''}`} onClick={() => setGroup('')}>전체</button>
        {PRICE_REF_GROUPS.map(([k, name]) => <button type="button" key={k} className={`chip${group === k ? ' active' : ''}`} onClick={() => setGroup(k)}>{k} {name}</button>)}
      </div>}
      {kind === 'g2b' && <>
        <div className="row wrap" role="group" aria-label="자재 분류">
          <button type="button" className={`chip${cls === '' ? ' active' : ''}`} onClick={() => setCls('')}>전체</button>
          {[['30', '건자재'], ['3015', '외장마감재'], ['3016', '내장마감재'], ['39', '전기 · 조명'], ['40', '배관 · 설비'], ['56', '가구']].map(([k, name]) => <button type="button" key={k} className={`chip${cls === k ? ' active' : ''}`} onClick={() => setCls(k)}>{name}</button>)}
          <select className="select design-filter" value={cls.length === 4 ? cls : ''} onChange={e => setCls(e.target.value)} aria-label="분류 고르기">
            <option value="">분류 고르기</option>{g2bGroups.map(g => <option key={g.code} value={g.code}>{g.code} {g.name}</option>)}
          </select>
        </div>
        <p className="t-cap">조달청 물품목록(나라장터 자재목록) {g2b.total.toLocaleString('ko-KR')}건{g2b.total > g2b.rows.length ? ` 중 ${g2b.rows.length}건` : ''} · 건자재(외장 · 내장 마감재 포함) · 전기·조명 · 배관·설비 · 가구 품목의 이름 · 규격 · 제조사 · 물품식별번호입니다. 가격은 없습니다 — 가격은 '물가 기준'에서 찾습니다.</p>
        {g2b.rows.length === 0 ? <Empty>맞는 품목이 없습니다. 받는 중이면 잠시 뒤 다시 보세요.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>식별번호</th><th>분류</th><th>품명 · 규격</th><th>제조사</th><th>구분</th></tr></thead>
            <tbody>{g2b.rows.map(r => <tr key={r.ident_no}><td className="nowrap strong">{r.ident_no}</td><td className="nowrap t-cap">{r.class_name ?? r.class_no}</td><td className="max">{r.name}</td><td>{r.maker}</td><td className="nowrap t-cap">{r.kind}</td></tr>)}</tbody>
          </table></div>)}
      </>}
      {kind === 'g2b' ? null : kind === 'ref'
        ? <p className="t-cap">조달청 가격정보(시설자재 · 시장시공가격) · 나라장터 쇼핑몰 계약 단가(건자재 · 조명) · 조명 시중 판매가 {refs.total.toLocaleString('ko-KR')}건{refs.total > refs.rows.length ? ` 중 ${refs.rows.length}건` : ''} · 품목 · 규격 · 단위마다 기호가 하나씩 붙어 있고, 가격이 새로 고시돼도 기호는 그대로입니다. 수량표의 '물가 기준에서 찾아 넣기'에 기호나 이름을 넣어 씁니다. 부가세 별도 · 우리 단가는 바꾸지 않습니다.</p>
        : <p className="t-cap">{count >= 400 ? '400건까지만 보입니다. 공종이나 낱말로 좁혀 보세요.' : `${count}건`} · 견적에는 '승인'된 단가 중 가장 최근 것만 쓰입니다.{kind === 'sell' && matches.length > 0 ? ` · 물가 기준과 견준 것 ${matches.length}건` : ''}</p>}
      {kind === 'g2b' ? null : kind === 'ref' ? (refs.rows.length === 0 ? <Empty>아직 받은 물가 기준이 없습니다. 조달청 가격정보를 받는 대로 여기에 쌓입니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>기호</th><th>출처</th><th>품명</th><th>규격</th><th>단위</th><th className="num">단가</th><th className="num">재료 · 노무 · 경비</th><th>지역</th><th>기준일</th></tr></thead>
          <tbody>{refs.rows.map(r => <tr key={r.id}><td className="nowrap strong">{r.code}</td><td className="nowrap t-cap">{r.source_name.replace('조달청 ', '')}</td><td>{r.item}</td><td className="max">{r.spec}</td><td>{r.unit}</td><td className="num">{Math.round(r.price).toLocaleString('ko-KR')}</td><td className="num t-cap">{[r.material, r.labor, r.expense].some(x => x != null) ? [r.material, r.labor, r.expense].map(x => (x == null ? '-' : Math.round(x).toLocaleString('ko-KR'))).join(' · ') : ''}</td><td className="nowrap">{r.region}</td><td className="nowrap">{r.notice_date ?? ''}</td></tr>)}</tbody>
        </table></div>
      )) : count === 0 ? <Empty>맞는 단가가 없습니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>공종</th><th>품목</th><th>규격</th><th>단위</th>{kind === 'sell' && <th>안</th>}<th className="num">{kind === 'sell' ? '판매 단가' : '실행 단가'}</th>{kind === 'sell' && <th className="num">물가 기준</th>}{kind === 'cost' && <th>협력사</th>}<th>기준일</th><th>출처</th><th>상태</th></tr></thead>
          <tbody>{kind === 'sell'
            ? prices.map(p => <tr key={p.id}><td className="nowrap">{tradeName(base, p.trade_code)}</td><td>{p.item}</td><td className="max">{p.spec}</td><td>{p.unit}</td><td>{VARIANT_LABELS[p.variant]}</td><td className="num">{p.sell_price.toLocaleString('ko-KR')}</td><td className="num"><RefCell price={p.sell_price} m={refOf.get(p.id)} onFind={() => { setKind('ref'); setSearch(p.item.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).join(' ')) }} /></td><td className="nowrap">{p.effective_date}</td><td className="max t-cap">{p.source_doc}</td><td>{p.approved ? <Badge tone="blue">승인</Badge> : <Badge>대기</Badge>}</td></tr>)
            : costs.map(p => <tr key={p.id}><td className="nowrap">{tradeName(base, p.trade_code)}</td><td>{p.item}</td><td className="max">{p.spec}</td><td>{p.unit}</td><td className="num">{p.cost_price.toLocaleString('ko-KR')}</td><td>{vname(p.vendor_id)}</td><td className="nowrap">{p.effective_date}</td><td className="max t-cap">{p.source_doc}</td><td>{p.approved ? <Badge tone="blue">승인</Badge> : <Badge>대기</Badge>}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  )
}

// ─────────────────────────────── 협력사 · 자재 · 학습 자료
function VendorsTab({ base }: { base: DesignBase }) {
  const { api, version } = useApp()
  const [status, setStatus] = useState<'partner' | 'candidate'>('partner')
  const { data: all, error, reload } = useAsync(() => api.listDesignVendors(), [version], [])
  const [find, setFind] = useState('')
  const [trade, setTrade] = useState('')
  const rows = all.filter(v => v.status === status && (!trade || v.trades.includes(trade)) && (!find.trim() || `${v.name} ${v.region ?? ''} ${v.contact_name ?? ''}`.toLowerCase().includes(find.trim().toLowerCase())))
  return (
    <div className="design-block">
      <div className="row wrap">
        <button type="button" className={`chip${status === 'partner' ? ' active' : ''}`} onClick={() => setStatus('partner')}>거래 협력사 {all.filter(v => v.status === 'partner').length}</button>
        <button type="button" className={`chip${status === 'candidate' ? ' active' : ''}`} onClick={() => setStatus('candidate')}>후보 (나라장터 · 검색) {all.filter(v => v.status === 'candidate').length}</button>
        <input className="input design-filter" type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="이름 · 지역 · 담당자 찾기" aria-label="협력사 찾기" />
        <select className="select" value={trade} onChange={e => setTrade(e.target.value)} aria-label="공종으로 거르기"><option value="">모든 공종</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
        <span className="t-cap">{rows.length}곳</span>
      </div>
      <p className="t-cap">발주서 자동 배정에는 '거래 협력사'만 씁니다. '거래처 연결'은 인트라넷 거래처 메뉴에 같은 이름이 있는 곳입니다.</p>
      {error && all.length === 0 ? <LoadError message="협력사를 불러오지 못했습니다." error={error} onRetry={reload} />
        : rows.length === 0 ? <Empty>협력사가 없습니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>이름</th><th>담당 공종</th><th>지역</th><th>담당자</th><th>연락처</th><th>{status === 'partner' ? '거래처 연결' : '찾은 곳'}</th></tr></thead>
          <tbody>{rows.map(v => <tr key={v.id}><td className="strong">{v.name}</td><td>{v.trades.map(t => tradeName(base, t)).join(', ')}</td><td>{v.region}</td><td>{v.contact_name}</td><td className="nowrap">{v.phone}</td>
            <td className="t-cap max">{status === 'partner' ? (v.client_id ? <Badge tone="blue">연결됨</Badge> : <Badge>미연결</Badge>) : v.source_note}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  )
}

function MaterialsTab() {
  const { api, version } = useApp()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const t = window.setTimeout(() => setQ(search), 350); return () => window.clearTimeout(t) }, [search])
  const { data: rows, error, reload } = useAsync(() => api.listDesignMaterials(q), [q, version], [])
  return (
    <div className="design-block">
      <div className="row"><input className="input design-filter" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="자재 이름 · 분류 · 코드 찾기" aria-label="자재 찾기" /><span className="t-cap">{rows.length}건</span></div>
      {error && rows.length === 0 ? <LoadError message="자재를 불러오지 못했습니다." error={error} onRetry={reload} />
        : rows.length === 0 ? <Empty>맞는 자재가 없습니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>코드</th><th>분류</th><th>이름</th><th>규격</th><th>단위</th><th>메모</th></tr></thead>
          <tbody>{rows.map(m => <tr key={m.id}><td className="nowrap strong">{m.color_code}</td><td className="nowrap">{m.category}</td>
            <td>{m.product_url ? <a href={m.product_url} target="_blank" rel="noreferrer">{m.name}</a> : m.name}</td><td className="max">{m.spec}</td><td>{m.unit}</td><td className="max t-cap">{m.notes}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  )
}

const KIND_LABELS: Record<string, string> = {
  drawing_set: '도면 세트 구성', cad_standard: '캐드 작성 기준', general_notes: '일반 사항', material_codes: '자재 코드 체계', design_report: '설계 보고서 구성',
  render_scenes: '렌더 장면 구성', spec_book: '스펙북 구성', cost_sheet: '원가계산서 양식', special_specs: '특기 시방', detail_types: '상세도 유형', finish_schedule: '마감표 양식',
}
function outline(body: unknown, depth = 0): string[] {
  if (body == null) return []
  if (Array.isArray(body)) return body.slice(0, 40).flatMap(x => (typeof x === 'object' && x ? outline(x, depth + 1) : [`${'  '.repeat(depth)}· ${String(x)}`]))
  if (typeof body === 'object') return Object.entries(body as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'object' && v ? [`${'  '.repeat(depth)}${k}`, ...outline(v, depth + 1)] : [`${'  '.repeat(depth)}${k}: ${String(v)}`])
  return [`${'  '.repeat(depth)}${String(body)}`]
}
function KnowledgeTab() {
  const { api, version } = useApp()
  const { data: rows, error, reload } = useAsync(() => api.listKnowledge(), [version], [] as Knowledge[])
  return (
    <div className="design-block">
      <p className="t-cap">표본 자료에서 뽑아 둔 구성 · 기준입니다. 도면 세트 · 스펙북 · 설계 보고서 · 제안서를 만들 때 본보기로 씁니다. 금액은 여기에 없습니다.</p>
      {error && rows.length === 0 ? <LoadError message="학습 자료를 불러오지 못했습니다." error={error} onRetry={reload} />
        : rows.length === 0 ? <Empty>학습 자료가 없습니다.</Empty> : rows.map(k => (
        <details className="design-know" key={k.id}>
          <summary><Badge tone="paper">{KIND_LABELS[k.kind] ?? k.kind}</Badge> <b>{k.title}</b> <span className="t-cap">{[k.project_code, k.source].filter(Boolean).join(' · ')}</span></summary>
          <pre>{outline(k.body).slice(0, 200).join('\n')}</pre>
        </details>))}
    </div>
  )
}
