// 화이트보드 페이지 · 슬라이드 (2026-11-28 대표 지시 '작업공간에 프린트가능한 페이지를 기본 제공하고, 쉽게 슬라이드를 만들 수 있게')
//  - 페이지 = Excalidraw 프레임. PDF · PPT 내보내기가 프레임마다 한 쪽이므로, 정해진 크기의 프레임을 한 번에 놓아 준다
//  - 순수 규칙 (시험 tests/board-pages.test.ts)
export type PageKind = 'slide' | 'a4l' | 'a4p'
export const PAGE_SIZES: Record<PageKind, { w: number; h: number; label: string; name: string }> = {
  slide: { w: 1920, h: 1080, label: '슬라이드 16:9', name: '슬라이드' },
  a4l: { w: 1123, h: 794, label: 'A4 가로', name: 'A4' },
  a4p: { w: 794, h: 1123, label: 'A4 세로', name: 'A4' },
}
export const PAGE_GAP = 120
/** 한 줄에 놓는 페이지 수 (넘으면 아랫줄로) */
export const PAGE_ROW = 5

export interface PageBox { id: string; x: number; y: number; width: number; height: number; name?: string | null; type: string; isDeleted?: boolean }

/** 페이지 목록: 위 → 아래, 왼쪽 → 오른쪽 (PDF · PPT 쪽 순서와 같음) */
export function pageList<T extends PageBox>(els: readonly T[]): T[] {
  return els.filter(e => !e.isDeleted && (e.type === 'frame' || e.type === 'magicframe')).sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 새 페이지를 놓을 자리: 마지막 페이지 오른쪽 · 한 줄이 차면 그 줄 아래 첫 칸 · 페이지가 없으면 다른 요소 오른쪽(없으면 0,0) */
export function nextPagePlace(els: readonly PageBox[], kind: PageKind): { x: number; y: number; width: number; height: number; name: string } {
  const size = PAGE_SIZES[kind]
  const pages = pageList(els)
  const name = `${size.name} ${pages.length + 1}`
  const at = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y), width: size.w, height: size.h, name })
  if (!pages.length) {
    const live = els.filter(e => !e.isDeleted)
    if (!live.length) return at(0, 0)
    return at(Math.max(...live.map(e => e.x + e.width)) + PAGE_GAP, Math.min(...live.map(e => e.y)))
  }
  const last = pages[pages.length - 1]
  const row = pages.filter(p => Math.abs(p.y - last.y) < 1)
  if (row.length >= PAGE_ROW) {
    return at(Math.min(...row.map(p => p.x)), Math.max(...row.map(p => p.y + p.height)) + PAGE_GAP)
  }
  return at(Math.max(...row.map(p => p.x + p.width)) + PAGE_GAP, last.y)
}

/** 목록에 보일 이름 */
export const pageLabel = (p: PageBox, i: number) => (p.name && p.name.trim() ? p.name.trim().slice(0, 24) : `페이지 ${i + 1}`)
