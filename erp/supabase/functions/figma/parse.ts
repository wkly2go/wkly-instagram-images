// 피그잼 · 피그마 연결 — 순수 함수만 (시험: tests/figma.test.ts · 화면 쪽 같은 규칙은 src/lib/figma.ts)

export type FigmaKind = 'board' | 'design' | 'slides'

/** 피그마 주소 → 파일 열쇠 · 종류 · (있으면) 노드 id. 피그마 주소가 아니면 null */
export function parseFigmaUrl(raw: string): { key: string; kind: FigmaKind; nodeId: string | null } | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null
  const m = u.pathname.match(/^\/(board|file|design|proto|slides|deck)\/([A-Za-z0-9]{10,64})(?:\/branch\/([A-Za-z0-9]{10,64}))?/)
  if (!m) return null
  const kind: FigmaKind = m[1] === 'board' ? 'board' : m[1] === 'slides' || m[1] === 'deck' ? 'slides' : 'design'
  const node = u.searchParams.get('node-id')
  return { key: m[3] ?? m[2], kind, nodeId: node ? node.replace(/-/g, ':') : null }
}

export interface FigmaFrame { id: string; name: string; type: string; page: string; w: number; h: number }
type Node = { id?: string; name?: string; type?: string; children?: Node[]; absoluteBoundingBox?: { width?: number; height?: number } | null; characters?: string }

const PAGE_TYPES = new Set(['FRAME', 'SECTION', 'COMPONENT', 'GROUP', 'SLIDE', 'INSTANCE'])

/** 페이지마다 맨 위 프레임 · 섹션 (PDF 한 장이 되는 단위) — 슬라이드 파일은 슬라이드 줄 안까지 */
export function framesOf(doc: Node | null | undefined): FigmaFrame[] {
  const out: FigmaFrame[] = []
  const take = (n: Node, page: string) => {
    if (!n.id || !n.type) return
    if (n.type === 'SLIDE_GRID' || n.type === 'SLIDE_ROW') { for (const c of n.children ?? []) take(c, page); return }
    if (!PAGE_TYPES.has(n.type)) return
    const b = n.absoluteBoundingBox ?? {}
    out.push({ id: n.id, name: (n.name ?? '').slice(0, 120), type: n.type, page, w: Math.round(b.width ?? 0), h: Math.round(b.height ?? 0) })
  }
  for (const page of doc?.children ?? []) for (const c of page.children ?? []) take(c, (page.name ?? '').slice(0, 80))
  return out.slice(0, 500)
}

/** 섹션 안 바로 아래 프레임을 섹션 바로 뒤에 넣음 (제안서 슬라이드가 섹션 안에 줄지어 있는 경우 · 2026-11-27 포켓몬 보드)
 *  kids: 섹션 id → 그 섹션 노드(depth=1 로 받은 것) */
export function expandSections(frames: FigmaFrame[], kids: Record<string, Node | null | undefined>, max = 500): FigmaFrame[] {
  const out: FigmaFrame[] = []
  const seen = new Set<string>()
  for (const f of frames) {
    if (out.length >= max) break
    if (!seen.has(f.id)) { out.push(f); seen.add(f.id) }
    if (f.type !== 'SECTION') continue
    for (const c of kids[f.id]?.children ?? []) {
      if (out.length >= max) break
      if (!c.id || !c.type || seen.has(c.id) || !['FRAME', 'COMPONENT', 'SLIDE'].includes(c.type)) continue
      const b = c.absoluteBoundingBox ?? {}
      out.push({ id: c.id, name: (c.name ?? '').slice(0, 120), type: c.type, page: `${f.page} › ${f.name}`.slice(0, 160), w: Math.round(b.width ?? 0), h: Math.round(b.height ?? 0) })
      seen.add(c.id)
    }
  }
  return out
}

/** 보드에 적힌 글 (포스트잇 · 글 상자 · 도형 안 글) — 인트라넷 찾기용 · 최대 50,000자 */
export function textOf(doc: Node | null | undefined, max = 50000): string {
  const parts: string[] = []
  let len = 0
  const walk = (n: Node) => {
    if (len >= max) return
    const t = typeof n.characters === 'string' ? n.characters.trim() : ''
    if (t) { parts.push(t); len += t.length + 1 }
    for (const c of n.children ?? []) walk(c)
  }
  if (doc) walk(doc)
  return parts.join('\n').slice(0, max)
}

/** 16:9 에 가까운지 (1% 안) — 제출용 PDF 안내에 씀 */
export const isWide = (w: number, h: number) => w > 0 && h > 0 && Math.abs(w / h - 16 / 9) < 0.02

/** 노드 id 목록 정리: 중복 · 형식이 틀린 것 빼고 최대 60개 */
export function cleanNodeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const x of ids) {
    if (typeof x !== 'string' || !/^[0-9]+[:-][0-9]+(;[0-9]+[:-][0-9]+)*$/.test(x)) continue
    const id = x.replace(/-/g, ':')
    if (!out.includes(id)) out.push(id)
  }
  return out.slice(0, 60)
}

