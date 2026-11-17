// 캐드 활용 (2026-11-17 대표 지시 '캐드와 스케치업을 활용 가능하게')
// DXF(캐드 교환 형식) 읽기 → 평면의 벽으로, 평면 → DXF 내보내기. 브라우저 안에서만 계산하고 외부 도구 · 비용이 없다.
// DWG 는 캐드에서 '다른 이름으로 저장 › DXF' 로 바꿔 올린다 (DWG 를 직접 읽는 무료 도구는 라이선스 확인 뒤 작업 처리기에 붙인다).
import type { PlanGeometry, PlanOpening, PlanWall } from './designPlan.ts'
import { doorSymbol, pieceCorners, wallFrame, wallSolids, along, type Pt } from './designPlanDraw.ts'

export interface DxfSegment { layer: string; x1: number; y1: number; x2: number; y2: number }
export interface DxfArc { layer: string; x: number; y: number; r: number }
export interface DxfDrawing {
  segments: DxfSegment[]
  /** 호 (문 열림 표시) — 벽으로 만들지 않는다 */
  arcs?: DxfArc[]
  layers: { name: string; count: number; length: number }[]
  /** $INSUNITS (1 인치 · 2 피트 · 4 mm · 5 cm · 6 m) — 없으면 null. 이 프로그램이 내보낸 파일은 표시 글로 mm */
  units: number | null
  /** 읽지 않은 요소 수 (호 · 블록 · 글 등) */
  skipped: Record<string, number>
  bounds: { x0: number; y0: number; x1: number; y1: number } | null
}

/** 이 프로그램이 내보낸 DXF 의 단위 표시 (999 는 캐드가 읽고 넘기는 설명 줄) */
export const DXF_MM_MARK = 'WKLY-ERP UNITS MM'
/** 예전 캐드가 \U+XXXX 로 적은 레이어 이름(한글)을 글자로 */
const decodeName = (s: string) => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))

/** DXF 글 → 선분. LINE · LWPOLYLINE · POLYLINE 만 벽 후보로 읽는다 (호는 문 표시라 따로 모아 두기만). y 는 화면 방향(아래로)으로 뒤집는다 */
export function parseDxf(text: string): DxfDrawing {
  const lines = text.split(/\r\n|\r|\n/)
  const segments: DxfSegment[] = [], arcs: DxfArc[] = []
  const skipped: Record<string, number> = {}
  let units: number | null = null, marked = false
  let section = '', type = '', layer = '0'
  let pts: Pt[] = []
  let closed = false, ez = 1, r = NaN
  let line = { x1: NaN, y1: NaN, x2: NaN, y2: NaN }
  let poly: { layer: string; closed: boolean; ez: number; pts: Pt[] } | null = null // POLYLINE … VERTEX … SEQEND
  let wantSection = false
  let headerVar = ''
  const push = (l: string, a: Pt, b: Pt) => { if (Number.isFinite(a.x + a.y + b.x + b.y) && (a.x !== b.x || a.y !== b.y)) segments.push({ layer: l, x1: a.x, y1: -a.y, x2: b.x, y2: -b.y }) }
  // 돌출 방향이 아래(0,0,-1)인 폴리선은 뒤집힌 블록을 분해한 것 — x 를 거울처럼 되돌린다
  const chain = (l: string, p0: Pt[], c: boolean, mirror: boolean) => { const p = mirror ? p0.map(q => ({ x: -q.x, y: q.y })) : p0; for (let i = 0; i + 1 < p.length; i++) push(l, p[i], p[i + 1]); if (c && p.length > 2) push(l, p[p.length - 1], p[0]) }
  const flush = () => {
    if (section !== 'ENTITIES' || !type) return
    if (type === 'LINE') push(layer, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 })
    else if (type === 'LWPOLYLINE') chain(layer, pts, closed, ez < 0)
    else if (type === 'POLYLINE') poly = { layer, closed, ez, pts: [] }
    else if (type === 'VERTEX') { if (poly && pts.length) poly.pts.push(pts[0]) }
    else if (type === 'SEQEND') { if (poly) chain(poly.layer, poly.pts, poly.closed, poly.ez < 0); poly = null }
    else {
      if (type === 'ARC' && Number.isFinite(line.x1 + line.y1 + r) && r > 0) arcs.push({ layer, x: ez < 0 ? -line.x1 : line.x1, y: -line.y1, r })
      skipped[type] = (skipped[type] ?? 0) + 1
    }
  }
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const head = lines[i].trim()
    // 빈 줄 · 한 줄 빠짐 등으로 코드와 값의 짝이 어긋나면 숫자 코드가 나올 때까지 한 줄씩 건너 다시 맞춘다
    if (!/^-?\d{1,4}$/.test(head)) { i -= 1; continue }
    const code = Number(head)
    const value = lines[i + 1].trim()
    if (code === 999) { if (value.toUpperCase().includes(DXF_MM_MARK)) marked = true; continue }
    if (code === 0) {
      flush()
      type = ''; layer = '0'; pts = []; closed = false; ez = 1; r = NaN; line = { x1: NaN, y1: NaN, x2: NaN, y2: NaN }
      if (value === 'SECTION') { wantSection = true; continue }
      if (value === 'ENDSEC') { section = ''; continue }
      if (value === 'EOF') break
      type = value
      continue
    }
    if (wantSection && code === 2) { section = value; wantSection = false; continue }
    if (section === 'HEADER') {
      if (code === 9) headerVar = value
      else if (headerVar === '$INSUNITS' && code === 70) units = Number(value)
      continue
    }
    if (section !== 'ENTITIES') continue
    const n = Number(value)
    if (code === 8) layer = decodeName(value) || '0'
    else if (code === 230) ez = n
    else if (code === 70) closed = (Number(value) & 1) === 1
    else if (type === 'LINE') { if (code === 10) line.x1 = n; else if (code === 20) line.y1 = n; else if (code === 11) line.x2 = n; else if (code === 21) line.y2 = n }
    else if (type === 'ARC') { if (code === 10) line.x1 = n; else if (code === 20) line.y1 = n; else if (code === 40) r = n }
    else if (type === 'LWPOLYLINE' || type === 'VERTEX') { if (code === 10) pts.push({ x: n, y: NaN }); else if (code === 20 && pts.length) pts[pts.length - 1].y = n }
  }
  flush()
  if ((units == null || units === 0) && marked) units = 4
  const by = new Map<string, { name: string; count: number; length: number }>()
  let b: DxfDrawing['bounds'] = null
  for (const s of segments) {
    const l = by.get(s.layer) ?? { name: s.layer, count: 0, length: 0 }
    l.count++; l.length += Math.hypot(s.x2 - s.x1, s.y2 - s.y1); by.set(s.layer, l)
    b = b ? { x0: Math.min(b.x0, s.x1, s.x2), y0: Math.min(b.y0, s.y1, s.y2), x1: Math.max(b.x1, s.x1, s.x2), y1: Math.max(b.y1, s.y1, s.y2) } : { x0: Math.min(s.x1, s.x2), y0: Math.min(s.y1, s.y2), x1: Math.max(s.x1, s.x2), y1: Math.max(s.y1, s.y2) }
  }
  return { segments, arcs, layers: [...by.values()].sort((a, c) => c.length - a.length), units, skipped, bounds: b }
}

