// 화이트보드 전체 보기 지도 (2026-11-27 대표 '페이지 전체가 보이는 네비게이션이 있으면 좋겠어')
// 보드 오른쪽 아래 작은 지도: 모든 요소(프레임은 테두리 · 사진은 회색 · 글은 가는 줄)와 지금 보는 화면(초록 네모).
// 누르거나 끌면 그 자리로 이동 · '전체' 는 보드 전체가 한 화면에 들어오게. 0.25초마다 다시 그림(요소가 많아도 네모만 그려 가벼움).
import { useEffect, useRef } from 'react'
import { minimapFit, minimapScroll, type Box } from '../lib/board'

interface El { x: number; y: number; width: number; height: number; type: string; isDeleted?: boolean; backgroundColor?: string; strokeColor?: string }
export interface MinimapSource {
  getSceneElements(): readonly El[]
  getAppState(): { scrollX: number; scrollY: number; zoom: { value: number }; width: number; height: number }
  updateScene(s: { appState: { scrollX: number; scrollY: number } }): void
  scrollToContent(target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }): void
}
const W = 208, H = 136

export function BoardMinimap({ source, onHide }: { source: () => MinimapSource | null; onHide: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const fit = useRef<{ scale: number; ox: number; oy: number } | null>(null)
  const view = useRef<Box>({ x: 0, y: 0, w: 1, h: 1 })
  const sig = useRef('')
  useEffect(() => {
    const draw = () => {
      const x = source(), c = cv.current
      if (!x || !c || document.visibilityState !== 'visible') return
      const a = x.getAppState(), els = x.getSceneElements()
      const z = a.zoom?.value || 1
      const v: Box = { x: -a.scrollX, y: -a.scrollY, w: a.width / z, h: a.height / z }
      const key = `${els.length}:${Math.round(v.x)}:${Math.round(v.y)}:${Math.round(v.w)}:${els.length ? `${Math.round(els[els.length - 1].x)}:${Math.round(els[0].y)}` : ''}`
      const moving = key !== sig.current
      sig.current = key
      view.current = v
      const boxes = els.map(e => ({ x: Math.min(e.x, e.x + e.width), y: Math.min(e.y, e.y + e.height), w: Math.abs(e.width), h: Math.abs(e.height) }))
      const f = minimapFit(boxes, v, W, H)
      fit.current = f
      if (!moving && c.dataset.drawn) return
      c.dataset.drawn = '1'
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      g.fillStyle = '#fbfaf7'
      g.fillRect(0, 0, W, H)
      for (let i = 0; i < els.length; i++) {
        const e = els[i], b = boxes[i]
        const rx = b.x * f.scale + f.ox, ry = b.y * f.scale + f.oy, rw = Math.max(1, b.w * f.scale), rh = Math.max(1, b.h * f.scale)
        if (e.type === 'frame' || e.type === 'magicframe') { g.strokeStyle = '#8a958e'; g.lineWidth = 1; g.strokeRect(rx + 0.5, ry + 0.5, rw, rh); continue }
        if (e.type === 'text') { g.fillStyle = '#55605a'; g.fillRect(rx, ry + rh / 2 - 0.5, rw, Math.max(1, Math.min(2, rh / 2))); continue }
        if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') { g.fillStyle = e.strokeColor && e.strokeColor !== 'transparent' ? e.strokeColor : '#55605a'; g.globalAlpha = 0.6; g.fillRect(rx, ry, rw, rh > 2 ? rh : 1); g.globalAlpha = 1; continue }
        g.fillStyle = e.type === 'image' ? '#c3cbc6' : e.backgroundColor && e.backgroundColor !== 'transparent' ? e.backgroundColor : '#e3e8e4'
        g.fillRect(rx, ry, rw, rh)
      }
      // 지금 보는 화면
      const vx = v.x * f.scale + f.ox, vy = v.y * f.scale + f.oy, vw = v.w * f.scale, vh = v.h * f.scale
      g.fillStyle = 'rgba(31, 107, 74, 0.10)'
      g.fillRect(vx, vy, vw, vh)
      g.strokeStyle = '#1f6b4a'
      g.lineWidth = 1.5
      g.strokeRect(vx, vy, vw, vh)
    }
    draw()
    const t = window.setInterval(draw, 250)
    return () => window.clearInterval(t)
  }, [source])

  const go = (e: { clientX: number; clientY: number }) => {
    const x = source(), c = cv.current, f = fit.current
    if (!x || !c || !f) return
    const r = c.getBoundingClientRect()
    x.updateScene({ appState: minimapScroll(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, f, view.current) })
  }
  return (
    <div className="board-map" role="group" aria-label="보드 전체 보기 지도">
      <div className="board-map-head">
        <b>전체 보기</b>
        <span className="grow" />
        <button type="button" onClick={() => source()?.scrollToContent(undefined, { fitToContent: true, animate: true })} title="보드 전체가 한 화면에 들어오게">전체 맞춤</button>
        <button type="button" onClick={onHide} aria-label="지도 숨기기" title="지도 숨기기">×</button>
      </div>
      <canvas
        ref={cv}
        style={{ width: W, height: H }}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); go(e) }}
        onPointerMove={e => { if (e.buttons & 1) go(e) }}
        title="누르거나 끌면 그 자리로 이동"
      />
    </div>
  )
}