// ───────── 수정 가능한 요소로 불러오기 (2026-11-27 대표 '프레임말고 모든 컨텐츠를 불러와서 수정할 수 있게') ─────────
// 피그마 노드 트리 → 화이트보드가 바로 쓸 수 있는 평평한 목록. 글 · 사각형 · 원 · 선 · 포스트잇 · 연결선은 그대로 요소로,
// 벡터(아이콘 · 로고) · 사진 칠은 그림(raster)으로. 좌표는 피그마 절대 좌표(absoluteBoundingBox).

type Paint = { type?: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } }
export type FNode = Node & {
  visible?: boolean; opacity?: number; fills?: Paint[]; strokes?: Paint[]; strokeWeight?: number; cornerRadius?: number
  style?: { fontSize?: number; textAlignHorizontal?: string; fontWeight?: number; lineHeightPx?: number; fontFamily?: string }
  shapeType?: string; strokeCap?: string; absoluteBoundingBox?: { x?: number; y?: number; width?: number; height?: number } | null
  connectorStart?: { endpointNodeId?: string; position?: { x: number; y: number } }
  connectorEnd?: { endpointNodeId?: string; position?: { x: number; y: number } }
}
export interface FlatEl {
  id: string
  kind: 'rect' | 'ellipse' | 'text' | 'line' | 'arrow' | 'raster' | 'frame'
  x: number; y: number; w: number; h: number
  fill?: string | null; stroke?: string | null; strokeWidth?: number; radius?: number; opacity?: number
  text?: string; fontSize?: number; align?: 'left' | 'center' | 'right'; color?: string
  /** 줄 간격 (글자 크기의 몇 배 · 피그마 lineHeightPx ÷ fontSize) */
  lineHeight?: number
  /** 피그마 글꼴 이름 · 굵기 (화이트보드 글꼴 고르기용) */
  font?: string; weight?: number
  name?: string; frame?: string
  points?: [number, number][]
  /** 사진 칠 (그림은 JPG 로 받음) */
  photo?: boolean
}

const hex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
function solid(ps: Paint[] | undefined): { color: string; alpha: number } | null {
  for (const p of [...(ps ?? [])].reverse()) {
    if (p.visible === false || p.type !== 'SOLID' || !p.color) continue
    return { color: hex(p.color), alpha: (p.opacity ?? 1) * (p.color.a ?? 1) }
  }
  return null
}
const hasImageFill = (n: FNode) => (n.fills ?? []).some(p => p.visible !== false && p.type === 'IMAGE')
const VECTORS = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'REGULAR_POLYGON', 'WASHI_TAPE', 'STAMP'])
const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'])

/** 글이 없고 벡터만 든 묶음(아이콘 · 로고) — 통째로 그림 한 장이 더 정확함 */
function pureGraphic(n: FNode): boolean {
  let vec = false
  const walk = (m: FNode): boolean => {
    if (m.type === 'TEXT' || m.type === 'STICKY' || m.type === 'SHAPE_WITH_TEXT') return false
    if (VECTORS.has(m.type ?? '') || hasImageFill(m)) vec = true
    return (m.children ?? []).every(c => walk(c as FNode))
  }
  return walk(n) && vec
}

const alignOf = (s?: string) => (s === 'CENTER' ? 'center' : s === 'RIGHT' ? 'right' : 'left') as FlatEl['align']

