import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import { Button, Empty } from './ui'
import { ask } from './Ask'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addMonths, manwon, todayKey, won } from '../lib/date'
import { LEDGER_CATEGORIES, LEDGER_METHODS, type LedgerEntry, type LedgerMethod, type LedgerRecurring } from '../lib/types'

const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo, 0).getDate()
}
export const monthEnd = (m: string) => `${m}-${String(lastDay(m)).padStart(2, '0')}`
/** 그 달 출금일 (31일 → 30일까지인 달은 30일) */
const dueOf = (r: LedgerRecurring, m: string) => `${m}-${String(Math.min(r.day_of_month, lastDay(m))).padStart(2, '0')}`
const inRange = (r: LedgerRecurring, m: string) => r.active && (!r.start_month || r.start_month <= m) && (!r.end_month || r.end_month >= m)
const digits = (s: string) => s.replace(/[^\d]/g, '')
const comma = (s: string) => (digits(s) ? Number(digits(s)).toLocaleString('ko-KR') : '')
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000)

// ---------------------------------------------------------------------
// 정기 출금 (대표 지시 2026-10-28 "정기적인 출금일과 금액을 한번에")
// ---------------------------------------------------------------------
type RDraft = { id?: number; name: string; amount: string; day_of_month: string; category: string; counterparty: string; method: LedgerMethod; memo: string }
const emptyR = (): RDraft => ({ name: '', amount: '', day_of_month: '25', category: LEDGER_CATEGORIES.출금[0], counterparty: '', method: '계좌', memo: '' })

