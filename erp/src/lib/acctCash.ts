// 자금 계획 (30 · 60 · 90일) — 실제 통장 잔액에서 시작해 받을 돈 · 낼 돈을 날짜별로 더함
//  - 받을 돈: 결제 대장 수금(예정 · 청구) · 거래처의 지난 입금 지연을 반영해 낮은 · 기대 · 높은 값
//  - 낼 돈: 결제 대장 지급(대기 · 예정) · 정기 출금(계좌 · 카드대금 — 카드로 나가는 구독은 카드대금에 들어 있어 뺌) · 부가세 예상
//  - 숫자를 지어내지 않는다: 날짜 없는 받을 돈은 계산에 넣지 않고 따로 보여 줌
import type { LedgerEntry, LedgerRecurring, Payment } from './types'
import { daysBetween, lastBalanceRow } from './acct.ts'
import { addDays } from './date.ts'

export type AccountBalance = { account: string; balance: number; date: string; stale: boolean; excluded: boolean; reason: string | null }

const EXCLUDE_ACCOUNT_RE = /(대출|운행기록부)/

/** 통장별 마지막 잔액 (은행 거래내역의 잔액 칸 · 같은 날은 잔액이 이어지는 순서로) — 14일 넘게 거래내역이 안 들어온 통장은 '오래됨' */
export function accountBalances(ledger: LedgerEntry[], today: string): AccountBalance[] {
  const byAccount = new Map<string, LedgerEntry[]>()
  for (const r of ledger) {
    if (r.method !== '계좌' || r.balance_after == null || !r.account) continue
    byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r])
  }
  const last = new Map<string, LedgerEntry>()
  for (const [account, rows] of byAccount) {
    const r = lastBalanceRow(rows)
    if (r) last.set(account, r)
  }
  return [...last.entries()]
    .map(([account, r]) => {
      const stale = daysBetween(r.entry_date, today) > 14
      const excluded = EXCLUDE_ACCOUNT_RE.test(account)
      return { account, balance: r.balance_after as number, date: r.entry_date, stale, excluded, reason: excluded ? (account.includes('대출') ? '대출 계정 — 자금에서 뺌' : '통장이 아닌 파일이 들어온 것으로 보임 — 확인 필요') : stale ? `${r.entry_date} 이후 거래내역 없음 — 최신 내역을 올려 주세요` : null }
    })
    .sort((a, b) => b.balance - a.balance)
}

/** 거래처별 평균 입금 지연(일) — 결제 대장 완료 수금의 (입금일 − 예정일). 2건 미만이면 전체 평균, 3건 미만이면 0 */
export function paymentDelays(payments: Payment[]): { byPayee: Map<string, number>; overall: number } {
  const samples: { who: string; d: number }[] = []
  for (const p of payments) {
    if (p.direction !== '수금' || p.status !== '완료' || !p.paid_date) continue
    const due = p.due_date ?? p.requested_date
    if (!due) continue
    samples.push({ who: (p.payee ?? '').trim(), d: Math.max(0, daysBetween(due, p.paid_date)) })
  }
  const overall = samples.length >= 3 ? Math.round(samples.reduce((n, s) => n + s.d, 0) / samples.length) : 0
  const by = new Map<string, number[]>()
  for (const s of samples) if (s.who) by.set(s.who, [...(by.get(s.who) ?? []), s.d])
  const byPayee = new Map<string, number>()
  for (const [who, ds] of by) if (ds.length >= 2) byPayee.set(who, Math.round(ds.reduce((n, v) => n + v, 0) / ds.length))
  return { byPayee, overall }
}

export type Flow = {
  kind: '받을 돈' | '낼 돈'
  label: string
  who: string
  amount: number
  /** 원래 날짜 (없으면 null) */
  date: string | null
  /** 시나리오별 들어오는(나가는) 날 — null 이면 그 시나리오에서 90일 안에 안 들어옴 */
  low: string | null
  exp: string | null
  high: string | null
  source: '결제 대장' | '정기 출금' | '부가세'
  overdue: boolean
  note: string | null
}

export type CashBucket = { label: string; to: string; inLow: number; inExp: number; inHigh: number; out: number; endLow: number; endExp: number; endHigh: number; outLow: number }
export type CashPlan = { opening: number; accounts: AccountBalance[]; flows: Flow[]; buckets: CashBucket[]; undated: Flow[]; risks: string[] }

