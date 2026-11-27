// 월마감 점검 — 마감 전에 자동으로 확인하는 것들 (고치지 않고 찾아서 보여 줌)
//  ① 통장 잔액 이어짐 (앞 잔액 ± 금액 = 이번 잔액 · 빠진 거래 찾기)
//  ② 확인 필요 · 분류 미정 줄
//  ③ 적격증빙 미확인 (3만 원 넘는 계좌 · 현금 지출에 세금계산서 · 계산서 · 카드 · 현금영수증이 없음 → 가산세 2% 위험)
//  ④ 두 통장에 같은 거래 (중복 기입 의심)
//  ⑤ 대표 가지급 · 가수 (올해 누계)
//  ⑥ 마감 뒤 바뀐 줄
import type { LedgerEntry, TaxInvoice } from './types'
import type { CloseSnapshot, MonthClose } from './acct.ts'
import { lastBalanceRow, monthRange, orderDay, sumOf } from './acct.ts'

export type ChainBreak = { account: string; id: number; date: string; expected: number; actual: number; diff: number }
export type ChainResult = { account: string; rows: number; breaks: ChainBreak[] }

/**
 * 통장 잔액 이어짐: 같은 날 안의 순서는 장부 번호로 알 수 없으므로(은행 파일은 최근 것이 위), 앞 잔액에서 이어지는 줄을 찾아 차례로 붙인다.
 * 이어지는 줄이 없으면 '끊김' — 그 사이에 장부에 없는 거래가 있다는 뜻 (차이 금액 = 빠진 거래 합계).
 */
export function balanceChain(rows: LedgerEntry[], account: string, month: string): ChainResult {
  const { from, to } = monthRange(month)
  const all = rows.filter(r => r.account === account && r.method === '계좌' && r.balance_after != null)
  const before = lastBalanceRow(all.filter(r => r.entry_date < from))
  const inside = all.filter(r => r.entry_date >= from && r.entry_date <= to)
  const breaks: ChainBreak[] = []
  let prev: number | null = before ? (before.balance_after as number) : null
  const byDay = new Map<string, LedgerEntry[]>()
  for (const r of inside) byDay.set(r.entry_date, [...(byDay.get(r.entry_date) ?? []), r])
  for (const day of [...byDay.keys()].sort()) {
    const res = orderDay(byDay.get(day) as LedgerEntry[], prev)
    for (const b of res.breaks) breaks.push({ account, id: b.row.id, date: b.row.entry_date, expected: b.expected, actual: b.row.balance_after as number, diff: (b.row.balance_after as number) - b.expected })
    prev = res.ordered[res.ordered.length - 1].balance_after as number
  }
  return { account, rows: inside.length, breaks }
}

/** 적격증빙이 없어도 되는 지출 (급여 · 세금 · 이자 · 보험 · 이체) */
const EVIDENCE_EXEMPT = ['인건비', '세금 · 공과금', '이자 · 금융비용', '보험료', '카드대금', '내 통장 이체', '대표 가지급 · 가수']
export const EVIDENCE_LIMIT = 30_000

export type CloseCheck = {
  key: string
  title: string
  ok: boolean
  /** 금액 · 건수 요약 */
  summary: string
  detail: string
  rows: LedgerEntry[]
}

export type CloseReport = {
  month: string
  rows: number
  inflow: number
  outflow: number
  chains: ChainResult[]
  checks: CloseCheck[]
  advance: { out: number; in: number; net: number }
  changedAfterClose: LedgerEntry[]
  snapshot: CloseSnapshot
  ready: boolean
}

