// 캐드 활용 (2026-11-17 대표 지시 '캐드와 스케치업을 활용 가능하게')
// DXF(캐드 교환 형식) 읽기 → 평면의 벽으로, 평면 → DXF 내보내기. 브라우저 안에서만 계산하고 외부 도구 · 비용이 없다.
// DWG 는 캐드에서 '다른 이름으로 저장 › DXF' 로 바꿔 올린다 (DWG 를 직접 읽는 무료 도구는 라이선스 확인 뒤 작업 처리기에 붙인다).
import type { PlanGeometry, PlanWall } from './designPlan.ts'
import { doorSymbol, pieceCorners, wallFrame, wallSolids, along, type Pt } from './designPlanDraw.ts'

export interface DxfSegment { layer: string; x1: number; y1: number; x2: number; y2: number }
export interface DxfDrawing {
  segments: DxfSegment[]
  layers: { name: string; count: number; length: number }[]
  /** $INSUNITS (1 인치 · 2 피트 · 4 mm · 5 cm · 6 m) — 없으면 null */
  units: number | null
  /** 읽지 않은 요소 수 (호 · 블록 · 글 등) */
  skipped: Record<string, number>
  bounds: { x0: number; y0: number; x1: number; y1: number } | null
}

/** DXF 글 → 선분. LINE · LWPOLYLINE · POLYLINE 만 읽는다 (호는 문 표시가 대부분이라 읽지 않음). y 는 화면 방향(아래로)으로 뒤집는다 */
export function parseDxf(text: string): DxfDrawing {
  const lines = text.split(/\r\n|\r|\n/)
  const segments: DxfSegment[] = []
  const skipped: Record<string, number> = {}
  let units: number | null = null
  let section = ''
  let type = ''
  let layer = '0'
  let pts: Pt[] = []
  let closed = false
  let line = { x1: NaN, y1: NaN, x2: NaN, y2: NaN }
  let poly: { layer: string; closed: boolean; pts: Pt[] } | null = null // POLYLINE … VERTEX … SEQEND
  let wantSection = false
  let headerVar = ''
  const push = (l: string, a: Pt, b: Pt) => { if (Number.isFinite(a.x + a.y + b.x + b.y) && (a.x !== b.x || a.y !== b.y)) segments.push({ layer: l, x1: a.x, y1: -a.y, x2: b.x, y2: -b.y }) }
  const chain = (l: string, p: Pt[], c: boolean) => { for (let i = 0; i + 1 < p.length; i++) push(l, p[i], p[i + 1]); if (c && p.length > 2) push(l, p[p.length - 1], p[0]) }
  const flush = () => {
    if (section !== 'ENTITIES' || !type) return
    if (type === 'LINE') push(layer, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 })
    else if (type === 'LWPOLYLINE') chain(layer, pts, closed)
    else if (type === 'POLYLINE') poly = { layer, closed, pts: [] }
    else if (type === 'VERTEX') { if (poly && pts.length) poly.pts.push(pts[0]) }
    else if (type === 'SEQEND') { if (poly) chain(poly.layer, poly.pts, poly.closed); poly = null }
    else skipped[type] = (skipped[type] ?? 0) + 1
  }
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    const value = lines[i + 1].trim()
    if (code === 0) {
      flush()
      type = ''; layer = '0'; pts = []; closed = false; line = { x1: NaN, y1: NaN, x2: NaN, y2: NaN }
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
    if (code === 8) layer = value || '0'
    else if (code === 70) closed = (Number(value) & 1) === 1
    else if (type === 'LINE') { if (code === 10) line.x1 = n; else if (code === 20) line.y1 = n; else if (code === 11) line.x2 = n; else if (code === 21) line.y2 = n }
    else if (type === 'LWPOLYLINE' || type === 'VERTEX') { if (code === 10) pts.push({ x: n, y: NaN }); else if (code === 20 && pts.length) pts[pts.length - 1].y = n }
  }
  flush()
  const by = new Map<string, { name: string; count: number; length: number }>()
  let b: DxfDrawing['bounds'] = null
  for (const s of segments) {
    const l = by.get(s.layer) ?? { name: s.layer, count: 0, length: 0 }
    l.count++; l.length += Math.hypot(s.x2 - s.x1, s.y2 - s.y1); by.set(s.layer, l)
    b = b ? { x0: Math.min(b.x0, s.x1, s.x2), y0: Math.min(b.y0, s.y1, s.y2), x1: Math.max(b.x1, s.x1, s.x2), y1: Math.max(b.y1, s.y1, s.y2) } : { x0: Math.min(s.x1, s.x2), y0: Math.min(s.y1, s.y2), x1: Math.max(s.x1, s.x2), y1: Math.max(s.y1, s.y2) }
  }
  return { segments, layers: [...by.values()].sort((a, c) => c.length - a.length), units, skipped, bounds: b }
}

