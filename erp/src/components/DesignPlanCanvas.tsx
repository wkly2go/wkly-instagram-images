// 평면 그리기 판 — 도면처럼 그리고(벽 몸통 · 문 열림 호 · 창 · 가구 기호 · 바깥 치수선 · 축척 막대),
// 캐드처럼 다룬다(휠 확대 · 끌어서 이동 · 길이 숫자 입력 · 모서리 끌기 · 문 · 창 끌기). 자료(평면)는 바깥(DesignPlan)이 들고 있다.
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { floorArea, floorOutline, snapPoint, wallLength, type PlanGeometry, type PlanNote, type PlanOpening, type PlanWall } from '../lib/designPlan'
import { dimLine, moveCorner, outwardSides, pieceCorners, planBounds, scaleBarLength, wallFrame, wallSolids, type Pt } from '../lib/designPlanDraw'
import { mix, type FinishKind, type FinishLook } from '../lib/designPlanLook'
import { footprint, ItemSymbol, itemLayer, OpeningSymbol, shapeOf } from './DesignPlanSymbols'

export type PlanTool = 'select' | 'wall' | 'newwall' | 'door' | 'window' | 'item' | 'note'
export type PlanLook = (finish?: string | null, fallback?: FinishKind) => FinishLook
export const GRID = 50
export const uid = () => Math.random().toString(36).slice(2, 10)

export interface PlanCanvasHandle {
  /** 그린 것 전체가 보이게 맞춘다 */
  fit(): void
  /** 가운데 기준 확대(1보다 작게) · 축소 */
  zoomBy(f: number): void
  /** 그리는 중의 글쇠(길이 숫자 · Enter · Esc)를 처리했으면 true */
  key(e: KeyboardEvent): boolean
}
interface Props {
  plan: PlanGeometry
  tool: PlanTool
  sel: string[]
  look: PlanLook
  /** 지금 그리는 벽의 두께 mm */
  wallT: number
  /** 지금 내는 문 · 창의 폭 mm */
  openW: number
  /** 놓을 부품의 자리 크기 (부품 놓기 도구) */
  ghost: { w: number; d: number; name: string } | null
  noteSel: string | null
  /** 값이 바뀌면 전체가 보이게 다시 맞춘다 */
  fitKey: number
  onSelect(ids: string[]): void
  onPickNote(id: string): void
  /** 한 번의 고침 (되돌리기 한 단계) */
  onChange(next: (cur: PlanGeometry) => PlanGeometry): void
  onDragStart(): void
  onDrag(next: PlanGeometry): void
  onDragEnd(): void
  /** 부품 놓기: 자리의 왼쪽 위 (격자에 맞춘 값) */
  onPlace(at: Pt): void
  onNote(at: Pt): void
  /** 판 위에 얹는 것 (댓글 쓰는 칸). 평면 좌표 → 화면 좌표 함수를 받는다 */
  overlay?: (toScreen: (p: Pt) => Pt) => ReactNode
}

interface View { cx: number; cy: number; /** 화면 1px 이 몇 mm 인지 */ s: number }
const MIN_S = 0.4, MAX_S = 120
const clampS = (s: number) => Math.min(MAX_S, Math.max(MIN_S, s))
const pointsOf = (a: Pt[]) => a.map(p => `${p.x},${p.y}`).join(' ')
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1

/** 벽 끝이 다른 벽 끝과 만나는 모서리면 그 벽 두께의 반만큼 늘려 모서리를 채운다 */
function cornerFill(walls: PlanWall[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  for (const w of walls) {
    const ext = (x: number, y: number) => walls.reduce((m, o) => (o.id !== w.id && (same({ x: o.x1, y: o.y1 }, { x, y }) || same({ x: o.x2, y: o.y2 }, { x, y })) ? Math.max(m, o.t / 2) : m), 0)
    out.set(w.id, [ext(w.x1, w.y1), ext(w.x2, w.y2)])
  }
  return out
}
function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], k = p.x * q.y - q.x * p.y; a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k }
  return a ? { x: cx / (3 * a), y: cy / (3 * a) } : pts[0]
}
/** 바닥 무늬: 마루는 널 줄, 타일 · 석재는 줄눈 (실제 크기 mm) */
const FLOOR_PATTERN: Partial<Record<FinishKind, string>> = { wood: 'dpc-fl-wood', tile: 'dpc-fl-tile', stone: 'dpc-fl-stone', vinyl: 'dpc-fl-tile', carpet: 'dpc-fl-carpet' }

