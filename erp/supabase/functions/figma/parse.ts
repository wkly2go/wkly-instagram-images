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
