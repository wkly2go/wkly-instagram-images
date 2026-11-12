// 세금계산서 ↔ 통장 짝짓기 (계산서 기준 장부 · 2026-11-12)
import type { LedgerEntry, TaxInvoice } from './types'

const clean = (s: string) => s.replace(/\(주\)|（주）|주식회사|㈜|\(.*?\)|\s/g, '').toLowerCase()
export const day = (s: string) => Date.parse(`${s}T00:00:00`) / 864e5

export interface InvoiceMatch {
  inv: TaxInvoice
  /** 금액이 똑같은 통장 줄 (한 번에 받거나 낸 경우) */
  row: LedgerEntry | null
  /** 받은 · 낸 돈 (나눠서 받은 경우 거래처별로 계산서 순서대로 채움) */
  paid: number
  /** 남은 돈 = 계산서 합계 − paid */
  left: number
  /** 수정 발행(마이너스 계산서)으로 서로 지워진 계산서 */
  canceled?: boolean
}

/** 계산서 ↔ 통장 짝짓기
 *  1) 증빙이 붙은 통장 줄 중 같은 금액 · 발행 45일 전 ~ 60일 뒤, 이름이 맞는 것 먼저
 *  2) 남은 계산서는 거래처 이름이 맞는 통장 입금 · 지급을 날짜순으로 모아 계산서 순서대로 채움 (계약금 · 잔금처럼 나눠 받은 돈)
 *     — 2026-11-12 더위클리컴퍼니 계산서 8억 3천을 여러 번에 나눠 받은 것을 미수로 잘못 보던 문제 */
export function matchInvoices(invoices: TaxInvoice[], rows: LedgerEntry[]): InvoiceMatch[] {
  const cash = rows.filter(r => !r.is_transfer && r.method !== '카드')
  const used = new Set<number>()
  const sorted = [...invoices].sort((a, b) => a.write_date.localeCompare(b.write_date))
  const out = new Map<string, InvoiceMatch>()
  const nameOf = (inv: TaxInvoice) => clean(inv.partner_name ?? '').slice(0, 4)
  const hit = (r: LedgerEntry, p: string) => !!p && clean(`${r.counterparty ?? ''}${r.memo ?? ''}`).includes(p)
  // 0) 마이너스(수정 · 취소) 계산서는 같은 거래처 · 같은 금액의 원 계산서와 서로 지움 (가까운 날짜 먼저)
  const canceled = new Set<string>()
  for (const neg of sorted.filter(i => i.total < 0)) {
    const p = nameOf(neg)
    const pair = sorted
      .filter(i => i.total === -neg.total && i.direction === neg.direction && !canceled.has(i.id) && nameOf(i) === p)
      .sort((a, b) => Math.abs(day(a.write_date) - day(neg.write_date)) - Math.abs(day(b.write_date) - day(neg.write_date)) || (a.write_date <= neg.write_date ? -1 : 1))[0]
    if (!pair) continue
    canceled.add(neg.id)
    canceled.add(pair.id)
  }
  for (const inv of sorted) {
    if (canceled.has(inv.id) || inv.total < 0) {
      out.set(inv.id, { inv, row: null, paid: 0, left: 0, canceled: true })
      continue
    }
    const dir = inv.direction === '매출' ? '입금' : '출금'
    const p = nameOf(inv)
    const d0 = day(inv.write_date)
    let best: LedgerEntry | null = null
    let score = Infinity
    for (const r of cash) {
      if (r.evidence !== '세금계산서' || used.has(r.id) || r.direction !== dir || r.amount !== Math.abs(inv.total)) continue
      const gap = day(r.entry_date) - d0
      if (gap < -45 || gap > 60) continue
      const sc = (hit(r, p) ? 0 : 1000) + Math.abs(gap)
      if (sc < score) {
        score = sc
        best = r
      }
    }
    if (best) used.add(best.id)
    const total = Math.abs(inv.total)
    out.set(inv.id, { inv, row: best, paid: best ? total : 0, left: best ? 0 : total })
  }
  // 2) 거래처별 나눠 받은 돈
  const groups = new Map<string, TaxInvoice[]>()
  for (const inv of sorted) {
    if (out.get(inv.id)!.left === 0) continue
    const k = `${inv.direction}|${nameOf(inv)}`
    if (!nameOf(inv)) continue
    groups.set(k, [...(groups.get(k) ?? []), inv])
  }
  for (const [k, list] of groups) {
    const [d, p] = k.split('|')
    const dir = d === '매출' ? '입금' : '출금'
    const first = day(list[0].write_date) - 45
    let pot = cash.filter(r => !used.has(r.id) && r.direction === dir && hit(r, p) && day(r.entry_date) >= first).reduce((n, r) => n + r.amount, 0)
    for (const inv of list) {
      const m = out.get(inv.id)!
      const take = Math.min(pot, m.left)
      pot -= take
      m.paid += take
      m.left -= take
    }
  }
  return sorted.map(inv => out.get(inv.id)!)
}
