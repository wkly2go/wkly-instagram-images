// 입출금 장부 › 통계 (대표 지시 2026-10-31 "첨부 이미지를 참조해서 대시보드를 세분화해서 시각화")
//   - 필터: 기간(올해 · 최근 12개월 · 지난해 · 직접) · 결제 수단 · 분류 · 거래처 → 아래 모든 숫자와 그래프에 적용
//   - 숫자 6칸: 이번 달 입금 · 출금 · 차액(전월 대비) / 기간 입금 · 출금 · 차액(전년 같은 기간 대비)
//   - 잔고 추이: 월말 잔고(기초 잔액을 넣으면) 또는 누적 차액, 전년 같은 달과 비교, 기간 평균선
//   - 분류별 월 입금 · 월 출금 누적 막대 (분류 7개 + 기타), 거래처 순위
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { addMonths, manwon, todayKey, won } from '../lib/date'
import { LEDGER_CATEGORIES, LEDGER_METHODS, type LedgerEntry, type LedgerMethod } from '../lib/types'
import { shortMan } from './charts'
import { monthEnd } from './LedgerViews'
import { Empty } from './ui'

// 범주 색: 검증된 8색 순서 (파랑 · 주황 · 청록 · 노랑 · 자홍 · 초록 · 보라) + 기타 회색
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const OTHER = '#a8a6a0'
const OPEN_KEY = 'wkly-ledger-opening'

