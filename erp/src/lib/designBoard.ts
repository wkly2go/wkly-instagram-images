// 제안 보드 (2026-11-17 대표 지시 '제안서는 피그마와 같은 환경에 houzz의 스팩 기능을 합쳐')
// 피그마처럼 넓은 판 위에 16:9 페이지(프레임)를 늘어놓고 글 · 사진 · 스펙 카드 · 마감 견본을 놓는다.
// 스펙 카드와 사진은 스펙북 · 투시도를 번호로 가리킬 뿐 복사하지 않는다 — 스펙북을 고치면 보드도 따라 바뀐다.
// 이 파일의 자료 형식은 저장(design.proposal_boards.data)과 화면이 같이 쓴다. 칸의 뜻을 바꾸지 말고 선택 칸만 더할 것.

export type BoardElType = 'text' | 'rect' | 'image' | 'spec' | 'swatch' | 'note' | 'table'
export interface BoardStyle {
  /** 글자 단계 — title 제목 · sub 소제목 · body 본문 */ size?: 'title' | 'sub' | 'body'
  bold?: boolean; align?: 'left' | 'center' | 'right'
  /** 글자색 · 바탕색 · 테두리색 (#rrggbb) */ color?: string; fill?: string; stroke?: string
}
export interface BoardEl {
  id: string; type: BoardElType
  /** 페이지 안 좌표 · 크기 (페이지 px 단위: 가로 1600 기준) */ x: number; y: number; w: number; h: number
  /** 겹침 순서 (클수록 위) */ z: number
  text?: string; style?: BoardStyle
  /** image: 'render:<투시도 id>' | 'spec:<스펙 항목 id>' (스펙북 사진) */ src?: string
  /** spec: 스펙북 항목 id · table: 넣을 스펙북 종류(materials 등, 비우면 선정 · 확정 전체) */ spec_id?: string; book?: string
  /** swatch: 마감 글 (PT-01 수성 페인트 백색) */ finish?: string
  locked?: boolean
}
export interface BoardPage { id: string; name: string; w: number; h: number; bg?: string; els: BoardEl[] }
export interface BoardComment { id: string; page: string; x: number; y: number; text: string; by: string; at: string; done?: boolean; replies?: { by: string; at: string; text: string }[] }
export interface ProposalBoard { v: 1; pages: BoardPage[]; comments: BoardComment[] }

export const PAGE_W = 1600, PAGE_H = 900
export const uid = () => Math.random().toString(36).slice(2, 10)
export const newPage = (name: string): BoardPage => ({ id: uid(), name, w: PAGE_W, h: PAGE_H, els: [] })
export const emptyBoard = (): ProposalBoard => ({ v: 1, pages: [newPage('표지')], comments: [] })

/** 저장된 값이 보드 모양인지 (DB 값은 믿지 않는다). 아니면 null */
export function readBoard(data: unknown): ProposalBoard | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { pages?: unknown; comments?: unknown }
  if (!Array.isArray(d.pages)) return null
  const pages = d.pages.filter((p): p is BoardPage => !!p && typeof p === 'object' && typeof (p as BoardPage).id === 'string' && Array.isArray((p as BoardPage).els))
    .map(p => ({ ...p, name: String(p.name ?? ''), w: Number(p.w) || PAGE_W, h: Number(p.h) || PAGE_H, els: p.els.filter(e => e && typeof e.id === 'string' && Number.isFinite(e.x + e.y + e.w + e.h)) }))
  return { v: 1, pages: pages.length ? pages : [newPage('표지')], comments: Array.isArray(d.comments) ? (d.comments as BoardComment[]).filter(c => c && typeof c.id === 'string') : [] }
}

