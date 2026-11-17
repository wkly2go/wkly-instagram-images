// 평면을 도면처럼 그리기 위한 계산 (2026-11-17 '평면을 더욱 현실에 맞게')
// 문 열림 호 · 창 기호 · 바깥 치수선 · 축척 막대 · 벽 모서리 끌기. 화면(SVG)과 DXF 내보내기가 같은 값을 쓴다.
import { closedShell, floorOutline, wallLength, type PlanGeometry, type PlanOpening, type PlanWall } from './designPlan.ts'

export interface Pt { x: number; y: number }
export interface WallFrame { len: number; ux: number; uy: number; /** 벽 진행 방향의 왼쪽 (화면 좌표 · y 아래) */ nx: number; ny: number }
export function wallFrame(w: PlanWall): WallFrame {
  const len = wallLength(w) || 1
  const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
  return { len, ux, uy, nx: uy, ny: -ux }
}
export const along = (w: PlanWall, f: WallFrame, d: number, off = 0): Pt => ({ x: w.x1 + f.ux * d + f.nx * off, y: w.y1 + f.uy * d + f.ny * off })

/** 벽 몸통 네 꼭짓점 (두께만큼의 사각형) */
export function wallBody(w: PlanWall, minT = 0): Pt[] {
  const f = wallFrame(w), h = Math.max(w.t, minT) / 2
  return [along(w, f, 0, h), along(w, f, f.len, h), along(w, f, f.len, -h), along(w, f, 0, -h)]
}

export type DoorStyle = 'swing' | 'double' | 'slide' | 'glass'
export const doorStyle = (o: PlanOpening): DoorStyle => (/양개|양문|double/i.test(o.type ?? '') ? 'double' : /미닫이|슬라이딩|slid/i.test(o.type ?? '') ? 'slide' : /유리|glass/i.test(o.type ?? '') ? 'glass' : 'swing')

export interface DoorSymbol { style: DoorStyle; a: Pt; b: Pt; /** 문짝 선 (경첩 → 문 끝) */ leaves: { hinge: Pt; tip: Pt; /** 닫힌 자리의 끝 */ shut: Pt; r: number; sweep: 0 | 1 }[] }
/** 문 기호: 벽을 끊은 자리(a~b), 문짝 선, 열림 호. 여닫이는 90° 열린 모습 */
export function doorSymbol(w: PlanWall, o: PlanOpening): DoorSymbol {
  const f = wallFrame(w)
  const from = Math.max(0, o.pos - o.width / 2), to = Math.min(f.len, o.pos + o.width / 2)
  const a = along(w, f, from), b = along(w, f, to)
  const side = o.side === -1 ? -1 : 1
  const style = doorStyle(o)
  const leaf = (hingeAt: number, shutAt: number) => {
    const r = Math.abs(shutAt - hingeAt)
    const hinge = along(w, f, hingeAt), shut = along(w, f, shutAt)
    const tip = along(w, f, hingeAt, r * side)
    // 화면 좌표(y 아래)에서 닫힌 자리 → 열린 자리로 도는 방향
    const cross = (shut.x - hinge.x) * (tip.y - hinge.y) - (shut.y - hinge.y) * (tip.x - hinge.x)
    return { hinge, tip, shut, r, sweep: (cross > 0 ? 1 : 0) as 0 | 1 }
  }
  if (style === 'slide') return { style, a, b, leaves: [] }
  if (style === 'double') { const mid = (from + to) / 2; return { style, a, b, leaves: [leaf(from, mid), leaf(to, mid)] } }
  return { style, a, b, leaves: [o.hinge === 'end' ? leaf(to, from) : leaf(from, to)] }
}
export const arcPath = (l: DoorSymbol['leaves'][number]) => `M${l.shut.x} ${l.shut.y}A${l.r} ${l.r} 0 0 ${l.sweep} ${l.tip.x} ${l.tip.y}`

/** 닫힌 평면이면 바깥쪽이 어느 쪽인지(왼쪽 1 · 오른쪽 -1). 닫히지 않았으면 왼쪽 */
export function outwardSides(g: Pick<PlanGeometry, 'walls'>): Map<string, 1 | -1> {
  const out = new Map<string, 1 | -1>()
  // 닫힌 방 규칙은 평면 · 3D · 스케치업이 같이 쓴다 (designPlan closedShell: 떠 있는 벽 · 안쪽 칸막이는 빼고 본다)
  const pts = floorOutline(closedShell(g.walls.filter(w => w.kind === 'existing')) ?? [])
  let cx = 0, cy = 0
  if (pts) { for (const p of pts) { cx += p.x; cy += p.y } cx /= pts.length; cy /= pts.length }
  for (const w of g.walls) {
    if (!pts || w.kind !== 'existing') { out.set(w.id, 1); continue }
    const f = wallFrame(w), mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
    out.set(w.id, (mx - cx) * f.nx + (my - cy) * f.ny >= 0 ? 1 : -1)
  }
  return out
}

