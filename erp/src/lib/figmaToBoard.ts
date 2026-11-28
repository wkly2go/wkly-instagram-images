// 피그마 프레임 요소 → 화이트보드(Excalidraw) 요소 뼈대 (2026-11-27 대표 '프레임말고 모든 컨텐츠를 불러와서 수정할 수 있게')
// 서버(figma 함수 'content')가 평평하게 만든 요소를 받아, 보드 오른쪽 빈 곳에 같은 배치로 놓는 뼈대를 만든다.
// 글 · 사각형 · 원 · 선 · 연결선은 고칠 수 있는 요소, 아이콘 · 로고 · 사진은 그림 요소. 순수 함수 (시험 tests/figma-to-board.test.ts).

import { figmaFontId } from './boardFonts.ts'

export interface FlatEl {
  id: string
  kind: 'rect' | 'ellipse' | 'text' | 'line' | 'arrow' | 'raster' | 'frame'
  x: number; y: number; w: number; h: number
  fill?: string | null; stroke?: string | null; strokeWidth?: number; radius?: number; opacity?: number
  text?: string; fontSize?: number; align?: 'left' | 'center' | 'right'; color?: string
  lineHeight?: number
  font?: string; weight?: number
  name?: string; frame?: string
  points?: [number, number][]
}
export interface FigmaContent {
  frames: { id: string; els: FlatEl[]; truncated: boolean }[]
  images: Record<string, { mime: string; data: string }>
  skipped: number
}
/** 피그마 글 상자 (화이트보드가 글 폭을 잰 뒤 맞출 기준) */
export interface TextBox { x: number; w: number; align: 'left' | 'center' | 'right' }
export interface BoardFile { id: string; mimeType: string; dataURL: string; created: number }

const safe = (s: string) => s.replace(/[^0-9a-z]/gi, '_')
const op = (v?: number) => (v == null ? 100 : Math.max(5, Math.min(100, Math.round(v))))

/** 평평한 요소 → Excalidraw 뼈대 + 그림 파일. at = 놓을 왼쪽 위 (첫 프레임 기준) */
export function figmaToSkeleton(c: FigmaContent, at: { x: number; y: number }, stamp = Date.now().toString(36)) {
  const all = c.frames.flatMap(f => f.els)
  if (!all.length) return { skeleton: [] as Record<string, unknown>[], files: [] as BoardFile[], count: 0, rasterMissing: 0, textBoxes: {} as Record<string, TextBox> }
  // 프레임끼리의 배치는 피그마 그대로 · 전체를 at 으로 옮김
  const minX = Math.min(...all.map(e => e.x)), minY = Math.min(...all.map(e => e.y))
  const dx = at.x - minX, dy = at.y - minY
  const sid = (id: string) => `fg-${stamp}-${safe(id)}`
  const skeleton: Record<string, unknown>[] = []
  const files: BoardFile[] = []
  const childrenOf = new Map<string, string[]>()
  // 가운데 · 오른쪽 정렬 글은 화이트보드가 글 폭을 잰 뒤 피그마 상자 안에 다시 맞춤 (placeTexts)
  const textBoxes: Record<string, TextBox> = {}
  let rasterMissing = 0
  const now = Date.now()
  for (const e of all) {
    if (e.kind === 'frame') continue
    const base = { id: sid(e.id), x: e.x + dx, y: e.y + dy, opacity: op(e.opacity) }
    let el: Record<string, unknown> | null = null
    if (e.kind === 'rect' || e.kind === 'ellipse') {
      el = {
        ...base, type: e.kind === 'rect' ? 'rectangle' : 'ellipse', width: e.w, height: e.h,
        backgroundColor: e.fill ?? 'transparent', fillStyle: 'solid',
        strokeColor: e.stroke ?? 'transparent', strokeWidth: e.strokeWidth ?? 1, roughness: 0,
        roundness: e.kind === 'rect' && (e.radius ?? 0) > 0 ? { type: 3 } : null,
      }
    } else if (e.kind === 'text') {
      el = { ...base, type: 'text', text: e.text ?? '', fontSize: e.fontSize ?? 16, fontFamily: figmaFontId(e.font, e.weight), textAlign: e.align ?? 'left', strokeColor: e.color ?? '#141414', ...(e.lineHeight ? { lineHeight: e.lineHeight } : {}) }
      textBoxes[base.id] = { x: e.x + dx, w: e.w, align: e.align ?? 'left' }
    } else if (e.kind === 'line' || e.kind === 'arrow') {
      el = { ...base, type: e.kind, points: e.points ?? [[0, 0], [e.w, e.h]], strokeColor: e.stroke ?? '#141414', strokeWidth: e.strokeWidth ?? 1, roughness: 0, ...(e.kind === 'arrow' ? { endArrowhead: 'arrow' } : {}) }
    } else if (e.kind === 'raster') {
      const img = c.images[e.id]
      if (img) {
        const fileId = `figma-${stamp}-${safe(e.id)}`
        files.push({ id: fileId, mimeType: img.mime, dataURL: `data:${img.mime};base64,${img.data}`, created: now + files.length })
        el = { ...base, type: 'image', fileId, width: e.w, height: e.h }
      } else {
        // 그림을 못 받은 것은 자리만 (점선 상자 + 이름)
        rasterMissing++
        el = { ...base, type: 'rectangle', width: e.w, height: e.h, backgroundColor: 'transparent', strokeColor: '#9c9c9c', strokeStyle: 'dashed', strokeWidth: 1, roughness: 0 }
      }
    }
    if (!el) continue
    skeleton.push(el)
    if (e.frame) childrenOf.set(e.frame, [...(childrenOf.get(e.frame) ?? []), el.id as string])
  }
  // 프레임은 맨 뒤에 (자식 id 를 알아야 함)
  for (const f of all.filter(e => e.kind === 'frame')) {
    skeleton.push({ type: 'frame', id: sid(f.id), x: f.x + dx, y: f.y + dy, width: f.w, height: f.h, name: f.name || '피그마 프레임', children: childrenOf.get(f.id) ?? [] })
  }
  return { skeleton, files, count: skeleton.length, rasterMissing, textBoxes }
}