/** 댓글 합치기: 저장 직전 서버의 최신 댓글과 내 댓글을 id 로 합친다 (내가 지운 것은 빼고, 같은 id 는 답글이 많은 쪽 · 같으면 내 것) */
export function mergeBoardComments(mine: BoardComment[], latest: BoardComment[], removed: Iterable<string> = []): BoardComment[] {
  const gone = new Set(removed)
  const out = new Map<string, BoardComment>()
  for (const c of latest) if (!gone.has(c.id)) out.set(c.id, c)
  for (const c of mine) { const o = out.get(c.id); out.set(c.id, o && (o.replies?.length ?? 0) > (c.replies?.length ?? 0) ? { ...c, replies: o.replies } : c) }
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at))
}

// ── 판 위 계산 (화면과 시험이 같이 쓴다 · 모두 페이지 px 단위) ──────────────
export interface Box { x: number; y: number; w: number; h: number }
export type BoardHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const PAGE_GAP = 160
/** 판 위에서 n 번째 페이지의 왼쪽 위치 (페이지는 옆으로 나란히 놓는다) */
export const pageLeft = (pages: { w: number }[], n: number) => pages.slice(0, n).reduce((a, p) => a + (p.w || PAGE_W) + PAGE_GAP, 0)

/** 값 하나를 가까운 기준선에 붙인다 (tol 안에서 가장 가까운 것) */
export function snapValue(v: number, targets: number[], tol: number): { v: number; hit: number | null } {
  let best: number | null = null
  for (const t of targets) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t
  return best === null ? { v, hit: null } : { v: best, hit: best }
}
/** 붙을 기준선: 페이지 가장자리 · 가운데 + 다른 요소의 가장자리 · 가운데 */
export function snapTargets(others: Box[], page: { w: number; h: number }): { xs: number[]; ys: number[] } {
  const xs = [0, page.w / 2, page.w], ys = [0, page.h / 2, page.h]
  for (const o of others) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h) }
  return { xs, ys }
}
/** 옮기는 상자를 기준선에 붙인다. gx · gy 는 그릴 안내선 위치 (없으면 null) */
export function snapMove(box: Box, others: Box[], page: { w: number; h: number }, tol: number): { x: number; y: number; gx: number | null; gy: number | null } {
  const { xs, ys } = snapTargets(others, page)
  const pick = (start: number, size: number, targets: number[]) => {
    let best: { d: number; g: number } | null = null
    for (const off of [0, size / 2, size]) { const s = snapValue(start + off, targets, tol); if (s.hit !== null && (!best || Math.abs(s.hit - start - off) < Math.abs(best.d))) best = { d: s.hit - start - off, g: s.hit } }
    return best
  }
  const sx = pick(box.x, box.w, xs), sy = pick(box.y, box.h, ys)
  return { x: box.x + (sx?.d ?? 0), y: box.y + (sy?.d ?? 0), gx: sx?.g ?? null, gy: sy?.g ?? null }
}
/** 손잡이를 끌어 크기 바꾸기. keepRatio 면 처음 비율을 지킨다. 최소 크기 아래로는 줄지 않고, 반대쪽 모서리는 제자리 */
export function resizeBox(start: Box, handle: BoardHandle, dx: number, dy: number, keepRatio = false, min = 16): Box {
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s')
  let w = start.w + (east ? dx : west ? -dx : 0), h = start.h + (south ? dy : north ? -dy : 0)
  if (keepRatio && start.w > 0 && start.h > 0) {
    const r = start.w / start.h
    if ((east || west) && (north || south)) { if (Math.abs(w - start.w) / r >= Math.abs(h - start.h)) h = w / r; else w = h * r }
    else if (east || west) h = w / r
    else w = h * r
  }
  w = Math.max(min, w); h = Math.max(min, h)
  if (keepRatio && start.w > 0 && start.h > 0) { const r = start.w / start.h; if (w / h > r) h = w / r; else w = h * r }
  const x = west ? start.x + start.w - w : !east && keepRatio && (north || south) ? start.x + (start.w - w) / 2 : start.x
  const y = north ? start.y + start.h - h : !south && keepRatio && (east || west) ? start.y + (start.h - h) / 2 : start.y
  return { x, y, w, h }
}
/** 카드 n 장을 칸 안에 고르게 놓는다 (스펙 페이지 자동 만들기). 한 줄에 maxCols 장까지 */
export function cardGrid(n: number, area: Box, gap = 24, maxCols = 4): Box[] {
  if (n <= 0) return []
  const cols = Math.min(maxCols, n), rows = Math.ceil(n / cols)
  const w = (area.w - gap * (cols - 1)) / cols, h = Math.min((area.h - gap * (rows - 1)) / rows, w * 1.3)
  return Array.from({ length: n }, (_, i) => ({ x: Math.round(area.x + (i % cols) * (w + gap)), y: Math.round(area.y + Math.floor(i / cols) * (h + gap)), w: Math.round(w), h: Math.round(h) }))
}
/** 목록을 size 개씩 나눈다 */
export const chunk = <T,>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / Math.max(1, size)) }, (_, i) => list.slice(i * size, (i + 1) * size))
/** 두 상자가 겹치는지 (끌어서 고르기) */
export const boxesTouch = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
/** 여러 상자를 감싸는 상자 */
export function boundsOf(list: Box[]): Box | null {
  if (!list.length) return null
  const x = Math.min(...list.map(b => b.x)), y = Math.min(...list.map(b => b.y))
  return { x, y, w: Math.max(...list.map(b => b.x + b.w)) - x, h: Math.max(...list.map(b => b.y + b.h)) - y }
}
/** 겹침 순서: 고른 요소를 맨 앞 · 맨 뒤로 (나머지 순서는 그대로, z 는 0부터 다시 매긴다) */
export function restack(els: BoardEl[], ids: string[], to: 'front' | 'back'): BoardEl[] {
  const pick = new Set(ids), sorted = [...els].sort((a, b) => a.z - b.z)
  const rest = sorted.filter(e => !pick.has(e.id)), moved = sorted.filter(e => pick.has(e.id))
  const order = to === 'front' ? [...rest, ...moved] : [...moved, ...rest]
  const z = new Map(order.map((e, i) => [e.id, i]))
  return els.map(e => (e.z === z.get(e.id) ? e : { ...e, z: z.get(e.id)! }))
}
/** 새 요소가 올라갈 z (맨 위) */
export const topZ = (els: BoardEl[]) => els.reduce((a, e) => Math.max(a, e.z), -1) + 1
/** 복사해 붙일 요소: 새 id · 조금 비켜 놓고 맨 위로 */
export function cloneEls(src: BoardEl[], onto: BoardEl[], shift = 24): BoardEl[] {
  let z = topZ(onto)
  return [...src].sort((a, b) => a.z - b.z).map(e => ({ ...e, style: e.style ? { ...e.style } : undefined, id: uid(), x: e.x + shift, y: e.y + shift, z: z++, locked: undefined }))
}
/** 옆 칸에서 넣을 때의 빈 자리: 같은 종류의 마지막 것 오른쪽 → 왼쪽 위부터 겹치지 않는 첫 자리 → 없으면 가운데에서 조금씩 비켜서 */
export function freeSpot(els: Box[], w: number, h: number, page: { w: number; h: number }, near?: Box | null, gap = 24): { x: number; y: number } {
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x + w <= page.w && y + h <= page.h && !els.some(e => boxesTouch(e, { x: x - gap / 2, y: y - gap / 2, w: w + gap, h: h + gap }))
  if (near) { const x = near.x + near.w + gap; if (free(x, near.y)) return { x, y: near.y } }
  const left = Math.min(80, Math.max(0, (page.w - w) / 2)), top = Math.min(140, Math.max(0, (page.h - h) / 2))
  for (let x = left; x + w <= page.w - left; x += 20) for (let y = top; y + h <= page.h - 40; y += 20) if (free(x, y)) return { x, y }
  const n = els.length % 8
  return { x: Math.round(Math.max(0, (page.w - w) / 2) + n * 24), y: Math.round(Math.max(0, (page.h - h) / 2) + n * 24) }
}
