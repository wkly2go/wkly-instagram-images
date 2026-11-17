// 제안 보드의 판 — 넓은 바탕 위에 16:9 페이지를 옆으로 늘어놓고, 휠로 옮기고 Ctrl+휠로 커서 자리를 확대한다.
// 고르기 · 옮기기 · 크기 바꾸기 · 끌어서 여러 개 고르기 · 붙기 안내선을 맡는다. 자료를 바꾸는 일은 부모(DesignBoard)가 한다.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import { boundsOf, boxesTouch, pageLeft, resizeBox, snapMove, snapTargets, snapValue, type BoardComment, type BoardEl, type BoardHandle, type BoardPage, type Box } from '../lib/designBoard'
import { BoardElView, elBox, textStyle } from './DesignBoardEl'

export type BoardTool = 'select' | 'text' | 'rect' | 'note' | 'comment'
export interface BoardCanvasHandle { fit(pageId?: string): void; zoomTo(k: number): void; zoomBy(f: number): void; centerOn(pageId: string, x: number, y: number): void }
export type Pin = BoardComment & { no: number }
interface Props {
  pages: BoardPage[]; pins: Pin[]; cur: string; sel: string[]; tool: BoardTool; editing: string | null; pinSel: string | null
  draftPin: { page: string; x: number; y: number } | null; readOnly: boolean
  onCur(id: string): void; onSel(ids: string[]): void; onEditing(id: string | null): void
  onCreate(tool: 'text' | 'rect' | 'note', pageId: string, x: number, y: number): void
  onPin(pageId: string, x: number, y: number): void; onPickPin(id: string): void
  onDropSpec(specId: string, pageId: string, x: number, y: number): void
  onBegin(): void; onLive(pages: BoardPage[]): void; onEnd(): void
  onText(id: string, text: string): void
  onZoom(k: number): void
}
type View = { x: number; y: number; k: number }
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; sx: number; sy: number; page: string; ids: string[]; base: BoardPage[]; moved: boolean }
  | { kind: 'resize'; sx: number; sy: number; page: string; id: string; handle: BoardHandle; base: BoardPage[]; moved: boolean }
  | { kind: 'marquee'; page: string; x0: number; y0: number; keep: string[] }
const HANDLES: BoardHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_AT: Record<BoardHandle, [number, number]> = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

function InlineEdit({ el, onDone }: { el: BoardEl; onDone(text: string): void }) {
  const [t, setT] = useState(el.text ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const a = ref.current; if (a) { a.focus(); a.select() } }, [])
  return <textarea ref={ref} className={`dbd-inline dbd-inline-${el.type}`} style={{ ...textStyle(el), background: el.type === 'note' ? el.style?.fill ?? '#fff3bf' : el.type === 'rect' ? el.style?.fill ?? '#eef3ee' : el.style?.fill }} value={t} aria-label="글 고치기"
    onChange={e => setT(e.target.value)} onBlur={() => onDone(t)} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.currentTarget.blur() } }} />
}

