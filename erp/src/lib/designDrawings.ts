// Drawing set generated from the plan (mm). Follows the learned standard (knowledge: drawing_set / cad_standard):
// A3 sheets, numbering I-000 general · I-1xx plan series · I-14x elevations, title block fields, scale picked from a standard list.
// Pure data in / strings out so it can be tested without a browser.
import { BASE_TYPES, FLOOR_TYPES, WALL_TYPES } from './designWallTypes.ts'
import { wallLength, type PlanGeometry, type PlanItem, type PlanWall } from './designPlan.ts'

export const SCALES = [10, 20, 30, 40, 50, 60, 100, 150, 200, 300, 500]
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface SheetMeta { no: string; title: string; scale: string; kind: 'cover' | 'list' | 'legend' | 'schedule' | 'finish' | 'floorDetail' | 'baseDetail' | 'doorDetail' | 'plan' | 'ceiling' | 'furniture' | 'elevation' | 'wallDetail' | 'furnDetail'; wall?: string; /** table page (0-based) */ page?: number; /** wall thickness for a wall detail */ t?: number; /** type code (W10 · F3 · B1) for a detail drawn from the learned catalogue */ wallType?: string; /** PlanItem id for a furniture detail */ item?: string; /** door width for a door detail */ width?: number }
/** Material number prefixes from the learned legend standard (knowledge: material_codes). */
export const MATERIAL_PREFIX: Record<string, string> = { AC: '흡음·천장재', MT: '금속', AS: '인조대리석', PT: '도장', FB: '패브릭', SH: '필름', LE: '인조가죽', GL: '유리', ST: '석재', WC: '벽지', TL: '타일', WF: '원목마루', WP: '무늬목·패널', VS: '바닥재', ETC: '기타' }
export const materialKind = (code: string | null | undefined) => MATERIAL_PREFIX[(code ?? '').toUpperCase().match(/^[A-Z]+/)?.[0] ?? ''] ?? ''
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

const elevWalls = (g: PlanGeometry) => g.walls.filter(w => w.kind === 'existing' || w.kind === 'new').sort((a, c) => wallLength(c) - wallLength(a)).slice(0, 12)
export const openingSize = (o: { kind: 'door' | 'window' }, height: number) => (o.kind === 'door' ? { h: Math.min(2100, height), sill: 0 } : { h: Math.min(1200, height), sill: 900 })

/** Wall face area (㎡) minus its openings — one face, at ceiling height. */
export function wallFaceArea(g: PlanGeometry, w: PlanWall): number {
  const open = g.openings.filter(o => o.wall === w.id).reduce((a, o) => a + o.width * openingSize(o, g.height).h, 0)
  return Math.max(0, Math.round((wallLength(w) * g.height - open) / 10000) / 100)
}

/** Walls that have a finish set, labelled like their elevation sheet (입면 A…), for the finish table. */
export function wallFinishRows(g: PlanGeometry): { label: string; finish: string; area: number }[] {
  return elevWalls(g).flatMap((w, i) => (w.finish?.trim() ? [{ label: `입면 ${String.fromCharCode(65 + i)}`, finish: w.finish.trim(), area: wallFaceArea(g, w) }] : []))
}

/** Sheet list for a project: general sheets numbered like the sample set (list I-002 · material legend I-006~ · finish table I-008~, tables split every ROWS_PER_SHEET rows), plan series,
 *  one elevation per wall (longest first, max 12), then details: wall types ID-200 (1/6) · doors ID-400 (1/40) · furniture IF-700. */
