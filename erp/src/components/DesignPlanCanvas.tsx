// 평면 그리기 판 — 도면처럼 그리고(벽 몸통 · 문 열림 호 · 창 · 가구 기호 · 바깥 치수선 · 축척 막대),
// 캐드처럼 다룬다(휠 확대 · 끌어서 이동 · 길이 숫자 입력 · 모서리 끌기 · 문 · 창 끌기). 자료(평면)는 바깥(DesignPlan)이 들고 있다.
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { closedShell, floorArea, floorOutline, snapPoint, wallLength, type PlanGeometry, type PlanNote, type PlanOpening, type PlanWall } from '../lib/designPlan'
import { dimLine, MIN_WALL, moveCorner, openingOverlaps, outwardSides, pieceCorners, planBounds, scaleBarLength, wallFrame, wallSolids, type Pt } from '../lib/designPlanDraw'
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
  /** 그리던 벽을 끝낸다 (되돌리기 · 다시 불러오기 때) */
  cancel(): void
  /** 그 자리가 화면 밖이면 가운데로 옮긴다 (댓글 목록에서 고른 핀) */
  show(p: Pt): void
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
  /** 끄는 동안의 고침 (되돌리기 단계는 끌기가 끝날 때 한 번) */
  onDrag(next: (cur: PlanGeometry) => PlanGeometry): void
  onDragEnd(): void
  /** 부품 놓기: 자리의 왼쪽 위 (격자에 맞춘 값) */
  onPlace(at: Pt): void
  onNote(at: Pt): void
  /** 짧은 알림 (문 · 창을 겹쳐 내려 할 때 등) */
  onNotice?(text: string): void
  /** 판 위에 얹는 것 (댓글 쓰는 칸). 평면 좌표 → 화면 좌표 함수를 받는다 */
  overlay?: (toScreen: (p: Pt) => Pt, size: { w: number; h: number }) => ReactNode
}

interface View { cx: number; cy: number; /** 화면 1px 이 몇 mm 인지 */ s: number }
const MIN_S = 0.4, MAX_S = 120
const clampS = (s: number) => Math.min(MAX_S, Math.max(MIN_S, s))
const pointsOf = (a: Pt[]) => a.map(p => `${p.x},${p.y}`).join(' ')
const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1