export const DesignBoardCanvas = forwardRef<BoardCanvasHandle, Props>(function DesignBoardCanvas(p, ref) {
  const vp = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ x: 40, y: 70, k: 0.4 })
  const viewRef = useRef(view)
  const drag = useRef<Drag | null>(null)
  const space = useRef(false)
  const [panning, setPanning] = useState(false)
  const [spaceOn, setSpaceOn] = useState(false)
  const [guides, setGuides] = useState<{ page: string; gx: number | null; gy: number | null } | null>(null)
  const [marquee, setMarquee] = useState<({ page: string } & Box) | null>(null)
  const props = useRef(p)
  props.current = p
  /** 사람이 직접 판을 옮기거나 확대하기 전까지는 판 크기가 바뀔 때마다 다시 맞춘다 */
  const moved = useRef(false)
  const setView = (v: View, auto = false) => { if (!auto) moved.current = true; viewRef.current = v; setViewState(v); props.current.onZoom(v.k) }

  const fit = (pageId?: string) => {
    const el = vp.current, { pages, cur } = props.current
    if (!el || !pages.length) return
    const i = Math.max(0, pages.findIndex(x => x.id === (pageId ?? cur))), pg = pages[i]
    const w = el.clientWidth, h = el.clientHeight
    if (w < 40 || h < 40) return
    const k = clamp(Math.min((w - 64) / pg.w, (h - 96) / pg.h), 0.05, 4)
    setView({ k, x: (w - pg.w * k) / 2 - pageLeft(pages, i) * k, y: (h - pg.h * k) / 2 + 12 }, true)
    moved.current = false
  }
  const zoomAround = (k: number, px?: number, py?: number) => {
    const el = vp.current, v = viewRef.current
    if (!el) return
    const cx = px ?? el.clientWidth / 2, cy = py ?? el.clientHeight / 2, nk = clamp(k, 0.05, 4)
    setView({ k: nk, x: cx - (cx - v.x) * (nk / v.k), y: cy - (cy - v.y) * (nk / v.k) })
  }
  useImperativeHandle(ref, () => ({
    fit, zoomTo: k => zoomAround(k), zoomBy: f => zoomAround(viewRef.current.k * f),
    centerOn: (pageId, x, y) => {
      const el = vp.current, { pages } = props.current, i = pages.findIndex(q => q.id === pageId), v = viewRef.current
      if (!el || i < 0) return
      setView({ ...v, x: el.clientWidth / 2 - (pageLeft(pages, i) + x) * v.k, y: el.clientHeight / 2 - y * v.k })
    },
  }))
  // 처음 한 번, 그리고 판의 크기가 처음 잡힐 때 지금 페이지에 맞춘다
  const fitted = useRef(false)
  useLayoutEffect(() => {
    const el = vp.current
    if (!el) return
    const ro = new ResizeObserver(() => { if ((!fitted.current || !moved.current) && el.clientWidth > 40 && el.clientHeight > 40) { fitted.current = true; fit() } })
    ro.observe(el)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 휠: 그냥 굴리면 옮기기, Ctrl · Cmd 와 함께(트랙패드 두 손가락 벌리기 포함)면 커서 자리에서 확대
  useEffect(() => {
    const el = vp.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (typing(e.target)) return
      e.preventDefault()
      const r = el.getBoundingClientRect(), v = viewRef.current, unit = e.deltaMode === 1 ? 32 : 1
      if (e.ctrlKey || e.metaKey) zoomAround(v.k * Math.exp(-e.deltaY * unit * 0.0025), e.clientX - r.left, e.clientY - r.top)
      else if (e.shiftKey && !e.deltaX) setView({ ...v, x: v.x - e.deltaY * unit })
      else setView({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 스페이스를 누르고 있는 동안은 끌어서 옮기기
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e.target) && (document.activeElement === document.body || vp.current?.closest('.dbd')?.contains(document.activeElement))) { e.preventDefault(); if (!space.current) { space.current = true; setSpaceOn(true) } } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; setSpaceOn(false) } }
    const blur = () => { space.current = false; setSpaceOn(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  /** 화면 좌표 → 그 자리의 페이지와 페이지 안 좌표 (페이지 밖이면 지금 페이지 기준) */
  const locate = (cx: number, cy: number) => {
    const r = vp.current!.getBoundingClientRect(), v = viewRef.current, { pages, cur } = props.current
    const wx = (cx - r.left - v.x) / v.k, wy = (cy - r.top - v.y) / v.k
    let i = pages.findIndex((pg, n) => wx >= pageLeft(pages, n) && wx <= pageLeft(pages, n) + pg.w && wy >= 0 && wy <= pg.h)
    const inside = i >= 0
    if (i < 0) i = Math.max(0, pages.findIndex(pg => pg.id === cur))
    return { page: pages[i], x: wx - pageLeft(pages, i), y: wy, inside }
  }

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (typing(t)) return
    const { tool, pages, sel, cur, readOnly } = props.current
    vp.current?.focus({ preventScroll: true })
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y }
      setPanning(true); e.currentTarget.setPointerCapture(e.pointerId); return
    }
    if (e.button !== 0) return
    const pin = t.closest<HTMLElement>('[data-pin]')
    if (pin) { props.current.onPickPin(pin.dataset.pin!); return }
    const at = locate(e.clientX, e.clientY)
    if (readOnly) return
    if (tool === 'text' || tool === 'rect' || tool === 'note') { if (at.inside) { e.preventDefault(); props.current.onCreate(tool, at.page.id, at.x, at.y) } return }
    if (tool === 'comment') { if (at.inside) { e.preventDefault(); props.current.onPin(at.page.id, at.x, at.y) } return }
    const handle = t.closest<HTMLElement>('[data-handle]')
    if (handle && sel.length === 1) {
      e.preventDefault()
      drag.current = { kind: 'resize', sx: e.clientX, sy: e.clientY, page: cur, id: sel[0], handle: handle.dataset.handle as BoardHandle, base: pages, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId); return
    }
    const hit = t.closest<HTMLElement>('[data-el]')
    if (hit) {
      const id = hit.dataset.el!, pageId = hit.dataset.page!
      if (props.current.editing && props.current.editing !== id) props.current.onEditing(null)
      let ids = pageId === cur ? sel : []
      if (e.shiftKey) ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
      else if (!ids.includes(id)) ids = [id]
      if (pageId !== cur) props.current.onCur(pageId)
      props.current.onSel(ids)
      const page = pages.find(x => x.id === pageId)!
      const movable = ids.filter(x => !page.els.find(q => q.id === x)?.locked)
      if (movable.length && ids.includes(id) && !e.shiftKey) {
        drag.current = { kind: 'move', sx: e.clientX, sy: e.clientY, page: pageId, ids: movable, base: pages, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      return
    }
    // 빈 곳: 그 페이지를 지금 페이지로 하고 끌어서 고르기를 시작한다
    if (at.inside && at.page.id !== cur) props.current.onCur(at.page.id)
    if (props.current.editing) props.current.onEditing(null)
    const keep = e.shiftKey && at.page.id === cur ? sel : []
    if (!e.shiftKey) props.current.onSel([])
    drag.current = { kind: 'marquee', page: at.page.id, x0: at.x, y0: at.y, keep }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const v = viewRef.current
    if (d.kind === 'pan') { setView({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }); return }
    if (d.kind === 'marquee') {
      const at = locate(e.clientX, e.clientY), pages = props.current.pages
      const i0 = pages.findIndex(x => x.id === d.page), i1 = pages.findIndex(x => x.id === at.page.id)
      const x1 = at.x + pageLeft(pages, i1) - pageLeft(pages, i0), y1 = at.y
      const box = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) }
      setMarquee({ page: d.page, ...box })
      const pg = pages[i0]
      if (pg) props.current.onSel([...new Set([...d.keep, ...pg.els.filter(q => boxesTouch(q, box)).map(q => q.id)])])
      return
    }
    if (!d.moved) { if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return; d.moved = true; props.current.onBegin() }
    let dx = (e.clientX - d.sx) / v.k, dy = (e.clientY - d.sy) / v.k
    const page = d.base.find(x => x.id === d.page)
    if (!page) return
    const tol = 6 / v.k, free = e.altKey
    if (d.kind === 'move') {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      const pick = new Set(d.ids), bb = boundsOf(page.els.filter(q => pick.has(q.id)))
      if (!bb) return
      const moved = { ...bb, x: bb.x + dx, y: bb.y + dy }
      const s = free ? { x: moved.x, y: moved.y, gx: null, gy: null } : snapMove(moved, page.els.filter(q => !pick.has(q.id)), page, tol)
      const ddx = s.x - bb.x, ddy = s.y - bb.y
      setGuides(s.gx === null && s.gy === null ? null : { page: d.page, gx: s.gx, gy: s.gy })
      props.current.onLive(d.base.map(pg => (pg.id !== d.page ? pg : { ...pg, els: pg.els.map(q => (pick.has(q.id) ? { ...q, x: Math.round(q.x + ddx), y: Math.round(q.y + ddy) } : q)) })))
      return
    }
    const el = page.els.find(q => q.id === d.id)
    if (!el) return
    const b = resizeBox(el, d.handle, dx, dy, e.shiftKey)
    let gx: number | null = null, gy: number | null = null
    if (!free && !e.shiftKey) {
      const { xs, ys } = snapTargets(page.els.filter(q => q.id !== d.id), page)
      if (d.handle.includes('e')) { const s = snapValue(b.x + b.w, xs, tol); if (s.hit !== null && s.v - b.x >= 16) { b.w = s.v - b.x; gx = s.hit } }
      if (d.handle.includes('w')) { const s = snapValue(b.x, xs, tol); if (s.hit !== null && b.x + b.w - s.v >= 16) { b.w += b.x - s.v; b.x = s.v; gx = s.hit } }
      if (d.handle.includes('s')) { const s = snapValue(b.y + b.h, ys, tol); if (s.hit !== null && s.v - b.y >= 16) { b.h = s.v - b.y; gy = s.hit } }
      if (d.handle.includes('n')) { const s = snapValue(b.y, ys, tol); if (s.hit !== null && b.y + b.h - s.v >= 16) { b.h += b.y - s.v; b.y = s.v; gy = s.hit } }
    }
    setGuides(gx === null && gy === null ? null : { page: d.page, gx, gy })
    props.current.onLive(d.base.map(pg => (pg.id !== d.page ? pg : { ...pg, els: pg.els.map(q => (q.id === d.id ? { ...q, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } : q)) })))
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 이미 풀림 */ }
    if (d.kind === 'pan') setPanning(false)
    if (d.kind === 'marquee') setMarquee(null)
    if ((d.kind === 'move' || d.kind === 'resize') && d.moved) props.current.onEnd()
    setGuides(null)
  }
  const dbl = (e: RMouseEvent<HTMLDivElement>) => {
    if (props.current.readOnly || props.current.tool !== 'select') return
    // 누른 채 끌 수 있게 포인터를 판이 잡고 있어 e.target 은 판이다 — 그 자리의 요소를 직접 찾는다
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-el]')
    if (!hit) return
    const page = props.current.pages.find(x => x.id === hit.dataset.page), el = page?.els.find(q => q.id === hit.dataset.el)
    if (el && !el.locked && (el.type === 'text' || el.type === 'note' || el.type === 'rect')) props.current.onEditing(el.id)
  }
  const drop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw.startsWith('dbd-spec:')) return
    e.preventDefault()
    const at = locate(e.clientX, e.clientY)
    props.current.onDropSpec(raw.slice(9), at.page.id, at.x, at.y)
  }

  const { pages, cur, sel, tool, editing, pins, pinSel, draftPin } = p
  const world: CSSProperties = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, ['--ik' as string]: 1 / view.k }
  return (
    <div ref={vp} className={`dbd-viewport tool-${tool}${panning ? ' panning' : spaceOn ? ' can-pan' : ''}`} tabIndex={0} aria-label="제안 보드 판"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl}
      onDragOver={e => { if (e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }} onDrop={drop} onAuxClick={e => e.preventDefault()}>
      <div className="dbd-world" style={world}>
        {pages.map((pg, i) => {
          const mine = pg.id === cur, picked = mine ? pg.els.filter(q => sel.includes(q.id)) : []
          return (
            <div key={pg.id} className={`dbd-frame${mine ? ' cur' : ''}`} style={{ left: pageLeft(pages, i), top: 0, width: pg.w, height: pg.h }}>
              <div className="dbd-frame-name">{i + 1}. {pg.name || '이름 없는 페이지'}</div>
              <div className="dbd-page" style={{ width: pg.w, height: pg.h, background: pg.bg ?? '#fff' }}>
                {[...pg.els].sort((a, b) => a.z - b.z).map(q => (
                  <div key={q.id} data-el={q.id} data-page={pg.id} className={`dbd-el dbd-el-${q.type}${q.locked ? ' locked' : ''}`} style={elBox(q)}>
                    {editing === q.id ? <InlineEdit el={q} onDone={t => { props.current.onText(q.id, t); props.current.onEditing(null) }} /> : <BoardElView el={q} />}
                  </div>
                ))}
              </div>
              <div className="dbd-over">
                {picked.map(q => <div key={q.id} className={`dbd-pick${q.locked ? ' locked' : ''}`} style={elBox(q)}>
                  {picked.length === 1 && !q.locked && editing !== q.id && HANDLES.map(h => <i key={h} data-handle={h} className={`dbd-handle h-${h}`} style={{ left: `${HANDLE_AT[h][0]}%`, top: `${HANDLE_AT[h][1]}%` }} />)}
                  {picked.length === 1 && <span className="dbd-pick-size">{Math.round(q.w)} × {Math.round(q.h)}</span>}
                </div>)}
                {guides?.page === pg.id && guides.gx !== null && <i className="dbd-guide v" style={{ left: guides.gx }} />}
                {guides?.page === pg.id && guides.gy !== null && <i className="dbd-guide h" style={{ top: guides.gy }} />}
                {marquee?.page === pg.id && <i className="dbd-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
                {pins.filter(c => c.page === pg.id).map(c => <button type="button" key={c.id} data-pin={c.id} className={`dbd-pin${c.done ? ' done' : ''}${pinSel === c.id ? ' on' : ''}`} style={{ left: c.x, top: c.y }} title={`${c.by}: ${c.text}`} aria-label={`댓글 ${c.no}`}>{c.no}</button>)}
                {draftPin?.page === pg.id && <span className="dbd-pin draft" style={{ left: draftPin.x, top: draftPin.y }}>+</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
