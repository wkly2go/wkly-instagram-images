// 3D 보기의 바닥 · 벽 무늬 (2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 그림 파일 없이 화면 안에서 직접 그린다(비용 · 외부 자료 없음). 같은 재료는 늘 같은 무늬가 나오도록 씨앗을 고정한다.
// 여기서는 밝기 무늬만 만든다 — 색은 마감 글에서 알아본 재료 색을 그대로 곱해 쓴다.
import * as THREE from 'three'
import type { FinishKind } from './designPlanLook.ts'

export interface TexSpec {
  /** 같은 무늬는 한 번만 그린다 */
  key: string
  /** 무늬 한 장이 덮는 실제 크기 (m) */
  w: number
  h: number
  /** 캔버스 한 변 (px) */
  px: number
  /** 벽에 세로 널로 붙일 때: 무늬의 긴 쪽을 높이 방향으로 돌린다 */
  upright?: boolean
  draw: (c: CanvasRenderingContext2D, size: number, rnd: () => number) => void
}
export type SurfaceUse = 'floor' | 'wall' | 'ceiling'

/** 씨앗이 같으면 늘 같은 수가 나오는 난수 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hashText(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** 밝기 v(0~1)의 따뜻한 회색 */
const tone = (v: number, warm = 0) => `rgb(${Math.round(255 * v)},${Math.round(255 * v * (1 - warm * 0.4))},${Math.round(255 * v * (1 - warm))})`

/** 마루 널: rows 줄, 한 줄에 per 장. 줄마다 이음 자리를 어긋나게 */
function planks(rows: number, per: number) {
  return (c: CanvasRenderingContext2D, S: number, rnd: () => number) => {
    const rh = S / rows, len = S / per
    c.fillStyle = '#fff'
    c.fillRect(0, 0, S, S)
    for (let r = 0; r < rows; r++) {
      const y = r * rh, off = Math.floor(rnd() * len)
      for (let k = 0; k < per; k++) {
        const x0 = off + k * len
        const v = 0.84 + rnd() * 0.16, warm = 0.02 + rnd() * 0.05
        const grain = Array.from({ length: 6 + Math.floor(rnd() * 6) }, () => ({ y: rnd(), a: 0.03 + rnd() * 0.07, amp: rnd() * rh * 0.06, f: 0.5 + rnd() * 1.5, ph: rnd() * 6.28, lw: 0.6 + rnd() * 1.4 }))
        const knot = rnd() < 0.1 ? { x: 0.15 + rnd() * 0.7, y: 0.3 + rnd() * 0.4, r: rh * (0.07 + rnd() * 0.07) } : null
        for (const dx of [0, -S]) {
          if (x0 + dx + len <= 0 || x0 + dx >= S) continue
          c.save()
          c.beginPath(); c.rect(x0 + dx, y, len, rh); c.clip()
          c.fillStyle = tone(v, warm)
          c.fillRect(x0 + dx, y, len, rh)
          for (const g of grain) {
            c.strokeStyle = `rgba(72,52,32,${g.a})`
            c.lineWidth = g.lw
            c.beginPath()
            for (let i = 0; i <= 16; i++) {
              const px = x0 + dx + (len * i) / 16, py = y + g.y * rh + Math.sin((i / 16) * 6.28 * g.f + g.ph) * g.amp
              if (i) c.lineTo(px, py); else c.moveTo(px, py)
            }
            c.stroke()
          }
          if (knot) for (let i = 3; i >= 1; i--) {
            c.strokeStyle = `rgba(72,52,32,${0.05 * i})`
            c.lineWidth = 1
            c.beginPath(); c.ellipse(x0 + dx + knot.x * len, y + knot.y * rh, knot.r * i, knot.r * i * 0.45, 0, 0, 6.2832); c.stroke()
          }
          c.restore()
          if (per > 1) { c.fillStyle = 'rgba(60,42,26,.34)'; c.fillRect(Math.round(x0 + dx), y, 1.2, rh) }
        }
      }
      c.fillStyle = 'rgba(60,42,26,.4)'
      c.fillRect(0, Math.round(y), S, 1.3)
    }
  }
}