const KNOWN_UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }
/** 나란히 가까운 선 사이 간격(도면 단위)의 가운데값 — 벽 두께로 도면 단위를 짐작할 때 쓴다 */
function typicalGap(segs: DxfSegment[]): number | null {
  const ax = segs.map(s => mkAxis(s.x1, s.y1, s.x2, s.y2, 'existing')).filter((a): a is Axis => !!a).sort((a, b) => b.len - a.len).slice(0, 1500)
  const gaps: number[] = []
  for (let i = 0; i < ax.length; i++) {
    let best = Infinity
    for (let j = 0; j < ax.length; j++) {
      if (i === j || !nearAngle(ax[i], ax[j])) continue
      const r = relate(ax[i], ax[j])
      if (!r) continue
      const over = Math.min(ax[i].len, r.b1) - Math.max(0, r.b0)
      const g = Math.abs(r.off)
      if (over >= Math.min(ax[i].len, ax[j].len) * 0.5 && g > ax[i].len * 1e-4 && g < best) best = g
    }
    if (Number.isFinite(best)) gaps.push(best)
  }
  if (gaps.length < 2) return null
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}
/** 도면 단위 → mm 배율. 파일에 적힌 단위($INSUNITS)를 먼저 쓰되 크기가 말이 안 되면(0.3m 미만 · 500m 넘음) 짐작으로 돌린다.
 *  적혀 있지 않으면 벽 두께로 보이는 선 간격(50~450mm)이 나오는 단위를 mm → cm → m 순서로 고르고, 그래도 모르면 mm 로 본다(guessed — 화면에서 확인받는다) */
export function dxfScale(d: Pick<DxfDrawing, 'units' | 'bounds'> & { segments?: DxfSegment[] }, layers?: string[]): { scale: number; guessed: boolean } {
  const size = d.bounds ? Math.max(d.bounds.x1 - d.bounds.x0, d.bounds.y1 - d.bounds.y0) : 0
  const fits = (s: number) => size <= 0 || (size * s >= 300 && size * s <= 500000)
  if (d.units != null && KNOWN_UNITS[d.units] && fits(KNOWN_UNITS[d.units])) return { scale: KNOWN_UNITS[d.units], guessed: false }
  const want = layers?.length ? new Set(layers) : null
  const gap = typicalGap((d.segments ?? []).filter(s => !want || want.has(s.layer)))
  if (gap) for (const s of [1, 10, 1000, 25.4]) if (gap * s >= 50 && gap * s <= 450 && fits(s)) return { scale: s, guessed: true }
  return { scale: size > 0 && size <= 200 ? 1000 : 1, guessed: true }
}

