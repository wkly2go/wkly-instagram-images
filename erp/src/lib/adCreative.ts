// 광고 소재 이미지 그리기 (캔버스 · 브라우저 안 · 외부 호출 없음)
export interface AdSize { key: string; label: string; w: number; h: number }
export type AdLayout = 'band' | 'overlay' | 'color'
export interface AdText { kicker: string; headline: string; sub: string; cta: string }

export const AD_SIZES: AdSize[] = [
  { key: 'sq', label: '정사각 1:1 · 피드', w: 1080, h: 1080 },
  { key: 'pt', label: '세로 4:5 · 피드', w: 1080, h: 1350 },
  { key: 'st', label: '스토리 · 릴스 9:16', w: 1080, h: 1920 },
  { key: 'ls', label: '가로 1.91:1 · 구글 · 링크', w: 1200, h: 628 },
]
export const AD_LAYOUTS: { key: AdLayout; label: string; hint: string }[] = [
  { key: 'band', label: '사진 + 글 띠', hint: '사진 아래(가로형은 오른쪽)에 브랜드 색 띠를 두고 글을 넣습니다.' },
  { key: 'overlay', label: '사진 위 글', hint: '사진 아래쪽을 브랜드 색으로 흐리게 덮고 글을 올립니다.' },
  { key: 'color', label: '색 바탕', hint: '사진 없이 브랜드 색 바탕에 글만 넣습니다.' },
]

/** 브랜드 색 — 밝은 바탕 위주 (검정 바탕 쓰지 않음) */
export const AD_PALETTE: Record<string, { main: string; ink: string; sub: string; ctaBg: string; ctaInk: string; rgb: [number, number, number] }> = {
  wkly: { main: '#1f6b4a', ink: '#ffffff', sub: '#d9efe2', ctaBg: '#f6f4ef', ctaInk: '#1f6b4a', rgb: [31, 107, 74] },
  arterior: { main: '#efe9df', ink: '#2a2723', sub: '#5b544b', ctaBg: '#8a5a3b', ctaInk: '#ffffff', rgb: [239, 233, 223] },
}

const FONT = "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif"

/** 한 줄 폭에 맞춰 줄 나눔. 띄어쓰기에서 먼저 자르고, 한 낱말이 너무 길면 글자 단위로 자른다. 사용자가 넣은 줄바꿈은 지킨다. */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (measure(next) <= maxWidth) { line = next; continue }
      if (line) out.push(line)
      if (measure(word) <= maxWidth) { line = word; continue }
      line = ''
      for (const ch of word) {
        if (measure(line + ch) > maxWidth && line) { out.push(line); line = ch } else line += ch
      }
    }
    if (line) out.push(line)
  }
  return out
}

export function adFileName(title: string, size: AdSize, layout: AdLayout, type: string) {
  const base = (title.trim() || '광고').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 50)
  return `${base}_${size.w}x${size.h}_${layout}.${type === 'image/png' ? 'png' : 'jpg'}`
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / s, sh = h / s
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
}