/** 타일: nx × ny 장과 줄눈. soft 는 줄눈이 옅은 바닥재(데코타일) */
function tiles(nx: number, ny: number, soft = false) {
  return (c: CanvasRenderingContext2D, S: number, rnd: () => number) => {
    const cw = S / nx, ch = S / ny, g = Math.max(1.6, S / 420) * (soft ? 0.6 : 1)
    c.fillStyle = soft ? tone(0.88, 0.02) : tone(0.79, 0.03)
    c.fillRect(0, 0, S, S)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * cw + g / 2, y = j * ch + g / 2, w = cw - g, h = ch - g
      c.fillStyle = tone(0.94 + rnd() * 0.06, rnd() * 0.012)
      c.fillRect(x, y, w, h)
      c.save()
      c.beginPath(); c.rect(x, y, w, h); c.clip()
      for (let m = 0; m < 3; m++) {
        const mx = x + rnd() * w, my = y + rnd() * h, mr = Math.max(cw, ch) * (0.2 + rnd() * 0.3)
        const grad = c.createRadialGradient(mx, my, 0, mx, my, mr)
        grad.addColorStop(0, `rgba(120,115,105,${0.012 + rnd() * 0.02})`)
        grad.addColorStop(1, 'rgba(120,115,105,0)')
        c.fillStyle = grad
        c.fillRect(mx - mr, my - mr, mr * 2, mr * 2)
      }
      c.restore()
    }
  }
}

/** 가장자리를 넘는 그림을 반대쪽에도 그려 이음매가 보이지 않게 */
const wrap = (S: number, fn: (dx: number, dy: number) => void) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy) }

function clouds(c: CanvasRenderingContext2D, S: number, rnd: () => number, n: number, strength: number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S, r = S * (0.08 + rnd() * 0.16), a = (0.03 + rnd() * 0.04) * strength, dark = rnd() < 0.7
    wrap(S, (dx, dy) => {
      const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      g.addColorStop(0, dark ? `rgba(110,105,98,${a})` : `rgba(255,255,255,${a * 1.6})`)
      g.addColorStop(1, dark ? 'rgba(110,105,98,0)' : 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
    })
  }
}

/** 석재: 구름결과 결(대리석) 또는 알갱이(테라조), 판 이음 */
function stone(slabs: number, terrazzo: boolean) {
  return (c: CanvasRenderingContext2D, S: number, rnd: () => number) => {
    c.fillStyle = tone(0.965, 0.012)
    c.fillRect(0, 0, S, S)
    clouds(c, S, rnd, 16, 0.5)
    if (terrazzo) {
      const chips = ['rgba(96,94,90,.55)', 'rgba(160,156,148,.55)', 'rgba(150,120,96,.5)', 'rgba(255,255,255,.75)', 'rgba(120,128,126,.5)']
      for (let i = 0; i < 950; i++) {
        const x = rnd() * S, y = rnd() * S, r = 1.4 + rnd() * rnd() * 6, n = 5 + Math.floor(rnd() * 3), rot = rnd() * 6.28, col = chips[Math.floor(rnd() * chips.length)]
        const pts = Array.from({ length: n }, (_, k) => { const a = rot + (k / n) * 6.2832, rr = r * (0.6 + rnd() * 0.5); return [Math.cos(a) * rr, Math.sin(a) * rr] })
        wrap(S, (dx, dy) => {
          if (x + dx < -8 || x + dx > S + 8 || y + dy < -8 || y + dy > S + 8) return
          c.fillStyle = col
          c.beginPath()
          pts.forEach(([px, py], k) => (k ? c.lineTo(x + dx + px, y + dy + py) : c.moveTo(x + dx + px, y + dy + py)))
          c.closePath(); c.fill()
        })
      }
    } else {
      for (let i = 0; i < 9; i++) {
        let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28
        const pts: [number, number][] = [[x, y]]
        const steps = 8 + Math.floor(rnd() * 8), step = S * (0.03 + rnd() * 0.04)
        for (let k = 0; k < steps; k++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y]) }
        const alpha = 0.11 + rnd() * 0.13, lw = 0.8 + rnd() * 1.6
        wrap(S, (dx, dy) => {
          for (const [w, al] of [[lw * 5, alpha * 0.25], [lw, alpha]] as const) {
            c.strokeStyle = `rgba(104,98,90,${al})`
            c.lineWidth = w
            c.lineJoin = 'round'
            c.beginPath()
            pts.forEach(([px, py], k) => (k ? c.lineTo(px + dx, py + dy) : c.moveTo(px + dx, py + dy)))
            c.stroke()
          }
        })
      }
    }
    c.fillStyle = 'rgba(92,88,80,.26)'
    for (let i = 0; i < slabs; i++) { c.fillRect(Math.round((S * i) / slabs), 0, 1.2, S); c.fillRect(0, Math.round((S * i) / slabs), S, 1.2) }
  }
}