/** 벽 끝이 다른 벽 끝과 만나는 모서리면 그 벽 두께의 반만큼 늘려 모서리를 채운다 */
function cornerFill(walls: PlanWall[]): Map<string, [number, number]> {
  // 끝점마다 가장 두꺼운 벽 둘(자기 자신을 빼고 고르려고)을 한 번에 모은다 — 캐드에서 가져온 큰 평면도 끌기가 끊기지 않게
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`
  const top = new Map<string, { a: number; aid: string; b: number }>()
  const put = (k: string, id: string, h: number) => {
    const c = top.get(k)
    if (!c) top.set(k, { a: h, aid: id, b: 0 })
    else if (h > c.a) { c.b = c.a; c.a = h; c.aid = id } else if (h > c.b) c.b = h
  }
  for (const w of walls) { put(key(w.x1, w.y1), w.id, w.t / 2); if (key(w.x2, w.y2) !== key(w.x1, w.y1)) put(key(w.x2, w.y2), w.id, w.t / 2) }
  const ext = (k: string, id: string) => { const c = top.get(k); return !c ? 0 : c.aid === id ? c.b : c.a }
  const out = new Map<string, [number, number]>()
  for (const w of walls) out.set(w.id, [ext(key(w.x1, w.y1), w.id), ext(key(w.x2, w.y2), w.id)])
  return out
}
/** 닫힌 방 규칙은 lib/designPlan 의 것 하나만 쓴다 (예전에 여기서 가져가던 곳을 위해 그대로 내보낸다) */
export { closedShell }
function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], k = p.x * q.y - q.x * p.y; a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k }
  return a ? { x: cx / (3 * a), y: cy / (3 * a) } : pts[0]
}
/** 바닥 무늬: 마루는 널 줄, 타일 · 석재는 줄눈 (실제 크기 mm) */
const FLOOR_PATTERN: Partial<Record<FinishKind, string>> = { wood: 'dpc-fl-wood', tile: 'dpc-fl-tile', stone: 'dpc-fl-stone', vinyl: 'dpc-fl-tile', carpet: 'dpc-fl-carpet' }

/** 평면 좌표(mm)로 그리는 층: 바닥 · 부품 · 벽 · 문 · 창. 보는 자리(이동 · 확대)가 바뀌어도 다시 그리지 않는다 */
const World = memo(function World({ plan, sel, look, outline }: { plan: PlanGeometry; sel: string[]; look: PlanLook; outline: Pt[] | null }) {
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
        <polygon points={pointsOf(outline)} fill={floorMat?.trim() ? mix(floor.color, '#ffffff', 0.38) : '#fafafa'} />
        {floorMat?.trim() && FLOOR_PATTERN[floor.kind] && <polygon className="pat" points={pointsOf(outline)} fill={`url(#${FLOOR_PATTERN[floor.kind]})`} />}
      </g>}
      {items.map(i => <ItemSymbol key={i.id} item={i} color={i.finish?.trim() ? look(i.finish, 'plain').color : null} selected={sel.includes(i.id)} />)}
      {/* 새 가벽: 테두리를 먼저, 속을 나중에 — 겹친 모서리에 선이 남지 않는다 */}
      <g className="dpc-wall-new-edge">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-new">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-new-hatch" fill="url(#dpc-hatch)">{fresh.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-old">{old.map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      <g className="dpc-wall-sel">{solids.filter(x => sel.includes(x.w.id)).map(({ w, parts }) => parts.map((p, i) => <polygon key={`${w.id}-${i}`} points={pointsOf(p)} />))}</g>
      {/* 누르는 자리: 얇은 벽도 잡히게 가운데 선을 넓게 */}
      <g className="dpc-wall-hit">{solids.map(({ w }) => <g key={w.id} data-hit="wall" data-id={w.id}>
        <title>{`${w.kind === 'new' ? '새 가벽' : '기존 벽'} · ${num(wallLength(w))}mm · 두께 ${w.t}${w.finish?.trim() ? ` · ${w.finish.trim()}` : ''}`}</title>
        <polygon points={pointsOf(pieceCorners(w, 0, wallLength(w)))} />
        <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
      </g>)}</g>
      {plan.openings.map(o => { const w = plan.walls.find(x => x.id === o.wall); return w ? <OpeningSymbol key={o.id} wall={w} opening={o} selected={sel.includes(o.id)} /> : null })}
    </>
  )
})

