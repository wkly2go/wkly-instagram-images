// 평면 · 3D 작업 공간 — 인트라넷 화면에서 평면을 도면처럼 그리고(벽 · 문 · 창 · 부품) 바로 3D 로 보고, 수량을 견적으로 넘긴다
// 레퍼런스: Houzz Pro(한 화면 작업 공간 · 물량 → 견적) · 피그마(같이 보기 · 댓글 핀 · 자동 저장) · 캐드(되돌리기 · 길이 입력 · 모서리 끌기)
// 이 파일은 자료와 상태(되돌리기 · 자동 저장 · 같이 보기)를 맡고, 그리기는 DesignPlanCanvas, 기호는 DesignPlanSymbols, 댓글은 DesignPlanNotes 가 맡는다.
// 정밀 모델 · 렌더(Enscape)는 스케치업에서 한다. 여기서는 블록 수준 배치와 수량까지.
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { AppWindow, Armchair, BrickWall, Columns2, Cuboid, DoorOpen, FileUp, Maximize2, MessageSquarePlus, Minimize2, MousePointer2, Redo2, Scan, SeparatorVertical, Square, Undo2, Users, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { Button, Empty } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DesignBase, DesignProject, SpecItem } from '../lib/design'
import { BASE_TYPES, CEILING_TYPES, FLOOR_TYPES, WALL_TYPES } from '../lib/designWallTypes'
import { EMPTY_PLAN, floorArea, keepLights, mergeNotes, planQuantities, wallLength, type PlanGeometry, type PlanItem, type PlanNote, type PlanOpening, type PlanRoom, type PlanWall } from '../lib/designPlan'
import { setWallLength, type Pt } from '../lib/designPlanDraw'
import { finishLook, ITEM_SHAPES, itemShape, resolveFinish, type FinishKind } from '../lib/designPlanLook'
import { fixtureToItem, type LibraryFixture } from '../lib/designLibrary'
import { DesignPlanCanvas, GRID, uid, type PlanCanvasHandle, type PlanTool } from './DesignPlanCanvas'
import { DesignPlanNoteComposer, DesignPlanNotes } from './DesignPlanNotes'
import { DesignPlanLibrary } from './DesignPlanLibrary'
import { DesignPlanCadImport, DesignPlanExport } from './DesignPlanCad'
import './DesignPlan.css'

const Plan3D = lazy(() => import('./DesignPlan3D'))

const TOOLS: { key: PlanTool; label: string; tip: string; icon: LucideIcon }[] = [
  { key: 'select', label: '고르기', tip: '벽 · 문 · 부품을 눌러 고릅니다. 부품과 문 · 창은 끌어서 옮기고, 빈 곳을 끌면 화면이 움직입니다', icon: MousePointer2 },
  { key: 'wall', label: '기존 벽', tip: '점을 차례로 눌러 벽을 그립니다. 같은 점을 한 번 더 누르거나 Esc 로 끝냅니다', icon: BrickWall },
  { key: 'newwall', label: '새 가벽', tip: '새로 세우는 벽입니다. 수량(㎡)에 들어갑니다', icon: SeparatorVertical },
  { key: 'door', label: '문', tip: '벽을 누르면 그 자리에 문을 냅니다', icon: DoorOpen },
  { key: 'window', label: '창', tip: '벽을 누르면 그 자리에 창을 냅니다', icon: AppWindow },
  { key: 'item', label: '부품 놓기', tip: '부품을 정하거나 라이브러리에서 고른 뒤 평면을 눌러 놓습니다', icon: Armchair },
  { key: 'note', label: '댓글', tip: '평면의 한 자리를 눌러 댓글을 남깁니다', icon: MessageSquarePlus },
]
type Layout = 'plan' | 'split' | '3d'
const LAYOUTS: [Layout, string, LucideIcon][] = [['plan', '평면', Square], ['split', '나란히', Columns2], ['3d', '3D', Cuboid]]
const LAYOUT_KEY = 'wkly-design-plan-layout'
type Tab = 'sel' | 'lib' | 'notes'
type Target = 'wall' | 'floor' | 'ceiling' | 'base'
type Peer = { id: string; name: string }
/** 같이 보기 (lib/designApi watchDesignPlan): 지금 보는 사람 · 다른 사람이 저장했을 때의 알림 */
type Watch = (projectId: string, who: Peer, on: { peers(list: Peer[]): void; saved(by: Peer & { at: number }): void }) => { saved(): void; close(): void }

const digits = (v: string) => Number(v.replace(/\D/g, '')) || 0
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const holds = (g: PlanGeometry, id: string) => g.walls.some(w => w.id === id) || g.openings.some(o => o.id === id) || g.items.some(i => i.id === id)