export function closeReport(input: { month: string; ledger: LedgerEntry[]; invoices: TaxInvoice[]; openingCount: number; close: MonthClose | null }): CloseReport {
  const { month, ledger, invoices, close } = input
  const { from, to } = monthRange(month)
  const inMonth = ledger.filter(r => r.entry_date >= from && r.entry_date <= to)
  const real = inMonth.filter(r => !r.is_transfer)
  const inflow = sumOf(real.filter(r => r.direction === '입금'), r => r.amount)
  const outflow = sumOf(real.filter(r => r.direction === '출금'), r => r.amount)

  const accounts = [...new Set(inMonth.filter(r => r.method === '계좌' && r.balance_after != null && r.account).map(r => r.account as string))]
  const chains = accounts.map(a => balanceChain(ledger, a, month)).filter(c => c.rows > 0)
  const breaks = chains.flatMap(c => c.breaks)

  const review = inMonth.filter(r => r.needs_review)
  const unclassified = inMonth.filter(r => !r.is_transfer && (r.category === '기타 입금' || r.category === '기타 출금'))
  const linked = new Set<number>()
  for (const i of invoices) for (const id of i.ledger_ids ?? []) linked.add(id)
  const noEvidence = inMonth.filter(
    r => r.direction === '출금' && !r.is_transfer && r.method !== '카드' && r.amount > EVIDENCE_LIMIT && !EVIDENCE_EXEMPT.includes(r.category) && !(r.evidence ?? '').trim() && !linked.has(r.id),
  )
  // 두 통장에 같은 날 · 같은 금액 · 같은 방향 · 같은 거래처 (계좌끼리만)
  const seen = new Map<string, LedgerEntry>()
  const dups: LedgerEntry[] = []
  for (const r of inMonth) {
    if (r.method !== '계좌' || !r.account) continue
    const k = `${r.entry_date}|${r.direction}|${r.amount}|${(r.counterparty ?? '').trim()}`
    const other = seen.get(k)
    if (other && other.account !== r.account) dups.push(r)
    else if (!other) seen.set(k, r)
  }
  // 대표 가지급 · 가수: 올해 1월부터 이 달까지 누계
  const ytd = ledger.filter(r => r.category === '대표 가지급 · 가수' && r.entry_date >= `${month.slice(0, 4)}-01-01` && r.entry_date <= to)
  const advOut = sumOf(ytd.filter(r => r.direction === '출금'), r => r.amount)
  const advIn = sumOf(ytd.filter(r => r.direction === '입금'), r => r.amount)

  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  const checks: CloseCheck[] = [
    {
      key: 'chain',
      title: '통장 잔액 이어짐',
      ok: breaks.length === 0,
      summary: chains.length ? (breaks.length ? `${breaks.length}곳 끊김 · 차이 ${won(sumOf(breaks, b => Math.abs(b.diff)))}` : `통장 ${chains.length}개 모두 이어짐`) : '잔액 칸이 있는 통장 거래가 없음',
      detail: '앞 거래 잔액 ± 금액이 다음 잔액과 맞는지 봅니다. 끊긴 곳 앞뒤에 장부에 없는 거래가 있습니다 — 그 기간 은행 거래내역을 다시 올려 주세요.',
      rows: breaks.map(b => ledger.find(r => r.id === b.id)).filter((r): r is LedgerEntry => !!r),
    },
    { key: 'review', title: "'확인 필요' 줄", ok: review.length === 0, summary: review.length ? `${review.length}건 · ${won(sumOf(review, r => r.amount))}` : '없음', detail: '자동 분류를 못 한 줄입니다. 분류를 정해야 손익 · 부가세 숫자가 맞습니다.', rows: review },
    { key: 'unclassified', title: '분류 미정 (기타 입금 · 기타 출금)', ok: unclassified.length === 0, summary: unclassified.length ? `${unclassified.length}건 · ${won(sumOf(unclassified, r => r.amount))}` : '없음', detail: '계정과목을 정할 수 없는 줄입니다. 분류를 고르면 분개 초안 · 손익에 반영됩니다.', rows: unclassified },
    {
      key: 'evidence',
      title: '적격증빙 미확인 (3만 원 넘는 지출)',
      ok: noEvidence.length === 0,
      summary: noEvidence.length ? `${noEvidence.length}건 · ${won(sumOf(noEvidence, r => r.amount))} · 가산세 위험 최대 ${won(Math.round(sumOf(noEvidence, r => r.amount) * 0.02))}` : '없음',
      detail: '계좌 · 현금으로 낸 3만 원 넘는 지출 중 세금계산서 · 계산서 · 카드 · 현금영수증을 찾지 못한 줄입니다 (법인세법 제116조 · 증빙불비 가산세 2% — 제75조의5). 3.3% 원천징수한 인적용역 등은 예외 — 세무대리인 확인.',
      rows: noEvidence,
    },
    { key: 'dup', title: '두 통장에 같은 거래 (중복 의심)', ok: dups.length === 0, summary: dups.length ? `${dups.length}건 · ${won(sumOf(dups, r => r.amount))}` : '없음', detail: '같은 날 · 같은 금액 · 같은 거래처가 다른 통장에도 있습니다. 같은 파일을 다른 통장 이름으로 두 번 올렸는지 확인해 주세요 (지우지 않음).', rows: dups },
    { key: 'opening', title: '기초 잔액', ok: input.openingCount > 0, summary: input.openingCount > 0 ? `통장 ${input.openingCount}개 입력됨` : '올해 기초 잔액 없음', detail: '연초 통장 잔액이 있어야 재무상태(현금 · 부채)를 맞출 수 있습니다. 통계 탭에서 통장별 기초 잔액을 넣어 주세요.', rows: [] },
  ]
  const changedAfterClose = close?.closed && close.closed_at ? inMonth.filter(r => r.updated_at > (close.closed_at as string) || r.created_at > (close.closed_at as string)) : []
  const snapshot: CloseSnapshot = { rows: inMonth.length, inflow, outflow, review: review.length, unclassified: unclassified.length, noEvidence: noEvidence.length, breaks: breaks.length }
  const ready = checks.filter(c => c.key !== 'opening').every(c => c.ok)
  return { month, rows: inMonth.length, inflow, outflow, chains, checks, advance: { out: advOut, in: advIn, net: advOut - advIn }, changedAfterClose, snapshot, ready }
}
