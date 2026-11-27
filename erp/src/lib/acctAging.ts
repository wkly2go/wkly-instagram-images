// 미수 · 미지급 연령표 (세금계산서 작성일 기준 · 은행 · 카드 대사 결과 반영)
//  0~30 · 31~60 · 61~90 · 90일 넘음. 거래처는 사업자번호로만 묶는다 (이름이 비슷해도 합치지 않음).
import type { CompanyKey } from './company.ts'
import { companyOfInvoice } from './company.ts'
import type { TaxInvoice } from './types'
import { daysBetween } from './acct.ts'

export const AGING_BUCKETS = ['0~30일', '31~60일', '61~90일', '90일 넘음'] as const
export const bucketOf = (age: number) => (age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3)

export type OpenItem = { inv: TaxInvoice; left: number; age: number; bucket: number; unchecked: boolean }

/** 아직 다 받지(내지) 못한 계산서 — 수정 발행 취소 · 완료 표시 · 음수(마이너스 수정) 제외 */
export function openInvoices(invoices: TaxInvoice[], direction: '매출' | '매입', today: string, company: CompanyKey | 'all' = 'all'): OpenItem[] {
  const out: OpenItem[] = []
  for (const inv of invoices) {
    if (inv.direction !== direction || inv.total <= 0 || inv.done) continue
    if (company !== 'all' && companyOfInvoice(inv) !== company) continue
    if ((inv.settle_how ?? '').includes('수정 발행')) continue
    const unchecked = inv.settled_at == null
    const left = inv.total - Math.min(inv.total, Math.max(0, inv.settled ?? 0))
    if (left <= 0) continue
    const age = Math.max(0, daysBetween(inv.write_date, today))
    out.push({ inv, left, age, bucket: bucketOf(age), unchecked })
  }
  return out.sort((a, b) => b.age - a.age)
}

export type AgingRow = { key: string; partner: string; biz: string | null; count: number; left: number; buckets: [number, number, number, number]; oldest: string; items: OpenItem[] }

/** 거래처(사업자번호)별 연령표 — 남은 돈 큰 순 */
export function agingTable(items: OpenItem[]): { rows: AgingRow[]; totals: [number, number, number, number]; total: number; count: number } {
  const m = new Map<string, AgingRow>()
  for (const it of items) {
    const biz = (it.inv.partner_biz_no ?? '').replace(/\D/g, '') || null
    const key = biz ?? `name:${it.inv.partner_name}`
    const row = m.get(key) ?? { key, partner: it.inv.partner_name, biz: it.inv.partner_biz_no, count: 0, left: 0, buckets: [0, 0, 0, 0] as [number, number, number, number], oldest: it.inv.write_date, items: [] }
    row.count++
    row.left += it.left
    row.buckets[it.bucket] += it.left
    if (it.inv.write_date < row.oldest) row.oldest = it.inv.write_date
    row.items.push(it)
    m.set(key, row)
  }
  const rows = [...m.values()].sort((a, b) => b.left - a.left)
  const totals: [number, number, number, number] = [0, 0, 0, 0]
  for (const r of rows) for (let i = 0; i < 4; i++) totals[i] += r.buckets[i]
  return { rows, totals, total: totals.reduce((n, v) => n + v, 0), count: items.length }
}

/** 독촉 문안 (사람이 복사해 보냄 · 인트라넷은 보내지 않음) — 금액 · 계산서 날짜만, 어조는 연령에 맞춤 */
export function reminderText(row: AgingRow, company: string): string {
  const oldestAge = Math.max(...row.items.map(i => i.age))
  const lines = row.items
    .slice()
    .sort((a, b) => a.inv.write_date.localeCompare(b.inv.write_date))
    .map(i => `- ${i.inv.write_date} 발행 · ${i.inv.item ?? '세금계산서'} · ${i.left.toLocaleString('ko-KR')}원`)
  const head = oldestAge > 60
    ? `${row.partner} 담당자님께,\n\n${company}입니다. 아래 세금계산서의 대금이 아직 확인되지 않아 연락드립니다. 지급 일정을 회신해 주시면 감사하겠습니다.`
    : `${row.partner} 담당자님께,\n\n${company}입니다. 발행해 드린 세금계산서 대금 확인 차 연락드립니다. 이미 보내 주셨다면 이 메일은 넘겨 주세요.`
  return `${head}\n\n${lines.join('\n')}\n합계 ${row.left.toLocaleString('ko-KR')}원\n\n감사합니다.`
}