export interface DimLine { a: Pt; b: Pt; ea: Pt; eb: Pt; label: Pt; text: string; angle: number }
/** 벽 하나의 치수선: 벽에서 off 만큼 띄운 선, 양 끝 보조선, 가운데 글 자리. 글은 뒤집히지 않게 돌린다 */
export function dimLine(w: PlanWall, off: number, side: 1 | -1, textGap: number): DimLine {
  const f = wallFrame(w)
  const d = (w.t / 2 + off) * side
  const a = along(w, f, 0, d), b = along(w, f, f.len, d)
  let angle = (Math.atan2(f.uy, f.ux) * 180) / Math.PI
  if (angle > 90 || angle <= -90) angle += 180
  return { a, b, ea: along(w, f, 0, (w.t / 2) * side), eb: along(w, f, f.len, (w.t / 2) * side), label: along(w, f, f.len / 2, d + textGap * side), text: Math.round(wallLength(w)).toLocaleString('ko-KR'), angle }
}

/** 화면 폭에 맞는 축척 막대 길이(mm): 폭의 15~25% 안에서 1 · 2 · 5 단위 */
export function scaleBarLength(viewW: number): number {
  const target = viewW * 0.2
  const pow = 10 ** Math.floor(Math.log10(target))
  const n = target / pow
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow
}

/** 벽 모서리를 옮긴다: 같은 자리에 끝이 닿은 벽을 모두 함께 (방이 벌어지지 않게) */
export function moveCorner(walls: PlanWall[], from: Pt, to: Pt): PlanWall[] {
  const same = (x: number, y: number) => Math.abs(x - from.x) < 1 && Math.abs(y - from.y) < 1
  return walls.map(w => ({ ...w, ...(same(w.x1, w.y1) ? { x1: to.x, y1: to.y } : {}), ...(same(w.x2, w.y2) ? { x2: to.x, y2: to.y } : {}) }))
}
/** 벽 길이를 숫자로 맞춘다: 시작점은 두고 끝점을 방향대로 옮기며, 그 끝에 닿은 다른 벽도 함께 */
export function setWallLength(walls: PlanWall[], id: string, length: number): PlanWall[] {
  const w = walls.find(x => x.id === id)
  // 길이가 없는 벽은 방향을 알 수 없다 → 바꾸지 않는다
  if (!w || !(length >= MIN_WALL) || wallLength(w) < MIN_WALL) return walls
  const f = wallFrame(w)
  return moveCorner(walls, { x: w.x2, y: w.y2 }, { x: Math.round(w.x1 + f.ux * length), y: Math.round(w.y1 + f.uy * length) })
}

/** 이보다 짧은 벽(mm)은 벽으로 보지 않는다: 모서리를 맞은편 끝에 겹쳐 길이가 없어진 벽 */
export const MIN_WALL = 10
/** 문 · 창을 벽 안에 앉힌다: 가운데를 [폭/2, 길이 - 폭/2] 안으로. 벽이 폭보다 짧으면 null (맞지 않음) */
export function seatOpening(pos: number, width: number, len: number): { pos: number; width: number } | null {
  if (!(len >= MIN_WALL) || !(width > 0) || width > len + 0.5) return null
  const w = Math.min(width, len)
  return { width: w, pos: Math.round(Math.min(len - w / 2, Math.max(w / 2, pos))) }
}
/** 같은 벽의 다른 문 · 창과 겹치는지 (새로 낼 때 · 옮길 때) */
export function openingOverlaps(openings: PlanOpening[], wall: string, pos: number, width: number, except?: string): PlanOpening | null {
  return openings.find(o => o.wall === wall && o.id !== except && Math.abs(o.pos - pos) < (o.width + width) / 2 - 0.5) ?? null
}
/** 벽 모양을 바꾼 뒤(모서리 끌기 · 길이 입력): 그 벽의 문 · 창을 평면 위 같은 자리에 다시 앉히고(벽 안으로 맞춤), 벽보다 넓어 맞지 않는 것은 뺀다.
 *  길이가 없어진 벽(MIN_WALL 미만)도 그 문 · 창과 함께 뺀다. 모양이 그대로인 벽의 문 · 창은 건드리지 않는다. 바뀐 것이 없으면 g 를 그대로 돌려준다 */
