// 카드뉴스 장 그리기 (인스타그램 캐러셀 4:5 · 캔버스 · 브라우저 안 · 외부 호출 없음)
// 표지는 광고 이미지(drawAdCreative · 사진 위 글)를 쓰고, 본문 장과 마지막 장은 여기서 그린다. 밝은 바탕 · 검정 바탕 없음.
import { AD_PALETTE, wrapText } from './adCreative.ts'

export const CARD_SIZE = { key: 'card', label: '카드뉴스 4:5', w: 1080, h: 1350 }
const FONT = "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif"
/** 본문 장 바탕: 브랜드 밝은 색 */
const PAPER: Record<string, { bg: string; ink: string; sub: string; accent: string }> = {
  wkly: { bg: '#f6f4ef', ink: '#151d18', sub: '#535c56', accent: '#1f6b4a' },
  arterior: { bg: '#f7f3ec', ink: '#2a2723', sub: '#5b544b', accent: '#8a5a3b' },
}

/** 본문 장: 쪽 번호 · 큰 제목 · 설명 · 아래 브랜드 줄 */
export function drawCardSlide(canvas: HTMLCanvasElement, slide: { title: string; body: string }, page: number, total: number, brand: string, brandName: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const p = PAPER[brand] ?? PAPER.wkly
  const { w, h } = CARD_SIZE
  canvas.width = w; canvas.height = h
  const pad = 96
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, w, h)
  // 위 쪽 번호 띠
  ctx.fillStyle = p.accent
  ctx.fillRect(pad, pad, 64, 8)
  ctx.font = `700 34px ${FONT}`
  ctx.fillStyle = p.accent
  ctx.textBaseline = 'top'
  ctx.fillText(`${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, pad, pad + 32)
  // 제목
  let size = 76
  let lines: string[] = []
  for (; size >= 48; size -= 4) {
    ctx.font = `800 ${size}px ${FONT}`
    lines = wrapText(s => ctx.measureText(s).width, slide.title, w - pad * 2)
    if (lines.length <= 3) break
  }
  ctx.fillStyle = p.ink
  let y = pad + 150
  for (const l of lines.slice(0, 4)) { ctx.fillText(l, pad, y); y += size * 1.28 }
  // 설명
  ctx.font = `400 44px ${FONT}`
  ctx.fillStyle = p.sub
  y += 36
  for (const l of wrapText(s => ctx.measureText(s).width, slide.body, w - pad * 2).slice(0, 8)) { ctx.fillText(l, pad, y); y += 44 * 1.6 }
  // 아래 브랜드 줄
  ctx.fillStyle = p.accent
  ctx.fillRect(pad, h - pad - 4, w - pad * 2, 2)
  ctx.font = `700 32px ${FONT}`
  ctx.textBaseline = 'bottom'
  ctx.fillText(brandName, pad, h - pad - 24)
  if (page < total) {
    ctx.textAlign = 'right'
    ctx.fillText('넘겨 보기 →', w - pad, h - pad - 24)
    ctx.textAlign = 'left'
  }
}

/** 마지막 장: 브랜드 색 바탕 · 행동 유도 · 연결 주소 */
export function drawCardEnd(canvas: HTMLCanvasElement, cta: string, link: string, brand: string, brandName: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pal = AD_PALETTE[brand] ?? AD_PALETTE.wkly
  const { w, h } = CARD_SIZE
  canvas.width = w; canvas.height = h
  ctx.fillStyle = pal.main
  ctx.fillRect(0, 0, w, h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = pal.ink
  ctx.font = `800 64px ${FONT}`
  ctx.fillText(brandName, w / 2, h * 0.36)
  // 버튼
  ctx.font = `800 54px ${FONT}`
  const label = cta || '자세히 보기'
  const bw = Math.min(w - 200, ctx.measureText(label).width + 140), bh = 128
  ctx.fillStyle = pal.ctaBg
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect((w - bw) / 2, h * 0.5 - bh / 2, bw, bh, bh / 2)
  else ctx.rect((w - bw) / 2, h * 0.5 - bh / 2, bw, bh)
  ctx.fill()
  ctx.fillStyle = pal.ctaInk
  ctx.fillText(label, w / 2, h * 0.5)
  ctx.fillStyle = pal.ink
  ctx.font = `400 36px ${FONT}`
  ctx.fillText('프로필 링크에서 확인하세요', w / 2, h * 0.62)
  ctx.font = `400 30px ${FONT}`
  ctx.fillText(link.replace(/^https?:\/\//, '').replace(/\/$/, ''), w / 2, h * 0.67)
  ctx.textAlign = 'left'
}
