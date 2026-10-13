import { useEffect, useRef, useState } from 'react'

/** 만 원 단위 짧은 축 라벨: 4천만 · 1.2억 · 500만 */
export function shortMan(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 100_000_000) return `${+(n / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000_000) return `${+(n / 10_000_000).toFixed(1)}천만`
  if (abs >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`
  return n ? n.toLocaleString('ko-KR') : '0'
}

function niceMax(v: number): number {
  if (v <= 0) return 10_000_000
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** 위쪽만 둥근 막대 (바닥에 붙음) */
function bar(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export interface FlowDatum {
  month: string
  inflow: number
  outflow: number
}

/** 월별 수금(파랑)·지급(분홍) 묶음 막대. 축 하나, 범례, 마지막 달 수금만 직접 표기, 마우스를 올리면 값 */
export function FlowChart({ data, height = 190 }: { data: FlowDatum[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const left = 44
  const top = 14
  const bottom = 24
  const plotW = width - left - 4
  const plotH = height - top - bottom
  const max = niceMax(Math.max(...data.flatMap(d => [d.inflow, d.outflow]), 0))
  const groupW = plotW / Math.max(1, data.length)
  const barW = Math.max(8, Math.min(22, (groupW - 18) / 2))
  const y = (v: number) => top + plotH - (Math.max(0, v) / max) * plotH
  const ticks = [0, max / 2, max]
  const last = data.length - 1
  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ paddingBottom: 6 }}>
        <span>
          <i style={{ background: 'var(--blue)' }} />
          수금 (받은 돈)
        </span>
        <span>
          <i style={{ background: 'var(--pink)' }} />
          지급 (준 돈)
        </span>
      </div>
      <svg width={width} height={height} role="img" aria-label={`월별 수금·지급: ${data.map(d => `${Number(d.month.slice(5))}월 수금 ${shortMan(d.inflow)}, 지급 ${shortMan(d.outflow)}`).join(' / ')}`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t ? '3 3' : undefined} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--gray)" fontFamily="var(--mono)">
              {shortMan(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = left + groupW * i + groupW / 2
          const x1 = cx - barW - 1
          const x2 = cx + 1
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={left + groupW * i} y={top} width={groupW} height={plotH + bottom} fill={hover === i ? 'var(--paper)' : 'transparent'} />
              <path d={bar(x1, y(d.inflow), barW, top + plotH - y(d.inflow))} fill="var(--blue)" />
              <path d={bar(x2, y(d.outflow), barW, top + plotH - y(d.outflow))} fill="var(--pink)" />
              {i === last && d.inflow > 0 && (
                <text x={x1 + barW / 2} y={y(d.inflow) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--blue)" fontFamily="var(--mono)">
                  {Math.round(d.inflow / 10_000).toLocaleString('ko-KR')}
                </text>
              )}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize={12} fill="var(--gray)">
                {Number(d.month.slice(5))}월
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="tip" style={{ left: Math.min(width - 150, Math.max(0, left + groupW * hover + groupW / 2 - 70)), top: 22 }}>
          <div>
            <b>{data[hover].month.replace('-', '.')}</b>
          </div>
          <div>
            <i style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--blue)', borderRadius: 2, marginRight: 4 }} />
            수금 {shortMan(data[hover].inflow)}
          </div>
          <div>
            <i style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--pink)', borderRadius: 2, marginRight: 4 }} />
            지급 {shortMan(data[hover].outflow)}
          </div>
        </div>
      )}
    </div>
  )
}

/** 0~max 막대 + 목표 눈금 */
export function Meter({ value, max = 100, target, red, label }: { value: number; max?: number; target?: number | null; red?: boolean; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label}>
      <i className={red ? 'red' : ''} style={{ width: `${pct}%` }} />
      {target != null && <b style={{ left: `${Math.max(0, Math.min(100, (target / max) * 100))}%` }} title={`목표 ${target}%`} />}
    </span>
  )
}

export interface BarDatum {
  key: string
  label: string
  value: number
  /** 마우스를 올렸을 때 덧붙일 설명 */
  note?: string
}

