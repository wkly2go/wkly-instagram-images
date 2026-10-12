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
