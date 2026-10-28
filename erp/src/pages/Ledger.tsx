import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BarChart3, CalendarClock, ChevronLeft, ChevronRight, Download, KeyRound, Lock, Pencil, Search, Trash2, Wallet, X } from 'lucide-react'
import { CompareView, RecurringView } from '../components/LedgerViews'
import { Shell } from '../components/Shell'
import { Button, Empty, Field, Modal, ViewTabs } from '../components/ui'
import { ask } from '../components/Ask'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addMonths, manwon, todayKey, won } from '../lib/date'
import { downloadText, toCsv } from '../lib/csv'
import { LEDGER_CATEGORIES, LEDGER_METHODS, type LedgerDirection, type LedgerEntry, type LedgerMethod, type LedgerStatus } from '../lib/types'

/**
 * 입출금 장부 (대표 지시 2026-10-28 "관리자만 사용하는 월별 입출입 장부 · 입출금이 한눈에 · 입력이 쉽게 · 반드시 관리자만 · 접근 시 비밀번호")
 *  - 서버(0063)가 막음: 관리자 + 장부 비밀번호로 잠금을 푼 뒤 30분만 데이터를 줌 (쓰는 동안 연장)
 *  - 화면을 떠나거나 10분 동안 손대지 않으면 다시 잠금
 *  - 계좌번호는 받지 않음 (결제 수단은 계좌 · 카드 · 현금 구분만)
 */
const IDLE_MS = 10 * 60_000

export default function Ledger() {
  const { api, me } = useApp()
  const [status, setStatus] = useState<LedgerStatus | null>(null)
  const refresh = useCallback(() => api.ledgerStatus().then(setStatus).catch(() => setStatus({ admin: false })), [api])
  useEffect(() => void refresh(), [refresh])
  const open = !!status?.open_until && status.open_until > new Date().toISOString()

  // 화면을 떠나면 잠금
  useEffect(() => () => void api.ledgerLock().catch(() => undefined), [api])

  return (
    <Shell active="ledger">
      {me.role !== 'admin' || (status && !status.admin) ? (
        <Empty>관리자만 볼 수 있는 화면입니다.</Empty>
      ) : !status ? (
        <Empty>확인하는 중…</Empty>
      ) : open ? (
        <LedgerBoard
          onLock={async () => {
            await api.ledgerLock().catch(() => undefined)
            void refresh()
          }}
          onExpired={() => void refresh()}
        />
      ) : (
        <LockGate status={status} onOpened={() => void refresh()} />
      )}
    </Shell>
  )
}

