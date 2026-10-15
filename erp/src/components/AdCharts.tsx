import { useEffect, useRef, useState } from 'react'
import { shortDate } from '../lib/date'

export interface Series {
  key: string
  label: string
  color: string
  values: (number | null)[]
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const nice = (n: number) => {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  const m = n / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

/**
 * 일별 그래프. stack = 매체별 누적 막대(광고비 · 노출 · 클릭 · 전환), line = 매체별 선(CTR · CPC 같은 비율)
 * 마우스를 올리면 그날 매체별 값
 */
export function DayChart({ days, series, mode, format, height = 200, label }: { days: string[]; series: Series[]; mode: 'stack' | 'line'; format: (n: number) => string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 44
  const padB = 22
  const padT = 8
  const plotW = width - padL - 6
  const plotH = height - padB - padT
  const totals = days.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0))
  const rawMax = mode === 'stack' ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap(s => s.values.map(v => v ?? 0)))
  const max = nice(rawMax * 1.05)
  const step = plotW / Math.max(1, days.length)
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const x = (i: number) => padL + step * i + step / 2
  const barW = Math.max(3, Math.min(28, step * 0.62))
  const every = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 46)))
  const ticks = [0, max / 2, max]
  return (
    <div className="ad-svg" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={width - 6} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % every === 0 ? (
            <text key={d} x={x(i)} y={height - 6} className="axis" textAnchor="middle">
              {shortDate(d)}
            </text>
          ) : null,
        )}
        {mode === 'stack'
          ? days.map((d, i) => {
              let acc = 0
              return (
                <g key={d}>
                  {series.map(s => {
                    const v = s.values[i] ?? 0
                    if (!v) return null
                    const top = y(acc + v)
                    const h = y(acc) - top
                    acc += v
                    return <rect key={s.key} x={x(i) - barW / 2} y={top + 1} width={barW} height={Math.max(1, h - 1)} rx={2} fill={s.color} />
                  })}
                </g>
              )
            })
          : series.map(s => {
              const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
              const segs: string[][] = [[]]
              pts.forEach(p => (p ? segs[segs.length - 1].push(p) : segs.push([])))
              return (
                <g key={s.key}>
                  {segs.filter(g => g.length).map((g, k) => (
                    <polyline key={k} points={g.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                  ))}
                  {s.values.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={s.color} stroke="var(--white)" strokeWidth={1.5} />))}
                </g>
              )
            })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="cross" />}
        {days.map((d, i) => (
          <rect key={d} x={padL + step * i} y={padT} width={step} height={plotH + padB} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="ad-tip" style={{ left: Math.min(width - 150, Math.max(0, x(hover) + 10)) }}>
          <b>{shortDate(days[hover])}</b>
          {mode === 'stack' && <span>합계 {format(totals[hover])}</span>}
          {series.map(s => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.label} {s.values[hover] == null ? '–' : format(s.values[hover] as number)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 가로 막대 (캠페인 비교) */
export function CompareBars({ rows, format }: { rows: { key: string; label: string; value: number; color: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="ad-hbars">
      {rows.map(r => (
        <div key={r.key} className="ad-hbar" title={`${r.label} · ${format(r.value)}`}>
          <span className="t-small truncate">{r.label}</span>
          <span className="track">
            <i style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </span>
          <span className="t-smallb num">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** 작은 추세선 (매체 카드용) */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const w = 120
  const h = 30
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? w / (values.length - 1) : w
  const pts = values.map((v, i) => `${i * step},${h - 2 - (v / max) * (h - 4)}`).join(' ')
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}
