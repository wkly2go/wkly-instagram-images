import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Maximize, Minus, Plus, X } from 'lucide-react'

/**
 * 사진 크게 보기 (대표 지시 2026-10-21 "채팅방에서 받은 자료 무한 확대 가능하게")
 *  - 확대 한도 없음: 마우스 휠 · 두 손가락 벌리기 · 가+ 버튼 · 두 번 누르기(2배씩)
 *  - 끌어서 옮기기 · 맞춤(화면에 맞게) · 원본(1:1) · 내려받기 · Esc 닫기
 *  - 확대는 마우스(손가락) 위치를 중심으로
 */
const MIN = 0.05
/** 사실상 한도 없음: 10,000배(1,000,000%)면 사진 점 하나가 화면을 채움 — 그 이상은 브라우저 계산이 깨져서 멈춤 */
const MAX = 10000
export function ImageViewer({ src, name, onClose, onDownload }: { src: string; name: string; onClose: () => void; onDownload?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const [v, setV] = useState({ s: 1, x: 0, y: 0 })
  const [fit, setFit] = useState(1)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; s: number } | null>(null)
  const moved = useRef(false)

  /** 화면에 맞는 배율로 가운데 */
  const reset = useCallback(() => {
    const b = box.current?.getBoundingClientRect()
    const i = img.current
    if (!b || !i?.naturalWidth) return
    const f = Math.min(1, (b.width - 40) / i.naturalWidth, (b.height - 40) / i.naturalHeight)
    setFit(f)
    setV({ s: f, x: (b.width - i.naturalWidth * f) / 2, y: (b.height - i.naturalHeight * f) / 2 })
  }, [])
  /** (cx, cy) 화면 점을 고정한 채 배율을 k 배 */
  const zoomAt = useCallback((k: number, cx?: number, cy?: number) => {
    const b = box.current?.getBoundingClientRect()
    if (!b) return
    const px = cx ?? b.left + b.width / 2
    const py = cy ?? b.top + b.height / 2
    setV(o => {
      const s = Math.min(MAX, Math.max(MIN, o.s * k))
      const r = s / o.s
      const ox = px - b.left
      const oy = py - b.top
      return { s, x: ox - (ox - o.x) * r, y: oy - (oy - o.y) * r }
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomAt(1.25)
      else if (e.key === '-') zoomAt(0.8)
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', reset)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reset)
    }
  }, [onClose, zoomAt, reset])
  // 휠은 passive 가 아니어야 페이지 대신 사진만 확대됨
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: v.s }
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const target = pinch.current.s * (d / pinch.current.d)
      zoomAt(target / v.s, (a.x + b.x) / 2, (a.y + b.y) / 2)
      moved.current = true
      return
    }
    const dx = cur.x - prev.x
    const dy = cur.y - prev.y
    if (Math.abs(dx) + Math.abs(dy) > 1) moved.current = true
    setV(o => ({ ...o, x: o.x + dx, y: o.y + dy }))
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  return createPortal(
    <div className="img-viewer" role="dialog" aria-label={`${name} 크게 보기`}>
      <div className="img-viewer-bar">
        <span className="t-smallb grow truncate">{name}</span>
        <span className="t-meta">{Math.round(v.s * 100).toLocaleString()}%</span>
        <button type="button" className="icon-btn" onClick={() => zoomAt(0.8)} aria-label="축소" title="축소 (-)">
          <Minus size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomAt(1.25)} aria-label="확대" title="확대 (+) · 한도 없음">
          <Plus size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={reset} aria-label="화면에 맞춤" title="화면에 맞춤 (0)">
          <Maximize size={16} />
        </button>
        <button type="button" className="quick-btn" onClick={() => zoomAt(1 / v.s)} title="원본 크기 (1:1)">
          1:1
        </button>
        {onDownload && (
          <button type="button" className="icon-btn" onClick={onDownload} aria-label="내려받기" title="내려받기">
            <Download size={16} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
          <X size={18} />
        </button>
      </div>
      <div
        ref={box}
        className="img-viewer-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={e => (v.s > fit * 1.01 && e.shiftKey ? reset() : zoomAt(2, e.clientX, e.clientY))}
        onClick={e => {
          if (e.target === e.currentTarget && !moved.current) onClose()
        }}
      >
        <img
          ref={img}
          src={src}
          alt={name}
          draggable={false}
          onLoad={reset}
          style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, imageRendering: v.s > 4 ? 'pixelated' : 'auto' }}
        />
      </div>
      <span className="img-viewer-hint t-cap">휠 · 두 손가락으로 확대(한도 없음) · 끌어서 이동 · 두 번 눌러 2배 · Shift+두 번 눌러 맞춤 · Esc 닫기</span>
    </div>,
    document.body,
  )
}