/** 고운 알갱이: 카펫 · 패브릭 · 벽지. weave 는 올이 엇갈린 짜임 */
function noise(lo: number, weave: boolean, warm = 0.02) {
  return (c: CanvasRenderingContext2D, S: number, rnd: () => number) => {
    const img = c.createImageData(S, S), d = img.data
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = lo + rnd() * (1 - lo)
      if (weave && ((x >> 1) + (y >> 1)) % 2) v *= 0.965
      const i = (y * S + x) * 4
      d[i] = 255 * v; d[i + 1] = 255 * v * (1 - warm * 0.4); d[i + 2] = 255 * v * (1 - warm); d[i + 3] = 255
    }
    c.putImageData(img, 0, 0)
  }
}

/** 콘크리트 · 몰탈: 얼룩과 잔 구멍 */
function concrete(c: CanvasRenderingContext2D, S: number, rnd: () => number) {
  noise(0.93, false, 0.01)(c, S, rnd)
  clouds(c, S, rnd, 34, 1.5)
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(70,70,68,${0.1 + rnd() * 0.2})`
    c.beginPath(); c.arc(rnd() * S, rnd() * S, 0.5 + rnd() * 1.3, 0, 6.2832); c.fill()
  }
}

/** 마감 글에 적힌 타일 크기(600각 · 300x600). 없으면 바닥 600각, 벽 300×600 */
export function tileSize(text: string, use: SurfaceUse): [number, number] {
  const pair = text.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})/i)
  const ok = (n: number) => n >= 50 && n <= 2400
  if (pair && ok(+pair[1]) && ok(+pair[2])) return use === 'wall' ? [Math.max(+pair[1], +pair[2]), Math.min(+pair[1], +pair[2])] : [+pair[1], +pair[2]]
  const sq = text.match(/(\d{2,4})\s*각/)
  if (sq && ok(+sq[1])) return [+sq[1], +sq[1]]
  return use === 'wall' ? [600, 300] : [600, 600]
}

/** 재료 종류 → 무늬. 페인트 · 금속 · 유리처럼 민무늬인 재료는 null */
export function surfaceTexture(kind: FinishKind, use: SurfaceUse, text = ''): TexSpec | null {
  if (kind === 'wood') return use === 'wall' ? { key: 'wood-panel', w: 2.4, h: 2.4, px: 1024, upright: true, draw: planks(16, 1) } : { key: 'wood-plank', w: 2.4, h: 2.4, px: 1024, draw: planks(16, 2) }
  if (kind === 'tile') { const [tw, th] = tileSize(text, use); return { key: `tile-${tw}x${th}`, w: (tw * 4) / 1000, h: (th * 4) / 1000, px: 1024, draw: tiles(4, 4) } }
  if (kind === 'stone') { const tz = /테라조|terrazzo/i.test(text); return { key: tz ? 'terrazzo' : 'stone', w: 2.4, h: 2.4, px: 1024, draw: stone(use === 'floor' ? 3 : 2, tz) } }
  if (kind === 'carpet') return { key: 'carpet', w: 0.45, h: 0.45, px: 256, draw: noise(0.8, false, 0.015) }
  if (kind === 'fabric') return { key: 'fabric', w: 0.3, h: 0.3, px: 256, draw: noise(0.88, true) }
  if (kind === 'concrete') return { key: 'concrete', w: 3, h: 3, px: 512, draw: concrete }
  if (kind === 'wallpaper') return { key: 'wallpaper', w: 0.5, h: 0.5, px: 256, draw: noise(0.95, true, 0.01) }
  if (kind === 'vinyl' && use === 'floor' && /데코\s*타일|lvt|p\s*타일/i.test(text)) return { key: 'vinyl-450', w: 1.8, h: 1.8, px: 512, draw: tiles(4, 4, true) }
  return null
}

/** 그린 무늬를 모아 두고 다시 쓴다. 화면을 닫을 때 한꺼번에 버린다 */
export class TextureBank {
  private map = new Map<string, THREE.CanvasTexture>()
  anisotropy: number
  constructor(anisotropy = 4) { this.anisotropy = anisotropy }
  get(spec: TexSpec): THREE.Texture | null {
    if (typeof document === 'undefined') return null
    let tex = this.map.get(spec.key)
    if (!tex) {
      const cv = document.createElement('canvas')
      cv.width = cv.height = spec.px
      const ctx = cv.getContext('2d')
      if (!ctx) return null
      spec.draw(ctx, spec.px, seeded(hashText(spec.key)))
      tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = this.anisotropy
      tex.name = spec.key
      this.map.set(spec.key, tex)
    }
    return tex
  }
  dispose() {
    for (const t of this.map.values()) t.dispose()
    this.map.clear()
  }
}
