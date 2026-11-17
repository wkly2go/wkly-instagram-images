// 평면 · 3D 모델링 (인트라넷 화면 안에서 그리기) — 평면 자료(mm)와 수량 계산
// 레퍼런스: Coohom · 아키스케치(평면을 그리면 바로 3D) · Houzz Pro(물량 → 견적)
// 여기서 만드는 것은 수량(개수 · 면적 · 길이)뿐이다. 금액은 견적 엔진(작업 처리기)만 계산한다.

export interface PlanWall { id: string; x1: number; y1: number; x2: number; y2: number; /** 두께 mm */ t: number; /** existing: 기존 벽(수량 없음) · new: 새로 세우는 가벽(수량에 들어감) */ kind: 'existing' | 'new'; /** 이 벽의 마감 (입면도 · 마감표에 적힘) */ finish?: string; /** 벽체 유형 기호 (W1~W30 · 벽체 상세도에 쓰임) */ type?: string }
export interface PlanOpening { id: string; wall: string; /** 벽 시작점에서 중심까지 mm */ pos: number; width: number; kind: 'door' | 'window'; /** 문 높이 mm (없으면 2100) */ height?: number; /** 도어 리스트: 어느 실로 들어가는 문인지 */ to?: string; /** 도어 리스트: 종류 (여닫이 도어 · 히든 여닫이 도어 …) */ type?: string; /** 문짝 마감 (재료 번호) */ finish?: string; /** 프레임 마감 (재료 번호) */ frame?: string; /** 경첩 쪽 — start: 벽 시작점 쪽(기본) · end: 끝점 쪽 */ hinge?: 'start' | 'end'; /** 열리는 쪽 — 벽 진행 방향의 왼쪽 1(기본) · 오른쪽 -1 */ side?: 1 | -1 }
export interface PlanItem {
  id: string; x: number; y: number; w: number; d: number; h: number; rot: 0 | 90
  name: string; trade_code: string; spec: string; unit: string
  /** 수량 세는 법 — count: 개수 · area: 바닥 면적(㎡) · length: 긴 변 길이(m) */
  measure: 'count' | 'area' | 'length'
  section: string | null
  /** 모양(평면 기호 · 3D) — 비우면 이름으로 알아본다 (lib/designPlanLook itemShape) */
  shape?: string
  /** 바닥에서 띄운 높이 mm (벽걸이 TV · 상부장). 펜던트 · 매입등은 천장에 붙는다 */
  z?: number
  /** 이 부품의 마감 (재료 번호 · 색 낱말) — 3D 색에 쓰인다 */
  finish?: string
}
/** One part of a room's finish: material number (PT-01) and, where it applies, the detail type (F/B/W). */
export interface RoomPart { mat?: string; detail?: string }
/** A room row of the finish schedule (sample set I-008: 실번호 · 실명 · 바닥 · 걸레받이 · 벽 · 천장). */
export interface PlanRoom { id: string; no: string; name: string; floor: RoomPart; base: RoomPart; wall: RoomPart; ceiling: RoomPart; /** 천장 높이 mm */ ch?: number; /** 바닥 면적 ㎡ (바닥 · 천장 수량) */ area?: number; /** 걸레받이 길이 m */ perimeter?: number; /** 조명 수량표: 조명 기호(DL-01) → 수량 */ lights?: Record<string, number> }
/** 도면 위 댓글 핀 (피그마식 협업 · 2026-11-17). 평면 자료와 함께 저장한다 */
export interface PlanNote { id: string; x: number; y: number; text: string; by: string; at: string; done?: boolean }
export interface PlanGeometry { unit: 'mm'; height: number; walls: PlanWall[]; openings: PlanOpening[]; items: PlanItem[]; rooms?: PlanRoom[]; notes?: PlanNote[] }
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

/** 벽이 이어져 닫힌 방이면 그 바닥 꼭짓점(mm)을 차례로. 닫히지 않았으면 null — 추정하지 않는다 */
export function floorOutline(walls: PlanWall[]): { x: number; y: number }[] | null {
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
  return pts.length === walls.length ? pts : null
}

/** 벽이 이어져 닫힌 방이면 바닥 면적(㎡). 닫히지 않았으면 null — 추정하지 않는다 */
export function floorArea(walls: PlanWall[]): number | null {
  const pts = floorOutline(walls)
  if (!pts) return null
  let s = 0
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y }
  return round3(Math.abs(s) / 2 / 1e6)
}

/** 댓글 핀 합치기: 저장 직전 서버의 최신 핀과 내 핀을 id 로 합친다. 내가 지운 것(removed)은 빼고, 같은 id 는 내 것이 이긴다 */
export function mergeNotes(mine: PlanNote[] | undefined, latest: PlanNote[] | undefined, removed: Iterable<string> = []): PlanNote[] {
  const gone = new Set(removed)
  const out = new Map<string, PlanNote>()
  for (const n of latest ?? []) if (!gone.has(n.id)) out.set(n.id, n)
  for (const n of mine ?? []) out.set(n.id, n)
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at))
}