interface DragHead { /** 누른 포인터 */ id: number; sx: number; sy: number; moved: boolean }
/** 화면 크기로 그리는 치수선 · 이름 · 면적 (확대해도 글자 크기는 그대로). 좌표는 평면 mm 를 s 로 나눈 값이라, 화면을 옮기기만 할 때는 다시 그리지 않는다 */
const Labels = memo(function Labels({ plan, sel, s, sides, outline, area }: { plan: PlanGeometry; sel: string[]; s: number; sides: Map<string, 1 | -1>; outline: Pt[] | null; area: number | null }) {
  const P = (p: Pt): Pt => ({ x: p.x / s, y: p.y / s })
  return (
    <>
      {plan.walls.map(w => {
        if (wallLength(w) / s < 38) return null
        const ex = w.kind === 'existing', side = sides.get(w.id) ?? 1
        const dl = dimLine(w, (ex ? 24 : 12) * s, side, 12 * s)
        const a = P(dl.a), b = P(dl.b), ea = P(dl.ea), eb = P(dl.eb), lb = P(dl.label), f = wallFrame(w)
        // 끝 표시는 45° 빗금, 보조선은 벽면에서 조금 띄워 치수선을 살짝 지나게
        const tx = (f.ux + f.nx * side) * 3.2, ty = (f.uy + f.ny * side) * 3.2, ox = f.nx * side * 4, oy = f.ny * side * 4
        return (
          <g key={w.id} className={`dpc-dim${ex ? '' : ' in'}${sel.includes(w.id) ? ' on' : ''}`}>
            <line x1={ea.x + ox * 0.6} y1={ea.y + oy * 0.6} x2={a.x + ox} y2={a.y + oy} /><line x1={eb.x + ox * 0.6} y1={eb.y + oy * 0.6} x2={b.x + ox} y2={b.y + oy} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line className="tick" x1={a.x - tx} y1={a.y - ty} x2={a.x + tx} y2={a.y + ty} /><line className="tick" x1={b.x - tx} y1={b.y - ty} x2={b.x + tx} y2={b.y + ty} />
            <text x={lb.x} y={lb.y} transform={`rotate(${dl.angle} ${lb.x} ${lb.y})`}>{dl.text}</text>
          </g>
        )
      })}
      {plan.items.map(i => {
        const f = footprint(i), pw = f.w / s, ph = f.d / s, c = P({ x: i.x + f.w / 2, y: i.y + f.d / 2 }), chars = [...i.name]
        const need = chars.reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0) + 6
        // 이름이 들어갈 자리가 있을 때만 적는다 (작은 기구는 기호만): 가로로, 안 되면 세워서, 넓은데 조금 모자라면 줄여서
        const flat = need <= pw && ph >= 16, tall = !flat && need <= ph && pw >= 30, cut = Math.floor(((pw - 6) / need) * chars.length)
        const label = flat || tall ? i.name : pw >= 64 && ph >= 16 && cut >= 2 ? `${chars.slice(0, cut - 1).join('')}…` : null
        return label ? <text key={i.id} className={`dpc-name${sel.includes(i.id) ? ' on' : ''}`} x={c.x} y={c.y} transform={tall ? `rotate(-90 ${c.x} ${c.y})` : undefined}>{label}</text> : null
      })}
      {outline && area != null && (() => {
        // 닫힌 평면의 가운데에 실 이름(실별 마감의 첫 실)과 면적을 적는다
        const c = P(centroid(outline)), room = plan.rooms?.[0], title = room ? [room.no, room.name].map(v => v?.trim()).filter(Boolean).join(' ') : ''
        return <>
          {title && room?.name?.trim() && <text className="dpc-room" x={c.x} y={c.y - 11}>{title}</text>}
          <text className="dpc-area" x={c.x} y={c.y + (title && room?.name?.trim() ? 9 : 0)}>{area.toLocaleString('ko-KR')}㎡ · {(area / 3.3058).toFixed(1)}평</text>
        </>
      })()}
    </>
  )
})

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
  // 마지막 커서 자리: 옮기자마자 숫자를 쳐도 방향이 맞게, 화면 갱신을 기다리지 않고 바로 적어 둔다
  const ptrNow = useRef<(Pt & { shift: boolean }) | null>(null)
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
    // 바깥 치수선이 들어갈 여백을 두고 맞춘다
    const s = clampS(Math.max(w / (z.w - Math.min(150, z.w * 0.3)), h / (z.h - Math.min(150, z.h * 0.3))))
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s })
  }
  // 직접 확대 · 이동하기 전까지는 판 크기가 바뀔 때마다(보기 전환 · 전체 화면) 다시 맞춘다
  const auto = useRef(true)
  useEffect(() => { auto.current = true }, [fitKey])
  useEffect(() => { if (auto.current && size.w > 0) fit() }, [fitKey, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // 도구를 바꾸면 그리던 벽은 끝낸다
  useEffect(() => { setChain(null); setTyped(''); chainStart.current = null }, [tool])

  const worldOf = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect(), { view: v, size: z } = live.current
    return { x: v.cx + (e.clientX - r.left - z.w / 2) * v.s, y: v.cy + (e.clientY - r.top - z.h / 2) * v.s }
  }
  /** 벽 그리기 · 모서리 끌기의 맞춤: 가까운 벽 끝에 먼저 붙고, 아니면 격자(직전 점 기준으로 곧게) */
  const snapDraw = (p: Pt, from: Pt | null, free: boolean, skip: Pt[] = [], walls = live.current.plan.walls): Pt & { snap?: boolean } => {
    let best: Pt | null = null, bd = 10 * live.current.view.s
    for (const w of walls) for (const c of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
      if (skip.some(k => same(c, k))) continue
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
    const at = ptrNow.current
    if (at) { const h = snapDraw(at, c, at.shift), n = Math.hypot(h.x - c.x, h.y - c.y); if (n > 0) dir = { x: (h.x - c.x) / n, y: (h.y - c.y) / n } }
    addPoint({ x: Math.round(c.x + dir.x * len), y: Math.round(c.y + dir.y * len) })
  }

  useImperativeHandle(ref, () => ({
    fit: () => { auto.current = true; fit() },
    zoomBy: f => { auto.current = false; setView(v => ({ ...v, s: clampS(v.s * f) })) },
    key: e => {
      const L = live.current
      if (!((L.tool === 'wall' || L.tool === 'newwall') && L.chain)) return false
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { setTyped(t => (t + e.key).replace(/^0+/, '').slice(0, 6)); return true }
      if (e.key === 'Backspace') { setTyped(t => t.slice(0, -1)); return true }
      if (e.key === 'Enter') { if (L.typed) placeTyped(); else endChain(); return true }
      if (e.key === 'Escape') { if (L.typed) setTyped(''); else endChain(); return true }
      return false
    },
    cancel: endChain,
    show: p => {
      const { view: v, size: z } = live.current
      const x = (p.x - v.cx) / v.s + z.w / 2, y = (p.y - v.cy) / v.s + z.h / 2
      if (x < 30 || y < 40 || x > z.w - 30 || y > z.h - 30) { auto.current = false; setView({ ...v, cx: p.x, cy: p.y }) }
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
      auto.current = false
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

  // 터치: 두 손가락으로 벌리면 확대, 함께 밀면 이동
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; mx: number; my: number; view: View } | null>(null)
  const pinchStart = () => {
    const [a, b] = [...touches.current.values()], r = svg.current!.getBoundingClientRect()
    pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view: live.current.view }
  }
  const pinchMove = () => {
    const g = pinch.current
    if (!g || touches.current.size < 2) return
    const [a, b] = [...touches.current.values()], r = svg.current!.getBoundingClientRect(), z = live.current.size
    const s = clampS((g.view.s * g.d) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
    // 처음 두 손가락 가운데에 있던 평면의 점이 지금의 가운데에 오게
    const wx = g.view.cx + (g.mx - z.w / 2) * g.view.s, wy = g.view.cy + (g.my - z.h / 2) * g.view.s
    auto.current = false
    setView({ cx: wx - (mx - z.w / 2) * s, cy: wy - (my - z.h / 2) * s, s })
  }

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const L = live.current, P = L.props
    wrap.current?.focus({ preventScroll: true })
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        // 한 손가락으로 하던 일은 그만두고(끌던 것은 그 자리에서 끝) 두 손가락 조작으로 넘어간다
        const d0 = drag.current
        drag.current = null
        if (d0 && 'started' in d0 && d0.started) P.onDragEnd()
        try { svg.current?.setPointerCapture(e.pointerId) } catch { /* 잡지 못해도 그대로 진행 */ }
        pinchStart()
        return
      }
      if (touches.current.size > 2) return
    }
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
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current) { pinchMove(); return }
    }
    const L = live.current, P = L.props, d = drag.current, p = worldOf(e)
    if (d && d.id === e.pointerId) {
      // 손가락 · 펜은 누르는 사이에도 조금 움직인다 → 마우스보다 넉넉하게 봐야 누른 것이 끌기로 바뀌지 않는다
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > (e.pointerType === 'mouse' ? 3 : 9)) d.moved = true
      if (d.kind === 'pan' || ((d.kind === 'empty' || d.kind === 'wall') && d.moved)) {
        setPanning(true)
        auto.current = false
        setView({ ...d.view0, cx: d.view0.cx - (e.clientX - d.sx) * d.view0.s, cy: d.view0.cy - (e.clientY - d.sy) * d.view0.s })
        return
      }
      if (!d.moved || d.kind === 'click' || d.kind === 'empty' || d.kind === 'wall') return
      // 끌기를 시작하는 때의 평면을 바탕으로 (누르는 순간 칸을 벗어나며 반영된 길이 입력이 되돌아가지 않게)
      if (!d.started) { d.started = true; P.onDragStart(); d.base = live.current.plan }
      if (d.kind === 'items') {
        const one = d.ids.length === 1
        const dx = Math.round((p.x - d.p0.x) / GRID) * GRID, dy = Math.round((p.y - d.p0.y) / GRID) * GRID
        P.onDrag(cur => ({ ...cur, items: cur.items.map(i => {
          const b = d.ids.includes(i.id) ? d.base.items.find(x => x.id === i.id) : null
          if (!b) return i
          // 하나만 옮길 때는 자리를 격자에 맞추고, 여럿이면 서로의 간격을 지킨다
          const q = one ? snapPoint(b.x + (p.x - d.p0.x), b.y + (p.y - d.p0.y), GRID) : { x: b.x + dx, y: b.y + dy }
          return q.x === i.x && q.y === i.y ? i : { ...i, x: q.x, y: q.y }
        }) }))
      } else if (d.kind === 'corner') {
        // 이 모서리에 닿은 벽의 맞은편 끝에는 붙지 않는다 (붙으면 벽 길이가 0 이 된다)
        const far = d.base.walls.flatMap(w => (same({ x: w.x1, y: w.y1 }, d.corner) ? [{ x: w.x2, y: w.y2 }] : same({ x: w.x2, y: w.y2 }, d.corner) ? [{ x: w.x1, y: w.y1 }] : []))
        const to = snapDraw(p, e.shiftKey ? d.corner : null, !e.shiftKey, [d.corner, ...far], d.base.walls)
        if (far.some(f => Math.hypot(f.x - to.x, f.y - to.y) < MIN_WALL)) return
        P.onDrag(cur => ({ ...cur, walls: moveCorner(d.base.walls, d.corner, { x: to.x, y: to.y }) }))
      } else if (d.kind === 'opening') {
        const o = d.base.openings.find(x => x.id === d.openingId), w = o && d.base.walls.find(x => x.id === o.wall)
        if (!o || !w) return
        const f = wallFrame(w)
        const at = seat((p.x - w.x1) * f.ux + (p.y - w.y1) * f.uy, o.width, f.len)
        // 같은 벽의 다른 문 · 창 위로는 옮기지 않는다
        if (openingOverlaps(d.base.openings, o.wall, at.pos, o.width, o.id)) return
        P.onDrag(cur => ({ ...cur, openings: cur.openings.map(x => (x.id !== o.id || x.pos === at.pos ? x : { ...x, pos: at.pos })) }))
      }
      return
    }
    ptrNow.current = { ...p, shift: e.shiftKey }
    setPtr(ptrNow.current)
  }
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId)
      if (pinch.current) { if (touches.current.size < 2) pinch.current = null; return }
    }
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
      const clash = openingOverlaps(L.plan.openings, hit.w.id, at.pos, at.width)
      if (clash) { P.onNotice?.(`이 자리에는 이미 ${clash.kind === 'door' ? '문' : '창'}이 있습니다. 비어 있는 벽 부분을 눌러 주세요`); return }
      const o: PlanOpening = { id: uid(), wall: hit.w.id, pos: at.pos, width: at.width, kind: L.tool }
      P.onChange(cur => ({ ...cur, openings: [...cur.openings, o] }))
      P.onSelect([o.id])
    } else if (L.tool === 'item') { if (P.ghost) P.onPlace(snapPoint(p.x - P.ghost.w / 2, p.y - P.ghost.d / 2, GRID)) }
    else if (L.tool === 'note') P.onNote({ x: Math.round(p.x), y: Math.round(p.y) })
  }

  // ── 그리기 ──────────────────────────────────────────────
  const s = view.s, x0 = view.cx - (size.w / 2) * s, y0 = view.cy - (size.h / 2) * s
  const S = (p: Pt): Pt => ({ x: (p.x - x0) / s, y: (p.y - y0) / s })
  const shell = useMemo(() => closedShell(plan.walls.filter(w => w.kind === 'existing')) ?? [], [plan.walls])
  const outline = useMemo(() => floorOutline(shell), [shell])
  const area = useMemo(() => floorArea(shell), [shell])
  const sides = useMemo(() => outwardSides({ walls: [...shell, ...plan.walls.filter(w => w.kind !== 'existing')] }), [shell, plan.walls])
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

  const cls = `dpc tool-${tool}${space || panning ? ' pan' : ''}${panning ? ' panning' : ''}`
  return (
    <div ref={wrap} className={cls} tabIndex={0} role="application" aria-label="평면 그리기 영역. 휠로 확대하고, 빈 곳을 끌어 이동합니다"
      onPointerEnter={() => { over.current = true }} onPointerLeave={() => { over.current = false; ptrNow.current = null; setPtr(null) }}>
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
        {size.w > 0 && <g className={`dpc-world${s > 22 ? ' far' : ''}`} transform={`matrix(${1 / s} 0 0 ${1 / s} ${-x0 / s} ${-y0 / s})`}><World plan={plan} sel={sel} look={look} outline={outline} /></g>}
        <g className="dpc-over">
          {size.w > 0 && <g transform={`translate(${-x0 / s} ${-y0 / s})`}><Labels plan={plan} sel={sel} s={s} sides={sides} outline={outline} area={area} /></g>}
          {selWall && [{ x: selWall.x1, y: selWall.y1 }, { x: selWall.x2, y: selWall.y2 }].map((c, i) => { const q = S(c); return <circle key={i} className="dpc-handle" data-hit="corner" data-x={c.x} data-y={c.y} cx={q.x} cy={q.y} r={6.5}><title>끌어서 모서리를 옮깁니다. 이어진 벽도 함께 움직입니다</title></circle> })}
          {openAt && (() => { const o = seat(openAt.pos, props.openW > 0 ? props.openW : tool === 'door' ? 900 : 1200, openAt.len), f = wallFrame(openAt.w); const a = S({ x: openAt.w.x1 + f.ux * (o.pos - o.width / 2), y: openAt.w.y1 + f.uy * (o.pos - o.width / 2) }), b = S({ x: openAt.w.x1 + f.ux * (o.pos + o.width / 2), y: openAt.w.y1 + f.uy * (o.pos + o.width / 2) }); return <line className="dpc-ghost-open" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.max(openAt.w.t / s, 6)} /> })()}
          {ghostAt && ghost && (() => { const q = S(ghostAt); return <g className="dpc-ghost"><rect x={q.x} y={q.y} width={ghost.w / s} height={ghost.d / s} rx={3} /><text x={q.x + ghost.w / s / 2} y={q.y + ghost.d / s / 2}>{ghost.name}</text></g> })()}
          {drawing && hover && (() => {
            const len = chain ? Math.hypot(hover.x - chain.x, hover.y - chain.y) : 0
            // 숫자를 치는 동안에는 그 길이만큼 가는 자리를 미리 보여 준다
            const end = chain && typed && len > 0 ? { x: chain.x + ((hover.x - chain.x) / len) * Number(typed), y: chain.y + ((hover.y - chain.y) / len) * Number(typed) } : hover
            const h = S(end), c = chain ? S(chain) : null
            const label = typed ? `${Number(typed).toLocaleString('ko-KR')} mm ↵` : chain && len > 0 ? `${num(len)} mm` : ''
            return <g className="dpc-draw">
              {c && <line x1={c.x} y1={c.y} x2={h.x} y2={h.y} />}
              {c && <circle className="from" cx={c.x} cy={c.y} r={4} />}
              <circle className={hover.snap && !typed ? 'snap' : 'at'} cx={h.x} cy={h.y} r={hover.snap && !typed ? 7 : 3.5} />
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
      {props.overlay?.(S, size)}
    </div>
  )
})
