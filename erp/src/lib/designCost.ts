// 실행 내역 엑셀 읽기 — 실제 양식('나름대로_기자재_굿즈_리스트 - 실행가'): 위치 | 기자재/물품 | 수량 | 단가 | 총금액 | (업체) | … | 비고
// 머리 줄 이름이 조금 달라도 알아본다. 업체 칸에 이름이 없으면 '총금액' 바로 다음 칸을 업체로 본다.
import type { Cell, XlsxBook } from './xlsx'

export interface CostRow { zone: string | null; item: string; qty: number; cost_price: number | null; vendor_name: string | null; note: string | null }
export interface CostSheet { sheet: string; rows: CostRow[]; total: number; /** 엑셀에 적힌 총금액 합 (검산용 · 없으면 null) */ sheetTotal: number | null }

const text = (c: Cell | undefined) => (c == null ? '' : String(c).replace(/\s+/g, ' ').trim())
const has = (c: Cell | undefined, re: RegExp) => re.test(text(c))

export function parseCostSheet(book: XlsxBook): CostSheet | null {
  for (const sheet of book.sheets) {
    const head = sheet.rows.findIndex(r => r.some(c => has(c, /^단\s*가$/)) && r.some(c => has(c, /^수\s*량/)))
    if (head < 0) continue
    const h = sheet.rows[head]
    const col = (re: RegExp) => h.findIndex(c => has(c, re))
    const qty = col(/^수\s*량/), price = col(/^단\s*가$/), amount = col(/총\s*금액|^금\s*액$|합\s*계/)
    let item = col(/기자재|물품|품\s*목|품\s*명|내\s*용|항\s*목/)
    const zone = col(/위치|구역|공간|구분/), note = col(/비\s*고|메모/)
    let vendor = col(/업체|거래처|구매처|렌탈처|발주처/)
    if (item < 0) item = zone >= 0 ? zone + 1 : 0
    if (vendor < 0 && amount >= 0 && amount + 1 !== note) vendor = amount + 1
    const rows: CostRow[] = []
    let lastZone: string | null = null, sheetTotal = 0, sawTotal = false
    for (const r of sheet.rows.slice(head + 1)) {
      if (zone >= 0 && text(r[zone])) lastZone = text(r[zone])
      const name = text(r[item]), q = r[qty]
      if (!name || typeof q !== 'number' || !(q >= 0)) continue
      const p = typeof r[price] === 'number' ? (r[price] as number) : null
      if (amount >= 0 && typeof r[amount] === 'number') { sheetTotal += r[amount] as number; sawTotal = true }
      rows.push({ zone: lastZone, item: name, qty: q, cost_price: p != null && p >= 0 ? Math.round(p) : null,
        vendor_name: vendor >= 0 ? text(r[vendor]) || null : null, note: note >= 0 ? text(r[note]).slice(0, 200) || null : null })
    }
    if (rows.length) return { sheet: sheet.name, rows, total: rows.reduce((s, x) => s + x.qty * (x.cost_price ?? 0), 0), sheetTotal: sawTotal ? sheetTotal : null }
  }
  return null
}