type Range = 'year' | '12m' | 'last' | 'custom'
const monthsBetween = (from: string, to: string) => {
  const out: string[] = []
  for (let m = from; m <= to && out.length < 36; m = addMonths(m, 1)) out.push(m)
  return out
}
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null)

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
function niceMax(v: number): number {
  if (v <= 0) return 1_000_000
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function LedgerStats({ onExpired }: { onExpired: () => void }) {
  const { api } = useApp()
  const thisMonth = todayKey().slice(0, 7)
  const [range, setRange] = useState<Range>('year')
  const [from, setFrom] = useState(`${thisMonth.slice(0, 4)}-01`)
  const [to, setTo] = useState(thisMonth)
  const [method, setMethod] = useState<LedgerMethod | ''>('')
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [opening, setOpening] = useState<string>(() => {
    try {
      return localStorage.getItem(OPEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)

  // 기간
  const [a, b] = useMemo((): [string, string] => {
    const y = Number(thisMonth.slice(0, 4))
    if (range === 'year') return [`${y}-01`, thisMonth]
    if (range === '12m') return [addMonths(thisMonth, -11), thisMonth]
    if (range === 'last') return [`${y - 1}-01`, `${y - 1}-12`]
    return from <= to ? [from, to] : [to, from]
  }, [range, from, to, thisMonth])
  const months = useMemo(() => monthsBetween(a, b), [a, b])
  const prevMonths = useMemo(() => months.map(m => addMonths(m, -12)), [months])

  // 전년 같은 기간 + 기간 앞 한 달(전월 대비용)까지 한 번에
  useEffect(() => {
    setLoading(true)
    api
      .listLedger(`${addMonths(a, -12)}-01`, monthEnd(b > thisMonth ? b : thisMonth))
      .then(setRows)
      .catch(() => onExpired())
      .finally(() => setLoading(false))
  }, [api, a, b, thisMonth, onExpired])

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = useMemo(
    () =>
      rows.filter(r => {
        if (method && r.method !== method) return false
        if (cats.size && !cats.has(r.category)) return false
        if (words.length && !words.every(w => [r.counterparty, r.memo, r.category].join(' ').toLowerCase().includes(w))) return false
        return true
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, method, cats, q],
  )
  const inMonth = (list: LedgerEntry[], m: string) => list.filter(r => r.entry_date.startsWith(m))
  const sumDir = (list: LedgerEntry[], d: '입금' | '출금') => list.filter(r => r.direction === d).reduce((n, r) => n + r.amount, 0)
  const inMonths = (ms: string[]) => filtered.filter(r => ms.includes(r.entry_date.slice(0, 7)))

  // 숫자 6칸
  const cur = inMonth(filtered, thisMonth)
  const prev = inMonth(filtered, addMonths(thisMonth, -1))
  const per = inMonths(months)
  const perPrev = inMonths(prevMonths)
  const k = {
    mIn: sumDir(cur, '입금'),
    mOut: sumDir(cur, '출금'),
    pIn: sumDir(prev, '입금'),
    pOut: sumDir(prev, '출금'),
    yIn: sumDir(per, '입금'),
    yOut: sumDir(per, '출금'),
    lyIn: sumDir(perPrev, '입금'),
    lyOut: sumDir(perPrev, '출금'),
  }

  // 분류: 기간 합계 상위 7개 + 기타
  const catSeries = (dir: '입금' | '출금') => {
    const tot = new Map<string, number>()
    for (const r of per) if (r.direction === dir) tot.set(r.category, (tot.get(r.category) ?? 0) + r.amount)
    // 순서는 장부 분류 순서를 따름 (필터가 바뀌어도 색이 그대로)
    const order = LEDGER_CATEGORIES[dir]
    const ranked = [...tot.entries()].sort((x, y) => y[1] - x[1])
    const keep = new Set(ranked.slice(0, ranked.length > 7 ? 6 : 7).map(e => e[0]))
    // 색은 남은 분류 안에서 순서대로 (같은 색이 두 번 나오지 않게)
    const series = order.filter(c => keep.has(c)).map((c, i) => ({ key: c, label: c, color: SLOTS[i % SLOTS.length] }))
    for (const [c] of ranked) if (keep.has(c) && !order.includes(c)) series.push({ key: c, label: c, color: OTHER })
    const hasOther = ranked.some(e => !keep.has(e[0]))
    if (hasOther) series.push({ key: '__other', label: '기타 분류', color: OTHER })
    const data = months.map(m => {
      const v: Record<string, number> = {}
      for (const r of inMonth(per, m)) if (r.direction === dir) {
        const key = keep.has(r.category) ? r.category : '__other'
        v[key] = (v[key] ?? 0) + r.amount
      }
      return { month: m, v }
    })
    return { series, data, total: ranked.reduce((n, e) => n + e[1], 0), ranked }
  }
  const inS = catSeries('입금')
  const outS = catSeries('출금')

  // 잔고(또는 누적 차액) 추이
  const open0 = Number(opening.replace(/[^\d-]/g, '')) || 0
  const hasOpen = opening.trim() !== ''
  const cum = (ms: string[]) => {
    let run = open0
    return ms.map(m => {
      const l = inMonth(filtered, m)
      run += sumDir(l, '입금') - sumDir(l, '출금')
      return run
    })
  }
  const line = cum(months)
  const lineLy = cum(prevMonths)
  const lyHas = perPrev.length > 0

  // 거래처 순위 (출금 · 입금)
  const topBy = (dir: '입금' | '출금') => {
    const mm = new Map<string, number>()
    for (const r of per) if (r.direction === dir) mm.set(r.counterparty?.trim() || '(거래처 없음)', (mm.get(r.counterparty?.trim() || '(거래처 없음)') ?? 0) + r.amount)
    return [...mm.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
  }

  const allCats = [...LEDGER_CATEGORIES['입금'], ...LEDGER_CATEGORIES['출금']]
  const filtersOn = !!method || cats.size > 0 || words.length > 0
  return (
    <div className="col gap-12 lstats">
      {/* 필터 한 줄 */}
      <div className="lstats-filters">
        <span className="seg" role="radiogroup" aria-label="기간">
          {([
            ['year', '올해'],
            ['12m', '최근 12개월'],
            ['last', '지난해'],
            ['custom', '직접'],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={range === key} className={range === key ? 'on' : ''} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </span>
        {range === 'custom' && (
          <span className="row" style={{ gap: 4 }}>
            <input className="input sm" type="month" value={from} onChange={e => setFrom(e.target.value)} aria-label="시작 달" />~
            <input className="input sm" type="month" value={to} onChange={e => setTo(e.target.value)} aria-label="끝 달" />
          </span>
        )}
        <select className="select sm" value={method} onChange={e => setMethod(e.target.value as LedgerMethod | '')} aria-label="결제 수단">
          <option value="">모든 수단</option>
          {LEDGER_METHODS.map(m => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="select sm"
          value=""
          onChange={e => {
            if (!e.target.value) return
            const n = new Set(cats)
            n.add(e.target.value)
            setCats(n)
          }}
          aria-label="분류 더하기"
        >
          <option value="">분류 골라 보기…</option>
          {allCats.filter(c => !cats.has(c)).map(c => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="search sm">
          <Search size={13} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="거래처 · 메모" aria-label="거래처 검색" />
        </label>
        <span className="t-cap">
          {a.replace('-', '.')} ~ {b.replace('-', '.')} · {per.length}건
        </span>
        {filtersOn && (
          <button
            type="button"
            className="link-btn t-cap"
            onClick={() => {
              setMethod('')
              setCats(new Set())
              setQ('')
            }}
          >
            필터 지우기
          </button>
        )}
      </div>
      {cats.size > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {[...cats].map(c => (
            <button
              key={c}
              type="button"
              className="lstats-chip"
              onClick={() => {
                const n = new Set(cats)
                n.delete(c)
                setCats(n)
              }}
              aria-label={`${c} 필터 빼기`}
            >
              {c} <X size={11} />
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Empty>불러오는 중…</Empty>
      ) : (
        <>
          <div className="lstats-kpis">
            <Kpi label="이번 달 입금" value={k.mIn} ch={pct(k.mIn, k.pIn)} vs="전월" good="up" tone="in" />
            <Kpi label="이번 달 출금" value={k.mOut} ch={pct(k.mOut, k.pOut)} vs="전월" good="down" tone="out" />
            <Kpi label="이번 달 차액" value={k.mIn - k.mOut} ch={pct(k.mIn - k.mOut, k.pIn - k.pOut)} vs="전월" good="up" tone="net" />
            <Kpi label={`${range === 'year' ? '올해' : '기간'} 입금`} value={k.yIn} ch={lyHas ? pct(k.yIn, k.lyIn) : null} vs="전년 같은 기간" good="up" tone="in" />
            <Kpi label={`${range === 'year' ? '올해' : '기간'} 출금`} value={k.yOut} ch={lyHas ? pct(k.yOut, k.lyOut) : null} vs="전년 같은 기간" good="down" tone="out" />
            <Kpi label={hasOpen ? '지금 잔고 (추정)' : `${range === 'year' ? '올해' : '기간'} 차액`} value={hasOpen ? line[line.length - 1] ?? open0 : k.yIn - k.yOut} ch={!hasOpen && lyHas ? pct(k.yIn - k.yOut, k.lyIn - k.lyOut) : null} vs="전년 같은 기간" good="up" tone="net" />
          </div>

          <div className="lstats-grid">
            <section className="lstats-card" aria-label="잔고 추이">
              <div className="lstats-h">
                <b>{hasOpen ? '월말 잔고 추이' : '누적 차액 추이'}</b>
                <label className="t-cap row" style={{ gap: 4, marginLeft: 'auto' }}>
                  기초 잔액
                  <input
                    className="input xs"
                    style={{ width: 110 }}
                    inputMode="numeric"
                    value={opening ? Number(opening.replace(/[^\d-]/g, '') || 0).toLocaleString('ko-KR') : ''}
                    placeholder="기간 시작 잔고"
                    onChange={e => {
                      const v = e.target.value.replace(/[^\d-]/g, '')
                      setOpening(v)
                      try {
                        if (v) localStorage.setItem(OPEN_KEY, v)
                        else localStorage.removeItem(OPEN_KEY)
                      } catch {
                        /* 저장 안 돼도 화면은 그대로 */
                      }
                    }}
                    aria-label="기초 잔액 (원)"
                  />
                </label>
              </div>
              <LineCompare months={months} cur={line} prev={lyHas ? lineLy : null} />
            </section>
            <section className="lstats-card" aria-label="월별 입금 (분류별)">
              <div className="lstats-h">
                <b>월별 입금 합계</b>
                <span className="t-cap">분류별 · 합계 {manwon(inS.total) || '0'}</span>
              </div>
              <StackMonthly series={inS.series} data={inS.data} label="월별 입금" />
            </section>
            <section className="lstats-card" aria-label="월별 출금 (분류별)">
              <div className="lstats-h">
                <b>월별 출금 합계</b>
                <span className="t-cap">분류별 · 합계 {manwon(outS.total) || '0'}</span>
              </div>
              <StackMonthly series={outS.series} data={outS.data} label="월별 출금" />
            </section>
          </div>

          <div className="lstats-grid two">
            <Share title="출금 분류 비중" ranked={outS.ranked} total={outS.total} colorOf={c => outS.series.find(s => s.key === c)?.color ?? OTHER} onPick={c => setCats(new Set([c]))} />
            <Share title="입금 분류 비중" ranked={inS.ranked} total={inS.total} colorOf={c => inS.series.find(s => s.key === c)?.color ?? OTHER} onPick={c => setCats(new Set([c]))} />
            <Rank title="출금 거래처 순위" list={topBy('출금')} onPick={name => setQ(name === '(거래처 없음)' ? '' : name)} />
            <Rank title="입금 거래처 순위" list={topBy('입금')} onPick={name => setQ(name === '(거래처 없음)' ? '' : name)} />
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, ch, vs, good, tone }: { label: string; value: number; ch: number | null; vs: string; good: 'up' | 'down'; tone: 'in' | 'out' | 'net' }) {
  const better = ch == null || ch === 0 ? null : (ch > 0) === (good === 'up')
  return (
    <div className={`lstats-kpi ${tone}${tone === 'net' && value < 0 ? ' minus' : ''}`}>
      <span className="t-cap">{label}</span>
      <b title={won(value)}>{shortMan(value)}</b>
      <span className={`lstats-ch ${better == null ? '' : better ? 'good' : 'bad'}`}>
        {ch == null ? `${vs} 기록 없음` : `${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${Math.abs(ch)}% · ${vs}`}
      </span>
    </div>
  )
}

/** 월별 분류 누적 막대: 축 하나, 범례, 마우스를 올리면 분류별 값 */
function StackMonthly({ series, data, label }: { series: { key: string; label: string; color: string }[]; data: { month: string; v: Record<string, number> }[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 220
  const left = 44
  const top = 10
  const bottom = 22
  const plotW = width - left - 4
  const plotH = height - top - bottom
  const totals = data.map(d => series.reduce((n, s) => n + Math.max(0, d.v[s.key] ?? 0), 0))
  const max = niceMax(Math.max(0, ...totals))
  const groupW = plotW / Math.max(1, data.length)
  const barW = Math.max(6, Math.min(28, groupW - 8))
  const y = (v: number) => top + plotH - (v / max) * plotH
  const hv = hover != null ? data[hover] : null
  return (
    <div className="chart" ref={ref}>
      <div className="lstats-legend">
        {series.length === 0 && <span className="t-cap">이 기간 기록이 없습니다.</span>}
        {series.map(s => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg width={width} height={height} role="img" aria-label={`${label}: ${data.map((d, i) => `${Number(d.month.slice(5))}월 ${shortMan(totals[i])}`).join(' / ')}`}>
        {[0, max / 2, max].map(t => (
          <g key={t}>
            <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? '3 3' : undefined} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--gray)" fontFamily="var(--mono)">
              {shortMan(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + groupW * i + (groupW - barW) / 2
          let acc = 0
          const segs = series
            .map(s => ({ s, v: Math.max(0, d.v[s.key] ?? 0) }))
            .filter(e => e.v > 0)
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={left + groupW * i} y={top} width={groupW} height={plotH + bottom} fill={hover === i ? 'var(--paper)' : 'transparent'} />
              {segs.map((e, j) => {
                const y1 = y(acc + e.v)
                const h = y(acc) - y1
                acc += e.v
                const lastSeg = j === segs.length - 1
                // 칸 사이 2px 흰 틈, 맨 위만 둥글게
                return lastSeg ? <path key={e.s.key} d={roundTop(x, y1, barW, Math.max(0, h - (j ? 2 : 0)))} fill={e.s.color} /> : <rect key={e.s.key} x={x} y={y1 + 2} width={barW} height={Math.max(0, h - 2)} fill={e.s.color} />
              })}
              {(data.length <= 12 || i % 2 === 0) && (
                <text x={left + groupW * i + groupW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--gray)">
                  {Number(d.month.slice(5))}월
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hv && hover != null && (
        <div className="tip" style={{ left: Math.min(width - 190, Math.max(0, left + groupW * hover + groupW / 2 - 80)), top: 34 }}>
          <div>
            <b>{hv.month.replace('-', '.')}</b> 합계 {won(totals[hover])}
          </div>
          {series
            .filter(s => (hv.v[s.key] ?? 0) > 0)
            .map(s => (
              <div key={s.key} className="tip-row">
                <i style={{ background: s.color }} /> {s.label} {won(hv.v[s.key])}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
function roundTop(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/** 올해(진한 선) vs 전년 같은 달(옅은 선) + 기간 평균(점선), 십자선 + 값 */
function LineCompare({ months, cur, prev }: { months: string[]; cur: number[]; prev: number[] | null }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 244
  const left = 48
  const top = 26
  const bottom = 22
  const plotW = width - left - 10
  const plotH = height - top - bottom
  const vals = [...cur, ...(prev ?? [])]
  const lo0 = Math.min(0, ...vals)
  const hi0 = Math.max(0, ...vals)
  const pad = (hi0 - lo0) * 0.08 || 1_000_000
  const lo = lo0 < 0 ? lo0 - pad : Math.max(0, Math.min(...vals) - pad)
  const hi = hi0 + pad
  const x = (i: number) => left + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
  const avg = cur.length ? cur.reduce((a, b) => a + b, 0) / cur.length : 0
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <div className="lstats-legend">
        <span>
          <i className="ln" style={{ background: 'var(--blue)' }} />
          이번 기간
        </span>
        {prev && (
          <span>
            <i className="ln" style={{ background: '#9cc3a6' }} />
            전년 같은 달
          </span>
        )}
        <span>
          <i className="ln dash" />
          기간 평균 {shortMan(Math.round(avg))}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`월별 ${months.map((m, i) => `${Number(m.slice(5))}월 ${shortMan(cur[i])}`).join(' / ')}`}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = e.clientX - r.left
          const i = Math.round(((px - left) / Math.max(1, plotW)) * (months.length - 1))
          setHover(Math.max(0, Math.min(months.length - 1, i)))
        }}
      >
        {ticks.map(t => (
          <g key={t}>
            <line x1={left} x2={width - 10} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 3" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--gray)" fontFamily="var(--mono)">
              {shortMan(Math.round(t))}
            </text>
          </g>
        ))}
        {lo < 0 && <line x1={left} x2={width - 10} y1={y(0)} y2={y(0)} stroke="var(--gray)" strokeWidth={1} />}
        <line x1={left} x2={width - 10} y1={y(avg)} y2={y(avg)} stroke="var(--red)" strokeWidth={1} strokeDasharray="5 4" opacity={0.7} />
        {prev && <path d={path(prev)} fill="none" stroke="#9cc3a6" strokeWidth={2} />}
        <path d={path(cur)} fill="none" stroke="var(--blue)" strokeWidth={2} />
        {cur.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3.5} fill={v < 0 ? 'var(--red)' : 'var(--blue)'} stroke="var(--white)" strokeWidth={2} />
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke="var(--gray)" strokeDasharray="2 3" />}
        {months.map((m, i) =>
          months.length <= 12 || i % 2 === 0 ? (
            <text key={m} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--gray)">
              {Number(m.slice(5))}월
            </text>
          ) : null,
        )}
        {cur.length > 0 && hover == null && (
          <text x={x(cur.length - 1)} y={y(cur[cur.length - 1]) - 9} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--blue)" fontFamily="var(--mono)">
            {shortMan(cur[cur.length - 1])}
          </text>
        )}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: Math.min(width - 180, Math.max(0, x(hover) - 80)), top: 30 }}>
          <div>
            <b>{months[hover].replace('-', '.')}</b> {won(cur[hover])}
          </div>
          {prev && (
            <div>
              전년 {won(prev[hover])} ({cur[hover] - prev[hover] >= 0 ? '+' : '−'}
              {manwon(Math.abs(cur[hover] - prev[hover])) || '0'})
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Share({ title, ranked, total, colorOf, onPick }: { title: string; ranked: [string, number][]; total: number; colorOf: (c: string) => string; onPick: (c: string) => void }) {
  return (
    <section className="lstats-card" aria-label={title}>
      <div className="lstats-h">
        <b>{title}</b>
        <span className="t-cap">누르면 그 분류만</span>
      </div>
      {ranked.length === 0 ? (
        <span className="t-cap">기록이 없습니다.</span>
      ) : (
        <>
          <div className="lstats-share" aria-hidden="true">
            {ranked.map(([c, v]) => (
              <i key={c} style={{ width: `${(v / total) * 100}%`, background: colorOf(c) }} title={`${c} ${won(v)}`} />
            ))}
          </div>
          <ul className="lstats-list">
            {ranked.slice(0, 8).map(([c, v]) => (
              <li key={c}>
                <button type="button" onClick={() => onPick(c)}>
                  <i style={{ background: colorOf(c) }} />
                  <span className="grow">{c}</span>
                  <span className="mono">{manwon(v)}</span>
                  <span className="t-cap" style={{ width: 44, textAlign: 'right' }}>
                    {Math.round((v / total) * 1000) / 10}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Rank({ title, list, onPick }: { title: string; list: [string, number][]; onPick: (name: string) => void }) {
  const max = Math.max(1, ...list.map(e => e[1]))
  return (
    <section className="lstats-card" aria-label={title}>
      <div className="lstats-h">
        <b>{title}</b>
        <span className="t-cap">상위 8곳 · 누르면 그 거래처만</span>
      </div>
      {list.length === 0 ? (
        <span className="t-cap">기록이 없습니다.</span>
      ) : (
        <ul className="lstats-list">
          {list.map(([name, v], i) => (
            <li key={name}>
              <button type="button" onClick={() => onPick(name)}>
                <span className="mono t-cap" style={{ width: 16 }}>
                  {i + 1}
                </span>
                <span className="lstats-rank-name">{name}</span>
                <span className="lstats-rank-bar">
                  <i style={{ width: `${(v / max) * 100}%` }} />
                </span>
                <span className="mono">{manwon(v)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
