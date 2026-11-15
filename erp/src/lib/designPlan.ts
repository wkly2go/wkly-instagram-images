// 평면 · 3D 모델링 (인트라넷 화면 안에서 그리기) — 평면 자료(mm)와 수량 계산
// 레퍼런스: Coohom · 아키스케치(평면을 그리면 바로 3D) · Houzz Pro(물량 → 견적)
// 여기서 만드는 것은 수량(개수 · 면적 · 길이)뿐이다. 금액은 견적 엔진(작업 처리기)만 계산한다.

export interface PlanWall { id: string; x1: number; y1: number; x2: number; y2: number; /** 두께 mm */ t: number; /** existing: 기존 벽(수량 없음) · new: 새로 세우는 가벽(수량에 들어감) */ kind: 'existing' | 'new'; /** 이 벽의 마감 (입면도 · 마감표에 적힘) */ finish?: string }
export interface PlanOpening { id: string; wall: string; /** 벽 시작점에서 중심까지 mm */ pos: number; width: number; kind: 'door' | 'window' }
export interface PlanItem {
  id: string; x: number; y: number; w: number; d: number; h: number; rot: 0 | 90
  name: string; trade_code: string; spec: string; unit: string
  /** 수량 세는 법 — count: 개수 · area: 바닥 면적(㎡) · length: 긴 변 길이(m) */
  measure: 'count' | 'area' | 'length'
  section: string | null
}
export interface PlanGeometry { unit: 'mm'; height: number; walls: PlanWall[]; openings: PlanOpening[]; items: PlanItem[] }
export const EMPTY_PLAN: PlanGeometry = { unit: 'mm', height: 2700, walls: [], openings: [], items: [] }

export interface PlanLine { trade: string; item: string; spec: string; unit: string; qty: number; section: string | null; count: number }

export const wallLength = (w: PlanWall) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** 격자에 맞추고, 직전 점 기준으로 가로 · 세로 중 가까운 쪽으로 곧게 */
export function snapPoint(x: number, y: number, grid: number, from?: { x: number; y: number } | null): { x: number; y: number } {
  let sx = Math.round(x / grid) * grid, sy = Math.round(y / grid) * grid
  if (from) { if (Math.abs(sx - from.x) >= Math.abs(sy - from.y)) sy = from.y; else sx = from.x }
  return { x: sx, y: sy }
}

/** 벽이 이어져 닫힌 방이면 바닥 면적(㎡). 닫히지 않았으면 null — 추정하지 않는다 */
export function floorArea(walls: PlanWall[]): number | null {
  if (walls.length < 3) return null
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`
  const next = new Map<string, { x: number; y: number }[]>()
  for (const w of walls) {
    const a = key(w.x1, w.y1), b = key(w.x2, w.y2)
    next.set(a, [...(next.get(a) ?? []), { x: w.x2, y: w.y2 }])
    next.set(b, [...(next.get(b) ?? []), { x: w.x1, y: w.y1 }])
  }
  if ([...next.values()].some(v => v.length !== 2)) return null
  const start = { x: walls[0].x1, y: walls[0].y1 }
  const pts = [start]
  let prev = start, cur = next.get(key(start.x, start.y))![0]
  while (key(cur.x, cur.y) !== key(start.x, start.y)) {
    pts.push(cur)
    if (pts.length > walls.length + 1) return null
    const [p, q] = next.get(key(cur.x, cur.y))!
    const nx = key(p.x, p.y) === key(prev.x, prev.y) ? q : p
    prev = cur; cur = nx
  }
  if (pts.length !== walls.length) return null
  let s = 0
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y }
  return round3(Math.abs(s) / 2 / 1e6)
}

/** 평면 → 수량 줄. 새 가벽은 길이 × 높이에서 문 · 창 면적을 뺀 ㎡, 부품은 같은 것끼리 더한다 */
export function planQuantities(g: PlanGeometry, wallTrade = 'T03'): PlanLine[] {
  const out = new Map<string, PlanLine>()
  const add = (l: Omit<PlanLine, 'count'>) => {
    const k = [l.trade, l.item, l.spec, l.unit, l.section ?? ''].join('|')
    const cur = out.get(k)
    if (cur) { cur.qty = round3(cur.qty + l.qty); cur.count++ } else out.set(k, { ...l, qty: round3(l.qty), count: 1 })
  }
  for (const w of g.walls.filter(x => x.kind === 'new')) {
    const holes = g.openings.filter(o => o.wall === w.id).reduce((s, o) => s + o.width * (o.kind === 'door' ? Math.min(2100, g.height) : 1200), 0)
    const m2 = (wallLength(w) * g.height - holes) / 1e6
    if (m2 > 0) add({ trade: wallTrade, item: '가벽 설치', spec: `H${g.height} · T${w.t}`, unit: 'm2', qty: m2, section: null })
  }
  for (const it of g.items) {
    if (!it.name.trim() || !it.trade_code || !it.unit) continue
    const qty = it.measure === 'area' ? (it.w * it.d) / 1e6 : it.measure === 'length' ? Math.max(it.w, it.d) / 1000 : 1
    add({ trade: it.trade_code, item: it.name.trim(), spec: it.spec.trim() || `W${it.w} D${it.d} H${it.h}`, unit: it.unit, qty, section: it.section })
  }
  return [...out.values()]
}
