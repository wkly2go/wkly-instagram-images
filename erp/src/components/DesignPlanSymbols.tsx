// 평면 기호 — 부품(가구 · 기구 · 조명)과 문 · 창을 도면에서 쓰는 모양으로 그린다 (2026-11-17 '평면을 더욱 현실에 맞게')
// 모두 mm 좌표로 그리고, 선 굵기만 화면 픽셀로 고정한다(DesignPlan.css 의 vector-effect).
import type { CSSProperties, ReactNode } from 'react'
import type { PlanItem, PlanOpening, PlanWall } from '../lib/designPlan'
import { along, arcPath, doorSymbol, wallFrame, type Pt } from '../lib/designPlanDraw'
import { itemShape, mix, SHAPE_COLOR, type ItemShape } from '../lib/designPlanLook'

const INK = '#3b413c'
const poly = (a: Pt[]) => a.map(p => `${p.x},${p.y}`).join(' ')
const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i)

/** 천장에 붙는 것(펜던트 · 매입등)은 점선으로, 바닥에 깔리는 것(러그 · 단상)은 맨 아래에 그린다 */
export const itemLayer = (shape: ItemShape) => (shape === 'rug' || shape === 'platform' ? 0 : shape === 'pendant' || shape === 'downlight' ? 2 : 1)
export const shapeOf = (it: Pick<PlanItem, 'name' | 'shape'>) => itemShape(it.name, it.shape)
/** 평면에서 차지하는 자리 (90° 돌리면 가로 · 세로가 바뀐다) */
export const footprint = (it: Pick<PlanItem, 'w' | 'd' | 'rot'>) => (it.rot === 90 ? { w: it.d, d: it.w } : { w: it.w, d: it.d })