const OPEN_IN = ['예정', '청구']
const OPEN_OUT = ['대기', '예정']

/** 정기 출금 → 기간 안 날짜들 (카드로 나가는 것은 카드대금에 들어 있어 뺌) */
export function recurringFlows(list: LedgerRecurring[], today: string, days: number): Flow[] {
  const out: Flow[] = []
  const end = addDays(today, days)
  for (const r of list) {
    if (!r.active || r.method === '카드' || r.amount <= 0) continue
    let y = Number(today.slice(0, 4))
    let m = Number(today.slice(5, 7))
    for (let i = 0; i < 5; i++) {
      const month = `${y}-${String(m).padStart(2, '0')}`
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const date = `${month}-${String(Math.min(r.day_of_month, last)).padStart(2, '0')}`
      const inRange = (!r.start_month || month >= r.start_month) && (!r.end_month || month <= r.end_month)
      if (inRange && date > today && date <= end) out.push({ kind: '낼 돈', label: r.name, who: r.counterparty ?? '', amount: r.amount, date, low: date, exp: date, high: date, source: '정기 출금', overdue: false, note: r.category === '카드대금' ? '카드대금은 지난달 사용액에 따라 달라짐 — 정기 출금에 적힌 금액' : null })
      m += 1
      if (m === 13) {
        m = 1
        y += 1
      }
    }
  }
  return out
}

/** 결제 대장 → 받을 돈 · 낼 돈 */
export function paymentFlows(payments: Payment[], today: string, delays: ReturnType<typeof paymentDelays>): { flows: Flow[]; undated: Flow[] } {
  const flows: Flow[] = []
  const undated: Flow[] = []
  for (const p of payments) {
    const amount = Math.round(p.amount)
    if (!amount || amount < 0) continue
    if (p.direction === '수금' && OPEN_IN.includes(p.status)) {
      const date = p.due_date ?? p.requested_date
      const who = (p.payee ?? '').trim()
      const base = { kind: '받을 돈' as const, label: p.title, who, amount, source: '결제 대장' as const }
      if (!date) {
        undated.push({ ...base, date: null, low: null, exp: null, high: null, overdue: false, note: '받을 날짜 없음 — 결제 대장에 예정일을 넣으면 계획에 들어감' })
        continue
      }
      const delay = delays.byPayee.get(who) ?? delays.overall
      const late = daysBetween(date, today)
      if (late > 0) {
        // 이미 지난 수금: 높은 값은 곧 들어옴, 기대는 60일 안 지연만, 낮은 값은 안 들어옴
        flows.push({ ...base, date, overdue: true, high: addDays(today, 7), exp: late <= 60 ? addDays(today, 14) : null, low: null, note: `예정일 ${date} 에서 ${late}일 지남` })
      } else {
        flows.push({ ...base, date, overdue: false, high: date, exp: addDays(date, delay), low: addDays(date, Math.max(delay, 30)), note: delay ? `이 거래처 평균 ${delay}일 늦게 입금` : null })
      }
    } else if (p.direction === '지급' && OPEN_OUT.includes(p.status)) {
      const date = p.due_date ?? p.requested_date
      const when = !date || date < today ? addDays(today, 7) : date
      flows.push({ kind: '낼 돈', label: p.title, who: (p.payee ?? '').trim(), amount, date: date ?? null, low: when, exp: when, high: when, source: '결제 대장', overdue: !!date && date < today, note: !date ? '지급 예정일 없음 — 다음 주로 가정' : date < today ? `예정일 ${date} 지남 — 곧 나갈 돈으로 봄` : p.is_estimate ? '예상 비용 (실제 결제 전)' : null })
    }
  }
  return { flows, undated }
}