function IconBtn({ label, children, ...rest }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="dpw-icon" aria-label={label} title={label} {...rest}>{children}</button>
}
/** 숫자 칸: 다 적고 Enter 를 누르거나 칸을 벗어날 때 한 번에 반영한다 (적는 도중의 값으로 도면이 흔들리지 않게) */
function NumDraft({ value, onCommit, ...rest }: { value: number; onCommit(n: number): void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => { const n = digits(text); if (n > 0 && n !== value) onCommit(n); else setText(String(value)) }
  return <input {...rest} className="input xs" inputMode="numeric" value={text} onChange={e => setText(e.target.value.replace(/\D/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
}

export function DesignPlan({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, me, toast, version } = useApp()
  const { run, busy } = useAction()
  const { data: specs } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [] as SpecItem[])

  // ── 평면 자료 · 되돌리기 ─────────────────────────────────
  const [plan, setPlanState] = useState<PlanGeometry>(EMPTY_PLAN)
  const planRef = useRef(plan)
  const hist = useRef({ past: [] as PlanGeometry[], future: [] as PlanGeometry[], tag: '', at: 0 })
  const [, setHistTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const ready = useRef(false)
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const rev = useRef(0)
  const [revTick, setRevTick] = useState(0)
  const [nudge, setNudge] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const inflight = useRef<Promise<boolean> | null>(null)
  const lastOwnSave = useRef(0)
  const dragging = useRef(false)
  const dragBase = useRef<PlanGeometry | null>(null)
  // 댓글은 되돌리기와 따로 간다: 내가 쓰거나 고친 것 · 지운 것만 기억해 두었다가 저장할 때 서버의 최신 댓글과 합친다
  const noteTouched = useRef(new Map<string, number>())
  const noteRemoved = useRef(new Map<string, number>())

  const [tool, setTool] = useState<PlanTool>('select')
  const [sel, setSel] = useState<string[]>([])
  const [noteSel, setNoteSel] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Pt | null>(null)
  const [tab, setTab] = useState<Tab>('sel')
  const [target, setTarget] = useState<Target>('wall')
  const [placing, setPlacing] = useState<LibraryFixture | null>(null)
  const [preset, setPreset] = useState({ name: '', trade_code: '', unit: 'EA', w: '1200', d: '600', h: '900', measure: 'count' as PlanItem['measure'], section: '' })
  const [wallT, setWallT] = useState({ wall: 150, newwall: 100 })
  const [openW, setOpenW] = useState({ door: 900, window: 1200 })
  const [fitKey, setFitKey] = useState(0)
  const [layout, setLayoutState] = useState<Layout>(() => { try { const v = localStorage.getItem(LAYOUT_KEY); return v === 'plan' || v === 'split' || v === '3d' ? v : 'split' } catch { return 'split' } })
  const [full, setFull] = useState<false | 'native' | 'css'>(false)
  const [wide, setWide] = useState(false)
  const [cadOpen, setCadOpen] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [remote, setRemote] = useState<{ name: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<PlanCanvasHandle>(null)
  const clip = useRef<{ items: PlanItem[]; n: number }>({ items: [], n: 0 })
  const watch = useRef<{ saved(): void; close(): void } | null>(null)

  const put = (next: PlanGeometry) => { planRef.current = next; setPlanState(next) }
  const touch = () => { rev.current += 1; dirtyRef.current = true; setDirtyState(true); setRevTick(rev.current) }
  /** 한 번의 고침 = 되돌리기 한 단계. tag 가 같은 고침이 잇따르면(글자 입력 · 방향키) 한 단계로 묶는다 */
  const change = (next: PlanGeometry | ((cur: PlanGeometry) => PlanGeometry), tag = '') => {
    const cur = planRef.current, value = typeof next === 'function' ? next(cur) : next
    if (value === cur) return
    const h = hist.current, now = Date.now()
    if (!(tag && tag === h.tag && now - h.at < 1500)) { h.past.push(cur); if (h.past.length > 120) h.past.shift() }
    h.future = []; h.tag = tag; h.at = now
    put(value); touch(); setHistTick(n => n + 1)
  }
  const step = (dir: 'undo' | 'redo') => {
    const h = hist.current, from = dir === 'undo' ? h.past : h.future, to = dir === 'undo' ? h.future : h.past
    const snap = from.pop()
    if (!snap) return
    const cur = planRef.current
    to.push(cur); h.tag = ''
    const next = { ...snap, notes: cur.notes }
    put(next); touch(); setHistTick(n => n + 1)
    setSel(ids => ids.filter(id => holds(next, id)))
  }
  const onDragStart = () => { dragBase.current = planRef.current; dragging.current = true }
  const onDragEnd = () => {
    const b = dragBase.current
    dragBase.current = null; dragging.current = false
    if (!b || b === planRef.current) return
    const h = hist.current
    h.past.push(b); h.future = []; h.tag = ''
    touch(); setHistTick(n => n + 1)
  }
  /** 댓글 고침 (되돌리기에 넣지 않는다) */
  const setNotes = (notes: PlanNote[]) => { put({ ...planRef.current, notes }); touch() }

  // ── 불러오기 ─────────────────────────────────────────────
  const adopt = (g: PlanGeometry) => {
    hist.current = { past: [], future: [], tag: '', at: 0 }
    put(g); setHistTick(n => n + 1)
    setSel(ids => ids.filter(id => holds(g, id)))
  }
  useEffect(() => {
    let alive = true
    ready.current = false; setLoading(true); setLoadFailed(false); setRemote(null); setSel([]); setNoteSel(null); setNoteDraft(null)
    noteTouched.current.clear(); noteRemoved.current.clear()
    dirtyRef.current = false; setDirtyState(false); setSavedAt(null); setSaveState('idle')
    api.getDesignPlan(project.id).then(saved => {
      if (!alive) return
      adopt({ ...EMPTY_PLAN, ...(saved ?? {}) })
      ready.current = true
      setFitKey(k => k + 1)
    }).catch(() => { if (alive) setLoadFailed(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [api, project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 저장 (자동 저장 · 지금 저장 · 수량표에 반영) ──────────
  /** 저장할 내용: 내 평면 + 서버의 최신 조명 수량(스펙북에서 고침) + 최신 댓글(다른 사람이 남긴 것) */
  const persist = async (pid: string, mine: PlanGeometry, apply: boolean): Promise<PlanGeometry> => {
    const touched = (mine.notes ?? []).filter(n => noteTouched.current.has(n.id)), removed = [...noteRemoved.current.keys()]
    const latest = await api.getDesignPlan(pid)
    const notes = mergeNotes(touched, latest?.notes, removed)
    const out: PlanGeometry = { ...keepLights(mine, latest), notes }
    if (!notes.length) delete out.notes
    await api.saveDesignPlan(pid, out)
    if (apply) await api.applyDesignPlan(pid, out, planQuantities(out))
    return out
  }
  const save = (apply = false): Promise<boolean> => {
    const pid = project.id
    const job = (async () => {
      if (inflight.current) await inflight.current.catch(() => false)
      if (!ready.current) return false
      setSaveState('saving')
      const startRev = rev.current
      let ok = false
      try {
        const out = await persist(pid, planRef.current, apply)
        for (const [id, r] of noteTouched.current) if (r <= startRev) noteTouched.current.delete(id)
        for (const [id, r] of noteRemoved.current) if (r <= startRev) noteRemoved.current.delete(id)
        // 저장하는 사이에 들어온 다른 사람의 댓글 · 조명 수량을 화면에도 반영한다 (되돌리기 단계는 만들지 않는다)
        const cur = planRef.current
        const notes = mergeNotes((cur.notes ?? []).filter(n => noteTouched.current.has(n.id)), out.notes, noteRemoved.current.keys())
        const next: PlanGeometry = { ...keepLights(cur, out), notes }
        if (!notes.length) delete next.notes
        if (JSON.stringify(next) !== JSON.stringify(cur)) put(next)
        if (rev.current === startRev) { dirtyRef.current = false; setDirtyState(false) }
        lastOwnSave.current = Date.now()
        setSavedAt(new Date()); setSaveState('idle')
        try { watch.current?.saved() } catch { /* 알림을 못 보내도 저장은 된 것 */ }
        ok = true
      } catch { setSaveState('error') }
      if (!ok || rev.current !== startRev) setNudge(n => n + 1)
      return ok
    })()
    inflight.current = job
    void job.finally(() => { if (inflight.current === job) inflight.current = null })
    return job
  }
  const saveRef = useRef(save)
  saveRef.current = save
  // 마지막으로 고친 뒤 2.5초가 지나면 저장한다. 끄는 중에는 미루고, 다른 사람이 고쳤다는 알림이 떠 있으면 고를 때까지 기다린다
  useEffect(() => {
    if (!dirty || loading || remote) return
    let t = window.setTimeout(function tick() {
      if (dragging.current) { t = window.setTimeout(tick, 500); return }
      void saveRef.current()
    }, saveState === 'error' ? 15000 : 2500)
    return () => window.clearTimeout(t)
  }, [dirty, revTick, nudge, loading, remote, saveState])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // 다른 단계로 넘어갈 때 저장하지 않은 것이 있으면 마저 저장한다
  useEffect(() => {
    const pid = project.id
    return () => { if (dirtyRef.current && ready.current) void persist(pid, planRef.current, false).catch(() => undefined) }
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 같이 보기: 지금 보는 사람 · 다른 사람이 저장하면 알림 ──
  const reload = async (force: boolean, by = '') => {
    try {
      const latest = await api.getDesignPlan(project.id)
      // 불러오는 사이에 내가 고쳤으면 덮어쓰지 않고 알림으로 바꾼다
      if (!force && (dirtyRef.current || dragging.current)) { setRemote({ name: by || '다른 사람' }); return }
      const notes = mergeNotes((planRef.current.notes ?? []).filter(n => noteTouched.current.has(n.id)), latest?.notes, noteRemoved.current.keys())
      const g: PlanGeometry = { ...EMPTY_PLAN, ...(latest ?? {}), notes }
      if (!notes.length) delete g.notes
      adopt(g)
      const mine = noteTouched.current.size > 0 || noteRemoved.current.size > 0
      dirtyRef.current = mine; setDirtyState(mine)
      if (mine) setNudge(n => n + 1)
      setRemote(null)
    } catch { toast('평면을 다시 불러오지 못했습니다') }
  }
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let handle: { saved(): void; close(): void } | null = null
    setPeers([])
    try {
      const fn = (api as unknown as { watchDesignPlan?: Watch }).watchDesignPlan
      if (typeof fn === 'function') handle = fn.call(api, project.id, { id: me.id, name: me.name }, {
        peers: list => setPeers((list ?? []).filter(p => p && p.id !== me.id)),
        saved: by => {
          if (by?.id === me.id && Date.now() - lastOwnSave.current < 4000) return
          if (!dirtyRef.current && !dragging.current && !inflight.current) void reloadRef.current(false, by?.name)
          else setRemote({ name: by?.name || '다른 사람' })
        },
      })
    } catch { handle = null }
    watch.current = handle
    return () => { watch.current = null; try { handle?.close() } catch { /* 이미 닫힘 */ } }
  }, [api, project.id, me.id, me.name])

  // ── 작업 공간: 폭 · 전체 화면 · 보기 전환 ─────────────────
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 980))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const exitFull = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); setFull(false) }, [])
  const toggleFull = async () => {
    const el = root.current
    if (!el) return
    if (full) { exitFull(); return }
    try { await el.requestFullscreen(); setFull('native') } catch { setFull('css') }
  }
  useEffect(() => {
    const on = () => setFull(f => (document.fullscreenElement === root.current ? 'native' : f === 'native' ? false : f))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  // 전체 화면에서는 이 칸 밖에 뜨는 창(옆 창 · 확인 창)이 보이지 않는다 → 그런 창이 뜨면 전체 화면을 먼저 닫는다
  useEffect(() => {
    if (!full) return
    const check = () => { if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(d => !root.current?.contains(d))) exitFull() }
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true })
    check()
    return () => mo.disconnect()
  }, [full, exitFull])
  const setLayout = (v: Layout) => { setLayoutState(v); try { localStorage.setItem(LAYOUT_KEY, v) } catch { /* 저장소를 못 써도 보기는 바뀐다 */ } }

  // ── 고른 대상 ────────────────────────────────────────────
  const selWalls = plan.walls.filter(w => sel.includes(w.id)), selItems = plan.items.filter(i => sel.includes(i.id)), selOpens = plan.openings.filter(o => sel.includes(o.id))
  const one = sel.length === 1
  const selWall = one ? selWalls[0] : undefined, selItem = one ? selItems[0] : undefined, selOpen = one ? selOpens[0] : undefined
  const rooms = plan.rooms ?? []
  const patchWalls = (ids: string[], p: Partial<PlanWall>, tag = '') => change(cur => ({ ...cur, walls: cur.walls.map(w => (ids.includes(w.id) ? { ...w, ...p } : w)) }), tag)
  const patchOpen = (id: string, p: Partial<PlanOpening>, tag = '') => change(cur => ({ ...cur, openings: cur.openings.map(o => (o.id === id ? { ...o, ...p } : o)) }), tag)
  const patchItems = (ids: string[], p: Partial<PlanItem>, tag = '') => change(cur => ({ ...cur, items: cur.items.map(i => (ids.includes(i.id) ? { ...i, ...p } : i)) }), tag)
  const removeSel = () => {
    if (!sel.length) return
    change(cur => ({ ...cur, walls: cur.walls.filter(w => !sel.includes(w.id)), openings: cur.openings.filter(o => !sel.includes(o.id) && !sel.includes(o.wall)), items: cur.items.filter(i => !sel.includes(i.id)) }))
    setSel([])
  }
  const cloneItems = (src: PlanItem[], off: number) => {
    if (!src.length) return
    const made = src.map(i => ({ ...i, id: uid(), x: i.x + off, y: i.y + off }))
    change(cur => ({ ...cur, items: [...cur.items, ...made] }))
    setSel(made.map(i => i.id))
  }
  const pickTool = (k: PlanTool) => { setTool(k); setNoteDraft(null); if (k !== 'item') setPlacing(null) }
  const select = (ids: string[]) => { setSel(ids); if (ids.length && tab === 'notes') setTab('sel') }

  // ── 글쇠 ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || cadOpen) return
      const t = e.target, active = document.activeElement
      if (t instanceof Element && t.closest('[role="dialog"], [role="alertdialog"]')) return
      const inside = !!active && !!root.current?.contains(active)
      const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (typing || !(inside || active === document.body || !active)) return
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (mod && !e.altKey && k === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); return }
      if (mod && !e.altKey && k === 'y') { e.preventDefault(); step('redo'); return }
      if (canvas.current?.key(e)) { e.preventDefault(); return }
      if (e.key === 'Escape') {
        if (noteDraft) setNoteDraft(null)
        else if (placing || tool !== 'select') { setPlacing(null); setTool('select') }
        else { setSel([]); setNoteSel(null) }
        return
      }
      if (!inside) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); removeSel(); return }
      if (e.key.startsWith('Arrow') && selItems.length && !mod && !e.altKey) {
        e.preventDefault()
        const d = e.shiftKey ? 500 : GRID, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        const ids = selItems.map(i => i.id)
        change(cur => ({ ...cur, items: cur.items.map(i => (ids.includes(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }), `nudge:${ids.join(',')}`)
        return
      }
      if (mod && k === 'c' && selItems.length && !window.getSelection()?.toString()) { clip.current = { items: selItems.map(i => ({ ...i })), n: 0 }; return }
      if (mod && k === 'v' && clip.current.items.length) { e.preventDefault(); clip.current.n += 1; cloneItems(clip.current.items, 200 * clip.current.n); return }
      if (k === 'd' && !e.altKey && !e.shiftKey && selItems.length) { e.preventDefault(); cloneItems(selItems, 200) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── 라이브러리 · 부품 놓기 · 댓글 · 캐드 ──────────────────
  const look = useCallback((text?: string | null, fb?: FinishKind) => finishLook(resolveFinish(text, specs), fb), [specs])
  const applyFinish = (text: string) => {
    if (target === 'wall') {
      const ids = selWalls.map(w => w.id)
      if (!ids.length) { toast('먼저 평면에서 마감을 넣을 벽을 골라 주세요'); return }
      patchWalls(ids, { finish: text })
      return
    }
    change(cur => {
      const list: PlanRoom[] = cur.rooms?.length ? cur.rooms : [{ id: `r${Date.now().toString(36)}`, no: '101', name: '', floor: {}, base: {}, wall: {}, ceiling: {}, ch: cur.height }]
      return { ...cur, rooms: list.map((r, i) => (i === 0 ? { ...r, [target]: { ...r[target], mat: text } } : r)) }
    })
  }
  const selectedFinish = target === 'wall' ? selWalls[0]?.finish?.trim() || null : rooms[0]?.[target].mat?.trim() || null
  const ghost = useMemo(() => {
    if (tool !== 'item') return null
    if (placing) {
      try { const it = fixtureToItem(placing, { x: 0, y: 0 }, base.trades, 'ghost'); return { w: it.rot === 90 ? it.d : it.w, d: it.rot === 90 ? it.w : it.d, name: it.name } } catch { return { w: placing.w, d: placing.d, name: placing.name } }
    }
    return { w: Number(preset.w) || 600, d: Number(preset.d) || 600, name: preset.name.trim() || '부품' }
  }, [tool, placing, preset.w, preset.d, preset.name, base.trades])
  const place = (at: Pt) => {
    let made: PlanItem
    if (placing) {
      try { made = { ...fixtureToItem(placing, at, base.trades, uid()), x: at.x, y: at.y } } catch { toast('이 부품을 놓지 못했습니다. 다시 골라 주세요'); return }
    } else {
      if (!preset.name.trim() || !preset.trade_code) { toast('놓을 부품의 이름과 공종을 먼저 정해 주세요'); return }
      made = { id: uid(), x: at.x, y: at.y, w: Number(preset.w) || 600, d: Number(preset.d) || 600, h: Number(preset.h) || 900, rot: 0, name: preset.name.trim(), trade_code: preset.trade_code, spec: '', unit: preset.unit, measure: preset.measure, section: preset.section.trim() || null }
    }
    const it = made
    change(cur => ({ ...cur, items: [...cur.items, it] }))
    setSel([it.id])
  }
  const addNote = (text: string) => {
    if (!noteDraft) return
    const n: PlanNote = { id: uid(), x: noteDraft.x, y: noteDraft.y, text, by: me.name, at: new Date().toISOString() }
    noteTouched.current.set(n.id, rev.current + 1)
    setNotes([...(planRef.current.notes ?? []), n])
    setNoteDraft(null); setNoteSel(n.id); setTab('notes')
  }
  const toggleNote = (id: string) => {
    noteTouched.current.set(id, rev.current + 1)
    setNotes((planRef.current.notes ?? []).map(n => (n.id === id ? { ...n, done: !n.done } : n)))
  }
  const removeNote = (id: string) => {
    noteTouched.current.delete(id); noteRemoved.current.set(id, rev.current + 1)
    setNotes((planRef.current.notes ?? []).filter(n => n.id !== id))
    if (noteSel === id) setNoteSel(null)
  }
  const importCad = (walls: PlanWall[], mode: 'replace' | 'add') => {
    setCadOpen(false)
    if (!walls?.length) return
    change(cur => {
      if (mode === 'replace') return { ...cur, walls, openings: cur.openings.filter(o => walls.some(w => w.id === o.wall)) }
      const used = new Set(cur.walls.map(w => w.id))
      return { ...cur, walls: [...cur.walls, ...walls.map(w => (used.has(w.id) ? { ...w, id: uid() } : w))] }
    })
    setSel([]); setTool('select'); setFitKey(k => k + 1)
    toast(mode === 'replace' ? `캐드 도면의 벽 ${walls.length}개로 바꿨습니다` : `캐드 도면의 벽 ${walls.length}개를 더했습니다`)
  }

  const lines = useMemo(() => planQuantities(plan), [plan])
  const area = useMemo(() => floorArea(plan.walls.filter(w => w.kind === 'existing')), [plan.walls])
  const plan3d = useDeferredValue(plan)
  const tname = (c: string) => base.trades.find(t => t.code === c)?.name ?? c
  const matNames = useMemo(() => [...new Set([...specs.filter(x => x.book === 'materials' && x.status !== 'dropped').map(x => [x.code, x.name].filter(Boolean).join(' ')), ...plan.walls.map(w => w.finish?.trim())].filter(Boolean))] as string[], [specs, plan.walls])
  const openNotes = (plan.notes ?? []).filter(n => !n.done).length
  const status = loading ? '불러오는 중…' : loadFailed ? '평면을 불러오지 못했습니다' : saveState === 'saving' ? '저장 중…' : saveState === 'error' ? '저장하지 못했습니다' : dirty ? '고친 내용을 곧 저장합니다' : savedAt ? `저장됨 ${hhmm(savedAt)}` : '저장됨'

  const inspector = () => {
    if (sel.length > 1) {
      const allWalls = selWalls.length === sel.length
      return <div className="dpw-form">
        <p className="dpw-form-title">{allWalls ? `벽 ${sel.length}개` : selItems.length === sel.length ? `부품 ${sel.length}개` : `${sel.length}개`}를 골랐습니다</p>
        {allWalls && <>
          <label className="dpw-f wide"><span>마감</span><input className="input" list="design-wall-finishes" placeholder="예: PT-01 수성 페인트 백색" onChange={e => patchWalls(sel, { finish: e.target.value }, `walls:${sel.join(',')}:finish`)} /></label>
          <label className="dpw-f"><span>두께</span><input className="input xs" inputMode="numeric" placeholder={String(selWalls[0].t)} onChange={e => { const t = digits(e.target.value); if (t > 0) patchWalls(sel, { t }, `walls:${sel.join(',')}:t`) }} /></label>
        </>}
        <p className="dpw-form-note">Shift 를 누른 채 누르면 여러 개를 고릅니다.{selItems.length > 0 ? ' 부품은 방향키로 50mm(Shift 500mm)씩 옮기고, D 로 하나 더 만듭니다.' : ''}{allWalls ? ' 라이브러리에서 마감을 누르면 고른 벽 모두에 들어갑니다.' : ''}</p>
        <div className="dpw-form-acts">
          {selItems.length > 0 && <Button size="sm" kind="outline" onClick={() => cloneItems(selItems, 200)}>하나 더</Button>}
          <Button size="sm" kind="ghost" onClick={removeSel}>지우기</Button>
        </div>
      </div>
    }
    if (selWall) {
      const w = selWall, tag = (k: string) => `wall:${w.id}:${k}`
      return <div className="dpw-form">
        <p className="dpw-form-title">{w.kind === 'new' ? '새 가벽' : '기존 벽'}</p>
        <label className="dpw-f"><span>길이</span><NumDraft value={Math.round(wallLength(w))} aria-label="벽 길이" title="숫자를 적고 Enter 를 누르면 끝점이 그 길이만큼 옮겨집니다. 이어진 벽도 함께 움직입니다" onCommit={n => change(cur => ({ ...cur, walls: setWallLength(cur.walls, w.id, n) }))} /><em>mm</em></label>
        <label className="dpw-f"><span>두께</span><input className="input xs" inputMode="numeric" value={w.t} onChange={e => patchWalls([w.id], { t: digits(e.target.value) }, tag('t'))} /><em>mm</em></label>
        <label className="dpw-f wide"><span>유형</span><select className="input" value={w.type ?? ''} title="표본 도면의 벽체 유형(W1~W30). 고르면 벽체 상세도에 층 구성이 그려지고, 두께가 정해진 유형은 두께도 맞춰집니다"
          onChange={e => { const t = WALL_TYPES.find(x => x.code === e.target.value); patchWalls([w.id], { type: t?.code, t: t && Number(t.thk) ? Number(t.thk) : w.t }) }}>
          <option value="">유형 없음</option>{WALL_TYPES.map(t => <option key={t.code} value={t.code}>{t.code} {t.name} · {t.composition.slice(0, 34)} · {t.thk || '?'}</option>)}</select></label>
        <label className="dpw-f wide"><span>마감</span><input className="input" list="design-wall-finishes" placeholder="예: PT-01 수성 페인트 백색" title="스펙북 마감재에 넣은 재료 번호를 고르거나 직접 적습니다. 라이브러리에서 눌러 넣을 수도 있습니다" value={w.finish ?? ''} onChange={e => patchWalls([w.id], { finish: e.target.value }, tag('finish'))} /></label>
        <div className="dpw-form-acts">
          <Button size="sm" kind="outline" onClick={() => patchWalls([w.id], { kind: w.kind === 'new' ? 'existing' : 'new' })}>{w.kind === 'new' ? '기존 벽으로' : '새 가벽으로'}</Button>
          {w.finish?.trim() && <Button size="sm" kind="outline" title="마감이 비어 있는 벽에만 같은 마감을 넣습니다" onClick={() => change(cur => ({ ...cur, walls: cur.walls.map(x => (x.finish?.trim() ? x : { ...x, finish: w.finish })) }))}>빈 벽에 같은 마감</Button>}
          <Button size="sm" kind="ghost" onClick={removeSel}>지우기</Button>
        </div>
        <p className="dpw-form-note">분홍 점(모서리)을 끌면 이어진 벽이 함께 움직입니다.</p>
      </div>
    }
    if (selOpen) {
      const o = selOpen, tag = (k: string) => `open:${o.id}:${k}`
      return <div className="dpw-form">
        <p className="dpw-form-title">{o.kind === 'door' ? '문' : '창'}</p>
        <label className="dpw-f"><span>폭</span><input className="input xs" inputMode="numeric" value={o.width} onChange={e => patchOpen(o.id, { width: digits(e.target.value) }, tag('width'))} /><em>mm</em></label>
        <label className="dpw-f"><span>벽 시작에서</span><input className="input xs" inputMode="numeric" value={Math.round(o.pos)} title="벽의 시작점에서 문 · 창 가운데까지의 거리. 평면에서 끌어서 옮길 수도 있습니다" onChange={e => patchOpen(o.id, { pos: digits(e.target.value) }, tag('pos'))} /><em>mm</em></label>
        {o.kind === 'door' && <>
          <label className="dpw-f"><span>높이</span><input className="input xs" inputMode="numeric" placeholder="2100" value={o.height ?? ''} onChange={e => patchOpen(o.id, { height: digits(e.target.value) || undefined }, tag('height'))} /><em>mm</em></label>
          <label className="dpw-f wide"><span>위치</span><input className="input" placeholder="들어가는 실 (예: 창고)" value={o.to ?? ''} onChange={e => patchOpen(o.id, { to: e.target.value }, tag('to'))} /></label>
          <label className="dpw-f wide"><span>종류</span><input className="input" list="design-door-kinds" placeholder="여닫이 도어" value={o.type ?? ''} onChange={e => patchOpen(o.id, { type: e.target.value }, tag('type'))} /></label>
          <label className="dpw-f wide"><span>문 마감</span><input className="input" list="design-mat-codes" placeholder="WD-01" value={o.finish ?? ''} onChange={e => patchOpen(o.id, { finish: e.target.value }, tag('finish'))} /></label>
          <label className="dpw-f wide"><span>프레임 마감</span><input className="input" list="design-mat-codes" placeholder="MT-01" value={o.frame ?? ''} onChange={e => patchOpen(o.id, { frame: e.target.value }, tag('frame'))} /></label>
        </>}
        <div className="dpw-form-acts">
          {o.kind === 'door' && <Button size="sm" kind="outline" title="문이 열리는 쪽을 벽의 반대편으로 바꿉니다" onClick={() => patchOpen(o.id, { side: o.side === -1 ? 1 : -1 })}>여는 방향 바꾸기</Button>}
          {o.kind === 'door' && <Button size="sm" kind="outline" title="경첩이 달린 쪽을 바꿉니다" onClick={() => patchOpen(o.id, { hinge: o.hinge === 'end' ? 'start' : 'end' })}>경첩 바꾸기</Button>}
          <Button size="sm" kind="ghost" onClick={removeSel}>지우기</Button>
        </div>
      </div>
    }
    if (selItem) {
      const it = selItem, tag = (k: string) => `item:${it.id}:${k}`, auto = ITEM_SHAPES.find(([k]) => k === itemShape(it.name))?.[1] ?? '상자'
      return <div className="dpw-form">
        <label className="dpw-f wide"><span>이름</span><input className="input" value={it.name} onChange={e => patchItems([it.id], { name: e.target.value }, tag('name'))} /></label>
        <label className="dpw-f wide"><span>모양</span><select className="input" value={it.shape ?? ''} title="평면 기호와 3D 모양. 비워 두면 이름으로 알아봅니다" onChange={e => patchItems([it.id], { shape: e.target.value || undefined })}>
          <option value="">이름으로 알아보기 ({auto})</option>{ITEM_SHAPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
        {(['w', 'd', 'h'] as const).map(k => <label key={k} className="dpw-f"><span>{{ w: '가로', d: '세로', h: '높이' }[k]}</span><input className="input xs" inputMode="numeric" value={it[k]} onChange={e => patchItems([it.id], { [k]: digits(e.target.value) }, tag(k))} /><em>mm</em></label>)}
        <label className="dpw-f"><span>바닥에서 높이</span><input className="input xs" inputMode="numeric" placeholder="0" value={it.z ?? ''} title="벽걸이 TV · 상부장처럼 바닥에서 띄운 높이" onChange={e => patchItems([it.id], { z: digits(e.target.value) || undefined }, tag('z'))} /><em>mm</em></label>
        <label className="dpw-f wide"><span>마감</span><input className="input" list="design-wall-finishes" placeholder="예: WD-01 오크 무늬목" title="재료 번호나 색 낱말을 적으면 평면과 3D 의 색이 바뀝니다" value={it.finish ?? ''} onChange={e => patchItems([it.id], { finish: e.target.value || undefined }, tag('finish'))} /></label>
        <label className="dpw-f wide"><span>공종</span><select className="input" value={it.trade_code} title="공종이 비어 있으면 수량표에 들어가지 않습니다" onChange={e => patchItems([it.id], { trade_code: e.target.value })}><option value="">공종 없음 (수량 제외)</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
        <label className="dpw-f wide"><span>규격</span><input className="input" placeholder={`W${it.w} D${it.d} H${it.h}`} value={it.spec} onChange={e => patchItems([it.id], { spec: e.target.value }, tag('spec'))} /></label>
        <label className="dpw-f wide"><span>수량 세는 법</span><select className="input" value={it.measure} onChange={e => { const m = e.target.value as PlanItem['measure']; patchItems([it.id], { measure: m, unit: m === 'area' ? 'm2' : m === 'length' ? 'm' : 'EA' }) }}><option value="count">개수로</option><option value="area">바닥 면적(㎡)으로</option><option value="length">길이(m)로</option></select></label>
        <label className="dpw-f wide"><span>견적 구분</span><input className="input" placeholder="선택 (예: 렌탈)" value={it.section ?? ''} onChange={e => patchItems([it.id], { section: e.target.value.trim() ? e.target.value : null }, tag('section'))} /></label>
        <div className="dpw-form-acts">
          <Button size="sm" kind="outline" onClick={() => patchItems([it.id], { rot: it.rot === 90 ? 0 : 90 })}>90° 돌리기</Button>
          <Button size="sm" kind="outline" title="같은 부품을 하나 더 만듭니다 (D)" onClick={() => cloneItems([it], 200)}>하나 더</Button>
          <Button size="sm" kind="ghost" onClick={removeSel}>지우기</Button>
        </div>
        <p className="dpw-form-note">방향키로 50mm(Shift 500mm)씩 옮깁니다. Ctrl+C · V 로 복사해 붙이고, 라이브러리에서 이 부품을 저장해 두면 다른 프로젝트에서도 바로 씁니다.</p>
      </div>
    }
    return <div className="dpw-form">
      <p className="dpw-form-title">고른 것이 없습니다</p>
      <p className="dpw-form-note">평면에서 벽 · 문 · 창 · 부품을 누르면 여기에서 치수 · 마감 · 종류를 고칩니다. 마감재와 가구 · 기구는 <b>라이브러리</b>에서 눌러 바로 넣을 수 있습니다.</p>
      <ul className="dpw-keys">
        <li><kbd>휠</kbd> 확대 · 축소</li><li><kbd>끌기</kbd> 화면 이동 (어느 도구에서나 <kbd>Space</kbd> + 끌기)</li>
        <li><kbd>숫자</kbd> + <kbd>Enter</kbd> 벽 길이</li><li><kbd>Ctrl</kbd> + <kbd>Z</kbd> 되돌리기</li>
        <li><kbd>방향키</kbd> 부품 옮기기</li><li><kbd>D</kbd> 하나 더 · <kbd>Delete</kbd> 지우기</li>
      </ul>
    </div>
  }

  return (
    <div className="design-block">
      <div ref={root} className={`dpw${wide ? ' wide' : ' narrow'}${full ? ' full' : ''}${full === 'css' ? ' full-css' : ''}`}>
        <div className="dpw-bar" role="toolbar" aria-label="평면 도구">
          <div className="dpw-tools">
            {TOOLS.map(t => <button type="button" key={t.key} title={t.tip} className={`dpw-tool${tool === t.key ? ' on' : ''}`} aria-pressed={tool === t.key} onClick={() => pickTool(t.key)}><t.icon size={13} /><span>{t.label}</span></button>)}
          </div>
          <span className="dpw-sep" />
          <div className="dpw-group">
            <IconBtn label="되돌리기 (Ctrl+Z)" disabled={!hist.current.past.length} onClick={() => step('undo')}><Undo2 size={14} /></IconBtn>
            <IconBtn label="다시 하기 (Ctrl+Shift+Z)" disabled={!hist.current.future.length} onClick={() => step('redo')}><Redo2 size={14} /></IconBtn>
          </div>
          <span className="dpw-sep" />
          <div className="dpw-group">
            <IconBtn label="축소" onClick={() => canvas.current?.zoomBy(1.25)}><ZoomOut size={14} /></IconBtn>
            <IconBtn label="확대" onClick={() => canvas.current?.zoomBy(0.8)}><ZoomIn size={14} /></IconBtn>
            <button type="button" className="dpw-text" title="그린 것 전체가 보이게 맞춥니다" onClick={() => canvas.current?.fit()}><Scan size={13} />맞춤</button>
          </div>
          <span className="dpw-sep" />
          <div className="dpw-seg" role="group" aria-label="보기">
            {LAYOUTS.map(([k, label, Icon]) => <button type="button" key={k} className={layout === k ? 'on' : ''} aria-pressed={layout === k} onClick={() => setLayout(k)}><Icon size={13} />{label}</button>)}
          </div>
          <button type="button" className="dpw-text" aria-pressed={!!full} title="작업 공간을 화면 가득 넓힙니다" onClick={() => void toggleFull()}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{full ? '전체 화면 닫기' : '전체 화면'}</button>
          <span className="dpw-sep" />
          <button type="button" className="dpw-text" title="캐드 도면(DXF)의 벽을 평면으로 가져옵니다" onClick={() => setCadOpen(true)}><FileUp size={13} />캐드 가져오기</button>
          <DesignPlanExport plan={plan} name={project.name} look={look} />
          <label className="dpw-h">천장 높이 <input className="input xs" inputMode="numeric" value={plan.height} onChange={e => change({ ...plan, height: digits(e.target.value) }, 'height')} /> mm</label>
          <span className="dpw-gap" />
          {peers.length > 0 && <span className="dpw-peers" title={peers.map(p => p.name).join(', ')}><Users size={13} />지금 보는 사람{peers.slice(0, 4).map(p => <i key={p.id}>{p.name}</i>)}{peers.length > 4 && <i>+{peers.length - 4}</i>}</span>}
          <span className={`dpw-status${saveState === 'error' || loadFailed ? ' err' : ''}`} role="status">{status}{saveState === 'error' && <> — <button type="button" className="dpw-link" onClick={() => void save()}>다시 시도</button></>}{loadFailed && <> — <button type="button" className="dpw-link" onClick={() => window.location.reload()}>새로 고침</button></>}</span>
          <Button size="sm" kind="outline" disabled={!dirty || loading || loadFailed || saveState === 'saving'} onClick={() => void save()}>지금 저장</Button>
        </div>

        <div className="dpw-opts">
          {(tool === 'wall' || tool === 'newwall') && <>
            <label className="dpw-h">벽 두께 <input className="input xs" inputMode="numeric" value={wallT[tool] || ''} onChange={e => setWallT({ ...wallT, [tool]: digits(e.target.value) })} aria-label="그릴 벽의 두께" /> mm</label>
            <span>점을 차례로 눌러 그립니다 · 길이는 <b>숫자를 치고 Enter</b> · 벽 끝에 가까이 가면 붙습니다 · Shift 를 누르면 비스듬히 · 같은 점을 한 번 더 누르거나 Esc 로 끝냅니다</span>
          </>}
          {(tool === 'door' || tool === 'window') && <>
            <label className="dpw-h">{tool === 'door' ? '문' : '창'} 폭 <input className="input xs" inputMode="numeric" value={openW[tool] || ''} onChange={e => setOpenW({ ...openW, [tool]: digits(e.target.value) })} aria-label={tool === 'door' ? '낼 문의 폭' : '낼 창의 폭'} /> mm</label>
            <span>벽을 누르면 그 자리에 {tool === 'door' ? '문' : '창'}이 납니다 · 낸 뒤에는 고르기로 끌어서 옮기고, 오른쪽에서 {tool === 'door' ? '여는 방향 · 경첩 · 종류' : '폭'}를 고칩니다</span>
          </>}
          {tool === 'item' && placing && <span><b>{placing.name}</b> 놓는 중 — 평면을 누르는 자리마다 놓입니다 · Esc 로 끝냅니다 <button type="button" className="dpw-link" onClick={() => setPlacing(null)}>직접 정해서 놓기</button></span>}
          {tool === 'item' && !placing && <div className="dpw-preset" aria-label="놓을 부품">
            <input className="input" value={preset.name} onChange={e => setPreset({ ...preset, name: e.target.value })} placeholder="부품 이름 (예: 진열 집기)" aria-label="부품 이름" />
            <select className="select" value={preset.trade_code} onChange={e => setPreset({ ...preset, trade_code: e.target.value })} aria-label="공종"><option value="">공종</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
            {(['w', 'd', 'h'] as const).map(k => <input key={k} className="input dpw-num" value={preset[k]} inputMode="numeric" onChange={e => setPreset({ ...preset, [k]: e.target.value.replace(/\D/g, '') })} aria-label={{ w: '가로', d: '세로', h: '높이' }[k]} placeholder={{ w: '가로', d: '세로', h: '높이' }[k]} title={{ w: '가로 mm', d: '세로 mm', h: '높이 mm' }[k]} />)}
            <select className="select" value={preset.measure} onChange={e => setPreset({ ...preset, measure: e.target.value as PlanItem['measure'], unit: e.target.value === 'area' ? 'm2' : e.target.value === 'length' ? 'm' : 'EA' })} aria-label="수량 세는 법"><option value="count">개수로</option><option value="area">바닥 면적(㎡)으로</option><option value="length">길이(m)로</option></select>
            <input className="input" value={preset.section} onChange={e => setPreset({ ...preset, section: e.target.value })} placeholder="견적 구분 (선택)" aria-label="견적 구분" />
            <button type="button" className="dpw-link" onClick={() => setTab('lib')}>라이브러리에서 고르기</button>
          </div>}
          {tool === 'note' && <span>평면의 한 자리를 누르면 번호 핀이 꽂히고 댓글을 남길 수 있습니다 · 같이 보는 사람에게도 보입니다</span>}
          {tool === 'select' && <span>눌러서 고르고(Shift 로 여러 개), 부품 · 문 · 창은 끌어서 옮깁니다 · 빈 곳을 끌면 화면 이동 · 휠로 확대 · 격자 {GRID}mm · 치수는 mm</span>}
        </div>

        {remote && <div className="dpw-banner" role="status">
          <span><b>{remote.name}님이 방금 평면을 고쳤습니다.</b> 내가 고친 내용은 아직 저장하지 않았습니다. 불러오면 내가 방금 고친 것은 사라집니다.</span>
          <Button size="sm" onClick={() => void reload(true)}>불러오기</Button>
          <Button size="sm" kind="outline" title="알림을 닫고 내가 고친 평면을 저장합니다" onClick={() => setRemote(null)}>내 작업 유지</Button>
        </div>}

        <div className="dpw-body">
          <div className={`dpw-stage is-${layout}`}>
            <div className="dpw-pane dpw-pane-2d">
              <DesignPlanCanvas ref={canvas} plan={plan} tool={tool} sel={sel} look={look} wallT={tool === 'newwall' ? wallT.newwall : wallT.wall} openW={tool === 'window' ? openW.window : openW.door}
                ghost={ghost} noteSel={noteSel} fitKey={fitKey} onSelect={select} onPickNote={id => { setNoteSel(id); setTab('notes') }}
                onChange={next => change(next)} onDragStart={onDragStart} onDrag={put} onDragEnd={onDragEnd} onPlace={place} onNote={at => { setNoteDraft(at); setNoteSel(null) }}
                overlay={(toScreen, size) => { if (!noteDraft) return null; const q = toScreen(noteDraft); return <><span className="dpn-draft-pin" style={{ left: q.x, top: q.y }} aria-hidden="true" /><DesignPlanNoteComposer x={q.x} y={q.y} maxX={size.w} maxY={size.h} onSubmit={addNote} onCancel={() => setNoteDraft(null)} /></> }} />
            </div>
            {layout !== 'plan' && <div className="dpw-pane dpw-pane-3d">
              <Suspense fallback={<div className="dpw-wait">3D 를 준비하는 중…</div>}><Plan3D plan={plan3d} selected={sel[0] ?? null} look={look} name={project.name} /></Suspense>
            </div>}
          </div>

          <aside className="dpw-side" aria-label="고른 대상 · 라이브러리 · 댓글">
            <div className="dpw-tabs" role="tablist">
              {([['sel', sel.length ? `고른 대상 ${sel.length}` : '고른 대상'], ['lib', '라이브러리'], ['notes', openNotes ? `댓글 ${openNotes}` : '댓글']] as [Tab, string][]).map(([k, label]) =>
                <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            <div className="dpw-panel" role="tabpanel">
              {tab === 'sel' && inspector()}
              {tab === 'lib' && <DesignPlanLibrary specs={specs} trades={base.trades} target={target} onTarget={setTarget} canApplyWall={selWalls.length > 0} selectedItem={selItem ?? null} selectedFinish={selectedFinish}
                onFinish={text => applyFinish(text)} onFixture={f => { setPlacing(f); setTool('item'); setNoteDraft(null) }} placing={tool === 'item' && placing ? placing.name : null} />}
              {tab === 'notes' && <DesignPlanNotes notes={plan.notes ?? []} active={noteSel} me={me.name} onPick={setNoteSel} onToggle={toggleNote} onRemove={removeNote} onStart={() => pickTool('note')} />}
            </div>
          </aside>
        </div>
        {cadOpen && <DesignPlanCadImport onImport={importCad} onClose={() => setCadOpen(false)} />}
        <datalist id="design-wall-finishes">{matNames.map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="design-door-kinds">{['여닫이 도어', '히든 여닫이 도어', '양개 여닫이 도어', '미닫이 도어', '유리 도어'].map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="design-mat-codes">{specs.filter(x => x.book === 'materials' && x.status !== 'dropped' && x.code).map(x => <option key={x.id} value={x.code!}>{x.name}</option>)}</datalist>
      </div>

      <div className="design-plan-qty" aria-label="실별 마감">
        <div className="row wrap">
          <b className="t-bodyb">실별 마감 (실내재료마감표)</b>
          <span className="t-cap">실마다 바닥 · 걸레받이 · 벽 · 천장의 재료 번호와 상세 유형을 적으면 도면 세트의 마감표와 상세도(ID-100 · ID-200)가 만들어집니다. 면적 · 걸레받이 길이를 적으면 아래 수량에도 들어갑니다</span>
          <span className="design-gap" />
          <Button size="sm" kind="outline" onClick={() => change({ ...plan, rooms: [...rooms, { id: `r${Date.now().toString(36)}`, no: String(101 + rooms.length), name: '', floor: {}, base: {}, wall: {}, ceiling: {}, ch: plan.height }] })}>실 추가</Button>
        </div>
        {rooms.length > 0 && <div className="table-wrap"><table className="table design-rooms">
          <thead><tr><th>실번호</th><th>실명</th><th>바닥 재료</th><th>상세</th><th>걸레받이 재료</th><th>상세</th><th>벽 재료</th><th>상세</th><th>천장 재료</th><th>유형</th><th>C.H</th><th>면적 ㎡</th><th>걸레받이 m</th><th /></tr></thead>
          <tbody>{rooms.map(r => { const set = (p: Partial<typeof r>) => change(cur => ({ ...cur, rooms: (cur.rooms ?? []).map(x => (x.id === r.id ? { ...x, ...p } : x)) }), `room:${r.id}:${Object.keys(p).join(',')}`); return <tr key={r.id}>
            <td><input className="input xs" value={r.no} aria-label="실번호" onChange={e => set({ no: e.target.value })} /></td>
            <td><input className="input" value={r.name} aria-label="실명" placeholder="예: 로비" onChange={e => set({ name: e.target.value })} /></td>
            {(['floor', 'base', 'wall'] as const).map(k => [
              <td key={k}><input className="input" list="design-mat-codes" value={r[k].mat ?? ''} aria-label={`${k} 재료 번호`} placeholder="PT-01" onChange={e => set({ [k]: { ...r[k], mat: e.target.value } })} /></td>,
              <td key={`${k}d`}><select className="input" value={r[k].detail ?? ''} aria-label={`${k} 상세 유형`} onChange={e => set({ [k]: { ...r[k], detail: e.target.value || undefined } })}><option value="">-</option>
                {(k === 'floor' ? FLOOR_TYPES.map(t => [t.code, t.composition]) : k === 'base' ? BASE_TYPES.map(t => [t.code, t.name]) : WALL_TYPES.map(t => [t.code, `${t.name} ${t.thk}`])).map(([c, n]) => <option key={c} value={c}>{c} {n.slice(0, 30)}</option>)}</select></td>])}
            <td><input className="input" list="design-mat-codes" value={r.ceiling.mat ?? ''} aria-label="천장 재료 번호" placeholder="PT-01" onChange={e => set({ ceiling: { ...r.ceiling, mat: e.target.value } })} /></td>
            <td><select className="input" value={r.ceiling.detail ?? ''} aria-label="천장 유형" onChange={e => set({ ceiling: { ...r.ceiling, detail: e.target.value || undefined } })}><option value="">-</option>{CEILING_TYPES.map(t => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}</select></td>
            <td><input className="input xs" inputMode="numeric" value={r.ch ?? ''} aria-label="천장 높이" onChange={e => set({ ch: digits(e.target.value) || undefined })} /></td>
            <td><input className="input xs" inputMode="decimal" key={`a${r.area ?? ''}`} defaultValue={r.area ?? ''} aria-label="면적" placeholder={rooms.length === 1 && area != null ? String(area) : ''} onBlur={e => { const v = Number(e.target.value.replace(/[^\d.]/g, '')) || undefined; if (v !== r.area) set({ area: v }) }} /></td>
            <td><input className="input xs" inputMode="decimal" key={`p${r.perimeter ?? ''}`} defaultValue={r.perimeter ?? ''} aria-label="걸레받이 길이" onBlur={e => { const v = Number(e.target.value.replace(/[^\d.]/g, '')) || undefined; if (v !== r.perimeter) set({ perimeter: v }) }} /></td>
            <td><Button size="sm" kind="ghost" onClick={() => change(cur => ({ ...cur, rooms: (cur.rooms ?? []).filter(x => x.id !== r.id) }))}>지우기</Button></td>
          </tr> })}</tbody>
        </table></div>}
      </div>

      <div className="design-plan-qty">
        <div className="row wrap">
          <b className="t-bodyb">이 평면의 수량</b>
          <span className="t-cap">{area != null ? `바닥 ${area}㎡ (${(area / 3.3058).toFixed(1)}평)` : '기존 벽이 닫힌 방이 되면 바닥 면적이 나옵니다'}</span>
          <span className="design-gap" />
          <Button size="sm" disabled={busy || loading || loadFailed || lines.length === 0} onClick={() => void run(async () => { if (!(await save(true))) throw new Error('평면을 저장하지 못해 수량표에 반영하지 못했습니다') }, '수량표에 반영했습니다. 새 모델 버전이 만들어졌습니다')}>수량표에 반영</Button>
        </div>
        {lines.length === 0 ? <Empty>새 가벽이나 부품을 그리면 여기에 수량이 모입니다. 기존 벽은 수량에 들어가지 않습니다.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>공종</th><th>품목</th><th>규격</th><th className="num">수량</th><th>단위</th><th>견적 구분</th></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td className="nowrap strong">{tname(l.trade)}</td><td>{l.item}</td><td className="max">{l.spec}</td><td className="num">{l.qty.toLocaleString('ko-KR')}</td><td>{l.unit}</td><td>{l.section}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="t-cap">평면은 고칠 때마다 자동으로 저장됩니다. '수량표에 반영'을 누르면 스케치업에서 '수량 보내기'를 한 것과 같이 새 모델 버전이 되고, 직접 넣은 수량은 그대로 남습니다. {area != null && project.area_m2 == null ? '면적은 프로젝트에 자동으로 넣지 않습니다(확인 후 직접 입력).' : ''}</p>
      </div>
    </div>
  )
}