export function RecurringView({ onExpired }: { onExpired: () => void }) {
  const { api, toast } = useApp()
  const today = todayKey()
  const month = today.slice(0, 7)
  const [list, setList] = useState<LedgerRecurring[]>([])
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState<RDraft | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([api.listRecurring(), api.listLedger(`${month}-01`, monthEnd(month))])
      setList(r)
      setEntries(e)
    } catch {
      onExpired()
    } finally {
      setLoading(false)
    }
  }, [api, month, onExpired])
  useEffect(() => void load(), [load])

  const active = list.filter(r => inRange(r, month))
  // 이번 달 기록됨: 정기 출금에서 기록한 것 (또는 같은 날 · 같은 금액 출금이 이미 있으면)
  const doneOf = (r: LedgerRecurring) => entries.some(e => e.direction === '출금' && ((r.id != null && e.recurring_id === r.id) || (e.amount === r.amount && e.entry_date === dueOf(r, month))))
  const rows = active
    .map(r => {
      const due = dueOf(r, month)
      const done = doneOf(r)
      const d = dayDiff(due, today)
      return { r, due, done, d }
    })
    .sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due))
  const total = active.reduce((n, r) => n + r.amount, 0)
  const left = rows.filter(x => !x.done).reduce((n, x) => n + x.r.amount, 0)
  const late = rows.filter(x => !x.done && x.d < 0)
  const next = rows.find(x => !x.done && x.d >= 0)
  const paused = list.filter(r => !inRange(r, month))

  const record = async (r: LedgerRecurring) => {
    try {
      await api.saveLedger({ direction: '출금', entry_date: dueOf(r, month) > today ? today : dueOf(r, month), amount: r.amount, category: r.category, counterparty: r.counterparty, method: r.method, memo: `정기 · ${r.name}`, recurring_id: r.id })
      toast(`${r.name} ${won(r.amount)} 장부에 기록했습니다.`)
      void load()
    } catch (x) {
      toast(friendlyError(x))
    }
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!f) return
    const amount = Number(digits(f.amount))
    const day = Math.min(31, Math.max(1, Number(f.day_of_month) || 1))
    if (!f.name.trim() || !amount) return toast('이름과 금액을 넣어 주세요.')
    try {
      await api.saveRecurring({ id: f.id, name: f.name.trim(), amount, day_of_month: day, category: f.category.trim() || '기타 출금', counterparty: f.counterparty.trim() || null, method: f.method, memo: f.memo.trim() || null })
      toast(f.id ? '고쳤습니다.' : `정기 출금 '${f.name.trim()}'을(를) 등록했습니다.`)
      setF(null)
      void load()
    } catch (x) {
      toast(friendlyError(x))
    }
  }
  const toggle = async (r: LedgerRecurring) => {
    try {
      await api.saveRecurring({ id: r.id, active: !r.active })
      void load()
    } catch (x) {
      toast(friendlyError(x))
    }
  }
  const remove = async (r: LedgerRecurring) => {
    if (!(await ask(`정기 출금 '${r.name}'을(를) 지울까요? 이미 장부에 기록한 내역은 남습니다.`))) return
    try {
      await api.deleteRecurring(r.id)
      void load()
    } catch (x) {
      toast(friendlyError(x))
    }
  }
  const edit = (r: LedgerRecurring) => setF({ id: r.id, name: r.name, amount: r.amount.toLocaleString('ko-KR'), day_of_month: String(r.day_of_month), category: r.category, counterparty: r.counterparty ?? '', method: r.method, memo: r.memo ?? '' })

  // 달력 띠: 1~말일, 출금일에 금액
  const n = lastDay(month)
  const byDay = new Map<number, typeof rows>()
  for (const x of rows) {
    const d = Number(x.due.slice(8))
    byDay.set(d, [...(byDay.get(d) ?? []), x])
  }

  if (loading) return <Empty>불러오는 중…</Empty>
  return (
    <div className="col gap-12">
      <div className="ledger-kpis four">
        <div className="ledger-kpi out">
          <span className="t-cap">매달 고정 출금</span>
          <b>{won(total)}</b>
          <span className="t-meta">{active.length}건 · 1년이면 {manwon(total * 12)}</span>
        </div>
        <div className="ledger-kpi">
          <span className="t-cap">이번 달 남은 출금</span>
          <b>{won(left)}</b>
          <span className="t-meta">
            {rows.filter(x => !x.done).length}건 남음 · {rows.filter(x => x.done).length}건 기록됨
          </span>
        </div>
        <div className={`ledger-kpi ${late.length ? 'warn' : ''}`}>
          <span className="t-cap">출금일 지남 · 미기록</span>
          <b>{late.length}건</b>
          <span className="t-meta">{late.length ? won(late.reduce((s, x) => s + x.r.amount, 0)) : '없음'}</span>
        </div>
        <div className="ledger-kpi net">
          <span className="t-cap">다음 출금</span>
          <b>{next ? (next.d === 0 ? '오늘' : `D-${next.d}`) : '—'}</b>
          <span className="t-meta truncate">{next ? `${Number(next.due.slice(5, 7))}/${Number(next.due.slice(8))} · ${next.r.name} · ${won(next.r.amount)}` : '이번 달 남은 출금 없음'}</span>
        </div>
      </div>

      {/* 이번 달 출금일 띠 */}
      <section className="rec-strip" aria-label="이번 달 출금일">
        {Array.from({ length: n }, (_, i) => i + 1).map(d => {
          const items = byDay.get(d) ?? []
          const key = `${month}-${String(d).padStart(2, '0')}`
          const sumDay = items.reduce((s, x) => s + x.r.amount, 0)
          const state = !items.length ? '' : items.every(x => x.done) ? 'done' : key < today ? 'late' : 'due'
          return (
            <div key={d} className={`rec-day ${state}${key === today ? ' today' : ''}`} title={items.map(x => `${x.r.name} ${won(x.r.amount)}${x.done ? ' (기록됨)' : ''}`).join('\n') || undefined}>
              <span className="rec-d">{d}</span>
              {items.length > 0 && <span className="rec-amt">{manwon(sumDay)}</span>}
            </div>
          )
        })}
      </section>

      <div className="row">
        <b className="t-bodyb grow">정기 출금 목록</b>
        {!f && (
          <Button size="sm" onClick={() => setF(emptyR())}>
            <Plus size={14} /> 정기 출금 등록
          </Button>
        )}
      </div>
      {f && (
        <form className="ledger-form out" onSubmit={save}>
          <input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="이름 (예: 사무실 임대료)" aria-label="이름" maxLength={60} style={{ width: 180 }} />
          <label className="row" style={{ gap: 4 }}>
            <span className="t-cap">매월</span>
            <input className="input" inputMode="numeric" value={f.day_of_month} onChange={e => setF({ ...f, day_of_month: digits(e.target.value).slice(0, 2) })} aria-label="출금일" style={{ width: 48, textAlign: 'center' }} />
            <span className="t-cap">일</span>
          </label>
          <div className="lf-amount">
            <input className="input" inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: comma(e.target.value) })} placeholder="금액" aria-label="금액" />
            <span className="t-meta">{digits(f.amount) ? manwon(Number(digits(f.amount))) : '원'}</span>
          </div>
          <input className="input lf-cat" list="rec-cats" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="분류" aria-label="분류" maxLength={40} />
          <datalist id="rec-cats">
            {LEDGER_CATEGORIES.출금.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input className="input lf-who" value={f.counterparty} onChange={e => setF({ ...f, counterparty: e.target.value })} placeholder="받는 곳" aria-label="받는 곳" maxLength={100} />
          <select className="select lf-method" value={f.method} onChange={e => setF({ ...f, method: e.target.value as LedgerMethod })} aria-label="수단">
            {LEDGER_METHODS.map(x => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input className="input lf-memo" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} placeholder="메모 (선택)" aria-label="메모" maxLength={500} />
          <Button type="submit" size="sm">
            {f.id ? '고치기' : '등록'}
          </Button>
          <button type="button" className="icon-btn sm" onClick={() => setF(null)} aria-label="취소">
            <X size={14} />
          </button>
        </form>
      )}

      {rows.length === 0 && !f ? (
        <Empty>정기 출금이 없습니다. '정기 출금 등록'으로 임대료 · 구독료 · 급여처럼 매달 나가는 돈을 넣어 두면 출금일과 금액을 한눈에 봅니다.</Empty>
      ) : (
        <table className="ledger-table rec-table">
          <thead>
            <tr>
              <th>출금일</th>
              <th>이름</th>
              <th>분류</th>
              <th>받는 곳</th>
              <th>수단</th>
              <th className="num">금액</th>
              <th>이번 달</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, due, done, d }) => (
              <tr key={r.id} className={done ? 'done' : d < 0 ? 'late' : ''}>
                <td className="mono">매월 {r.day_of_month}일</td>
                <td>
                  <b>{r.name}</b>
                  {r.memo && <span className="t-meta"> · {r.memo}</span>}
                </td>
                <td>{r.category}</td>
                <td className="truncate">{r.counterparty ?? ''}</td>
                <td className="t-meta">{r.method}</td>
                <td className="num out">{r.amount.toLocaleString('ko-KR')}</td>
                <td>
                  {done ? (
                    <span className="rec-badge done">기록됨</span>
                  ) : d < 0 ? (
                    <button type="button" className="rec-badge late" onClick={() => void record(r)} title="장부에 출금으로 기록">
                      {-d}일 지남 · 기록
                    </button>
                  ) : (
                    <button type="button" className="rec-badge due" onClick={() => void record(r)} title={`${due} 출금 · 눌러서 장부에 기록`}>
                      {d === 0 ? '오늘' : `D-${d}`} · 기록
                    </button>
                  )}
                </td>
                <td className="row-actions">
                  <button type="button" className="icon-btn sm" onClick={() => edit(r)} aria-label="고치기" title="고치기">
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="icon-btn sm" onClick={() => void toggle(r)} aria-label="멈추기" title="멈추기 (해지 · 일시중지)">
                    <Power size={13} />
                  </button>
                  <button type="button" className="icon-btn sm" onClick={() => void remove(r)} aria-label="지우기" title="지우기">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {paused.length > 0 && (
        <details className="rec-paused">
          <summary className="t-cap">멈춘 정기 출금 {paused.length}건</summary>
          {paused.map(r => (
            <div key={r.id} className="row t-small">
              <span className="grow">
                매월 {r.day_of_month}일 · {r.name} · {won(r.amount)}
              </span>
              <button type="button" className="link-btn t-cap" onClick={() => void toggle(r)}>
                다시 켜기
              </button>
              <button type="button" className="icon-btn sm" onClick={() => void remove(r)} aria-label="지우기">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// 월별 비교 (최근 12개월)
// ---------------------------------------------------------------------
export function CompareView({ month, onExpired }: { month: string; onExpired: () => void }) {
  const { api } = useApp()
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)), [month])
  useEffect(() => {
    setLoading(true)
    api
      .listLedger(`${months[0]}-01`, monthEnd(month))
      .then(setRows)
      .catch(() => onExpired())
      .finally(() => setLoading(false))
  }, [api, months, month, onExpired])

  const data = months.map(m => {
    const list = rows.filter(r => r.entry_date.startsWith(m))
    const inn = list.filter(r => r.direction === '입금').reduce((n, r) => n + r.amount, 0)
    const out = list.filter(r => r.direction === '출금').reduce((n, r) => n + r.amount, 0)
    return { m, inn, out, net: inn - out, count: list.length }
  })
  const max = Math.max(1, ...data.map(d => Math.max(d.inn, d.out)))
  const withData = data.filter(d => d.count)
  const sum = (k: 'inn' | 'out' | 'net') => data.reduce((n, d) => n + d[k], 0)
  const avg = (k: 'inn' | 'out' | 'net') => (withData.length ? Math.round(sum(k) / withData.length) : 0)
  // 출금 분류 상위 (12개월)
  const cats = useMemo(() => {
    const mm = new Map<string, number>()
    for (const r of rows) if (r.direction === '출금') mm.set(r.category, (mm.get(r.category) ?? 0) + r.amount)
    return [...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [rows])
  const catMax = Math.max(1, ...cats.map(c => c[1]))

  // 차액 선: 그래프 높이 140 안에서
  const H = 140
  // 차액 선은 막대와 같은 눈금 (바닥 = 0), 적자 달은 바닥에 빨간 점
  const y = (v: number) => H - (Math.max(0, v) / max) * H
  const pts = data.map((d, i) => `${((i + 0.5) / 12) * 100},${y(d.net)}`).join(' ')

  if (loading) return <Empty>불러오는 중…</Empty>
  return (
    <div className="col gap-12">
      <div className="ledger-kpis four">
        <div className="ledger-kpi in">
          <span className="t-cap">12개월 입금</span>
          <b>{manwon(sum('inn'))}</b>
          <span className="t-meta">월평균 {manwon(avg('inn'))}</span>
        </div>
        <div className="ledger-kpi out">
          <span className="t-cap">12개월 출금</span>
          <b>{manwon(sum('out'))}</b>
          <span className="t-meta">월평균 {manwon(avg('out'))}</span>
        </div>
        <div className={`ledger-kpi net ${sum('net') < 0 ? 'minus' : ''}`}>
          <span className="t-cap">12개월 차액</span>
          <b>{manwon(sum('net'))}</b>
          <span className="t-meta">월평균 {manwon(avg('net'))}</span>
        </div>
        <div className="ledger-kpi">
          <span className="t-cap">흑자 달 · 적자 달</span>
          <b>
            {withData.filter(d => d.net >= 0).length} · {withData.filter(d => d.net < 0).length}
          </b>
          <span className="t-meta">기록 있는 {withData.length}개월 기준</span>
        </div>
      </div>

      <section className="ledger-chart" aria-label="월별 입금 · 출금 · 차액">
        <div className="row t-cap">
          <span className="grow">월별 비교 (최근 12개월)</span>
          <span className="lg-key in" /> 입금 <span className="lg-key out" /> 출금 <span className="lg-key net" /> 차액
        </div>
        <div className="cmp-chart">
          <div className="cmp-bars">
            {data.map(d => (
              <div key={d.m} className={`cmp-month${d.m === month ? ' cur' : ''}`} title={`${d.m} · 입금 ${won(d.inn)} · 출금 ${won(d.out)} · 차액 ${won(d.net)}`}>
                <div className="bar-pair">
                  <i className="in" style={{ height: `${(d.inn / max) * 100}%` }} />
                  <i className="out" style={{ height: `${(d.out / max) * 100}%` }} />
                </div>
                <span>{Number(d.m.slice(5))}월</span>
              </div>
            ))}
          </div>
          <svg className="cmp-net" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts} />
          </svg>
          <div className="cmp-dots" aria-hidden="true">
            {data.map((d, i) => (
              <i key={d.m} className={d.net < 0 ? 'minus' : ''} style={{ left: `${((i + 0.5) / 12) * 100}%`, top: `${4 + y(d.net)}px` }} title={`차액 ${won(d.net)}`} />
            ))}
          </div>
        </div>
      </section>

      <div className="ledger-charts">
        <table className="ledger-table cmp-table">
          <thead>
            <tr>
              <th>월</th>
              <th className="num">입금</th>
              <th className="num">출금</th>
              <th className="num">차액</th>
              <th className="num">출금 전월 대비</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d, i, arr) => {
              const p = arr[i + 1]
              const ch = p && p.out ? Math.round(((d.out - p.out) / p.out) * 100) : null
              return (
                <tr key={d.m} className={d.m === month ? 'editing' : ''}>
                  <td className="mono">{d.m.replace('-', '.')}</td>
                  <td className="num in">{d.inn ? d.inn.toLocaleString('ko-KR') : '-'}</td>
                  <td className="num out">{d.out ? d.out.toLocaleString('ko-KR') : '-'}</td>
                  <td className={`num ${d.net < 0 ? 'out' : 'in'}`}>{d.count ? `${d.net < 0 ? '−' : '+'}${Math.abs(d.net).toLocaleString('ko-KR')}` : '-'}</td>
                  <td className={`num ${ch != null && ch > 0 ? 'out' : ''}`}>{ch == null ? '-' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : ''}${Math.abs(ch)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <section className="ledger-cats" aria-label="12개월 출금 분류">
          <span className="t-cap">12개월 출금 분류</span>
          {cats.length === 0 && <span className="t-meta">없음</span>}
          {cats.map(([c, v]) => (
            <div key={c} className="ledger-cat" title={won(v)}>
              <span className="truncate">{c}</span>
              <span className="meter">
                <i className="out" style={{ width: `${(v / catMax) * 100}%` }} />
              </span>
              <span className="t-meta">{manwon(v)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