/** 평면 좌표(mm)로 그리는 층: 바닥 · 부품 · 벽 · 문 · 창. 보는 자리(이동 · 확대)가 바뀌어도 다시 그리지 않는다 */
const World = memo(function World({ plan, sel, look }: { plan: PlanGeometry; sel: string[]; look: PlanLook }) {
  const shell = useMemo(() => plan.walls.filter(w => w.kind === 'existing'), [plan.walls])
  const outline = useMemo(() => floorOutline(shell), [shell])
  const ends = useMemo(() => cornerFill(plan.walls), [plan.walls])
  const floorMat = plan.rooms?.[0]?.floor.mat
  const floor = look(floorMat, 'plain')
  const pieces = (w: PlanWall) => {
    const [e1, e2] = ends.get(w.id) ?? [0, 0], len = wallLength(w)
    return wallSolids(w, plan.openings).map(p => pieceCorners(w, p.from <= 0 ? -e1 : p.from, p.to >= len ? len + e2 : p.to, 40))
  }
  const solids = useMemo(() => plan.walls.filter(w => wallLength(w) > 0).map(w => ({ w, parts: pieces(w) })), [plan.walls, plan.openings]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => [...plan.items].sort((a, b) => itemLayer(shapeOf(a)) - itemLayer(shapeOf(b))), [plan.items])
  const fresh = solids.filter(x => x.w.kind === 'new'), old = solids.filter(x => x.w.kind !== 'new')
  return (
    <>
      {outline && <g className="dpc-floor">
        <polygon points={pointsOf(outline)} fill={floorMat?.trim() ? mix(floor.color, '#ffffff', 0.38) : '#fbfaf6'} />
        {floorMat?.trim() && FLOOR_PATTERN[floor.kind] && <polygon className="pat" points={pointsOf(outline)} fill={`url(#${FLOOR_PATTERN[floor.kind]})`} />}
      </g>}
      {items.map(i => <ItemSymbol key={i.id} item={i} color={i.finish?.trim() ? look(i.finish, 'plain').color : null} selected={sel.includes(i.id)} />)}
      {/* 새 가벽: 테두리를 먼저, 속을 나중에 — 겹친 모서리에 선이 남지 않는다 */}
      <g className="dpc-wall-new-edge">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-new">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-new-hatch">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-old">{old.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-sel">{solids.filter(x => sel.includes(x.w.id)).map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      {/* 누르는 자리: 얇은 벽도 잡히게 가운데 선을 넓게 */}
      <g className="dpc-wall-hit">{solids.map(({ w }) => <g key={w.id} data-hit="wall" data-id={w.id}>
        <polygon points={pointsOf(pieceCorners(w, 0, wallLength(w)))} />
        <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
      </g>)}</g>
      {plan.openings.map(o => { const w = plan.walls.find(x => x.id === o.wall); return w ? <OpeningSymbol key={o.id} wall={w} opening={o} selected={sel.includes(o.id)} /> : null })}
    </>
  )
})

interface DragHead { /** 누른 포인터 */ id: number; sx: number; sy: number; moved: boolean }
type Drag = DragHead & (
  | { kind: 'pan'; view0: View }
  | { kind: 'empty'; view0: View }
  | { kind: 'wall'; view0: View }
  | { kind: 'click'; hit: string | null; hitId: string }
  | { kind: 'items'; started: boolean; base: PlanGeometry; p0: Pt; ids: string[] }
  | { kind: 'corner'; started: boolean; base: PlanGeometry; corner: Pt }
  | { kind: 'opening'; started: boolean; base: PlanGeometry; openingId: string }
)

export const DesignPlanCanvas = forwardRef<PlanCanvasHandle, Props>(function DesignPlanCanvas(props, ref) {
  const { plan, tool, sel, look, ghost, noteSel, fitKey } = props
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ cx: 3000, cy: 2000, s: 12 })
  const [chain, setChain] = useState<Pt | null>(null)
  const [ptr, setPtr] = useState<(Pt & { shift: boolean }) | null>(null)
  const [typed, setTyped] = useState('')
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const chainStart = useRef<Pt | null>(null)
  const lastDir = useRef<Pt>({ x: 1, y: 0 })
  const drag = useRef<Drag | null>(null)
  const over = useRef(false)
  const live = useRef({ plan, tool, sel, view, size, chain, ptr, typed, space, props })
  live.current = { plan, tool, sel, view, size, chain, ptr, typed, space, props }

  // 판의 실제 크기 (가로세로 비를 고정하지 않는다)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const read = () => { const w = el.clientWidth, h = el.clientHeight; if (w > 0 && h > 0) setSize(p => (p.w === w && p.h === h ? p : { w, h })) }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])

  const fit = () => {
    const { plan: g, size: z } = live.current
    if (!z.w) return
    const b = planBounds(g)
    if (!b) { setView({ cx: 3000, cy: 2000, s: 12 }); return }
    const w = Math.max(b.x1 - b.x0, 1500), h = Math.max(b.y1 - b.y0, 1500)
    const s = clampS(Math.max(w / Math.max(z.w - 150, 120), h / Math.max(z.h - 150, 120)))
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s })
  }
  const needFit = useRef(true)
  useEffect(() => { needFit.current = true }, [fitKey])
  useEffect(() => { if (needFit.current && size.w > 0) { needFit.current = false; fit() } }, [fitKey, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // 도구를 바꾸면 그리던 벽은 끝낸다
  useEffect(() => { setChain(null); setTyped(''); chainStart.current = null }, [tool])

  const worldOf = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect(), { view: v, size: z } = live.current
    return { x: v.cx + (e.clientX - r.left - z.w / 2) * v.s, y: v.cy + (e.clientY - r.top - z.h / 2) * v.s }
  }
  /** 벽 그리기 · 모서리 끌기의 맞춤: 가까운 벽 끝에 먼저 붙고, 아니면 격자(직전 점 기준으로 곧게) */
  const snapDraw = (p: Pt, from: Pt | null, free: boolean, skip?: Pt, walls = live.current.plan.walls): Pt & { snap?: boolean } => {
    let best: Pt | null = null, bd = 10 * live.current.view.s
    for (const w of walls) for (const c of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      if (skip && same(c, skip)) continue
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      if (d < bd) { bd = d; best = c }
    }
    return best ? { ...best, snap: true } : snapPoint(p.x, p.y, GRID, free ? null : from)
  }
  const nearestWall = (p: Pt) => {
    const { plan: g, view: v } = live.current
    let best: { w: PlanWall; pos: number; len: number; dist: number } | null = null
    for (const w of g.walls) {
      const len = wallLength(w)
      if (!len) continue
      const t = Math.max(0, Math.min(1, ((p.x - w.x1) * (w.x2 - w.x1) + (p.y - w.y1) * (w.y2 - w.y1)) / (len * len)))
      const dist = Math.hypot(p.x - (w.x1 + t * (w.x2 - w.x1)), p.y - (w.y1 + t * (w.y2 - w.y1)))
      if (!best || dist < best.dist) best = { w, pos: t * len, len, dist }
    }
    return best && best.dist < Math.max(16 * v.s, best.w.t / 2) ? best : null
  }
  /** 문 · 창이 벽 안에 들어가게 자리(가운데)를 맞춘다 */
  const seat = (pos: number, width: number, len: number) => { const w = Math.min(width, len); return { width: w, pos: Math.min(len - w / 2, Math.max(w / 2, Math.round(pos / GRID) * GRID)) } }

  const endChain = () => { setChain(null); setTyped(''); chainStart.current = null }
  const addPoint = (q: Pt) => {
    const L = live.current, c = L.chain
    if (!c) { chainStart.current = q; setChain(q); setTyped(''); return }
    if (same(c, q)) { endChain(); return }
    const wall: PlanWall = { id: uid(), x1: c.x, y1: c.y, x2: q.x, y2: q.y, t: L.props.wallT > 0 ? L.props.wallT : 100, kind: L.tool === 'newwall' ? 'new' : 'existing' }
    const n = Math.hypot(q.x - c.x, q.y - c.y)
    lastDir.current = { x: (q.x - c.x) / n, y: (q.y - c.y) / n }
    L.props.onChange(cur => ({ ...cur, walls: [...cur.walls, wall] }))
    // 처음 점으로 돌아오면 방이 닫힌 것 — 그리기를 끝낸다
    if (chainStart.current && same(chainStart.current, q)) endChain()
    else { setChain(q); setTyped('') }
  }
  const placeTyped = () => {
    const L = live.current, c = L.chain, len = Number(L.typed)
    if (!c || !(len > 0)) return
    let dir = lastDir.current
    if (L.ptr) { const h = snapDraw(L.ptr, c, L.ptr.shift), n = Math.hypot(h.x - c.x, h.y - c.y); if (n > 0) dir = { x: (h.x - c.x) / n, y: (h.y - c.y) / n } }
    addPoint({ x: Math.round(c.x + dir.x * len), y: Math.round(c.y + dir.y * len) })
  }

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: f => setView(v => ({ ...v, s: clampS(v.s * f) })),
    key: e => {
      const L = live.current
      if (!((L.tool === 'wall' || L.tool === 'newwall') && L.chain)) return false
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { setTyped(t => (t + e.key).replace(/^0+/, '').slice(0, 6)); return true }
      if (e.key === 'Backspace') { setTyped(t => t.slice(0, -1)); return true }
      if (e.key === 'Enter') { if (L.typed) placeTyped(); else endChain(); return true }
      if (e.key === 'Escape') { if (L.typed) setTyped(''); else endChain(); return true }
      return false
    },
  }))

  // 휠: 커서 자리를 기준으로 확대 · 축소 (페이지가 같이 밀리지 않게 passive 를 끈다)
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), z = live.current.size
      const mx = e.clientX - r.left - z.w / 2, my = e.clientY - r.top - z.h / 2
      const dy = Math.max(-240, Math.min(240, e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY))
      const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0016))
      setView(v => { const s = clampS(v.s * f); return { cx: v.cx + mx * (v.s - s), cy: v.cy + my * (v.s - s), s } })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Space 를 누르고 끌면 어느 도구에서나 화면 이동
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && over.current && !typing(e.target)) { e.preventDefault(); if (!e.repeat) setSpace(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { if (live.current.space) e.preventDefault(); setSpace(false) } }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const L = live.current, P = L.props
    wrap.current?.focus({ preventScroll: true })
    const head = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false }
    const take = (d: Drag) => { drag.current = d; try { svg.current?.setPointerCapture(e.pointerId) } catch { /* 잡지 못해도 그대로 진행 */ } }
    if (e.button === 1 || (e.button === 0 && L.space)) { e.preventDefault(); setPanning(true); take({ kind: 'pan', ...head, view0: L.view }); return }
    if (e.button !== 0) return
    const el = (e.target as Element).closest?.('[data-hit]') as SVGElement | null
    const hit = el?.getAttribute('data-hit') ?? null, id = el?.getAttribute('data-id') ?? ''
    if (L.tool !== 'select') { take({ kind: 'click', ...head, hit, hitId: id }); return }
    const p = worldOf(e)
    if (hit === 'corner') { take({ kind: 'corner', ...head, started: false, base: L.plan, corner: { x: Number(el!.getAttribute('data-x')), y: Number(el!.getAttribute('data-y')) } }); return }
    if (hit === 'note') { P.onPickNote(id); return }
    if (hit === 'item') {
      let ids = L.sel
      if (e.shiftKey) { ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]; P.onSelect(ids); if (!ids.includes(id)) return }
      else if (!ids.includes(id)) { ids = [id]; P.onSelect(ids) }
      take({ kind: 'items', ...head, started: false, base: L.plan, p0: p, ids: ids.filter(x => L.plan.items.some(i => i.id === x)) })
      return
    }
    if (hit === 'opening') { P.onSelect([id]); take({ kind: 'opening', ...head, started: false, base: L.plan, openingId: id }); return }
    if (hit === 'wall') {
      P.onSelect(e.shiftKey ? (L.sel.includes(id) ? L.sel.filter(x => x !== id) : [...L.sel, id]) : [id])
      take({ kind: 'wall', ...head, view0: L.view })
      return
    }
    take({ kind: 'empty', ...head, view0: L.view })
  }
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const L = live.current, P = L.props, d = drag.current, p = worldOf(e)
    if (d && d.id === e.pointerId) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true
      if (d.kind === 'pan' || ((d.kind === 'empty' || d.kind === 'wall') && d.moved)) {
        setPanning(true)
        setView({ ...d.view0, cx: d.view0.cx - (e.clientX - d.sx) * d.view0.s, cy: d.view0.cy - (e.clientY - d.sy) * d.view0.s })
        return
      }
      if (!d.moved || d.kind === 'click' || d.kind === 'empty' || d.kind === 'wall') return
      if (!d.started) { d.started = true; P.onDragStart() }
      if (d.kind === 'items') {
        const one = d.ids.length === 1
        const dx = Math.round((p.x - d.p0.x) / GRID) * GRID, dy = Math.round((p.y - d.p0.y) / GRID) * GRID
        P.onDrag({ ...L.plan, items: L.plan.items.map(i => {
          const b = d.ids.includes(i.id) ? d.base.items.find(x => x.id === i.id) : null
          if (!b) return i
          // 하나만 옮길 때는 자리를 격자에 맞추고, 여럿이면 서로의 간격을 지킨다
          const q = one ? snapPoint(b.x + (p.x - d.p0.x), b.y + (p.y - d.p0.y), GRID) : { x: b.x + dx, y: b.y + dy }
          return q.x === i.x && q.y === i.y ? i : { ...i, x: q.x, y: q.y }
        }) })
      } else if (d.kind === 'corner') {
        const to = snapDraw(p, e.shiftKey ? d.corner : null, !e.shiftKey, d.corner, d.base.walls)
        P.onDrag({ ...L.plan, walls: moveCorner(d.base.walls, d.corner, { x: to.x, y: to.y }) })
      } else if (d.kind === 'opening') {
        const o = L.plan.openings.find(x => x.id === d.openingId), w = o && L.plan.walls.find(x => x.id === o.wall)
        if (!o || !w) return
        const f = wallFrame(w)
        const at = seat((p.x - w.x1) * f.ux + (p.y - w.y1) * f.uy, o.width, f.len)
        if (at.pos !== o.pos) P.onDrag({ ...L.plan, openings: L.plan.openings.map(x => (x.id === o.id ? { ...x, pos: at.pos } : x)) })
      }
      return
    }
    setPtr({ ...p, shift: e.shiftKey })
  }
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setPanning(false)
    try { svg.current?.releasePointerCapture(e.pointerId) } catch { /* 이미 풀림 */ }
    const L = live.current, P = L.props
    if ('started' in d && d.started) { P.onDragEnd(); return }
    if (d.moved || e.type === 'pointercancel') return
    if (d.kind === 'empty') { if (!e.shiftKey) P.onSelect([]); return }
    if (d.kind !== 'click') return
    const p = worldOf(e)
    if (d.hit === 'note') { P.onPickNote(d.hitId); return }
    if (L.tool === 'wall' || L.tool === 'newwall') addPoint(snapDraw(p, L.chain, e.shiftKey))
    else if (L.tool === 'door' || L.tool === 'window') {
      const hit = nearestWall(p)
      if (!hit) return
      const at = seat(hit.pos, P.openW > 0 ? P.openW : L.tool === 'door' ? 900 : 1200, hit.len)
      const o: PlanOpening = { id: uid(), wall: hit.w.id, pos: at.pos, width: at.width, kind: L.tool }
      P.onChange(cur => ({ ...cur, openings: [...cur.openings, o] }))
      P.onSelect([o.id])
    } else if (L.tool === 'item') { if (P.ghost) P.onPlace(snapPoint(p.x - P.ghost.w / 2, p.y - P.ghost.d / 2, GRID)) }
    else if (L.tool === 'note') P.onNote({ x: Math.round(p.x), y: Math.round(p.y) })
  }

  // ── 그리기 ──────────────────────────────────────────────
  const s = view.s, x0 = view.cx - (size.w / 2) * s, y0 = view.cy - (size.h / 2) * s
  const S = (p: Pt): Pt => ({ x: (p.x - x0) / s, y: (p.y - y0) / s })
  const shell = useMemo(() => plan.walls.filter(w => w.kind === 'existing'), [plan.walls])
  const outline = useMemo(() => floorOutline(shell), [shell])
  const area = useMemo(() => floorArea(shell), [shell])
  const sides = useMemo(() => outwardSides(plan), [plan.walls]) // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => [...(plan.notes ?? [])].sort((a, b) => a.at.localeCompare(b.at)), [plan.notes])
  const drawing = tool === 'wall' || tool === 'newwall'
  const hover = drawing && ptr ? snapDraw(ptr, chain, ptr.shift) : null
  const openAt = (tool === 'door' || tool === 'window') && ptr ? nearestWall(ptr) : null
  const ghostAt = tool === 'item' && ghost && ptr ? snapPoint(ptr.x - ghost.w / 2, ptr.y - ghost.d / 2, GRID) : null
  const selWall = tool === 'select' && sel.length === 1 ? plan.walls.find(w => w.id === sel[0]) : undefined
  // 격자: 화면에서 너무 촘촘하지 않은 간격을 고른다
  const steps = [100, 500, 1000, 5000, 10000, 50000]
  const gi0 = steps.findIndex(g => g / s >= 14), gi = gi0 < 0 ? steps.length - 1 : gi0, minor = steps[gi], major = steps[Math.min(steps.length - 1, gi + 1)]
  const gridAt = (g: number) => ({ width: g / s, height: g / s, x: (((-x0 / s) % (g / s)) + g / s) % (g / s), y: (((-y0 / s) % (g / s)) + g / s) % (g / s) })
  const bar = scaleBarLength(size.w * s)
  const empty = plan.walls.length === 0 && plan.items.length === 0

  const dims = size.w > 0 ? plan.walls.map(w => {
    const len = wallLength(w)
    if (len / s < 38) return null
    const ex = w.kind === 'existing'
    const side = sides.get(w.id) ?? 1
    const dl = dimLine(w, (ex ? 24 : 12) * s, side, 10 * s)
    const a = S(dl.a), b = S(dl.b), ea = S(dl.ea), eb = S(dl.eb), lb = S(dl.label)
    const f = wallFrame(w)
    // 화면 좌표에서의 방향: 선 방향 u, 바깥쪽 n. 끝 표시는 45° 빗금
    const tx = (f.ux + f.nx * side) * 3.2, ty = (f.uy + f.ny * side) * 3.2, ox = f.nx * side * 4, oy = f.ny * side * 4
    return (
      <g key={w.id} className={`dpc-dim${ex ? '' : ' in'}${sel.includes(w.id) ? ' on' : ''}`}>
        <line x1={ea.x + ox * 0.6} y1={ea.y + oy * 0.6} x2={a.x + ox} y2={a.y + oy} /><line x1={eb.x + ox * 0.6} y1={eb.y + oy * 0.6} x2={b.x + ox} y2={b.y + oy} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="tick" x1={a.x - tx} y1={a.y - ty} x2={a.x + tx} y2={a.y + ty} /><line className="tick" x1={b.x - tx} y1={b.y - ty} x2={b.x + tx} y2={b.y + ty} />
        <text x={lb.x} y={lb.y} transform={`rotate(${dl.angle} ${lb.x} ${lb.y})`}>{dl.text}</text>
      </g>
    )
  }) : null

  const names = plan.items.map(i => {
    const f = footprint(i), pw = f.w / s, ph = f.d / s, c = S({ x: i.x + f.w / 2, y: i.y + f.d / 2 })
    const need = [...i.name].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0) + 6
    const flat = pw >= need || pw >= ph, room = flat ? pw : ph
    if (room < 30 || (flat ? ph : pw) < 15) return null
    const max = Math.floor(((room - 6) / need) * [...i.name].length)
    const label = need <= room ? i.name : max >= 2 ? `${[...i.name].slice(0, max - 1).join('')}…` : null
    if (!label) return null
    return <text key={i.id} className={`dpc-name${sel.includes(i.id) ? ' on' : ''}`} x={c.x} y={c.y} transform={flat ? undefined : `rotate(-90 ${c.x} ${c.y})`}>{label}</text>
  })

  const cls = `dpc tool-${tool}${space || panning ? ' pan' : ''}${panning ? ' panning' : ''}`
  return (
    <div ref={wrap} className={cls} tabIndex={0} aria-label="평면 그리기 영역. 휠로 확대하고, 빈 곳을 끌어 이동합니다"
      onPointerEnter={() => { over.current = true }} onPointerLeave={() => { over.current = false; setPtr(null) }}>
      <svg ref={svg} className="dpc-svg" width={size.w || 1} height={size.h || 1} viewBox={`0 0 ${size.w || 1} ${size.h || 1}`} role="img" aria-label="평면"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => { if (drawing) endChain() }} onContextMenu={e => e.preventDefault()} onMouseDown={e => { if (e.button === 1) e.preventDefault() }}>
        <defs>
          <pattern id="dpc-grid-a" patternUnits="userSpaceOnUse" {...gridAt(minor)}><path d={`M${minor / s} 0H0V${minor / s}`} className="dpc-grid a" /></pattern>
          <pattern id="dpc-grid-b" patternUnits="userSpaceOnUse" {...gridAt(major)}><path d={`M${major / s} 0H0V${major / s}`} className="dpc-grid b" /></pattern>
          <pattern id="dpc-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform={`scale(${s}) rotate(45)`}><line x1="0" y1="0" x2="0" y2="7" className="dpc-hatch" /></pattern>
          <pattern id="dpc-fl-wood" patternUnits="userSpaceOnUse" width="1800" height="150"><path d="M0 0H1800M900 0V150" className="dpc-fl" /></pattern>
          <pattern id="dpc-fl-tile" patternUnits="userSpaceOnUse" width="600" height="600"><path d="M0 0H600M0 0V600" className="dpc-fl" /></pattern>
          <pattern id="dpc-fl-stone" patternUnits="userSpaceOnUse" width="800" height="800"><path d="M0 0H800M0 0V800" className="dpc-fl" /></pattern>
          <pattern id="dpc-fl-carpet" patternUnits="userSpaceOnUse" width="200" height="200"><path d="M50 50h1M150 150h1" className="dpc-fl dot" /></pattern>
        </defs>
        <rect className="dpc-bg" width={size.w} height={size.h} />
        <rect width={size.w} height={size.h} fill="url(#dpc-grid-a)" pointerEvents="none" />
        <rect width={size.w} height={size.h} fill="url(#dpc-grid-b)" pointerEvents="none" />
        {size.w > 0 && <g className={`dpc-world${s > 22 ? ' far' : ''}`} transform={`matrix(${1 / s} 0 0 ${1 / s} ${-x0 / s} ${-y0 / s})`}><World plan={plan} sel={sel} look={look} /></g>}
        <g className="dpc-over">
          {dims}
          {names}
          {outline && area != null && (() => { const c = S(centroid(outline)); return <text className="dpc-area" x={c.x} y={c.y}>{area.toLocaleString('ko-KR')}㎡ · {(area / 3.3058).toFixed(1)}평</text> })()}
          {selWall && [{ x: selWall.x1, y: selWall.y1 }, { x: selWall.x2, y: selWall.y2 }].map((c, i) => { const q = S(c); return <circle key={i} className="dpc-handle" data-hit="corner" data-x={c.x} data-y={c.y} cx={q.x} cy={q.y} r={6.5}><title>끌어서 모서리를 옮깁니다. 이어진 벽도 함께 움직입니다</title></circle> })}
          {openAt && (() => { const o = seat(openAt.pos, props.openW > 0 ? props.openW : tool === 'door' ? 900 : 1200, openAt.len), f = wallFrame(openAt.w); const a = S({ x: openAt.w.x1 + f.ux * (o.pos - o.width / 2), y: openAt.w.y1 + f.uy * (o.pos - o.width / 2) }), b = S({ x: openAt.w.x1 + f.ux * (o.pos + o.width / 2), y: openAt.w.y1 + f.uy * (o.pos + o.width / 2) }); return <line className="dpc-ghost-open" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.max(openAt.w.t / s, 6)} /> })()}
          {ghostAt && ghost && (() => { const q = S(ghostAt); return <g className="dpc-ghost"><rect x={q.x} y={q.y} width={ghost.w / s} height={ghost.d / s} rx={3} /><text x={q.x + ghost.w / s / 2} y={q.y + ghost.d / s / 2}>{ghost.name}</text></g> })()}
          {drawing && hover && (() => {
            const h = S(hover), c = chain ? S(chain) : null, len = chain ? Math.hypot(hover.x - chain.x, hover.y - chain.y) : 0
            const label = typed ? `${Number(typed).toLocaleString('ko-KR')} mm ↵` : chain && len > 0 ? `${num(len)} mm` : ''
            return <g className="dpc-draw">
              {c && <line x1={c.x} y1={c.y} x2={h.x} y2={h.y} />}
              {c && <circle className="from" cx={c.x} cy={c.y} r={4} />}
              <circle className={hover.snap ? 'snap' : 'at'} cx={h.x} cy={h.y} r={hover.snap ? 7 : 3.5} />
              {label && <g transform={`translate(${Math.min(h.x + 14, size.w - label.length * 9 - 20)} ${Math.max(h.y - 30, 6)})`}><rect className={typed ? 'typed' : ''} width={label.length * 8.6 + 16} height={24} rx={8} /><text x={8} y={12}>{label}</text></g>}
            </g>
          })()}
          {notes.map((n: PlanNote, i) => { const q = S(n); return <g key={n.id} className={`dpc-pin${n.done ? ' done' : ''}${noteSel === n.id ? ' on' : ''}`} data-hit="note" data-id={n.id} transform={`translate(${q.x} ${q.y})`}>
            <title>{`${n.by} · ${n.text}`}</title>
            <path d="M0 0L-7 -12A11 11 0 1 1 7 -12Z" /><text x={0} y={-20}>{i + 1}</text>
          </g> })}
          {size.w > 0 && <g className="dpc-scale" transform={`translate(14 ${size.h - 16})`}>
            <rect x={-6} y={-22} width={bar / s + 12} height={30} rx={6} />
            <path d={`M0 -5V0H${bar / s}V-5`} /><text x={bar / s / 2} y={-11}>{bar >= 1000 ? `${bar / 1000}m` : `${bar}mm`}</text>
          </g>}
        </g>
      </svg>
      {ptr && !panning && <span className="dpc-coord" aria-hidden="true">{num(ptr.x)} , {num(ptr.y)}</span>}
      {empty && <p className="dpc-empty">위 도구에서 <b>기존 벽</b>을 고르고 평면을 차례로 눌러 벽을 그리세요.<br />길이는 숫자를 치고 Enter 를 누르면 정확히 들어갑니다. 캐드 도면(DXF)이 있으면 <b>캐드 가져오기</b>로 불러옵니다.</p>}
      {props.overlay?.(S)}
    </div>
  )
})