/** 프레임 하나를 평평한 요소 목록으로 (max 개까지 · 넘으면 truncated) */
export function flattenFrame(root: FNode, max = 2500): { els: FlatEl[]; truncated: boolean } {
  const els: FlatEl[] = []
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
  const conns: { id: string; n: FNode; frame: string }[] = []
  let truncated = false
  const box = (n: FNode) => {
    const b = n.absoluteBoundingBox ?? {}
    return { x: Math.round(b.x ?? 0), y: Math.round(b.y ?? 0), w: Math.max(1, Math.round(b.width ?? 0)), h: Math.max(1, Math.round(b.height ?? 0)) }
  }
  const push = (e: FlatEl) => { if (els.length >= max) { truncated = true; return false } els.push(e); return true }
  const rb = box(root)
  const fid = root.id ?? 'frame'
  const rootFill = solid(root.fills)
  push({ id: fid, kind: 'frame', ...rb, name: (root.name ?? '').slice(0, 120) })
  if (rootFill && rootFill.alpha > 0.02 && rootFill.color !== '#ffffff') push({ id: `${fid}:bg`, kind: 'rect', ...rb, fill: rootFill.color, stroke: null, opacity: Math.round(rootFill.alpha * 100), frame: fid })
  const walk = (n: FNode, inherited: number) => {
    if (truncated || n.visible === false || !n.id) return
    const op = inherited * (n.opacity ?? 1)
    const b = box(n)
    boxes.set(n.id, b)
    const t = n.type ?? ''
    const f = solid(n.fills), s = solid(n.strokes)
    const common = { id: n.id, ...b, frame: fid }
    const stroke = s && (n.strokeWeight ?? 0) > 0 ? s.color : null
    const sw = stroke ? Math.max(1, Math.min(8, Math.round(n.strokeWeight ?? 1))) : undefined
    if (t === 'TEXT') {
      const txt = typeof n.characters === 'string' ? n.characters : ''
      const fs = Math.max(6, Math.round(n.style?.fontSize ?? 14))
      const lh = n.style?.lineHeightPx && n.style.fontSize ? Math.round(Math.max(0.8, Math.min(3, n.style.lineHeightPx / n.style.fontSize)) * 100) / 100 : undefined
      if (txt.trim()) push({ ...common, kind: 'text', text: txt.slice(0, 4000), fontSize: fs, ...(lh ? { lineHeight: lh } : {}), font: (n.style?.fontFamily ?? '').slice(0, 60), weight: n.style?.fontWeight ?? 400, align: alignOf(n.style?.textAlignHorizontal), color: f?.color ?? '#151d18', opacity: Math.round(op * (f?.alpha ?? 1) * 100) })
      return
    }
    if (t === 'CONNECTOR') { conns.push({ id: n.id, n, frame: fid }); return }
    if (t === 'LINE' || (t === 'VECTOR' && (b.w <= 2 || b.h <= 2) && !hasImageFill(n))) { push({ ...common, kind: /ARROW/.test(n.strokeCap ?? '') ? 'arrow' : 'line', stroke: stroke ?? s?.color ?? '#151d18', strokeWidth: sw ?? 1, opacity: Math.round(op * 100), points: [[0, 0], [b.w <= 2 && b.h > 2 ? 0 : b.w, b.h <= 2 ? 0 : b.h]] }); return }
    if (t === 'STICKY' || t === 'SHAPE_WITH_TEXT') {
      const ell = t === 'SHAPE_WITH_TEXT' && /ELLIPSE/.test(n.shapeType ?? '')
      push({ ...common, kind: ell ? 'ellipse' : 'rect', fill: f?.color ?? (t === 'STICKY' ? '#fff3a8' : null), stroke, strokeWidth: sw, radius: t === 'STICKY' ? 0 : 8, opacity: Math.round(op * 100) })
      const txt = typeof n.characters === 'string' ? n.characters.trim() : ''
      if (txt) push({ id: `${n.id}:t`, kind: 'text', x: b.x + 12, y: b.y + 12, w: Math.max(10, b.w - 24), h: Math.max(10, b.h - 24), text: txt.slice(0, 2000), fontSize: 16, align: t === 'STICKY' ? 'left' : 'center', color: '#151d18', frame: fid })
      return
    }
    if (hasImageFill(n) || VECTORS.has(t) || (CONTAINERS.has(t) && pureGraphic(n))) { push({ ...common, kind: 'raster', name: (n.name ?? '').slice(0, 80), opacity: Math.round(op * 100), ...(hasImageFill(n) && !VECTORS.has(t) ? { photo: true } : {}) }); return }
    if (t === 'ELLIPSE' || t === 'RECTANGLE' || (CONTAINERS.has(t) && n !== root)) {
      if ((f && f.alpha > 0.02) || stroke) push({ ...common, kind: t === 'ELLIPSE' ? 'ellipse' : 'rect', fill: f && f.alpha > 0.02 ? f.color : null, stroke, strokeWidth: sw, radius: Math.round(n.cornerRadius ?? 0), opacity: Math.round(op * (f?.alpha ?? 1) * 100) })
    }
    for (const c of n.children ?? []) walk(c as FNode, op)
  }
  for (const c of root.children ?? []) walk(c as FNode, root.opacity ?? 1)
  // 연결선: 이은 노드 가운데 → 가운데, 없으면 적힌 위치 · 상자 대각선
  const end = (e: FNode['connectorStart'], fb: [number, number]): [number, number] => {
    const t = e?.endpointNodeId ? boxes.get(e.endpointNodeId) : undefined
    if (t) return [t.x + t.w / 2, t.y + t.h / 2]
    if (e?.position) return [e.position.x, e.position.y]
    return fb
  }
  for (const c of conns) {
    const b = boxes.get(c.id)!
    const a = end(c.n.connectorStart, [b.x, b.y]), z = end(c.n.connectorEnd, [b.x + b.w, b.y + b.h])
    const s = solid(c.n.strokes)
    push({ id: c.id, kind: 'arrow', x: a[0], y: a[1], w: Math.abs(z[0] - a[0]) || 1, h: Math.abs(z[1] - a[1]) || 1, stroke: s?.color ?? '#151d18', strokeWidth: 2, points: [[0, 0], [z[0] - a[0], z[1] - a[1]]], frame: c.frame })
  }
  return { els, truncated }
}