const tokens = (name: string) => name.toUpperCase().split(/[-_\s.,()[\]|/\\+]+/).filter(Boolean)
const WALL_WORDS = new Set(['WALL', 'WALLS', 'WAL', 'STR', 'STRU', 'STRUC', 'STRUCT', 'STRUCTURE', 'CONC', 'RC', 'PARTITION', 'PART'])
const NOT_WALL = new Set(['FURN', 'FURNITURE', 'STRS', 'STAIR', 'STAIRS', 'ELEC', 'DOOR', 'DOORS', 'GLAZ', 'WIN', 'WINDOW', 'TEXT', 'DIM', 'DIMS', 'ANNO', 'HATCH', 'PATT', 'FIXT', 'EQPM', 'CLNG', 'LITE', 'LIGHT', 'FLOR'])
/** 벽으로 보이는 레이어 이름 (기본 선택용) — 이름을 - _ 띄어쓰기로 나눠 낱말로 본다. 벽지 · 벽등 · 계단 · 가구 레이어는 빼고 */
export const isWallLayer = (name: string) => {
  const t = tokens(name)
  if (t.some(x => NOT_WALL.has(x) || /벽지|벽등|벽부|벽걸이|계단/.test(x))) return false
  return t.some(x => WALL_WORDS.has(x) || /WALL/.test(x) || /벽|조적|경량|구조|가벽/.test(x))
}
/** 레이어 이름에 NEW · 가벽 · 신설이 있으면 새 가벽, 아니면 고른 종류 */
export const layerKind = (name: string, fallback: PlanWall['kind'] = 'existing'): PlanWall['kind'] => (/(^|[^A-Z])NEW([^A-Z]|$)|가벽|신설/i.test(name) ? 'new' : fallback)
const GLAZ_LAYER = /glaz|window|(^|[^a-z])win([^a-z]|$)|창호|유리|창(?!고)/i

interface Axis { ax: number; ay: number; ux: number; uy: number; len: number; th: number; kind: PlanWall['kind'] }
function mkAxis(x1: number, y1: number, x2: number, y2: number, kind: PlanWall['kind']): Axis | null {
  let ux = x2 - x1, uy = y2 - y1
  const len = Math.hypot(ux, uy)
  if (!(len > 0) || !Number.isFinite(len)) return null
  ux /= len; uy /= len
  let sx = x1, sy = y1
  if (uy < -1e-9 || (Math.abs(uy) <= 1e-9 && ux < 0)) { ux = -ux; uy = -uy; sx = x2; sy = y2 }
  let th = Math.atan2(uy, ux)
  if (th >= Math.PI - 0.01) th -= Math.PI
  return { ax: sx, ay: sy, ux, uy, len, th, kind }
}
const nearAngle = (a: Axis, b: Axis) => { const d = Math.abs(a.th - b.th); return d < 0.025 || Math.PI - d < 0.025 }
/** B 를 A 의 축(A 시작점 기준 · A 방향)으로 본 값: 가운데 간격(왼쪽 +) · 구간 · 같은 방향인지 */
function relate(A: Axis, B: Axis) {
  if (Math.abs(A.ux * B.uy - A.uy * B.ux) > 0.025) return null
  const bx = B.ax + B.ux * B.len, by = B.ay + B.uy * B.len, nx = -A.uy, ny = A.ux
  const o1 = (B.ax - A.ax) * nx + (B.ay - A.ay) * ny, o2 = (bx - A.ax) * nx + (by - A.ay) * ny
  const t1 = (B.ax - A.ax) * A.ux + (B.ay - A.ay) * A.uy, t2 = (bx - A.ax) * A.ux + (by - A.ay) * A.uy
  return { off: (o1 + o2) / 2, b0: Math.min(t1, t2), b1: Math.max(t1, t2), t1, t2, same: A.ux * B.ux + A.uy * B.uy > 0 }
}
type Span = [number, number]
/** 구간 [a, b] 에서 쓴 구간들을 뺀 나머지 */
function freeParts(a: number, b: number, used: Span[]): Span[] {
  let parts: Span[] = [[a, b]]
  for (const [u0, u1] of used) {
    const next: Span[] = []
    for (const [p0, p1] of parts) {
      if (u1 <= p0 || u0 >= p1) { next.push([p0, p1]); continue }
      if (u0 > p0) next.push([p0, u0])
      if (u1 < p1) next.push([u1, p1])
    }
    parts = next
  }
  return parts.filter(p => p[1] - p[0] > 1)
}