export function reseatOpenings(g: PlanGeometry, before: PlanWall[]): { plan: PlanGeometry; dropped: number; collapsed: number } {
  const old = new Map(before.map(w => [w.id, w]))
  const gone = new Set(g.walls.filter(w => wallLength(w) < MIN_WALL).map(w => w.id))
  let dropped = 0, changed = gone.size > 0
  const openings: PlanOpening[] = []
  for (const o of g.openings) {
    if (gone.has(o.wall)) { dropped++; continue }
    const w = g.walls.find(x => x.id === o.wall), b = old.get(o.wall)
    if (!w || !b || (b.x1 === w.x1 && b.y1 === w.y1 && b.x2 === w.x2 && b.y2 === w.y2)) { openings.push(o); continue }
    const fb = wallFrame(b), f = wallFrame(w)
    // 바꾸기 전 평면 위의 자리를 새 벽에 내린 거리 (시작점을 옮겨도 문은 제자리에 남는다)
    const cx = b.x1 + fb.ux * o.pos, cy = b.y1 + fb.uy * o.pos
    const at = seatOpening((cx - w.x1) * f.ux + (cy - w.y1) * f.uy, o.width, f.len)
    if (!at) { dropped++; changed = true; continue }
    if (at.pos !== o.pos || at.width !== o.width) { changed = true; openings.push({ ...o, pos: at.pos, width: at.width }) } else openings.push(o)
  }
  if (!changed) return { plan: g, dropped: 0, collapsed: 0 }
  return { plan: { ...g, walls: gone.size ? g.walls.filter(w => !gone.has(w.id)) : g.walls, openings }, dropped, collapsed: gone.size }
}

/** 그려진 것 전체의 범위 */
export function planBounds(g: PlanGeometry): { x0: number; y0: number; x1: number; y1: number } | null {
  const xs = [...g.walls.flatMap(w => [w.x1, w.x2]), ...g.items.flatMap(i => [i.x, i.x + (i.rot === 90 ? i.d : i.w)])]
  const ys = [...g.walls.flatMap(w => [w.y1, w.y2]), ...g.items.flatMap(i => [i.y, i.y + (i.rot === 90 ? i.w : i.d)])]
  return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null
}

export interface WallPiece { from: number; to: number; z0: number; z1: number }
export const DOOR_H = 2100, SILL_H = 900, HEAD_H = 2100
/** 벽을 문 · 창 자리에서 끊은 조각 (mm). 문 위 · 창 위아래는 채운다. 3D 와 스케치업 내보내기가 같이 쓴다 */
export function wallPieces(w: PlanWall, openings: PlanOpening[], H: number): WallPiece[] {
  const len = wallLength(w)
  if (!(len > 0) || !(H > 0)) return []
  const out: WallPiece[] = []
  let cur = 0
  for (const o of openings.filter(x => x.wall === w.id).sort((a, b) => a.pos - b.pos)) {
    const a = Math.max(cur, Math.max(0, o.pos - o.width / 2)), b = Math.min(len, o.pos + o.width / 2)
    if (b <= a) continue
    if (a > cur) out.push({ from: cur, to: a, z0: 0, z1: H })
    const top = Math.min(o.kind === 'door' ? o.height || DOOR_H : HEAD_H, H)
    if (o.kind === 'window') out.push({ from: a, to: b, z0: 0, z1: Math.min(SILL_H, H) })
    if (top < H) out.push({ from: a, to: b, z0: top, z1: H })
    cur = b
  }
  if (cur < len) out.push({ from: cur, to: len, z0: 0, z1: H })
  return out.filter(p => p.to - p.from > 1 && p.z1 - p.z0 > 1)
}
/** 평면에서 벽이 꽉 찬 구간 (문 · 창 자리 제외) */
export const wallSolids = (w: PlanWall, openings: PlanOpening[]): { from: number; to: number }[] => wallPieces(w, openings, 1e6).filter(p => p.z0 === 0 && p.z1 === 1e6).map(p => ({ from: p.from, to: p.to }))
/** 조각의 바닥 네 꼭짓점 */
export function pieceCorners(w: PlanWall, from: number, to: number, minT = 0): Pt[] {
  const f = wallFrame(w), h = Math.max(w.t, minT) / 2
  return [along(w, f, from, h), along(w, f, to, h), along(w, f, to, -h), along(w, f, from, -h)]
}