/** 글 묶음(작은 글 · 큰 글 · 설명 · 버튼)을 상자 안에 아래 정렬로 그린다. 큰 글은 3줄 안에 들어갈 때까지 줄인다. */
function drawTextBlock(ctx: CanvasRenderingContext2D, t: AdText, box: { x: number; y: number; w: number; h: number }, base: number, pal: (typeof AD_PALETTE)[string], align: 'bottom' | 'center') {
  let hs = base
  let lines: string[] = []
  for (; hs > base * 0.55; hs -= 2) {
    ctx.font = `800 ${hs}px ${FONT}`
    lines = wrapText(s => ctx.measureText(s).width, t.headline, box.w)
    if (lines.length <= 3) break
  }
  lines = lines.slice(0, 3)
  const ks = Math.round(base * 0.42), ss = Math.round(base * 0.46), cs = Math.round(base * 0.44)
  ctx.font = `500 ${ss}px ${FONT}`
  const subLines = t.sub.trim() ? wrapText(s => ctx.measureText(s).width, t.sub, box.w).slice(0, 2) : []
  const gap = base * 0.35
  const ctaH = t.cta.trim() ? cs * 2.2 : 0
  const total = (t.kicker.trim() ? ks * 1.4 + gap * 0.6 : 0) + lines.length * hs * 1.22 + (subLines.length ? gap * 0.7 + subLines.length * ss * 1.45 : 0) + (ctaH ? gap + ctaH : 0)
  let y = align === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  if (t.kicker.trim()) {
    ctx.font = `700 ${ks}px ${FONT}`
    ctx.fillStyle = pal.sub
    ctx.fillText(t.kicker.trim(), box.x, y)
    y += ks * 1.4 + gap * 0.6
  }
  ctx.font = `800 ${hs}px ${FONT}`
  ctx.fillStyle = pal.ink
  for (const l of lines) { ctx.fillText(l, box.x, y); y += hs * 1.22 }
  if (subLines.length) {
    y += gap * 0.7
    ctx.font = `500 ${ss}px ${FONT}`
    ctx.fillStyle = pal.sub
    for (const l of subLines) { ctx.fillText(l, box.x, y); y += ss * 1.45 }
  }
  if (ctaH) {
    y += gap
    ctx.font = `700 ${cs}px ${FONT}`
    const w = ctx.measureText(t.cta.trim()).width + cs * 2.2
    ctx.fillStyle = pal.ctaBg
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, y, w, ctaH, ctaH / 2)
    else ctx.rect(box.x, y, w, ctaH)
    ctx.fill()
    ctx.fillStyle = pal.ctaInk
    ctx.textBaseline = 'middle'
    ctx.fillText(t.cta.trim(), box.x + cs * 1.1, y + ctaH / 2)
  }
}

export function drawAdCreative(canvas: HTMLCanvasElement, size: AdSize, layout: AdLayout, img: HTMLImageElement | null, t: AdText, brand: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pal = AD_PALETTE[brand] ?? AD_PALETTE.wkly
  const { w, h } = size
  canvas.width = w; canvas.height = h
  const landscape = w > h * 1.3
  const story = h > w * 1.5 // 9:16 — 인스타그램 스토리 · 릴스는 위 14% · 아래 20%가 화면 버튼에 가려짐
  const pad = Math.round(Math.min(w, h) * (landscape ? 0.08 : 0.07))
  const base = Math.round(landscape ? h * 0.085 : story ? w * 0.09 : w * 0.08)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = pal.main
  ctx.fillRect(0, 0, w, h)
  const useImg = img && layout !== 'color' ? img : null

  if (useImg && layout === 'band') {
    if (landscape) {
      const bw = Math.round(w * 0.46)
      cover(ctx, useImg, 0, 0, w - bw, h)
      drawTextBlock(ctx, t, { x: w - bw + pad, y: pad, w: bw - pad * 2, h: h - pad * 2 }, base, pal, 'center')
    } else {
      const bh = Math.round(h * (story ? 0.44 : 0.4))
      const safe = story ? h * 0.2 : 0
      cover(ctx, useImg, 0, 0, w, h - bh)
      drawTextBlock(ctx, t, { x: pad, y: h - bh + pad * 0.8, w: w - pad * 2, h: bh - pad * 1.6 - safe }, base, pal, 'center')
    }
    return
  }
  if (useImg && layout === 'overlay') {
    cover(ctx, useImg, 0, 0, w, h)
    const [r, g, b] = pal.rgb
    const grad = landscape ? ctx.createLinearGradient(w, 0, w * 0.25, 0) : ctx.createLinearGradient(0, h, 0, h * 0.3)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.94)`)
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.72)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    const box = landscape ? { x: w * 0.5, y: pad, w: w * 0.5 - pad, h: h - pad * 2 } : story ? { x: pad, y: h * 0.4, w: w - pad * 2, h: h * 0.4 } : { x: pad, y: h * 0.4, w: w - pad * 2, h: h * 0.6 - pad * 1.2 }
    drawTextBlock(ctx, t, box, base, pal, landscape ? 'center' : 'bottom')
    return
  }
  // 색 바탕: 큰 원 장식 하나 + 가운데 글
  ctx.fillStyle = pal.sub
  ctx.globalAlpha = 0.18
  ctx.beginPath()
  ctx.arc(w * 0.88, h * 0.12, Math.min(w, h) * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  drawTextBlock(ctx, t, { x: pad * 1.3, y: story ? h * 0.14 : pad, w: w - pad * 2.6, h: story ? h * 0.66 : h - pad * 2 }, Math.round(base * 1.15), pal, 'center')
}
