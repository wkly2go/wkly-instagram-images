// Drawing set generated from the plan (mm). Follows the learned standard (knowledge: drawing_set / cad_standard):
// A3 sheets, numbering I-000 general · I-1xx plan series · I-14x elevations, title block fields, scale picked from a standard list.
// Pure data in / strings out so it can be tested without a browser.
import { wallLength, type PlanGeometry, type PlanItem, type PlanWall } from './designPlan.ts'

export const SCALES = [10, 20, 30, 40, 50, 60, 100, 150, 200, 300, 500]
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface SheetMeta { no: string; title: string; scale: string; kind: 'cover' | 'list' | 'finish' | 'plan' | 'ceiling' | 'furniture' | 'elevation' | 'wallDetail' | 'furnDetail'; wall?: string; /** table page (0-based) */ page?: number; /** wall thickness for a wall detail */ t?: number; /** PlanItem id for a furniture detail */ item?: string }
export const ROWS_PER_SHEET = 36
export interface FinishRow { trade: string; item: string; spec: string; qty: number; unit: string }

export function planBounds(g: PlanGeometry): Bounds | null {
  const xs = [...g.walls.flatMap(w => [w.x1, w.x2]), ...g.items.flatMap(i => [i.x, i.x + (i.rot === 90 ? i.d : i.w)])]
  const ys = [...g.walls.flatMap(w => [w.y1, w.y2]), ...g.items.flatMap(i => [i.y, i.y + (i.rot === 90 ? i.w : i.d)])]
  return xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null
}

/** Smallest standard scale whose drawing fits the given paper area (mm). */
export function pickScale(realW: number, realH: number, paperW: number, paperH: number): number {
  return SCALES.find(s => realW / s <= paperW && realH / s <= paperH) ?? SCALES[SCALES.length - 1]
}

/** Furniture types worth a detail sheet: one per distinct name + size, in plan order (max 12). */
export function furnitureTypes(g: PlanGeometry): (PlanItem & { count: number })[] {
  const m = new Map<string, PlanItem & { count: number }>()
  for (const i of g.items) {
    const k = `${i.name}|${i.w}|${i.d}|${i.h}`, hit = m.get(k)
    if (hit) hit.count += 1
    else if (i.measure === 'count' && i.h > 0) m.set(k, { ...i, count: 1 })
  }
  return [...m.values()].slice(0, 12)
}

/** Items standing against a wall, as spans along that wall (mm from wall start) — drawn on its elevation. */
export function elevationItems(g: PlanGeometry, w: PlanWall, reach = 300): { id: string; name: string; a: number; b: number; h: number }[] {
  const len = wallLength(w)
  if (!len) return []
  const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
  return g.items.flatMap(i => {
    const iw = i.rot === 90 ? i.d : i.w, id = i.rot === 90 ? i.w : i.d
    const pts = [[i.x, i.y], [i.x + iw, i.y], [i.x, i.y + id], [i.x + iw, i.y + id]].map(([x, y]) => ({ along: (x - w.x1) * ux + (y - w.y1) * uy, off: Math.abs((x - w.x1) * -uy + (y - w.y1) * ux) }))
    const a = Math.max(0, Math.min(...pts.map(p => p.along))), b = Math.min(len, Math.max(...pts.map(p => p.along)))
    return Math.min(...pts.map(p => p.off)) <= w.t / 2 + reach && b - a > 1 && i.h > 0 ? [{ id: i.id, name: i.name, a, b, h: i.h }] : []
  })
}

/** Sheet list for a project: general sheets (finish table split every ROWS_PER_SHEET rows), plan series,
 *  one elevation per wall (longest first, max 12), a section detail per new-wall thickness (ID) and one detail per furniture type (IF). */
