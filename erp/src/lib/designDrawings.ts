// Drawing set generated from the plan (mm). Follows the learned standard (knowledge: drawing_set / cad_standard):
// A3 sheets, numbering I-000 general · I-1xx plan series · I-14x elevations, title block fields, scale picked from a standard list.
// Pure data in / strings out so it can be tested without a browser.
import { wallLength, type PlanGeometry, type PlanWall } from './designPlan.ts'

export const SCALES = [10, 20, 30, 40, 50, 60, 100, 150, 200, 300, 500]
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface SheetMeta { no: string; title: string; scale: string; kind: 'cover' | 'list' | 'finish' | 'plan' | 'ceiling' | 'furniture' | 'elevation'; wall?: string }
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

/** Sheet list for a project: fixed general sheets, plan series, one elevation per existing wall (longest first, max 12). */
export function sheetList(g: PlanGeometry): SheetMeta[] {
  const b = planBounds(g)
  const s = b ? `1/${pickScale(b.maxX - b.minX, b.maxY - b.minY, 300, 215)}` : 'NONE'
  const walls = g.walls.filter(w => w.kind === 'existing' || w.kind === 'new').sort((a, c) => wallLength(c) - wallLength(a)).slice(0, 12)
  const out: SheetMeta[] = [
    { no: 'I-000', title: '표지', scale: 'NONE', kind: 'cover' },
    { no: 'I-002', title: '도면 목록표', scale: 'NONE', kind: 'list' },
    { no: 'I-004', title: '실내재료마감표', scale: 'NONE', kind: 'finish' },
  ]
  if (b) out.push({ no: 'I-102', title: '평면도', scale: s, kind: 'plan' }, { no: 'I-106', title: '천장도', scale: s, kind: 'ceiling' }, { no: 'I-109', title: '가구안내도', scale: s, kind: 'furniture' })
  walls.forEach((w, i) => out.push({ no: `I-${141 + i}`, title: `입면도 ${String.fromCharCode(65 + i)}`, scale: `1/${pickScale(wallLength(w), g.height, 300, 200)}`, kind: 'elevation', wall: w.id }))
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
