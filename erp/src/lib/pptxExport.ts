// 화이트보드 → PPT (2026-11-28 대표 지시 'ppt로 내보내기 만들어')
//  - 페이지(프레임)마다 슬라이드 한 장. 글은 파워포인트에서 고칠 수 있는 글 상자로, 나머지(도형 · 선 · 사진)는 그 쪽 그림 한 장으로
//  - 슬라이드 크기는 첫 페이지 비율 (폭 13.333인치) · 크기가 다른 페이지는 가운데에 맞춰 넣음
//  - 자리 계산은 순수 규칙(시험 tests/pptx-export.test.ts) · 파일 만들기는 pptxgenjs(MIT · 내보낼 때만 불러옴)
export const PPT_W_IN = 13.333

export interface PptFrame { x: number; y: number; width: number; height: number }
export interface PptTextEl { x: number; y: number; width: number; height: number; text: string; fontSize: number; fontFamily?: number; textAlign?: string; strokeColor?: string; angle?: number; opacity?: number }
export interface PptText { text: string; x: number; y: number; w: number; h: number; fontSize: number; color: string; align: 'left' | 'center' | 'right'; bold: boolean; rotate: number }
export interface PptFit { scale: number; ox: number; oy: number; w: number; h: number }

/** 페이지를 슬라이드 안에 맞춤 (인치) */
export function pptFit(frame: PptFrame, slideW: number, slideH: number): PptFit {
  const scale = Math.min(slideW / frame.width, slideH / frame.height)
  const w = frame.width * scale, h = frame.height * scale
  return { scale, ox: (slideW - w) / 2, oy: (slideH - h) / 2, w, h }
}
export const pptSlideSize = (first: PptFrame) => ({ w: PPT_W_IN, h: Math.round((PPT_W_IN * first.height / first.width) * 1000) / 1000 })

const hex6 = (c?: string) => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})/i.exec(c ?? '')
  if (!m) return '151D18'
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]
  return h.toUpperCase()
}
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** 페이지 안 글 요소 → 슬라이드 글 상자 (인치 · 포인트). boldFont = 굵은 글꼴 번호 */
export function pptTexts(frame: PptFrame, texts: readonly PptTextEl[], fit: PptFit, boldFont = 9): PptText[] {
  const out: PptText[] = []
  for (const t of texts) {
    if (!t.text?.trim() || !(t.width > 0) || !(t.height > 0)) continue
    const align = t.textAlign === 'center' ? 'center' : t.textAlign === 'right' ? 'right' : 'left'
    // 파워포인트 글꼴이 조금 넓을 수 있어 상자 폭에 여유를 둠 (정렬 방향은 지킴)
    const pad = t.width * 0.06
    const x = align === 'left' ? t.x : align === 'right' ? t.x - pad : t.x - pad / 2
    out.push({
      text: t.text,
      x: r3(fit.ox + (x - frame.x) * fit.scale), y: r3(fit.oy + (t.y - frame.y) * fit.scale),
      w: r3((t.width + pad) * fit.scale), h: r3(t.height * fit.scale),
      fontSize: Math.max(1, Math.round(t.fontSize * fit.scale * 72 * 10) / 10),
      color: hex6(t.strokeColor), align, bold: t.fontFamily === boldFont,
      rotate: Math.round(((t.angle ?? 0) * 180) / Math.PI) % 360,
    })
  }
  return out
}

export interface PptSlide { image: string; frame: PptFrame; texts: PptTextEl[] }
/** 슬라이드 묶음 → .pptx (Blob) */
export async function buildPptx(slides: PptSlide[], title: string): Promise<Blob> {
  if (!slides.length) throw new Error('내보낼 페이지가 없습니다.')
  const Pptx = (await import('pptxgenjs')).default
  const p = new Pptx()
  const size = pptSlideSize(slides[0].frame)
  p.defineLayout({ name: 'WKLY', width: size.w, height: size.h })
  p.layout = 'WKLY'
  p.title = title
  for (const s of slides) {
    const slide = p.addSlide()
    slide.background = { color: 'FFFFFF' }
    const fit = pptFit(s.frame, size.w, size.h)
    slide.addImage({ data: s.image, x: fit.ox, y: fit.oy, w: fit.w, h: fit.h })
    for (const t of pptTexts(s.frame, s.texts, fit)) {
      slide.addText(t.text, { x: t.x, y: t.y, w: t.w, h: t.h, fontSize: t.fontSize, color: t.color, align: t.align, bold: t.bold, valign: 'top', margin: 0, fontFace: 'Pretendard', fit: 'none', wrap: false, ...(t.rotate ? { rotate: t.rotate } : {}) } as never)
    }
  }
  return (await p.write({ outputType: 'blob' })) as Blob
}