export interface DxfWallOptions { layers: string[]; scale: number; /** 짝을 못 찾은 선의 벽 두께 mm */ thickness?: number; /** 레이어 이름으로 정해지지 않는 벽의 종류 (NEW · 가벽 레이어는 늘 새 가벽) */ kind?: PlanWall['kind']; /** 벽의 두 면(겹선)을 한 벽으로 묶을지 */ pair?: boolean }
export interface DxfWallResult {
  walls: PlanWall[]
  /** 이어 붙인 벽 사이 빈칸(문 · 창 자리) */
  openings: PlanOpening[]
  paired: number; single: number
  /** 너무 짧아 벽으로 보지 않은 선 */
  dropped: number
  /** 6,000 줄을 넘어 읽지 않은 선 (짧은 것부터 뺌) */
  truncated: number
  /** 도면 좌표에서 뺀 값 mm (도면이 원점에서 아주 멀 때만 · 같은 파일이면 늘 같은 값) */
  shift: { x: number; y: number }
}
export const DXF_MAX_LINES = 6000
interface Band extends Axis { lo: number; hi: number; members: number; used: Span[] }
interface WallP { ux: number; uy: number; c: number; s0: number; s1: number; t: number; kind: PlanWall['kind'] }
const ptOf = (w: Pick<WallP, 'ux' | 'uy' | 'c'>, s: number) => ({ x: w.ux * s - w.uy * w.c, y: w.uy * s + w.ux * w.c })

/** 고른 레이어의 선 → 벽. 캐드 도면은 벽을 두 줄(양쪽 면)로 그리므로 나란하고 가까운(40~450mm) 두 면을 가운데 선 하나와 두께로 묶는다.
 *  한 면은 한 구간에 한 벽만 쓰고(겹친 벽 없음), 40mm 안쪽의 겹선(보드 · 유리)은 한 면으로, 가운데 선은 벽 안에 넣는다.
 *  같은 선 위 두께가 같은 조각은 2,400mm 까지의 빈칸(문 · 창 자리)을 건너 한 벽으로 잇고, 빈칸은 문 · 창으로 돌려준다.
 *  끝은 만나는 벽의 가운데 선에 맞춰(모서리 · T 자) 닫힌 방이 되게 한다. 좌표는 도면 그대로(mm) — 같은 파일은 나눠 가져와도 같은 자리 */