/** 변환된 글 요소를 피그마 상자에 맞춤: 글꼴이 달라 넓어진 글은 상자 폭에 맞게 줄이고(3% 넘게 넓을 때) · 가운데 · 오른쪽 정렬은 상자 안 제자리로 */
export function placeTexts<T extends { id: string; type: string; x: number; width: number }>(els: T[], boxes: Record<string, TextBox>): T[] {
  return els.map(e => {
    const b = e.type === 'text' ? boxes[e.id] : undefined
    if (!b) return e
    let out = e as T & { fontSize?: number; height?: number }
    if (b.w > 4 && e.width > b.w * 1.03) {
      const r = b.w / e.width
      out = { ...out, width: b.w, ...(typeof out.fontSize === 'number' ? { fontSize: Math.round(out.fontSize * r * 10) / 10 } : {}), ...(typeof out.height === 'number' ? { height: out.height * r } : {}) }
    }
    const w = out.width
    const x = b.align === 'center' ? b.x + (b.w - w) / 2 : b.align === 'right' ? b.x + b.w - w : out.x
    return { ...out, x }
  })
}

/** 여러 번 받은 요소를 하나로 (프레임 3개씩 나눠 받은 것) */
export function mergeContents(parts: FigmaContent[]): FigmaContent {
  return { frames: parts.flatMap(p => p.frames), images: Object.assign({}, ...parts.map(p => p.images)), skipped: parts.reduce((n, p) => n + p.skipped, 0) }
}

/** '모두 불러오기'에 넣을 프레임: 섹션 자체는 빼고(안의 슬라이드를 하나씩) · 200px 보다 작은 조각(버튼 · 아이콘)은 뺌 · 최대 max 개 */
export function pickAllFrames<T extends { id: string; type: string; w: number; h: number }>(frames: T[], max = 30): T[] {
  return frames.filter(f => f.type !== 'SECTION' && (f.w >= 200 || f.h >= 200)).slice(0, max)
}