export function sheetList(g: PlanGeometry, finishRows = 0, legendRows = 0): SheetMeta[] {
  const b = planBounds(g)
  const s = b ? `1/${pickScale(b.maxX - b.minX, b.maxY - b.minY, 300, 215)}` : 'NONE'
  const walls = elevWalls(g)
  const rooms = g.rooms ?? [], roomPages = rooms.length ? 1 : 0, used = (k: 'floor' | 'base' | 'wall') => new Set(rooms.map(r => r[k].detail).filter(Boolean))
  const pages = Math.min(Math.max(1, Math.ceil(finishRows / ROWS_PER_SHEET)), 20), lpages = Math.min(Math.max(1, Math.ceil(legendRows / ROWS_PER_SHEET)), 2)
  const out: SheetMeta[] = [
    { no: 'I-000', title: '표지', scale: 'NONE', kind: 'cover' },
    { no: 'I-002', title: '도면 목록표', scale: 'NONE', kind: 'list' },
    ...Array.from({ length: lpages }, (_, i): SheetMeta => ({ no: `I-00${6 + i}`, title: `재료마감범례표${lpages > 1 ? `-${i + 1}` : ''}`, scale: 'NONE', kind: 'legend', page: i })),
    ...(rooms.length ? [{ no: 'I-008', title: '실내재료마감표', scale: 'NONE', kind: 'schedule' } as SheetMeta] : []),
    ...Array.from({ length: pages }, (_, i): SheetMeta => ({ no: `I-${String(8 + roomPages + i).padStart(3, '0')}`, title: `${rooms.length ? '마감 수량표' : '실내재료마감표'}${pages > 1 ? `-${i + 1}` : ''}`, scale: 'NONE', kind: 'finish', page: i })),
  ]
  if (b) out.push({ no: 'I-102', title: '평면도', scale: s, kind: 'plan' }, { no: 'I-106', title: '천장도', scale: s, kind: 'ceiling' }, { no: 'I-109', title: '가구안내도', scale: s, kind: 'furniture' })
  walls.forEach((w, i) => out.push({ no: `I-${141 + i}`, title: `입면도 ${String.fromCharCode(65 + i)}`, scale: `1/${pickScale(wallLength(w), g.height, 300, 200)}`, kind: 'elevation', wall: w.id }))
  FLOOR_TYPES.filter(t => used('floor').has(t.code)).slice(0, 3).forEach((t, i) => out.push({ no: `ID-${101 + i}`, title: `바닥 상세 ${t.code}`, scale: '1/6', kind: 'floorDetail', wallType: t.code }))
  BASE_TYPES.filter(t => used('base').has(t.code)).slice(0, 2).forEach((t, i) => out.push({ no: `ID-${104 + i}`, title: `걸레받이 상세 ${t.code}`, scale: '1/6', kind: 'baseDetail', wallType: t.code }))
  const typed = WALL_TYPES.filter(t => g.walls.some(w => w.type === t.code) || used('wall').has(t.code)).slice(0, 9)
  typed.forEach((t, i) => out.push({ no: `ID-${201 + i}`, title: `벽체 상세 ${t.code}`, scale: '1/6', kind: 'wallDetail', wallType: t.code }))
  ;[...new Set(g.walls.filter(w => w.kind === 'new' && !typed.some(t => t.code === w.type)).map(w => w.t))].sort((a, c) => a - c).slice(0, 9 - typed.length)
    .forEach((t, i) => out.push({ no: `ID-${201 + typed.length + i}`, title: `벽체 상세 T${t}`, scale: '1/6', kind: 'wallDetail', t }))
  ;[...new Set(g.openings.filter(o => o.kind === 'door').map(o => o.width))].sort((a, c) => a - c).slice(0, 8)
    .forEach((width, i) => out.push({ no: `ID-${401 + i}`, title: `도어 상세 W${width}`, scale: '1/40', kind: 'doorDetail', width }))
  furnitureTypes(g).forEach((f, i) => out.push({ no: `IF-${701 + i}`, title: `가구 상세 ${f.name}`, scale: `1/${pickScale(f.w + f.d, f.h + f.d, 240, 160)}`, kind: 'furnDetail', item: f.id }))
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
  const layers = ['A-WALL', 'A-WALL-NEW', 'A-DOOR', 'A-GLAZ', 'I-FURN', 'A-ANNO-DIMS', 'A-ANNO-TEXT', 'A-ELEV', 'I-FURN-DETL']
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
  // Elevations and furniture views sit to the right of the plan in model space, at 1:1 in mm.
  const b = planBounds(g)
  if (b) {
    const rect = (layer: string, x: number, y: number, w: number, h: number) => line(layer, x, y, x + w, y) + line(layer, x + w, y, x + w, y + h) + line(layer, x + w, y + h, x, y + h) + line(layer, x, y + h, x, y)
    const ex = b.maxX + 3000
    let y = b.minY
    elevWalls(g).forEach((w, i) => {
      const len = wallLength(w), base = y + g.height
      ent += rect('A-ELEV', ex, y, len, g.height) + text('A-ANNO-TEXT', ex, y - 250, 150, `ELEVATION ${String.fromCharCode(65 + i)}${w.finish?.trim() ? ` - ${w.finish.trim()}` : ''}`)
      for (const o of g.openings.filter(o => o.wall === w.id)) { const s = openingSize(o, g.height); ent += rect(o.kind === 'door' ? 'A-DOOR' : 'A-GLAZ', ex + o.pos - o.width / 2, base - s.sill - s.h, o.width, s.h) }
      for (const it of elevationItems(g, w)) ent += rect('I-FURN', ex + it.a, base - it.h, it.b - it.a, it.h)
      y += g.height + 1500
    })
    const fx = ex + Math.max(0, ...elevWalls(g).map(wallLength)) + 3000
    let fy = b.minY
    for (const f of furnitureTypes(g)) {
      ent += text('A-ANNO-TEXT', fx, fy - 250, 150, `${f.name} W${f.w} D${f.d} H${f.h}`)
      ent += rect('I-FURN-DETL', fx, fy, f.w, f.h) + rect('I-FURN-DETL', fx + f.w + 600, fy, f.d, f.h) + rect('I-FURN-DETL', fx, fy + f.h + 600, f.w, f.d)
      fy += f.h + f.d + 2100
    }
  }
  const table = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length) + layers.map((l, i) => pair(0, 'LAYER') + pair(2, l) + pair(70, 0) + pair(62, i + 1) + pair(6, 'CONTINUOUS')).join('') + pair(0, 'ENDTAB')
  return pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'TABLES') + table + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES') + ent + pair(0, 'ENDSEC') + pair(0, 'EOF')
}