export function cashPlan(input: {
  today: string
  ledger: LedgerEntry[]
  payments: Payment[]
  recurring: LedgerRecurring[]
  /** 다가오는 부가세 (기대 · 많이 낼 때) */
  vat?: { date: string; expected: number; high: number; label: string } | null
  /** 자금에서 뺄 통장 (화면에서 고름) */
  skipAccounts?: Set<string>
}): CashPlan {
  const { today } = input
  const accounts = accountBalances(input.ledger, today).map(a => (input.skipAccounts?.has(a.account) ? { ...a, excluded: true, reason: a.reason ?? '화면에서 뺌' } : a))
  const opening = accounts.filter(a => !a.excluded).reduce((n, a) => n + a.balance, 0)
  const delays = paymentDelays(input.payments)
  const pf = paymentFlows(input.payments, today, delays)
  const flows = [...pf.flows, ...recurringFlows(input.recurring, today, 90)]
  if (input.vat && input.vat.date > today && daysBetween(today, input.vat.date) <= 90 && input.vat.high > 0) {
    const d = input.vat.date
    flows.push({ kind: '낼 돈', label: input.vat.label, who: '세무서', amount: Math.max(0, input.vat.expected), date: d, low: d, exp: d, high: d, source: '부가세', overdue: false, note: `많이 낼 때 ${input.vat.high.toLocaleString('ko-KR')}원 (카드 공제를 못 받을 때)` })
  }
  flows.sort((a, b) => (a.exp ?? a.high ?? '9999').localeCompare(b.exp ?? b.high ?? '9999'))

  const ends = [30, 60, 90].map(n => addDays(today, n))
  let cumLow = opening
  let cumExp = opening
  let cumHigh = opening
  const buckets: CashBucket[] = ends.map((to, i) => {
    const from = i === 0 ? today : ends[i - 1]
    const within = (d: string | null) => !!d && d > from && d <= to
    const inLow = flows.filter(f => f.kind === '받을 돈' && within(f.low)).reduce((n, f) => n + f.amount, 0)
    const inExp = flows.filter(f => f.kind === '받을 돈' && within(f.exp)).reduce((n, f) => n + f.amount, 0)
    const inHigh = flows.filter(f => f.kind === '받을 돈' && within(f.high)).reduce((n, f) => n + f.amount, 0)
    const out = flows.filter(f => f.kind === '낼 돈' && within(f.exp)).reduce((n, f) => n + f.amount, 0)
    // 낮은 값 시나리오는 부가세를 '많이 낼 때'로
    const vatExtra = input.vat && flows.some(f => f.source === '부가세' && within(f.exp)) ? Math.max(0, input.vat.high - Math.max(0, input.vat.expected)) : 0
    const outLow = out + vatExtra
    cumLow += inLow - outLow
    cumExp += inExp - out
    cumHigh += inHigh - out
    return { label: `${(i + 1) * 30}일`, to, inLow, inExp, inHigh, out, outLow, endLow: cumLow, endExp: cumExp, endHigh: cumHigh }
  })

  const risks: string[] = []
  const neg = buckets.find(b => b.endLow < 0)
  if (neg) risks.push(`늦게 들어오면(낮은 값) ${neg.label} 안에 잔액이 ${Math.abs(neg.endLow).toLocaleString('ko-KR')}원 모자랍니다.`)
  const overdue = flows.filter(f => f.kind === '받을 돈' && f.overdue).sort((a, b) => b.amount - a.amount)
  for (const f of overdue.slice(0, 2)) risks.push(`${f.who || f.label} 수금 ${f.amount.toLocaleString('ko-KR')}원 — ${f.note}`)
  const bigOut = flows.filter(f => f.kind === '낼 돈' && f.source !== '정기 출금').sort((a, b) => b.amount - a.amount)[0]
  if (bigOut) risks.push(`가장 큰 지급: ${bigOut.label}${bigOut.who ? ` (${bigOut.who})` : ''} ${bigOut.amount.toLocaleString('ko-KR')}원 · ${bigOut.exp}`)
  const stale = accounts.filter(a => a.stale && !a.excluded)
  if (stale.length) risks.push(`잔액이 오래된 통장 ${stale.length}개 (${stale.map(a => `${a.account} ${a.date}`).join(' · ')}) — 시작 잔액이 실제와 다를 수 있습니다.`)
  if (pf.undated.length) risks.push(`받을 날짜가 없는 수금 ${pf.undated.length}건 · ${pf.undated.reduce((n, f) => n + f.amount, 0).toLocaleString('ko-KR')}원 — 계획에 넣지 않았습니다.`)
  return { opening, accounts, flows, buckets, undated: pf.undated, risks: risks.slice(0, 5) }
}