/** 도면 단위 → mm 배율. 단위가 적혀 있지 않으면 전체 크기로 짐작한다(guessed) — 화면에서 확인받는다 */
export function dxfScale(d: Pick<DxfDrawing, 'units' | 'bounds'>): { scale: number; guessed: boolean } {
  const known: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }
  if (d.units != null && known[d.units]) return { scale: known[d.units], guessed: false }
  const size = d.bounds ? Math.max(d.bounds.x1 - d.bounds.x0, d.bounds.y1 - d.bounds.y0) : 0
  return { scale: size > 0 && size <= 200 ? 1000 : size <= 3000 ? 10 : 1, guessed: true }
}
/** 벽으로 보이는 레이어 이름 (기본 선택용) */
export const isWallLayer = (name: string) => /wall|벽|a-wall|wal\b|조적|경량|구조|str/i.test(name)

interface Seg { ux: number; uy: number; c: number; s0: number; s1: number; len: number }
const toSeg = (x1: number, y1: number, x2: number, y2: number): Seg => {
  let ux = x2 - x1, uy = y2 - y1
  const len = Math.hypot(ux, uy)
  ux /= len; uy /= len
  if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy }
  const nx = -uy, ny = ux
  const a = x1 * ux + y1 * uy, b = x2 * ux + y2 * uy
  return { ux, uy, c: x1 * nx + y1 * ny, s0: Math.min(a, b), s1: Math.max(a, b), len }
}
const fromSeg = (s: Pick<Seg, 'ux' | 'uy' | 'c'>, a: number, b: number) => { const nx = -s.uy, ny = s.ux; return { x1: s.ux * a + nx * s.c, y1: s.uy * a + ny * s.c, x2: s.ux * b + nx * s.c, y2: s.uy * b + ny * s.c } }

export interface DxfWallOptions { layers: string[]; scale: number; /** 짝을 못 찾은 선의 벽 두께 mm */ thickness?: number; kind?: PlanWall['kind']; /** 벽의 두 면(겹선)을 한 벽으로 묶을지 */ pair?: boolean }
/** 고른 레이어의 선 → 벽. 캐드 도면은 벽을 두 줄(양쪽 면)로 그리므로, 나란하고 가까운(40~450mm) 두 선은 가운데 선 하나와 두께로 묶는다 */
export function dxfToWalls(d: DxfDrawing, o: DxfWallOptions): { walls: PlanWall[]; paired: number; single: number; dropped: number } {
  const want = new Set(o.layers)
  const raw = d.segments.filter(s => want.has(s.layer)).map(s => toSeg(s.x1 * o.scale, s.y1 * o.scale, s.x2 * o.scale, s.y2 * o.scale))
  const segs = raw.filter(s => s.len >= 100).slice(0, 6000)
  const dropped = raw.length - segs.length
  const used = new Array<boolean>(segs.length).fill(false)
  const lines: { s: Pick<Seg, 'ux' | 'uy' | 'c'>; a: number; b: number; t: number }[] = []
  let paired = 0
  if (o.pair !== false) {
    const order = segs.map((_, i) => i).sort((a, b) => segs[a].len - segs[b].len)
    const done = new Set<string>()
    for (const i of order) {
      const A = segs[i]
      let best = -1, bestScore = 0
      for (let j = 0; j < segs.length; j++) {
        if (j === i) continue
        const B = segs[j]
        if (Math.abs(A.ux * B.uy - A.uy * B.ux) > 0.02) continue
        const gap = Math.abs(A.c - B.c)
        if (gap < 40 || gap > 450) continue
        const over = Math.min(A.s1, B.s1) - Math.max(A.s0, B.s0)
        if (over < Math.max(200, Math.min(A.len, B.len) * 0.5)) continue
        const score = over - gap
        if (best < 0 || score > bestScore) { best = j; bestScore = score }
      }
      if (best < 0) continue
      const key = i < best ? `${i}-${best}` : `${best}-${i}`
      used[i] = true; used[best] = true
      if (done.has(key)) continue
      done.add(key)
      const B = segs[best]
      // 양 끝이 벽 두께 안쪽으로 가까우면 두 면 끝의 가운데(모서리 중심), 아니면 겹친 구간만
      const gap = Math.abs(A.c - B.c)
      const a = Math.abs(A.s0 - B.s0) <= gap * 1.5 ? (A.s0 + B.s0) / 2 : Math.max(A.s0, B.s0)
      const b = Math.abs(A.s1 - B.s1) <= gap * 1.5 ? (A.s1 + B.s1) / 2 : Math.min(A.s1, B.s1)
      lines.push({ s: { ux: A.ux, uy: A.uy, c: (A.c + B.c) / 2 }, a, b, t: Math.round(gap) })
      paired++
    }
  }
  // 짝 없는 짧은 선(500mm 미만)은 벽 끝 마구리 · 문틀이 대부분이라 벽으로 만들지 않는다
  let single = 0, short = 0
  segs.forEach((s, i) => { if (used[i]) return; if (s.len < 500) { short++; return } lines.push({ s, a: s.s0, b: s.s1, t: o.thickness ?? 100 }); single++ })
  if (!lines.length) return { walls: [], paired, single, dropped: dropped + short }
  const pts = lines.map(l => fromSeg(l.s, l.a, l.b))
  const minX = Math.min(...pts.flatMap(p => [p.x1, p.x2])), minY = Math.min(...pts.flatMap(p => [p.y1, p.y2]))
  const walls = pts.map((p, i): PlanWall => ({ id: `dx${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`, x1: Math.round(p.x1 - minX), y1: Math.round(p.y1 - minY), x2: Math.round(p.x2 - minX), y2: Math.round(p.y2 - minY), t: lines[i].t, kind: o.kind ?? 'existing' }))
  return { walls: walls.filter(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 100), paired, single, dropped: dropped + short }
}