/** 한 계열 세로 막대 (예: 월별 수주액). 축 하나, 마지막 값만 직접 표기, 마우스를 올리면 값 */
export function BarChart({ data, height = 180, color = 'var(--blue)', label, format = shortMan }: { data: BarDatum[]; height?: number; color?: string; label: string; format?: (n: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const left = 44
  const top = 16
  const bottom = 24
  const plotW = width - left - 4
  const plotH = height - top - bottom
  const max = niceMax(Math.max(...data.map(d => d.value), 0))
  const groupW = plotW / Math.max(1, data.length)
  const barW = Math.max(6, Math.min(26, groupW - 10))
  const y = (v: number) => top + plotH - (Math.max(0, v) / max) * plotH
  const lastWithValue = data.map(d => d.value > 0).lastIndexOf(true)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`${label}: ${data.map(d => `${d.label} ${format(d.value)}`).join(' / ')}`}>
        {[0, max / 2, max].map(t => (
          <g key={t}>
            <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t ? '3 3' : undefined} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--gray)" fontFamily="var(--mono)">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = left + groupW * i + groupW / 2
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={left + groupW * i} y={top} width={groupW} height={plotH + bottom} fill={hover === i ? 'var(--paper)' : 'transparent'} />
              <path d={bar(cx - barW / 2, y(d.value), barW, top + plotH - y(d.value))} fill={color} />
              {i === lastWithValue && (
                <text x={cx} y={y(d.value) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--blue)" fontFamily="var(--mono)">
                  {format(d.value)}
                </text>
              )}
              {(data.length <= 12 || i % 2 === 0) && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={12} fill="var(--gray)">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="tip" style={{ left: Math.min(width - 170, Math.max(0, left + groupW * hover + groupW / 2 - 70)), top: 20 }}>
          <div>
            <b>{data[hover].label}</b> {format(data[hover].value)}
          </div>
          {data[hover].note && <div>{data[hover].note}</div>}
        </div>
      )}
    </div>
  )
}

export interface HBarDatum {
  key: string
  label: string
  /** % */
  value: number | null
  target?: number | null
  note?: string
}

/** 가로 막대 (예: 프로젝트별 마진율 %). 0 기준선, 목표 눈금, 음수는 빨강, 값은 막대 끝에 직접 표기 */
export function HBarChart({ data, label, min = -10, max = 50 }: { data: HBarDatum[]; label: string; min?: number; max?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const labelW = Math.min(170, Math.max(90, width * 0.32))
  const right = 52
  const rowH = 26
  const height = data.length * rowH + 22
  const lo = Math.min(min, ...data.map(d => d.value ?? 0))
  const hi = Math.max(max, ...data.map(d => Math.max(d.value ?? 0, d.target ?? 0)))
  const plotW = width - labelW - right
  const x = (v: number) => labelW + ((v - lo) / (hi - lo)) * plotW
  const zero = x(0)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`${label}: ${data.map(d => `${d.label} ${d.value == null ? '없음' : `${d.value.toFixed(1)}%`}`).join(' / ')}`}>
        {[lo, 0, hi / 2, hi].filter((t, i, a) => a.indexOf(t) === i).map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={height - 18} stroke={t === 0 ? 'var(--gray)' : 'var(--line)'} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 3'} />
            <text x={x(t)} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--gray)" fontFamily="var(--mono)">
              {Math.round(t)}%
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const yy = i * rowH + 4
          const v = d.value ?? 0
          const neg = v < 0
          const below = d.target != null && d.value != null && d.value < d.target
          const x1 = neg ? x(v) : zero
          const w = Math.abs(x(v) - zero)
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={0} y={yy - 2} width={width} height={rowH} fill={hover === i ? 'var(--paper)' : 'transparent'} />
              <text x={labelW - 8} y={yy + 14} textAnchor="end" fontSize={12} fill="var(--blue)" fontWeight={700}>
                {d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}
              </text>
              {d.value != null && <rect x={x1} y={yy + 4} width={Math.max(2, w)} height={14} rx={4} fill={neg ? 'var(--red)' : below ? 'var(--pink)' : 'var(--blue)'} />}
              {d.target != null && <line x1={x(d.target)} x2={x(d.target)} y1={yy} y2={yy + 22} stroke="var(--green)" strokeWidth={2} />}
              <text x={Math.max(x(v), zero) + 6} y={yy + 15} fontSize={11} fontWeight={700} fill={neg ? 'var(--red)' : 'var(--blue)'} fontFamily="var(--mono)">
                {d.value == null ? '–' : `${d.value.toFixed(1)}%`}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="tip" style={{ left: labelW, top: hover * rowH + 26 }}>
          <div>
            <b>{data[hover].label}</b>
          </div>
          <div>
            마진율 {data[hover].value == null ? '–' : `${data[hover].value!.toFixed(1)}%`}
            {data[hover].target != null && ` · 목표 ${data[hover].target}%`}
          </div>
          {data[hover].note && <div>{data[hover].note}</div>}
        </div>
      )}
    </div>
  )
}

/** 한 줄 누적 막대 (예: 상태별 프로젝트 수). 조각 사이 2px 간격, 범례에 숫자 */
export function StackBar({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className="col gap-6">
      <div className="stackbar" role="img" aria-label={`${label}: ${parts.map(p => `${p.label} ${p.value}`).join(', ')}`}>
        {total === 0 ? <i style={{ flex: 1, background: 'var(--line)' }} /> : parts.filter(p => p.value > 0).map(p => <i key={p.key} style={{ flex: p.value, background: p.color }} title={`${p.label} ${p.value}`} />)}
      </div>
      <div className="legend">
        {parts.map(p => (
          <span key={p.key}>
            <i style={{ background: p.color }} />
            {p.label} <b className="t-blue">{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