const FINISH_TRADE: Record<string, string> = { PT: 'T06', SH: 'T07', WC: 'T07', TL: 'T08', ST: 'T08', AS: 'T08', MT: 'T04', GL: 'T05', WP: 'T03', WD: 'T03', AC: 'T03', FB: 'T03', LE: 'T03', VS: 'T09', WF: 'T09', CP: 'T09', CT: 'T09' }
/** 마감 글의 재료 번호 앞 글자(PT-01 → PT)로 공종을 고른다. 번호가 없으면 기타(T99) — 수량표에서 고친다 */
export const finishTrade = (finish: string) => FINISH_TRADE[finish.trim().toUpperCase().match(/^[A-Z]{2,3}(?=[-\s]?\d)/)?.[0] ?? ''] ?? 'T99'

/** 평면 → 수량 줄. 마감이 정해진 벽은 한 면의 마감 면적(㎡)도 넣는다. 새 가벽은 길이 × 높이에서 문 · 창 면적을 뺀 ㎡, 부품은 같은 것끼리 더한다 */
export function planQuantities(g: PlanGeometry, wallTrade = 'T03'): PlanLine[] {
  const out = new Map<string, PlanLine>()
  const add = (l: Omit<PlanLine, 'count'>) => {
    const k = [l.trade, l.item, l.spec, l.unit, l.section ?? ''].join('|')
    const cur = out.get(k)
    if (cur) { cur.qty = round3(cur.qty + l.qty); cur.count++ } else out.set(k, { ...l, qty: round3(l.qty), count: 1 })
  }
  for (const w of g.walls.filter(x => x.kind === 'new')) {
    const holes = g.openings.filter(o => o.wall === w.id).reduce((s, o) => s + o.width * (o.kind === 'door' ? Math.min(o.height || 2100, g.height) : 1200), 0)
    const m2 = (wallLength(w) * g.height - holes) / 1e6
    if (m2 > 0) add({ trade: wallTrade, item: '가벽 설치', spec: `H${g.height} · T${w.t}`, unit: 'm2', qty: m2, section: null })
  }
  // Wall finish: one face of each wall that has a finish set, net of openings. Trade comes from the material number prefix.
  for (const w of g.walls.filter(x => x.finish?.trim())) {
    const holes = g.openings.filter(o => o.wall === w.id).reduce((s, o) => s + o.width * (o.kind === 'door' ? Math.min(o.height || 2100, g.height) : 1200), 0)
    const m2 = (wallLength(w) * g.height - holes) / 1e6
    if (m2 > 0) add({ trade: finishTrade(w.finish!), item: '벽 마감', spec: w.finish!.trim(), unit: 'm2', qty: m2, section: null })
  }
  // Room finishes: floor and ceiling by the room's area, baseboard by its length. Rooms without a material or a size add nothing.
  for (const r of g.rooms ?? []) {
    const line = (mat: string | undefined, item: string, unit: string, qty: number | undefined) => { if (mat?.trim() && qty && qty > 0) add({ trade: finishTrade(mat), item, spec: mat.trim(), unit, qty, section: null }) }
    line(r.floor.mat, '바닥 마감', 'm2', r.area); line(r.ceiling.mat, '천장 마감', 'm2', r.area); line(r.base.mat, '걸레받이', 'm', r.perimeter)
    for (const [code, n] of Object.entries(r.lights ?? {})) if (n > 0) add({ trade: 'T11', item: '조명 기구', spec: code, unit: 'EA', qty: n, section: null })
  }
  for (const it of g.items) {
    if (!it.name.trim() || !it.trade_code || !it.unit) continue
    const qty = it.measure === 'area' ? (it.w * it.d) / 1e6 : it.measure === 'length' ? Math.max(it.w, it.d) / 1000 : 1
    add({ trade: it.trade_code, item: it.name.trim(), spec: it.spec.trim() || `W${it.w} D${it.d} H${it.h}`, unit: it.unit, qty, section: it.section })
  }
  return [...out.values()]
}

/** Lighting counts are edited in the spec book, everything else in the plan editor. Each side keeps the other's part
 *  when it saves: take `lights` from `from` (the latest saved plan) into the rooms of `into`. */
export function keepLights(into: PlanGeometry, from: PlanGeometry | null): PlanGeometry {
  if (!into.rooms?.length || !from?.rooms?.length) return into
  const saved = new Map(from.rooms.map(r => [r.id, r.lights]))
  return { ...into, rooms: into.rooms.map(r => (saved.get(r.id) ? { ...r, lights: saved.get(r.id) } : r)) }
}