/** 모양별 기호. (0,0)~(w,d) 안에 그린다. 위쪽(y=0)이 뒤(벽 쪽) */
function glyph(shape: ItemShape, w: number, d: number): ReactNode {
  const m = Math.min(w, d), rx = m * 0.07, wide = w >= d
  const body = <rect className="b" width={w} height={d} rx={rx} />
  // 긴 변을 n 칸으로 나누는 선
  const bays = (n: number, a = 0, b = 1) => range(n - 1).map(i => (wide
    ? <line className="l" key={i} x1={(w * (i + 1)) / n} x2={(w * (i + 1)) / n} y1={d * a} y2={d * b} />
    : <line className="l" key={i} y1={(d * (i + 1)) / n} y2={(d * (i + 1)) / n} x1={w * a} x2={w * b} />))
  switch (shape) {
    case 'table':
      return <>{body}<rect className="l" x={m * 0.09} y={m * 0.09} width={w - m * 0.18} height={d - m * 0.18} rx={rx * 0.5} /></>
    case 'round':
      return <><ellipse className="b" cx={w / 2} cy={d / 2} rx={w / 2} ry={d / 2} /><ellipse className="l" cx={w / 2} cy={d / 2} rx={w * 0.4} ry={d * 0.4} /></>
    case 'chair': {
      const back = d * 0.22
      return <><rect className="b" y={back * 0.45} width={w} height={d - back * 0.45} rx={m * 0.16} /><rect className="p" x={w * 0.05} width={w * 0.9} height={back} rx={back * 0.45} /></>
    }
    case 'bench':
      return <>{body}{wide ? [1, 2].map(i => <line className="l" key={i} x1={0} x2={w} y1={(d * i) / 3} y2={(d * i) / 3} />) : [1, 2].map(i => <line className="l" key={i} y1={0} y2={d} x1={(w * i) / 3} x2={(w * i) / 3} />)}</>
    case 'sofa': {
      const back = Math.min(d * 0.28, 280), arm = Math.min(w * 0.13, 220), n = Math.max(1, Math.round((w - arm * 2) / 720)), seat = (w - arm * 2) / n
      return <>
        {body}
        <rect className="p" width={w} height={back} rx={rx} />
        <rect className="p" y={back * 0.55} width={arm} height={d - back * 0.55} rx={rx} />
        <rect className="p" x={w - arm} y={back * 0.55} width={arm} height={d - back * 0.55} rx={rx} />
        {range(n).map(i => <rect className="s" key={i} x={arm + seat * i + seat * 0.04} y={back + (d - back) * 0.06} width={seat * 0.92} height={(d - back) * 0.86} rx={m * 0.06} />)}
      </>
    }
    case 'bed': {
      const head = Math.min(d * 0.05, 90), n = w >= 1300 ? 2 : 1, pw = (w - w * 0.12) / n
      return <>
        {body}
        <rect className="p" width={w} height={head} rx={rx * 0.4} />
        {range(n).map(i => <rect className="s" key={i} x={w * 0.06 + pw * i + pw * 0.05} y={head + d * 0.035} width={pw * 0.9} height={d * 0.15} rx={m * 0.05} />)}
        <rect className="p" y={d * 0.3} width={w} height={d * 0.7} rx={rx} />
        <line className="l" x1={0} x2={w} y1={d * 0.38} y2={d * 0.38} />
      </>
    }
    case 'shelf': {
      const n = Math.max(1, Math.round(Math.max(w, d) / 600))
      return <>{body}{bays(n)}{wide ? <line className="l" x1={0} x2={w} y1={d * 0.24} y2={d * 0.24} /> : <line className="l" y1={0} y2={d} x1={w * 0.24} x2={w * 0.24} />}</>
    }
    case 'counter':
      return <>{body}{wide ? <rect className="p" x={0} y={0} width={w} height={d * 0.36} rx={rx * 0.5} /> : <rect className="p" x={0} y={0} width={w * 0.36} height={d} rx={rx * 0.5} />}</>
    case 'cabinet': {
      const n = Math.max(1, Math.round(Math.max(w, d) / 500))
      return <>
        {body}{bays(n)}
        {range(n).map(i => (wide
          ? <line className="l" key={`x${i}`} x1={(w * i) / n} y1={0} x2={(w * (i + 1)) / n} y2={d} />
          : <line className="l" key={`x${i}`} y1={(d * i) / n} x1={0} y2={(d * (i + 1)) / n} x2={w} />))}
      </>
    }
    case 'plant': {
      const cx = w / 2, cy = d / 2
      return <>
        <ellipse className="b" cx={cx} cy={cy} rx={w / 2} ry={d / 2} />
        {range(8).map(i => { const a = (Math.PI * 2 * i) / 8 + 0.3; return <line className="l" key={i} x1={cx + Math.cos(a) * w * 0.12} y1={cy + Math.sin(a) * d * 0.12} x2={cx + Math.cos(a) * w * 0.44} y2={cy + Math.sin(a) * d * 0.44} /> })}
        <ellipse className="p" cx={cx} cy={cy} rx={w * 0.14} ry={d * 0.14} />
      </>
    }
    case 'rug':
      return <><rect className="b soft" width={w} height={d} rx={rx * 0.4} /><rect className="l dash" x={m * 0.08} y={m * 0.08} width={w - m * 0.16} height={d - m * 0.16} /></>
    case 'light': {
      const cx = w / 2, cy = d / 2
      return <><ellipse className="b" cx={cx} cy={cy} rx={w / 2} ry={d / 2} /><ellipse className="l" cx={cx} cy={cy} rx={w * 0.24} ry={d * 0.24} /><line className="l" x1={cx} x2={cx} y1={d * 0.1} y2={d * 0.9} /><line className="l" y1={cy} y2={cy} x1={w * 0.1} x2={w * 0.9} /></>
    }
    case 'pendant': {
      const cx = w / 2, cy = d / 2
      return <><ellipse className="b" cx={cx} cy={cy} rx={w / 2} ry={d / 2} /><ellipse className="p" cx={cx} cy={cy} rx={w * 0.16} ry={d * 0.16} />{range(4).map(i => { const a = (Math.PI / 2) * i + Math.PI / 4; return <line className="l" key={i} x1={cx + Math.cos(a) * w * 0.24} y1={cy + Math.sin(a) * d * 0.24} x2={cx + Math.cos(a) * w * 0.46} y2={cy + Math.sin(a) * d * 0.46} /> })}</>
    }
    case 'downlight': {
      const cx = w / 2, cy = d / 2
      return <><ellipse className="b" cx={cx} cy={cy} rx={w / 2} ry={d / 2} /><line className="l" x1={cx - w * 0.34} x2={cx + w * 0.34} y1={cy - d * 0.34} y2={cy + d * 0.34} /><line className="l" x1={cx - w * 0.34} x2={cx + w * 0.34} y1={cy + d * 0.34} y2={cy - d * 0.34} /></>
    }
    case 'screen':
      return <>{body}{wide ? <line className="l" x1={0} x2={w} y1={d / 2} y2={d / 2} /> : <line className="l" y1={0} y2={d} x1={w / 2} x2={w / 2} />}</>
    case 'tv':
      return <>{body}{wide ? <line className="l lite" x1={w * 0.04} x2={w * 0.96} y1={d * 0.78} y2={d * 0.78} /> : <line className="l lite" y1={d * 0.04} y2={d * 0.96} x1={w * 0.78} x2={w * 0.78} />}</>
    case 'platform':
      return <>{body}<rect className="l" x={m * 0.06} y={m * 0.06} width={w - m * 0.12} height={d - m * 0.12} />{wide ? <line className="l dash" x1={0} x2={w} y1={d * 0.86} y2={d * 0.86} /> : <line className="l dash" y1={0} y2={d} x1={w * 0.86} x2={w * 0.86} />}</>
    case 'toilet':
      return <>
        <rect className="b" x={w * 0.08} width={w * 0.84} height={d * 0.27} rx={m * 0.06} />
        <ellipse className="b" cx={w / 2} cy={d * 0.63} rx={w * 0.44} ry={d * 0.37} />
        <ellipse className="l" cx={w / 2} cy={d * 0.65} rx={w * 0.27} ry={d * 0.24} />
      </>
    case 'basin':
      return <>{body}<ellipse className="s" cx={w / 2} cy={d * 0.56} rx={w * 0.36} ry={d * 0.3} /><circle className="k" cx={w / 2} cy={d * 0.14} r={m * 0.05} /></>
    case 'bathtub':
      return <>{body}<rect className="s" x={m * 0.09} y={m * 0.09} width={w - m * 0.18} height={d - m * 0.18} rx={m * 0.22} />{wide ? <circle className="k" cx={w * 0.14} cy={d / 2} r={m * 0.045} /> : <circle className="k" cx={w / 2} cy={d * 0.14} r={m * 0.045} />}</>
    case 'sink': {
      const n = Math.max(w, d) >= 1000 ? 2 : 1
      return <>
        {body}
        {range(n).map(i => (wide
          ? <rect className="s" key={i} x={w * 0.08 + ((w * 0.84) / n) * i + w * 0.02} y={d * 0.3} width={(w * 0.84) / n - w * 0.04} height={d * 0.56} rx={m * 0.08} />
          : <rect className="s" key={i} y={d * 0.08 + ((d * 0.84) / n) * i + d * 0.02} x={w * 0.3} height={(d * 0.84) / n - d * 0.04} width={w * 0.56} rx={m * 0.08} />))}
        {wide ? <circle className="k" cx={w / 2} cy={d * 0.15} r={m * 0.05} /> : <circle className="k" cx={w * 0.15} cy={d / 2} r={m * 0.05} />}
      </>
    }
    case 'appliance':
      return <>{body}<rect className="l" x={m * 0.1} y={m * 0.1} width={w - m * 0.2} height={d - m * 0.2} rx={rx * 0.5} />{Math.max(w, d) / m < 1.35 ? <circle className="l" cx={w / 2} cy={d / 2} r={m * 0.26} /> : null}</>
    default:
      return body
  }
}

