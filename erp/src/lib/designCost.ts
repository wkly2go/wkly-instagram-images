// 실행 내역 엑셀 읽기 — 실제 양식 두 가지
//  ① '나름대로_기자재_굿즈_리스트 - 실행가': 위치 | 기자재/물품 | 수량 | 단가 | 총금액 | (업체) | … | 비고
//  ② 회사 '실행집행 내역서'(2026-11-17 로제코 실물로 확인): No | 구분 | 견적 항목 | 견적 금액 | 실행 내역 | 단위 | 수량 | 실행 단가 | 실행 금액 | 원가 출처 | 발주처 | … | 근거·확인
//     → 품목은 '실행 내역', 구분은 아래 줄로 이어 씀, '견적 항목'은 비고 앞에 붙임, 발주처 '미정 · 내부 · —'는 업체 없음(발주서에서 빠짐)
// 머리 줄 이름이 조금 달라도 알아본다. 업체 칸에 이름이 없으면 '총금액' 바로 다음 칸을 업체로 본다.
import type { Cell, XlsxBook } from './xlsx'

export interface CostRow { zone: string | null; item: string; qty: number; cost_price: number | null; vendor_name: string | null; note: string | null; unit?: string | null }
export interface CostSheet { sheet: string; rows: CostRow[]; total: number; /** 엑셀에 적힌 총금액 합 (검산용 · 없으면 null) */ sheetTotal: number | null }

const text = (c: Cell | undefined) => (c == null ? '' : String(c).replace(/\s+/g, ' ').trim())
const has = (c: Cell | undefined, re: RegExp) => re.test(text(c))
const PRICE = /^(실행\s*)?단\s*가(\s*\(.*\))?$/
/** 발주할 업체가 아닌 값 — 발주서 초안에서 빠지도록 업체 없음으로 */
const NO_VENDOR = /^(미정|없음|자체|당사|내부.*|[-—–·]+)$/

export function parseCostSheet(book: XlsxBook): CostSheet | null {
  for (const sheet of book.sheets) {
    const head = sheet.rows.findIndex(r => r.some(c => has(c, PRICE)) && r.some(c => has(c, /^수\s*량/)))
    if (head < 0) continue
    const h = sheet.rows[head]
    const col = (re: RegExp) => h.findIndex(c => has(c, re))
    const first = (...res: RegExp[]) => res.map(col).find(i => i >= 0) ?? -1
    const qty = col(/^수\s*량/), unit = col(/^단\s*위$/)
    const price = first(/^실행\s*단\s*가/, PRICE)
    const amount = first(/^실행\s*금\s*액/, /총\s*금액|^금\s*액(\s*\(.*\))?$|합\s*계/)
    let item = first(/^실행\s*내\s*역/, /기자재|물품|품\s*목|품\s*명|내\s*용|항\s*목/)
    // ② 양식: 실행 줄이 속한 견적 항목 (첫 줄에만 적혀 있어 아래로 이어 씀)
    const group = item >= 0 && has(h[item], /^실행\s*내\s*역/) ? col(/견적\s*항\s*목/) : -1
    const zone = col(/위치|구역|공간|구분/), note = col(/비\s*고|메모|근거/)
    let vendor = col(/업체|거래처|구매처|렌탈처|발주처/)
    if (item < 0) item = zone >= 0 ? zone + 1 : 0
    if (vendor < 0 && amount >= 0 && amount + 1 !== note) vendor = amount + 1
    const rows: CostRow[] = []
    let lastZone: string | null = null, lastGroup = '', sheetTotal = 0, sawTotal = false
    for (const r of sheet.rows.slice(head + 1)) {
      if (zone >= 0 && text(r[zone])) lastZone = text(r[zone])
      if (group >= 0 && text(r[group])) lastGroup = text(r[group])
      const name = text(r[item]), q = r[qty]
      if (!name || typeof q !== 'number' || !(q >= 0)) continue
      const p = typeof r[price] === 'number' ? (r[price] as number) : null
      if (amount >= 0 && typeof r[amount] === 'number') { sheetTotal += r[amount] as number; sawTotal = true }
      const v = vendor >= 0 ? text(r[vendor]) : ''
      const memo = [group >= 0 && lastGroup ? `[${lastGroup}]` : '', note >= 0 ? text(r[note]) : ''].filter(Boolean).join(' ')
      rows.push({ zone: lastZone, item: name, qty: q, cost_price: p != null && p >= 0 ? Math.round(p) : null,
        vendor_name: v && !NO_VENDOR.test(v) ? v : null, note: memo.slice(0, 200) || null, ...(unit >= 0 && text(r[unit]) ? { unit: text(r[unit]).slice(0, 20) } : {}) })
    }
    if (rows.length) return { sheet: sheet.name, rows, total: rows.reduce((s, x) => s + x.qty * (x.cost_price ?? 0), 0), sheetTotal: sawTotal ? sheetTotal : null }
  }
  return null
}