export function sheetList(g: PlanGeometry, finishRows = 0): SheetMeta[] {
  const b = planBounds(g)
  const s = b ? `1/${pickScale(b.maxX - b.minX, b.maxY - b.minY, 300, 215)}` : 'NONE'
  const walls = g.walls.filter(w => w.kind === 'existing' || w.kind === 'new').sort((a, c) => wallLength(c) - wallLength(a)).slice(0, 12)
  const pages = Math.min(Math.max(1, Math.ceil(finishRows / ROWS_PER_SHEET)), 20)
  const out: SheetMeta[] = [
    { no: 'I-000', title: '표지', scale: 'NONE', kind: 'cover' },
    { no: 'I-002', title: '도면 목록표', scale: 'NONE', kind: 'list' },
    ...Array.from({ length: pages }, (_, i): SheetMeta => ({ no: `I-${String(4 + i).padStart(3, '0')}`, title: `실내재료마감표${pages > 1 ? ` (${i + 1}/${pages})` : ''}`, scale: 'NONE', kind: 'finish', page: i })),
  ]
  if (b) out.push({ no: 'I-102', title: '평면도', scale: s, kind: 'plan' }, { no: 'I-106', title: '천장도', scale: s, kind: 'ceiling' }, { no: 'I-109', title: '가구안내도', scale: s, kind: 'furniture' })
  walls.forEach((w, i) => out.push({ no: `I-${141 + i}`, title: `입면도 ${String.fromCharCode(65 + i)}`, scale: `1/${pickScale(wallLength(w), g.height, 300, 200)}`, kind: 'elevation', wall: w.id }))
  ;[...new Set(g.walls.filter(w => w.kind === 'new').map(w => w.t))].sort((a, c) => a - c).slice(0, 6)
    .forEach((t, i) => out.push({ no: `ID-${201 + i}`, title: `가벽 단면 상세 T${t}`, scale: `1/${t <= 300 ? 5 : 10}`, kind: 'wallDetail', t }))
  furnitureTypes(g).forEach((f, i) => out.push({ no: `IF-${301 + i}`, title: `가구 상세 ${f.name}`, scale: `1/${pickScale(f.w + f.d, f.h + f.d, 240, 160)}`, kind: 'furnDetail', item: f.id }))
  return out
}

// ── DXF (R12 ASCII, model space in mm, layers by element kind) ────────────────
const pair = (code: number, v: string | number) => `${code}\n${v}\n`
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  pair(0, 'LINE') + pair(8, layer) + pair(10, x1.toFixed(1)) + pair(20, (-y1).toFixed(1)) + pair(11, x2.toFixed(1)) + pair(21, (-y2).toFixed(1))
const text = (layer: string, x: number, y: number, h: number, s: string) =>
  pair(0, 'TEXT') + pair(8, layer) + pair(10, x.toFixed(1)) + pair(20, (-y).toFixed(1)) + pair(40, h) + pair(1, s)

function wallEdges(w: PlanWall): [number, number, number, number][] {
  const len = wallLength(w) || 1, nx = (-(w.y2 - w.y1) / len) * (w.t / 2), ny = ((w.x2 - w.x1) / len) * (w.t / 2)
  return [[w.x1 + nx, w.y1 + ny, w.x2 + nx, w.y2 + ny], [w.x1 - nx, w.y1 - ny, w.x2 - nx, w.y2 - ny], [w.x1 + nx, w.y1 + ny, w.x1 - nx, w.y1 - ny], [w.x2 + nx, w.y2 + ny, w.x2 - nx, w.y2 - ny]]
}

export function planDxf(g: PlanGeometry): string {
  const layers = ['A-WALL', 'A-WALL-NEW', 'A-DOOR', 'A-GLAZ', 'I-FURN', 'A-ANNO-DIMS', 'A-ANNO-TEXT']
  let ent = ''
  for (const w of g.walls) {
    const layer = w.kind === 'new' ? 'A-WALL-NEW' : 'A-WALL'
    for (const e of wallEdges(w)) ent += line(layer, ...e)
    ent += text('A-ANNO-DIMS', (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2 - w.t, 120, String(Math.round(wallLength(w))))
  }
  for (const o of g.openings) {
    const w = g.walls.find(x => x.id === o.wall)
    if (!w) continue
    const len = wallLength(w) || 1, ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len, a = o.pos - o.width / 2, b = o.pos + o.width / 2
    ent += line(o.kind === 'door' ? 'A-DOOR' : 'A-GLAZ', w.x1 + ux * a, w.y1 + uy * a, w.x1 + ux * b, w.y1 + uy * b)
  }
  for (const i of g.items) {
    const w = i.rot === 90 ? i.d : i.w, d = i.rot === 90 ? i.w : i.d
    ent += line('I-FURN', i.x, i.y, i.x + w, i.y) + line('I-FURN', i.x + w, i.y, i.x + w, i.y + d) + line('I-FURN', i.x + w, i.y + d, i.x, i.y + d) + line('I-FURN', i.x, i.y + d, i.x, i.y)
    ent += text('A-ANNO-TEXT', i.x + 50, i.y + d / 2, 100, i.name)
  }
  const table = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length) + layers.map((l, i) => pair(0, 'LAYER') + pair(2, l) + pair(70, 0) + pair(62, i + 1) + pair(6, 'CONTINUOUS')).join('') + pair(0, 'ENDTAB')
  return pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'TABLES') + table + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ent + pair(0, 'ENDSEC') + pair(0, 'EOF')
}