/** 부품 하나의 평면 기호. 색은 마감이 있으면 그 색, 없으면 모양의 기본 색 */
export function ItemSymbol({ item, color, selected }: { item: PlanItem; /** 마감에서 알아본 색 (없으면 모양 기본 색) */ color?: string | null; selected: boolean }) {
  const shape = shapeOf(item)
  const c = color || SHAPE_COLOR[shape]
  const vars = { '--c': c, '--c2': mix(c, INK, 0.14), '--c3': mix(c, '#ffffff', 0.55), '--k': mix(c, INK, 0.72) } as CSSProperties
  const f = footprint(item)
  return (
    <g className={`dps dps-${shape}${itemLayer(shape) === 2 ? ' ceil' : ''}${selected ? ' sel' : ''}`} data-hit="item" data-id={item.id} style={vars}
      transform={item.rot === 90 ? `translate(${item.x + f.w} ${item.y}) rotate(90)` : `translate(${item.x} ${item.y})`}>
      <rect className="h" width={item.w} height={item.d} />
      {glyph(shape, item.w, item.d)}
      {selected && <rect className="o" width={item.w} height={item.d} />}
    </g>
  )
}

/** 모양 고르기에 쓰는 작은 미리보기 */
export function ShapeIcon({ shape, size = 26 }: { shape: ItemShape; size?: number }) {
  const [w, d] = shape === 'sofa' || shape === 'counter' || shape === 'shelf' || shape === 'bench' || shape === 'tv' || shape === 'screen' || shape === 'sink' ? [100, 60] : shape === 'bed' || shape === 'toilet' ? [70, 100] : shape === 'bathtub' ? [100, 55] : [90, 90]
  const c = SHAPE_COLOR[shape]
  const vars = { '--c': c, '--c2': mix(c, INK, 0.14), '--c3': mix(c, '#ffffff', 0.55), '--k': mix(c, INK, 0.72) } as CSSProperties
  return <svg className="dps-icon" width={size} height={size} viewBox="-6 -6 112 112" aria-hidden="true"><g className={`dps dps-${shape}`} style={vars} transform={`translate(${(100 - w) / 2} ${(100 - d) / 2})`}>{glyph(shape, w, d)}</g></svg>
}