export function dxfToWalls(d: DxfDrawing, o: DxfWallOptions): DxfWallResult {
  const want = new Set(o.layers), sc = o.scale, fallback = o.kind ?? 'existing'
  const raw: Axis[] = []
  for (const s of d.segments) if (want.has(s.layer)) { const a = mkAxis(s.x1 * sc, s.y1 * sc, s.x2 * sc, s.y2 * sc, layerKind(s.layer, fallback)); if (a) raw.push(a) }
  const long = raw.filter(s => s.len >= 100).sort((a, b) => b.len - a.len)
  const segs = long.slice(0, DXF_MAX_LINES)
  const truncated = long.length - segs.length
  let dropped = raw.length - long.length
  // 1) 40mm 안쪽으로 나란히 겹친 선 → 한 면(묶음). 긴 선이 축이 된다
  const parent = segs.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  if (o.pair !== false) for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]
    if (A.kind !== B.kind || !nearAngle(A, B)) continue
    const r = relate(A, B)
    if (!r || Math.abs(r.off) >= 40) continue
    const over = Math.min(A.len, r.b1) - Math.max(0, r.b0)
    if (over < 50 || over < Math.min(A.len, B.len) * 0.5) continue
    const a = find(i), b = find(j)
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
  }
  const groups = new Map<number, number[]>()
  segs.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]) })
  const bands: Band[] = []
  for (const [root, ids] of groups) {
    const A = segs[root]
    let lo = 0, hi = 0, s0 = 0, s1 = A.len
    for (const id of ids) {
      if (id === root) continue
      const r = relate(A, segs[id])!
      const nx = -A.uy, ny = A.ux, B = segs[id]
      const oa = (B.ax - A.ax) * nx + (B.ay - A.ay) * ny, ob = (B.ax + B.ux * B.len - A.ax) * nx + (B.ay + B.uy * B.len - A.ay) * ny
      lo = Math.min(lo, oa, ob); hi = Math.max(hi, oa, ob); s0 = Math.min(s0, r.b0); s1 = Math.max(s1, r.b1)
    }
    bands.push({ ...A, ax: A.ax + A.ux * s0, ay: A.ay + A.uy * s0, len: s1 - s0, lo, hi, members: ids.length, used: [] })
  }
  // 2) 두 면 짝짓기: 얇은 벽부터, 한 면의 같은 구간은 한 번만
  type Near = { k: number; mid: number; b0: number; b1: number; t1: number; t2: number }
  const near: Near[][] = bands.map(() => [])
  const cands: { i: number; j: number; t: number; over: number; lo: number; hi: number; b0: number; b1: number; t1: number; t2: number; dmid: number }[] = []
  if (o.pair !== false) for (let i = 0; i < bands.length; i++) for (let j = 0; j < bands.length; j++) {
    if (i === j) continue
    const A = bands[i], B = bands[j]
    if (A.kind !== B.kind || !nearAngle(A, B)) continue
    const r = relate(A, B)
    if (!r || Math.abs(r.off) > 470) continue
    const bl = r.same ? B.lo : -B.hi, bh = r.same ? B.hi : -B.lo
    const jlo = r.off + bl, jhi = r.off + bh
    near[i].push({ k: j, mid: (jlo + jhi) / 2, b0: r.b0, b1: r.b1, t1: r.t1, t2: r.t2 })
    if (j < i || (jlo < A.hi + 20 && jhi > A.lo - 20)) continue
    const lo = Math.min(A.lo, jlo), hi = Math.max(A.hi, jhi), t = hi - lo
    if (t < 40 || t > 450) continue
    const over = Math.min(A.len, r.b1) - Math.max(0, r.b0)
    if (over < Math.max(200, Math.min(A.len, B.len) * 0.5)) continue
    cands.push({ i, j, t, over, lo, hi, b0: r.b0, b1: r.b1, t1: r.t1, t2: r.t2, dmid: (jlo + jhi) / 2 - (A.lo + A.hi) / 2 })
  }
  cands.sort((a, b) => a.t - b.t || b.over - a.over)
  const walls: WallP[] = []
  // B 의 자기 축 값 ↔ A 축 값
  const toA = (c: { t1: number; t2: number }, len: number, s: number) => c.t1 + ((c.t2 - c.t1) * s) / len
  const fromA = (c: { t1: number; t2: number }, len: number, t: number) => ((t - c.t1) / (c.t2 - c.t1)) * len
  const markUsed = (k: number, c: { t1: number; t2: number }, f0: number, f1: number) => { const a = fromA(c, bands[k].len, f0), b = fromA(c, bands[k].len, f1); bands[k].used.push([Math.min(a, b), Math.max(a, b)]) }
  let paired = 0
  for (const p of cands) {
    const A = bands[p.i], B = bands[p.j]
    const p0 = Math.max(0, p.b0), p1 = Math.min(A.len, p.b1)
    // 가운데 선: 이 짝의 한쪽이 다른 두 면의 한가운데에 있으면 바깥 두 면을 짝으로 쓴다
    const tol = Math.max(8, Math.abs(p.dmid) * 0.12), amid = (A.lo + A.hi) / 2
    const middle = near[p.i].some(q => q.k !== p.j && Math.min(q.b1, p1) - Math.max(q.b0, p0) >= (p1 - p0) * 0.5 && (Math.abs(q.mid - amid + p.dmid) <= tol || Math.abs(q.mid - amid - 2 * p.dmid) <= tol) && Math.abs(q.mid - amid) <= 470)
    if (middle) continue
    const usedB = B.used.map(([a, b]): Span => { const x = toA(p, B.len, a), y = toA(p, B.len, b); return [Math.min(x, y), Math.max(x, y)] })
    const free = freeParts(p0, p1, [...A.used, ...usedB]).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]
    if (!free || free[1] - free[0] < Math.min(200, (p1 - p0) * 0.9)) continue
    const [f0, f1] = free
    A.used.push([f0, f1]); markUsed(p.j, p, f0, f1)
    const start = f0 === p0 && Math.abs(p.b0) <= p.t * 1.5 ? p.b0 / 2 : f0
    const end = f1 === p1 && Math.abs(A.len - p.b1) <= p.t * 1.5 ? (A.len + p.b1) / 2 : f1
    const nA = -A.uy * A.ax + A.ux * A.ay, sA = A.ux * A.ax + A.uy * A.ay
    walls.push({ ux: A.ux, uy: A.uy, c: nA + (p.lo + p.hi) / 2, s0: sA + start, s1: sA + end, t: Math.round(p.t), kind: A.kind })
    paired++
    // 두 면 사이에 든 선(가운데 선 · 보드 선)은 이 벽에 넣는다
    for (const q of near[p.i]) if (q.k !== p.j && q.mid > p.lo + 4 && q.mid < p.hi - 4 && Math.min(q.b1, f1) > Math.max(q.b0, f0)) markUsed(q.k, q, Math.max(q.b0, f0), Math.min(q.b1, f1))
  }
  // 3) 짝 없는 면: 500mm 이상 남은 곳만 한 줄 벽 (짧은 것은 벽 끝 마구리 · 문틀이 대부분)
  let single = 0
  for (const b of bands) {
    const parts = freeParts(0, b.len, b.used)
    const nB = -b.uy * b.ax + b.ux * b.ay, sB = b.ux * b.ax + b.uy * b.ay
    let made = false
    for (const [f0, f1] of parts) {
      if (f1 - f0 < 500) continue
      const w = b.hi - b.lo
      walls.push({ ux: b.ux, uy: b.uy, c: nB + (b.lo + b.hi) / 2, s0: sB + f0, s1: sB + f1, t: w >= 5 ? Math.round(Math.max(w, 10)) : (o.thickness ?? 100), kind: b.kind })
      single++; made = true
    }
    if (!made && !b.used.length) dropped += b.members
  }
  // 4) 다른 벽 몸통 안에 절반 넘게 든 벽은 겹친 것 — 짧은 쪽을 뺀다 (사각 기둥 · 두 번 그린 선)
  const inside = (a: WallP, b: WallP) => {
    const pa = ptOf(a, a.s0), pb = ptOf(a, a.s1)
    const al = (p: { x: number; y: number }) => p.x * b.ux + p.y * b.uy, pe = (p: { x: number; y: number }) => -p.x * b.uy + p.y * b.ux - b.c
    let lo = 0, hi = 1
    const clip = (v0: number, v1: number, min: number, max: number) => { // v(λ) = v0 + (v1 - v0) λ ∈ [min, max]
      const dv = v1 - v0
      if (Math.abs(dv) < 1e-9) { if (v0 < min || v0 > max) hi = -1; return }
      let l0 = (min - v0) / dv, l1 = (max - v0) / dv
      if (l0 > l1) [l0, l1] = [l1, l0]
      lo = Math.max(lo, l0); hi = Math.min(hi, l1)
    }
    clip(al(pa), al(pb), b.s0, b.s1); clip(pe(pa), pe(pb), -b.t / 2 - 1, b.t / 2 + 1)
    return Math.max(0, hi - lo)
  }
  const gone = new Set<number>()
  const box = walls.map(w => { const p = ptOf(w, w.s0), q = ptOf(w, w.s1), r = w.t / 2 + 2; return [Math.min(p.x, q.x) - r, Math.min(p.y, q.y) - r, Math.max(p.x, q.x) + r, Math.max(p.y, q.y) + r] })
  for (let i = 0; i < walls.length; i++) for (let j = 0; j < walls.length; j++) {
    if (i === j || gone.has(j) || gone.has(i)) continue
    const A = box[i], B = box[j]
    if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) continue
    const a = walls[i], b = walls[j], la = a.s1 - a.s0, lb = b.s1 - b.s0
    if (la > lb || (la === lb && i < j)) continue
    if (inside(a, b) >= 0.5) gone.add(i)
  }
  let list = walls.filter((_, i) => !gone.has(i))
  // 5) 같은 선 위 두께가 같은 조각은 2,400mm 까지의 빈칸을 건너 잇는다. 300mm 넘는 빈칸은 문(유리 · 창 선이 있으면 창)
  const glaz = d.segments.filter(s => GLAZ_LAYER.test(s.layer) && !want.has(s.layer)).map(s => ({ x: ((s.x1 + s.x2) / 2) * sc, y: ((s.y1 + s.y2) / 2) * sc }))
  type Run = WallP & { gaps: { g0: number; g1: number; kind: 'door' | 'window' }[] }
  const runs: Run[] = []
  const seen = new Set<number>()
  for (let i = 0; i < list.length; i++) {
    if (seen.has(i)) continue
    const a = list[i], line: Run[] = []
    for (let j = i; j < list.length; j++) {
      const b = list[j]
      if (seen.has(j) || b.kind !== a.kind || Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.01 || Math.abs(b.t - a.t) > Math.max(2, a.t * 0.05)) continue
      const same = a.ux * b.ux + a.uy * b.uy > 0, c = same ? b.c : -b.c
      if (Math.abs(c - a.c) > Math.max(10, a.t * 0.15)) continue
      const s0 = same ? b.s0 : -b.s1, s1 = same ? b.s1 : -b.s0
      seen.add(j); line.push({ ...a, c: (a.c + c) / 2, s0, s1, t: b.t, gaps: [] })
    }
    line.sort((x, y) => x.s0 - y.s0)
    let cur: Run | null = null
    for (const p of line) {
      if (cur && p.s0 - cur.s1 <= 2400) {
        const g = p.s0 - cur.s1
        if (g >= 300) {
          const g0 = cur.s1, g1 = p.s0, cc = cur.c, t = cur.t
          const win = glaz.some(q => { const s = q.x * a.ux + q.y * a.uy, n = -q.x * a.uy + q.y * a.ux; return s > g0 - 50 && s < g1 + 50 && Math.abs(n - cc) <= t / 2 + 60 })
          cur.gaps.push({ g0, g1, kind: win ? 'window' : 'door' })
        }
        cur.s1 = Math.max(cur.s1, p.s1)
        continue
      }
      if (cur) runs.push(cur)
      cur = { ...p, gaps: [] }
    }
    if (cur) runs.push(cur)
  }
  // 6) 끝 맞추기: 가까운 벽의 가운데 선과 만나는 점으로 (ㄱ자 모서리는 두 벽 끝을 같이, T 자는 붙는 벽 끝만)
  for (let pass = 0; pass < 2; pass++) for (const w of runs) for (const endKey of ['s0', 's1'] as const) {
    let best: { s: number; d: number; v: Run; vs: number; vEnd: 's0' | 's1' | null } | null = null
    for (const v of runs) {
      if (v === w) continue
      const cross = w.ux * v.uy - w.uy * v.ux
      if (Math.abs(cross) < 0.2) continue
      // 두 가운데 선의 만나는 점
      const p = ptOf(w, w[endKey]), q = ptOf(v, v.s0)
      const t = ((q.x - p.x) * v.uy - (q.y - p.y) * v.ux) / cross
      const x = { x: p.x + w.ux * t, y: p.y + w.uy * t }
      const tol = Math.max(w.t, v.t) * 0.75 + 40
      if (Math.abs(t) > tol) continue
      const vs = x.x * v.ux + x.y * v.uy
      if (vs < v.s0 - tol || vs > v.s1 + tol) continue
      const vEnd = Math.abs(vs - v.s0) <= tol ? 's0' : Math.abs(vs - v.s1) <= tol ? 's1' : null
      if (!best || Math.abs(t) < best.d) best = { s: w[endKey] + t, d: Math.abs(t), v, vs, vEnd }
    }
    if (!best) continue
    const other = endKey === 's0' ? w.s1 : w.s0
    if (endKey === 's0' ? best.s >= other - 50 : best.s <= other + 50) continue
    w[endKey] = best.s
    if (best.vEnd) best.v[best.vEnd] = best.vs
  }
  // 7) 좌표: 도면 그대로. 원점에서 200m 넘게 떨어진 도면만 도면 전체(모든 레이어)의 왼쪽 위 모서리를 1m 단위로 뺀다
  const b = d.bounds
  const far = b ? Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.y0), Math.abs(b.y1)) * sc > 200000 : false
  const shift = far && b ? { x: Math.floor((b.x0 * sc) / 1000) * 1000, y: Math.floor((b.y0 * sc) / 1000) * 1000 } : { x: 0, y: 0 }
  // 끝점 붙이기: 2mm 안의 끝점은 한 점으로 (닫힌 방을 찾을 때 좌표가 정확히 같아야 함)
  const pts = new Map<string, { x: number; y: number }>()
  const weld = (p: { x: number; y: number }) => {
    const x = Math.round(p.x - shift.x) || 0, y = Math.round(p.y - shift.y) || 0
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const hit = pts.get(`${x + dx},${y + dy}`); if (hit) return hit }
    const q = { x, y }; pts.set(`${x},${y}`, q); return q
  }
  const out: PlanWall[] = [], openings: PlanOpening[] = []
  const tag = Math.random().toString(36).slice(2, 6)
  runs.forEach((w, i) => {
    const a = weld(ptOf(w, w.s0)), e = weld(ptOf(w, w.s1)), len = Math.hypot(e.x - a.x, e.y - a.y)
    if (len < 100) return
    const id = `dx${i.toString(36)}${tag}`
    out.push({ id, x1: a.x, y1: a.y, x2: e.x, y2: e.y, t: Math.max(10, w.t), kind: w.kind })
    w.gaps.forEach((g, k) => {
      const from = Math.max(0, g.g0 - w.s0), to = Math.min(len, g.g1 - w.s0)
      if (to - from >= 300) openings.push({ id: `${id}o${k}`, wall: id, pos: Math.round((from + to) / 2), width: Math.round(to - from), kind: g.kind })
    })
  })
  return { walls: out, openings, paired, single, dropped, truncated, shift }
}