/** 잠금 화면: 처음이면 비밀번호 정하기, 아니면 비밀번호 넣기 */
function LockGate({ status, onOpened }: { status: LedgerStatus; onOpened: () => void }) {
  const { api } = useApp()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = !status.has_password
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (first && pw !== pw2) return setErr('두 비밀번호가 다릅니다.')
    setBusy(true)
    try {
      if (first) await api.ledgerSetPassword(null, pw)
      await api.ledgerUnlock(pw)
      setPw('')
      setPw2('')
      onOpened()
    } catch (x) {
      setErr(friendlyError(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ledger-gate">
      <form className="ledger-gate-card" onSubmit={submit}>
        <Lock size={28} className="t-blue" />
        <h2 className="t-title">입출금 장부</h2>
        <span className="t-cap">{first ? '처음 한 번, 장부 비밀번호를 정해 주세요 (6자 이상). 인트라넷 로그인 비밀번호와 다르게 정하는 것을 권합니다.' : '관리자 전용입니다. 장부 비밀번호를 넣어 주세요.'}</span>
        <input className="input" type="password" autoFocus autoComplete={first ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} placeholder={first ? '새 장부 비밀번호' : '장부 비밀번호'} aria-label="장부 비밀번호" />
        {first && <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="한 번 더" aria-label="비밀번호 확인" />}
        {err && <span className="t-small t-red">{err}</span>}
        {!!status.fails && !err && <span className="t-cap t-red">최근 10분 동안 {status.fails}번 틀렸습니다. 5번이면 10분 잠깁니다.</span>}
        <Button type="submit" block disabled={busy || pw.length < (first ? 6 : 1)}>
          {first ? '정하고 열기' : '열기'}
        </Button>
        <span className="t-meta">열면 30분 동안 쓸 수 있고, 10분 동안 손대지 않거나 화면을 떠나면 다시 잠깁니다.</span>
      </form>
    </div>
  )
}

type Draft = { id?: number; direction: LedgerDirection; entry_date: string; amount: string; category: string; counterparty: string; method: LedgerMethod; memo: string }
const emptyDraft = (d: LedgerDirection = '출금', date = todayKey()): Draft => ({ direction: d, entry_date: date, amount: '', category: LEDGER_CATEGORIES[d][0], counterparty: '', method: '계좌', memo: '' })
const digits = (s: string) => s.replace(/[^\d]/g, '')
const comma = (s: string) => (digits(s) ? Number(digits(s)).toLocaleString('ko-KR') : '')
const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`
}

function LedgerBoard({ onLock, onExpired }: { onLock: () => void; onExpired: () => void }) {
  const { api, toast, profileName } = useApp()
  const [month, setMonth] = useState(todayKey().slice(0, 7))
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [prev, setPrev] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState<Draft>(() => emptyDraft())
  const [filter, setFilter] = useState<'all' | LedgerDirection>('all')
  const [q, setQ] = useState('')
  const [changingPw, setChangingPw] = useState(false)
  // 이번 달 · 정기 출금 · 월별 비교 (2026-10-28 "정기 출금일과 금액 · 월별 비교 대시보드")
  const [tab, setTab] = useState<'month' | 'recurring' | 'compare'>('month')
  const amountRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const pm = addMonths(month, -1)
      const [a, b] = await Promise.all([api.listLedger(`${month}-01`, monthEnd(month)), api.listLedger(`${pm}-01`, monthEnd(pm))])
      setRows(a)
      setPrev(b)
    } catch {
      onExpired() // 잠겼거나 시간이 지남 → 잠금 화면
    } finally {
      setLoading(false)
    }
  }, [api, month, onExpired])
  useEffect(() => void load(), [load])

  // 쓰는 동안 연장 (5분마다 한 번), 10분 손대지 않으면 잠금
  useEffect(() => {
    let last = Date.now()
    let touched = Date.now()
    const act = () => {
      last = Date.now()
      if (Date.now() - touched > 5 * 60_000) {
        touched = Date.now()
        api.ledgerTouch().then(u => !u && onExpired()).catch(() => undefined)
      }
    }
    const tick = window.setInterval(() => Date.now() - last > IDLE_MS && onLock(), 30_000)
    window.addEventListener('pointerdown', act)
    window.addEventListener('keydown', act)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('pointerdown', act)
      window.removeEventListener('keydown', act)
    }
  }, [api, onExpired, onLock])

  const sum = (list: LedgerEntry[], d: LedgerDirection) => list.filter(r => r.direction === d).reduce((n, r) => n + r.amount, 0)
  const inSum = sum(rows, '입금')
  const outSum = sum(rows, '출금')
  const pIn = sum(prev, '입금')
  const pOut = sum(prev, '출금')
  const net = inSum - outSum

  // 날짜별 (그래프)
  const days = useMemo(() => {
    const n = Number(monthEnd(month).slice(8))
    return Array.from({ length: n }, (_, i) => {
      const key = `${month}-${String(i + 1).padStart(2, '0')}`
      const day = rows.filter(r => r.entry_date === key)
      return { key, d: i + 1, inn: sum(day, '입금'), out: sum(day, '출금') }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month])
  const maxDay = Math.max(1, ...days.map(d => Math.max(d.inn, d.out)))

  // 분류별
  const byCat = (d: LedgerDirection) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.direction === d) m.set(r.category, (m.get(r.category) ?? 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }

  const shown = rows.filter(r => (filter === 'all' || r.direction === filter) && (!q.trim() || `${r.category} ${r.counterparty ?? ''} ${r.memo ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    const amount = Number(digits(f.amount))
    if (!amount) {
      amountRef.current?.focus()
      return toast('금액을 넣어 주세요.')
    }
    try {
      await api.saveLedger({ id: f.id, direction: f.direction, entry_date: f.entry_date, amount, category: f.category.trim() || '기타', counterparty: f.counterparty.trim() || null, method: f.method, memo: f.memo.trim() || null })
      toast(f.id ? '고쳤습니다.' : `${f.direction} ${won(amount)} 기록했습니다.`)
      // 같은 날짜 · 구분은 그대로 두고 다음 입력
      setF(emptyDraft(f.direction, f.entry_date))
      if (f.entry_date.slice(0, 7) !== month) setMonth(f.entry_date.slice(0, 7))
      else void load()
      amountRef.current?.focus()
    } catch (x) {
      toast(friendlyError(x))
      void load()
    }
  }
  const edit = (r: LedgerEntry) => {
    setF({ id: r.id, direction: r.direction, entry_date: r.entry_date, amount: r.amount.toLocaleString('ko-KR'), category: r.category, counterparty: r.counterparty ?? '', method: r.method, memo: r.memo ?? '' })
    amountRef.current?.focus()
  }
  const remove = async (r: LedgerEntry) => {
    if (!(await ask(`${r.entry_date} ${r.direction} ${won(r.amount)} (${r.category}) 기록을 지울까요?`))) return
    try {
      await api.deleteLedger(r.id)
      toast('지웠습니다.')
      void load()
    } catch (x) {
      toast(friendlyError(x))
    }
  }
  const exportCsv = () => {
    const csv = toCsv(
      [...rows].reverse().map(r => ({ 날짜: r.entry_date, 구분: r.direction, 금액: r.amount, 분류: r.category, 거래처: r.counterparty ?? '', 수단: r.method, 메모: r.memo ?? '', 기록: profileName(r.created_by) })),
    )
    downloadText(`입출금장부_${month}.csv`, '﻿' + csv)
  }
  const diff = (a: number, b: number) => (b ? `지난달 ${a >= b ? '▲' : '▼'} ${manwon(Math.abs(a - b))}` : '지난달 기록 없음')
  const [y, m] = month.split('-')

  return (
    <div className="ledger col gap-12">
      {/* 머리: 월 이동 · 내보내기 · 비밀번호 · 잠금 */}
      <ViewTabs
        label="장부 화면"
        items={[
          { key: 'month' as const, label: '월 장부', icon: <Wallet size={14} /> },
          { key: 'recurring' as const, label: '정기 출금', icon: <CalendarClock size={14} /> },
          { key: 'compare' as const, label: '월별 비교', icon: <BarChart3 size={14} /> },
        ]}
        active={tab}
        onPick={setTab}
      />
      <div className="row ledger-head">
        {tab !== 'recurring' && (
          <>
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="지난달">
          <ChevronLeft size={18} />
        </button>
        <b className="t-title">
          {y}년 {Number(m)}월
        </b>
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRight size={18} />
        </button>
        {month !== todayKey().slice(0, 7) && (
          <button type="button" className="link-btn t-cap" onClick={() => setMonth(todayKey().slice(0, 7))}>
            이번 달
          </button>
        )}
          </>
        )}
        {tab === 'compare' && <span className="t-cap">까지 12개월</span>}
        {tab === 'recurring' && <b className="t-title">매달 나가는 돈</b>}
        <span className="grow" />
        <Button kind="ghost" size="sm" onClick={exportCsv} disabled={!rows.length || tab !== 'month'} title="이 달 장부를 엑셀(CSV)로">
          <Download size={14} /> 엑셀
        </Button>
        <Button kind="ghost" size="sm" onClick={() => setChangingPw(true)} title="장부 비밀번호 바꾸기">
          <KeyRound size={14} /> 비밀번호
        </Button>
        <Button kind="outline" size="sm" onClick={onLock} title="지금 잠그기">
          <Lock size={14} /> 잠그기
        </Button>
      </div>

      {tab === 'recurring' ? (
        <RecurringView onExpired={onExpired} />
      ) : tab === 'compare' ? (
        <CompareView month={month} onExpired={onExpired} />
      ) : (
      <>
      {/* 한눈에: 입금 · 출금 · 남은 돈 */}
      <div className="ledger-kpis">
        <div className="ledger-kpi in">
          <span className="t-cap">입금</span>
          <b>{won(inSum)}</b>
          <span className="t-meta">
            {rows.filter(r => r.direction === '입금').length}건 · {diff(inSum, pIn)}
          </span>
        </div>
        <div className="ledger-kpi out">
          <span className="t-cap">출금</span>
          <b>{won(outSum)}</b>
          <span className="t-meta">
            {rows.filter(r => r.direction === '출금').length}건 · {diff(outSum, pOut)}
          </span>
        </div>
        <div className={`ledger-kpi net ${net < 0 ? 'minus' : ''}`}>
          <span className="t-cap">차액 (입금 − 출금)</span>
          <b>
            {net < 0 ? '−' : '+'}
            {won(Math.abs(net))}
          </b>
          <span className="t-meta">{inSum + outSum ? `출금이 입금의 ${inSum ? Math.round((outSum / inSum) * 100) : '—'}%` : '이 달 기록 없음'}</span>
        </div>
      </div>

      {/* 날짜별 막대 + 분류별 */}
      <div className="ledger-charts">
        <section className="ledger-chart" aria-label="날짜별 입출금">
          <div className="row t-cap">
            <span className="grow">날짜별</span>
            <span className="lg-key in" /> 입금 <span className="lg-key out" /> 출금
          </div>
          <div className="ledger-bars">
            {days.map(d => (
              <div key={d.key} className={`ledger-day${d.key === todayKey() ? ' today' : ''}`} title={`${Number(m)}/${d.d} · 입금 ${won(d.inn)} · 출금 ${won(d.out)}`} onClick={() => setF(x => ({ ...x, entry_date: d.key }))}>
                <div className="bar-pair">
                  <i className="in" style={{ height: `${(d.inn / maxDay) * 100}%` }} />
                  <i className="out" style={{ height: `${(d.out / maxDay) * 100}%` }} />
                </div>
                <span>{d.d % 5 === 0 || d.d === 1 ? d.d : ''}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ledger-cats" aria-label="분류별">
          {(['입금', '출금'] as LedgerDirection[]).map(dir => {
            const list = byCat(dir)
            const total = dir === '입금' ? inSum : outSum
            return (
              <div key={dir} className="col gap-4">
                <span className="t-cap">{dir} 분류</span>
                {list.length === 0 && <span className="t-meta">없음</span>}
                {list.slice(0, 6).map(([c, v]) => (
                  <div key={c} className="ledger-cat" title={won(v)}>
                    <span className="truncate">{c}</span>
                    <span className="meter">
                      <i className={dir === '입금' ? 'in' : 'out'} style={{ width: `${total ? (v / total) * 100 : 0}%` }} />
                    </span>
                    <span className="t-meta">{manwon(v)}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </section>
      </div>

      {/* 입력: 한 줄 · Enter 로 기록 */}
      <form className={`ledger-form ${f.direction === '입금' ? 'in' : 'out'}`} onSubmit={save}>
        <div className="seg ledger-dir" role="group" aria-label="입금 · 출금">
          {(['입금', '출금'] as LedgerDirection[]).map(d => (
            <button key={d} type="button" className={f.direction === d ? 'on' : ''} onClick={() => setF(x => ({ ...x, direction: d, category: LEDGER_CATEGORIES[d].includes(x.category) || !x.category ? LEDGER_CATEGORIES[d][0] : x.category }))}>
              {d}
            </button>
          ))}
        </div>
        <input className="input lf-date" type="date" value={f.entry_date} onChange={e => setF({ ...f, entry_date: e.target.value })} aria-label="날짜" required />
        <div className="lf-amount">
          <input ref={amountRef} className="input" inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: comma(e.target.value) })} placeholder="금액" aria-label="금액" autoFocus />
          <span className="t-meta">{digits(f.amount) ? manwon(Number(digits(f.amount))) : '원'}</span>
        </div>
        <input className="input lf-cat" list={`ledger-cats-${f.direction}`} value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="분류" aria-label="분류" maxLength={40} />
        <datalist id={`ledger-cats-${f.direction}`}>
          {[...new Set([...LEDGER_CATEGORIES[f.direction], ...rows.filter(r => r.direction === f.direction).map(r => r.category)])].map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input className="input lf-who" value={f.counterparty} onChange={e => setF({ ...f, counterparty: e.target.value })} placeholder={f.direction === '입금' ? '보낸 곳' : '받는 곳'} aria-label="거래처" maxLength={100} />
        <select className="select lf-method" value={f.method} onChange={e => setF({ ...f, method: e.target.value as LedgerMethod })} aria-label="수단">
          {LEDGER_METHODS.map(x => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input className="input lf-memo" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} placeholder="메모 (선택)" aria-label="메모" maxLength={500} />
        <Button type="submit" size="sm">
          {f.id ? '고치기' : '기록'}
        </Button>
        {f.id && (
          <button type="button" className="icon-btn sm" onClick={() => setF(emptyDraft(f.direction, f.entry_date))} aria-label="고치기 취소" title="취소">
            <X size={14} />
          </button>
        )}
      </form>

      {/* 내역 */}
      <div className="row ledger-list-head">
        <div className="seg" role="group" aria-label="보기">
          {(['all', '입금', '출금'] as const).map(k => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'all' ? '전체' : k} <b>{k === 'all' ? rows.length : rows.filter(r => r.direction === k).length}</b>
            </button>
          ))}
        </div>
        <span className="grow" />
        <label className="search">
          <Search size={13} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="분류 · 거래처 · 메모" aria-label="내역 검색" />
        </label>
      </div>
      {loading ? (
        <Empty>불러오는 중…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{rows.length ? '조건에 맞는 기록이 없습니다.' : '이 달 기록이 없습니다. 위 입력 줄에 금액을 넣고 Enter 를 누르면 바로 기록됩니다.'}</Empty>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>분류</th>
              <th>거래처</th>
              <th>수단</th>
              <th>메모</th>
              <th className="num">금액</th>
              <th aria-label="고치기 · 지우기" />
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} className={f.id === r.id ? 'editing' : ''}>
                <td className="mono">{r.entry_date.slice(5).replace('-', '.')}</td>
                <td>{r.category}</td>
                <td className="truncate">{r.counterparty ?? ''}</td>
                <td className="t-meta">{r.method}</td>
                <td className="t-cap truncate">{r.memo ?? ''}</td>
                <td className={`num ${r.direction === '입금' ? 'in' : 'out'}`}>
                  {r.direction === '입금' ? '+' : '−'}
                  {r.amount.toLocaleString('ko-KR')}
                </td>
                <td className="row-actions">
                  <button type="button" className="icon-btn sm" onClick={() => edit(r)} aria-label="고치기" title="고치기">
                    <Pencil size={13} />
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
      </>
      )}
      {changingPw && <ChangePassword onClose={() => setChangingPw(false)} onDone={onExpired} />}
    </div>
  )
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { api, toast } = useApp()
  const [oldPw, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (pw !== pw2) return toast('새 비밀번호 두 칸이 다릅니다.')
    setBusy(true)
    try {
      await api.ledgerSetPassword(oldPw, pw)
      toast('장부 비밀번호를 바꿨습니다. 새 비밀번호로 다시 열어 주세요.')
      onClose()
      onDone()
    } catch (x) {
      toast(friendlyError(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="장부 비밀번호 바꾸기"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !oldPw || pw.length < 6}>
            바꾸기
          </Button>
        </>
      }
    >
      <Field label="지금 비밀번호">
        <input className="input" type="password" autoFocus autoComplete="current-password" value={oldPw} onChange={e => setOld(e.target.value)} />
      </Field>
      <Field label="새 비밀번호 (6자 이상)">
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
      </Field>
      <Field label="새 비밀번호 한 번 더">
        <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
      </Field>
      <span className="t-cap">바꾸면 열려 있는 장부는 모두 잠깁니다.</span>
    </Modal>
  )
}