/** 문 · 창 기호. 벽을 끊은 자리에 문짝 + 열림 호(여닫이 · 양개 · 유리), 미닫이 문짝, 창은 세 줄 */
export function OpeningSymbol({ wall, opening: o, selected }: { wall: PlanWall; opening: PlanOpening; selected: boolean }) {
  const f = wallFrame(wall)
  const from = Math.max(0, o.pos - o.width / 2), to = Math.min(f.len, o.pos + o.width / 2)
  if (!(to > from)) return null
  const h = Math.max(wall.t, 40) / 2
  const p = (dist: number, off = 0) => along(wall, f, dist, off)
  const gap = [p(from, h), p(to, h), p(to, -h), p(from, -h)]
  const cls = `dpo dpo-${o.kind}${selected ? ' sel' : ''}`
  if (o.kind === 'window') {
    const a = p(from), b = p(to)
    return (
      <g className={cls} data-hit="opening" data-id={o.id}>
        <polygon className="frame" points={poly(gap)} />
        <line className="glass" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      </g>
    )
  }
  const sym = doorSymbol(wall, o)
  const side = o.side === -1 ? -1 : 1
  let panel: ReactNode = null
  if (sym.style === 'slide') {
    // 미닫이: 벽면 바로 옆에 반쯤 열린 문짝, 움직이는 길은 점선
    const pt = Math.max(40, Math.min(h * 0.7, 60)), w0 = to - from
    const start = o.hinge === 'end' ? to - w0 * 0.45 : from - w0 * 0.55
    const q = [p(start, side * h), p(start + w0, side * h), p(start + w0, side * (h + pt)), p(start, side * (h + pt))]
    const t0 = p(Math.min(from, start), side * (h + pt / 2)), t1 = p(Math.max(to, start + w0), side * (h + pt / 2))
    panel = <><line className="track" x1={t0.x} y1={t0.y} x2={t1.x} y2={t1.y} /><polygon className="panel" points={poly(q)} /></>
  }
  return (
    <g className={`${cls} dpo-${sym.style}`} data-hit="opening" data-id={o.id}>
      <polygon className="gap" points={poly(gap)} />
      <line className="sill" x1={gap[0].x} y1={gap[0].y} x2={gap[1].x} y2={gap[1].y} />
      <line className="sill" x1={gap[3].x} y1={gap[3].y} x2={gap[2].x} y2={gap[2].y} />
      {sym.leaves.map((l, i) => <path key={`a${i}`} className="arc" d={arcPath(l)} />)}
      {sym.leaves.map((l, i) => <line key={`l${i}`} className="leaf" x1={l.hinge.x} y1={l.hinge.y} x2={l.tip.x} y2={l.tip.y} />)}
      {panel}
    </g>
  )
}