const uni = (s: string) => [...s].map(ch => (ch.charCodeAt(0) < 128 ? ch : `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)).join('')
const num = (n: number) => (Math.round(n * 1000) / 1000).toString()

/** 평면 → DXF (R12 · mm · y 위쪽). 벽 · 문 · 창 · 집기 · 치수 글을 레이어로 나눠 캐드와 스케치업(Pro)에서 연다 */
export function planToDxf(g: PlanGeometry): string {
  const out: string[] = []
  const p = (...v: (string | number)[]) => { for (let i = 0; i < v.length; i += 2) out.push(String(v[i]), typeof v[i + 1] === 'number' ? num(v[i + 1] as number) : String(v[i + 1])) }
  const LAYERS: [string, number][] = [['A-WALL', 7], ['A-WALL-NEW', 5], ['A-DOOR', 3], ['A-GLAZ', 4], ['A-FURN', 30], ['A-ANNO-DIMS', 8]]
  p(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC')
  p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB')
  p(0, 'TABLE', 2, 'LAYER', 70, LAYERS.length)
  for (const [name, color] of LAYERS) p(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS')
  p(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  const line = (layer: string, a: Pt, b: Pt) => p(0, 'LINE', 8, layer, 10, a.x, 20, -a.y, 30, 0, 11, b.x, 21, -b.y, 31, 0)
  const loop = (layer: string, pts: Pt[]) => pts.forEach((a, i) => line(layer, a, pts[(i + 1) % pts.length]))
  const text = (layer: string, at: Pt, h: number, s: string) => p(0, 'TEXT', 8, layer, 10, at.x, 20, -at.y, 30, 0, 40, h, 1, uni(s))
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
      p(0, 'ARC', 8, 'A-DOOR', 10, l.hinge.x, 20, -l.hinge.y, 30, 0, 40, l.r, 50, ccw ? a1 : a2, 51, ccw ? a2 : a1)
    }
  }
  for (const it of g.items) {
    const w = it.rot === 90 ? it.d : it.w, d = it.rot === 90 ? it.w : it.d
    loop('A-FURN', [{ x: it.x, y: it.y }, { x: it.x + w, y: it.y }, { x: it.x + w, y: it.y + d }, { x: it.x, y: it.y + d }])
    if (it.name.trim()) text('A-FURN', { x: it.x + 60, y: it.y + d - 60 }, 100, it.name.trim())
  }
  p(0, 'ENDSEC', 0, 'EOF')
  return out.join('\r\n') + '\r\n'
}