/** 캐드 글: 줄바꿈 · 제어 문자는 띄어쓰기로, 한글 등은 UTF-16 한 단위마다 \U+XXXX */
const uni = (s: string) => {
  let out = ''
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out += c < 32 || c === 127 ? ' ' : c < 128 ? s[i] : `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}` }
  return out
}
const num = (n: number) => (Math.round(n * 1000) / 1000).toString()
const finite = (...v: number[]) => v.every(Number.isFinite)

/** 평면 → DXF (R12 · mm · y 위쪽). 벽 · 문 · 창 · 집기 · 치수 글을 레이어로 나눠 캐드와 스케치업(Pro)에서 연다 */
export function planToDxf(g: PlanGeometry): string {
  const out: string[] = []
  const p = (...v: (string | number)[]) => { for (let i = 0; i < v.length; i += 2) out.push(String(v[i]), typeof v[i + 1] === 'number' ? num(v[i + 1] as number) : String(v[i + 1])) }
  const LAYERS: [string, number][] = [['A-WALL', 7], ['A-WALL-NEW', 5], ['A-DOOR', 3], ['A-GLAZ', 4], ['A-FURN', 30], ['A-ANNO-DIMS', 8]]
  p(999, DXF_MM_MARK)
  p(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC')
  p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB')
  p(0, 'TABLE', 2, 'LAYER', 70, LAYERS.length)
  for (const [name, color] of LAYERS) p(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS')
  // 한글이 나오는 트루타입 글꼴 (캐드 기본 STANDARD 는 한글이 없는 글꼴인 경우가 많다)
  p(0, 'ENDTAB', 0, 'TABLE', 2, 'STYLE', 70, 1, 0, 'STYLE', 2, 'WKLY', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 100, 3, 'malgun.ttf', 4, '', 0, 'ENDTAB')
  p(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  const line = (layer: string, a: Pt, b: Pt) => { if (finite(a.x, a.y, b.x, b.y)) p(0, 'LINE', 8, layer, 10, a.x, 20, -a.y, 30, 0, 11, b.x, 21, -b.y, 31, 0) }
  const loop = (layer: string, pts: Pt[]) => pts.forEach((a, i) => line(layer, a, pts[(i + 1) % pts.length]))
  const text = (layer: string, at: Pt, h: number, s: string) => { if (finite(at.x, at.y, h)) p(0, 'TEXT', 8, layer, 10, at.x, 20, -at.y, 30, 0, 40, h, 1, uni(s), 7, 'WKLY') }
  for (const w of g.walls) {
    const layer = w.kind === 'new' ? 'A-WALL-NEW' : 'A-WALL'
    for (const s of wallSolids(w, g.openings)) loop(layer, pieceCorners(w, s.from, s.to))
    const f = wallFrame(w)
    text('A-ANNO-DIMS', along(w, f, f.len / 2, w.t / 2 + 250), 120, Math.round(f.len).toString())
  }
  for (const o of g.openings) {
    const w = g.walls.find(x => x.id === o.wall)
    if (!w) continue
    const f = wallFrame(w)
    const from = Math.max(0, o.pos - o.width / 2), to = Math.min(f.len, o.pos + o.width / 2)
    if (o.kind === 'window') { for (const off of [w.t / 2, 0, -w.t / 2]) line('A-GLAZ', along(w, f, from, off), along(w, f, to, off)); continue }
    const d = doorSymbol(w, o)
    if (!d.leaves.length) { line('A-DOOR', along(w, f, from, w.t / 4), along(w, f, (from + to) / 2 + 50, w.t / 4)); line('A-DOOR', along(w, f, (from + to) / 2 - 50, -w.t / 4), along(w, f, to, -w.t / 4)) }
    for (const l of d.leaves) {
      line('A-DOOR', l.hinge, l.tip)
      // 호: DXF 는 반시계 방향 · y 위쪽
      const a1 = (Math.atan2(-(l.shut.y - l.hinge.y), l.shut.x - l.hinge.x) * 180) / Math.PI, a2 = (Math.atan2(-(l.tip.y - l.hinge.y), l.tip.x - l.hinge.x) * 180) / Math.PI
      const ccw = ((a2 - a1) % 360 + 360) % 360 <= 180
      if (finite(l.hinge.x, l.hinge.y, l.r, a1, a2)) p(0, 'ARC', 8, 'A-DOOR', 10, l.hinge.x, 20, -l.hinge.y, 30, 0, 40, l.r, 50, ccw ? a1 : a2, 51, ccw ? a2 : a1)
    }
  }
  for (const it of g.items) {
    const w = it.rot === 90 ? it.d : it.w, d = it.rot === 90 ? it.w : it.d
    if (!finite(it.x, it.y, w, d) || w <= 0 || d <= 0) continue
    loop('A-FURN', [{ x: it.x, y: it.y }, { x: it.x + w, y: it.y }, { x: it.x + w, y: it.y + d }, { x: it.x, y: it.y + d }])
    if (it.name.trim()) text('A-FURN', { x: it.x + 60, y: it.y + d - 60 }, 100, it.name.trim())
  }
  p(0, 'ENDSEC', 0, 'EOF')
  return out.join('\r\n') + '\r\n'
}
