// 피그마 프레임 요소 → 화이트보드(Excalidraw) 요소 뼈대 (2026-11-27 대표 '프레임말고 모든 컨텐츠를 불러와서 수정할 수 있게')
// 서버(figma 함수 'content')가 평평하게 만든 요소를 받아, 보드 오른쪽 빈 곳에 같은 배치로 놓는 뼈대를 만든다.
// 글 · 사각형 · 원 · 선 · 연결선은 고칠 수 있는 요소, 아이콘 · 로고 · 사진은 그림 요소. 순수 함수 (시험 tests/figma-to-board.test.ts).

export interface FlatEl {
  id: string
  kind: 'rect' | 'ellipse' | 'text' | 'line' | 'arrow' | 'raster' | 'frame'
  x: number; y: number; w: number; h: number
  fill?: string | null; stroke?: string | null; strokeWidth?: number; radius?: number; opacity?: number
  text?: string; fontSize?: number; align?: 'left' | 'center' | 'right'; color?: string
  name?: string; frame?: string
  points?: [number, number][]
}
export interface FigmaContent {
  frames: { id: string; els: FlatEl[]; truncated: boolean }[]
  images: Record<string, { mime: string; data: string }>
  skipped: number
}
export interface BoardFile { id: string; mimeType: string; dataURL: string; created: number }

const safe = (s: string) => s.replace(/[^0-9a-z]/gi, '_')
const op = (v?: number) => (v == null ? 100 : Math.max(5, Math.min(100, Math.round(v))))

/** 평평한 요소 → Excalidraw 뼈대 + 그림 파일. at = 놓을 왼쪽 위 (첫 프레임 기준) */
export function figmaToSkeleton(c: FigmaContent, at: { x: number; y: number }, stamp = Date.now().toString(36)) {
  const all = c.frames.flatMap(f => f.els)
  if (!all.length) return { skeleton: [] as Record<string, unknown>[], files: [] as BoardFile[], count: 0, rasterMissing: 0, textBoxes: {} as Record<string, { x: number; w: number; align: 'center' | 'right' }> }
  // 프레임끼리의 배치는 피그마 그대로 · 전체를 at 으로 옮김
  const minX = Math.min(...all.map(e => e.x)), minY = Math.min(...all.map(e => e.y))
  const dx = at.x - minX, dy = at.y - minY
  const sid = (id: string) => `fg-${stamp}-${safe(id)}`
  const skeleton: Record<string, unknown>[] = []
  const files: BoardFile[] = []
  const childrenOf = new Map<string, string[]>()
  // 가운데 · 오른쪽 정렬 글은 화이트보드가 글 폭을 잰 뒤 피그마 상자 안에 다시 맞춤 (placeTexts)
  const textBoxes: Record<string, { x: number; w: number; align: 'center' | 'right' }> = {}
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
      el = { ...base, type: 'text', text: e.text ?? '', fontSize: e.fontSize ?? 16, fontFamily: 2, textAlign: e.align ?? 'left', strokeColor: e.color ?? '#151d18' }
      if (e.align === 'center' || e.align === 'right') textBoxes[base.id] = { x: e.x + dx, w: e.w, align: e.align }
    } else if (e.kind === 'line' || e.kind === 'arrow') {
      el = { ...base, type: e.kind, points: e.points ?? [[0, 0], [e.w, e.h]], strokeColor: e.stroke ?? '#151d18', strokeWidth: e.strokeWidth ?? 1, roughness: 0, ...(e.kind === 'arrow' ? { endArrowhead: 'arrow' } : {}) }
    } else if (e.kind === 'raster') {
      const img = c.images[e.id]
      if (img) {
        const fileId = `figma-${stamp}-${safe(e.id)}`
        files.push({ id: fileId, mimeType: img.mime, dataURL: `data:${img.mime};base64,${img.data}`, created: now + files.length })
        el = { ...base, type: 'image', fileId, width: e.w, height: e.h }
      } else {
        // 그림을 못 받은 것은 자리만 (점선 상자 + 이름)
        rasterMissing++
        el = { ...base, type: 'rectangle', width: e.w, height: e.h, backgroundColor: 'transparent', strokeColor: '#9aa39d', strokeStyle: 'dashed', strokeWidth: 1, roughness: 0 }
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

/** 변환된 글 요소를 피그마 상자 기준으로 가운데 · 오른쪽에 다시 놓음 (요소를 바꾼 새 목록) */
export function placeTexts<T extends { id: string; type: string; x: number; width: number }>(els: T[], boxes: Record<string, { x: number; w: number; align: 'center' | 'right' }>): T[] {
  return els.map(e => {
    const b = e.type === 'text' ? boxes[e.id] : undefined
    if (!b) return e
    return { ...e, x: b.align === 'center' ? b.x + (b.w - e.width) / 2 : b.x + b.w - e.width }
  })
}
