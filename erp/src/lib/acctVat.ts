// 부가세 신고 준비 (세무대리인 검토용 · 세무 자문 아님)
//  - 매출 · 매입 세금계산서(홈택스 목록) + 카드 · 현금영수증 매입(장부) 으로 과세기간 숫자를 모음
//  - 카드 매입은 가맹점 · 분류 낱말로 공제 후보 · 불공제 후보 · 부가세 없음 · 확인 필요로 나눔 (최종 판단은 세무대리인)
//  - 예상 납부세액은 확정값이 아니라 범위 — 가정은 표로 드러냄
import type { CompanyKey } from './company.ts'
import { companyOfInvoice } from './company.ts'
import type { LedgerEntry, TaxInvoice, TaxInvoiceSummary } from './types'
import { daysBetween, sumOf, vatIn } from './acct.ts'

export type VatFiling = '예정신고' | '예정고지'
export type VatPeriod = {
  key: string // 'vat:2026-Q4' — 세무 일정 task_key 와 같음
  year: number
  q: 1 | 2 | 3 | 4
  label: string // '2026년 2기 확정 (10~12월)'
  from: string
  to: string
  /** 예정고지 법인의 예정 분기는 신고하지 않음 (고지서 납부) */
  filing: '예정 신고' | '확정 신고' | '예정고지 납부'
}

const qMonths = (q: number) => [3 * q - 2, 3 * q]
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** 과세기간: 예정신고 법인은 분기마다, 예정고지 법인의 확정은 반기 전체 */
export function vatPeriod(year: number, q: 1 | 2 | 3 | 4, filing: VatFiling): VatPeriod {
  const half = q <= 2 ? 1 : 2
  const final = q === 2 || q === 4
  const [m1, m2] = final && filing === '예정고지' ? [q === 2 ? 1 : 7, q * 3] : qMonths(q)
  const filingKind = final ? '확정 신고' : filing === '예정고지' ? '예정고지 납부' : '예정 신고'
  return {
    key: `vat:${year}-Q${q}`,
    year,
    q,
    label: `${year}년 ${half}기 ${final ? '확정' : '예정'} (${m1}~${m2}월)`,
    from: `${year}-${pad(m1)}-01`,
    to: `${year}-${pad(m2)}-${pad(lastDay(year, m2))}`,
    filing: filingKind,
  }
}

/** 오늘이 들어 있는 과세기간 */
export function currentVatPeriod(today: string, filing: VatFiling): VatPeriod {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return vatPeriod(y, Math.ceil(m / 3) as 1 | 2 | 3 | 4, filing)
}

/** 고르기 목록: 오늘 기간부터 거꾸로 n개 */
export function recentVatPeriods(today: string, filing: VatFiling, n = 6): VatPeriod[] {
  const out: VatPeriod[] = []
  let y = Number(today.slice(0, 4))
  let q = Math.ceil(Number(today.slice(5, 7)) / 3)
  for (let i = 0; i < n; i++) {
    out.push(vatPeriod(y, q as 1 | 2 | 3 | 4, filing))
    q -= 1
    if (q === 0) {
      q = 4
      y -= 1
    }
  }
  return out
}

// ---------- 카드 · 현금영수증 매입 분류 ----------
export type PurchaseClass = '공제 후보' | '불공제 후보' | '부가세 없음' | '확인 필요'
export const PURCHASE_CLASSES: PurchaseClass[] = ['공제 후보', '불공제 후보', '부가세 없음', '확인 필요']

/** 해외 서비스 (국내 부가세 없이 결제 — 매입세액 공제할 세액 없음) */
const FOREIGN_RE = /(google|anthropic|claude\.ai|openai|chatgpt|figma|adobe|autodesk|shutterstock|microsoft|facebk|meta platforms|apple\.com|itunes|amazon|aws|notion|slack|zoom\.us|dropbox|canva|github|vercel|cloudflare|supabase|midjourney|runway|envato|freepik|sketchup|trimble|spotify|netflix|linkedin|upwork|fiverr|paypal|stripe|squarespace|godaddy|atlassian|miro|capcut|pinterest|docusign|grammarly|elevenlabs|perplexity|cursor)/i
const ENTERTAIN_RE = /(골프|컨트리클럽|주점|호프|포차|와인|위스키|노래|단란|유흥|룸살롱|선물|꽃집|플라워|화환|상품권|기프티|gift)/i
const VEHICLE_RE = /(주유|오일뱅크|에너지|칼텍스|s-?oil|알뜰주유|충전소|lpg|주차|파킹|parking|하이패스|도로공사|톨게이트|통행료|세차|카센터|정비소|타이어|자동차|렌터카|렌트카|쏘카|그린카)/i
const PASSENGER_RE = /(택시|카카오\s?t|우티|티머니|고속버스|시외버스|버스|지하철|코레일|ktx|srt|철도|항공권|대한항공|아시아나|제주항공|진에어|티웨이|에어부산|에어서울)/i
const FREIGHT_RE = /(퀵|용달|화물|택배|운송|물류|이사|배송)/i
const EXEMPT_RE = /(병원|의원|약국|치과|한의원|보험|우체국\s?보험|은행|이자|국세|지방세|세무서|구청|시청|주민센터|우편)/i
const NO_VAT_CATS = ['보험료', '이자 · 금융비용', '세금 · 공과금', '인건비']

/** 한 줄 분류 — 가맹점 · 메모 · 장부 분류 낱말 기준 (참고용) */
export function classifyPurchase(row: Pick<LedgerEntry, 'counterparty' | 'memo' | 'category'>): { cls: PurchaseClass; reason: string } {
  const text = `${row.counterparty ?? ''} ${row.memo ?? ''}`
  if (NO_VAT_CATS.includes(row.category)) return { cls: '부가세 없음', reason: `${row.category} — 면세 · 세금 (공제할 부가세 없음)` }
  if (FOREIGN_RE.test(text)) return { cls: '부가세 없음', reason: '해외 서비스 결제 — 국내 부가세 없음 (세금계산서를 받았으면 그쪽으로)' }
  if (ENTERTAIN_RE.test(text)) return { cls: '불공제 후보', reason: '기업업무추진비(접대 · 선물) 의심 — 불공제' }
  if (VEHICLE_RE.test(text)) return { cls: '불공제 후보', reason: '차량 관련 — 비영업용 소형승용차면 불공제 (경차 · 9인승 이상 · 화물차는 공제)' }
  if (PASSENGER_RE.test(text)) return { cls: '불공제 후보', reason: '여객운송(택시 · 버스 · 철도 · 항공) — 카드 매입세액 공제 안 됨' }
  if (EXEMPT_RE.test(text)) return { cls: '부가세 없음', reason: '면세 업종 (의료 · 보험 · 금융 · 관공서) 의심' }
  if (row.category === '교통 · 운반') return FREIGHT_RE.test(text) ? { cls: '공제 후보', reason: '화물 · 운반 용역' } : { cls: '확인 필요', reason: '교통 · 운반 — 여객(불공제)인지 화물(공제)인지 확인' }
  if (row.category === '식대 · 경비') return { cls: '공제 후보', reason: '직원 복리후생 식대로 가정 — 거래처 접대분이면 불공제' }
  if (row.category === '기타 출금' || row.category === '기타 입금') return { cls: '확인 필요', reason: '분류 미정 — 장부에서 분류를 정하면 다시 계산' }
  return { cls: '공제 후보', reason: '일반 과세 사업자 매입으로 가정 (간이과세자 · 면세 사업자면 공제 안 됨)' }
}

export type PurchaseLine = {
  id: number
  date: string
  who: string
  account: string
  category: string
  evidence: string
  /** 부가세 포함 금액 (취소 · 환불은 음수) */
  gross: number
  /** 추정 세액 (부가세 없음이면 0) */
  vat: number
  cls: PurchaseClass
  reason: string
}

/** 장부에서 카드 · 현금영수증 매입을 모아 분류 (세금계산서와 짝지어진 줄 · 이체는 뺌) */
export function purchaseLines(ledger: LedgerEntry[], from: string, to: string, linkedIds: Set<number>): PurchaseLine[] {
  const out: PurchaseLine[] = []
  for (const r of ledger) {
    if (r.entry_date < from || r.entry_date > to || r.is_transfer || linkedIds.has(r.id)) continue
    const card = r.method === '카드'
    const receipt = (r.evidence ?? '').includes('현금영수증')
    if (!card && !receipt) continue
    if ((r.evidence ?? '').includes('세금계산서')) continue
    // 카드로 들어온 입금 = 승인 취소 · 환불 → 매입에서 뺌
    const sign = r.direction === '출금' ? 1 : -1
    if (sign < 0 && !card) continue
    const { cls, reason } = classifyPurchase(r)
    const gross = sign * r.amount
    out.push({ id: r.id, date: r.entry_date, who: r.counterparty ?? '', account: r.account ?? r.method, category: r.category, evidence: card ? '카드' : '현금영수증', gross, vat: cls === '부가세 없음' ? 0 : vatIn(gross), cls, reason: sign < 0 ? `승인 취소 · 환불 — ${reason}` : reason })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
}

// ---------- 세금계산서 ----------
const TI_NONDEDUCT_RE = /(승용|리스|렌트|주유|골프|접대|선물|상품권|화환)/i

export type InvoiceSide = {
  count: number
  supply: number
  vat: number
  total: number
  /** 수정 발행 (음수 포함) 매수 */
  amended: number
  /** 세액 0 (면세 계산서 · 영세율 의심) */
  zeroVat: TaxInvoice[]
  /** 매입 중 불공제 후보 (품목 · 거래처 낱말) */
  nondeduct: { inv: TaxInvoice; reason: string }[]
  list: TaxInvoice[]
}

function side(list: TaxInvoice[], buy: boolean): InvoiceSide {
  const nondeduct = buy
    ? list.filter(i => i.vat > 0 && TI_NONDEDUCT_RE.test(`${i.item ?? ''} ${i.partner_name}`)).map(inv => ({ inv, reason: '품목 · 거래처에 승용차 · 접대 관련 낱말 — 불공제 여부 확인' }))
    : []
  return {
    count: list.length,
    supply: sumOf(list, i => i.supply),
    vat: sumOf(list, i => i.vat),
    total: sumOf(list, i => i.total),
    amended: list.filter(i => (i.invoice_kind ?? '').includes('수정') || i.total < 0).length,
    zeroVat: list.filter(i => i.vat === 0 && i.supply !== 0),
    nondeduct,
    list: [...list].sort((a, b) => a.write_date.localeCompare(b.write_date)),
  }
}

/** 계산서가 없는 매출 입금 (공급 시기 · 계산서 발행 확인 필요 — 신고 누락 위험) */
export type UninvoicedSale = { id: number; date: string; who: string; amount: number; vat: number; category: string }

export type VatPrep = {
  company: CompanyKey | 'all'
  period: VatPeriod
  sales: InvoiceSide
  buys: InvoiceSide
  purchases: PurchaseLine[]
  byClass: Record<PurchaseClass, { count: number; gross: number; vat: number }>
  uninvoiced: UninvoicedSale[]
  /** 매출세액 */
  outputTax: number
  /** 세금계산서 매입세액 (불공제 후보 뺀 것) */
  inputTax: number
  inputTaxNondeduct: number
  /** 기대 값 · 범위 (낮음 = 후보가 모두 공제될 때 · 높음 = 카드 공제를 하나도 못 받을 때) */
  expected: number
  low: number
  high: number
  /** 기간이 끝나지 않았거나 장부에 확인 필요 줄이 남음 */
  open: boolean
  reviewRows: number
  questions: string[]
  assumptions: { item: string; assumption: string; effect: string }[]
}

export function vatPrep(input: {
  company: CompanyKey | 'all'
  period: VatPeriod
  invoices: TaxInvoice[]
  ledger: LedgerEntry[]
  today: string
  filing: VatFiling
}): VatPrep {
  const { company, period, invoices, ledger, today } = input
  const mine = invoices.filter(i => (company === 'all' || companyOfInvoice(i) === company) && i.write_date >= period.from && i.write_date <= period.to)
  const sales = side(mine.filter(i => i.direction === '매출'), false)
  const buys = side(mine.filter(i => i.direction === '매입'), true)
  // 세금계산서와 짝지어진 장부 줄은 카드 매입에서 뺌 (같은 매입을 두 번 공제하지 않게)
  const linked = new Set<number>()
  for (const i of invoices) for (const id of i.ledger_ids ?? []) linked.add(id)
  const purchases = purchaseLines(ledger, period.from, period.to, linked)
  const byClass = Object.fromEntries(PURCHASE_CLASSES.map(c => [c, { count: 0, gross: 0, vat: 0 }])) as VatPrep['byClass']
  for (const p of purchases) {
    byClass[p.cls].count++
    byClass[p.cls].gross += p.gross
    byClass[p.cls].vat += p.vat
  }
  const uninvoiced: UninvoicedSale[] = ledger
    .filter(r => r.direction === '입금' && !r.is_transfer && r.category.startsWith('매출') && r.entry_date >= period.from && r.entry_date <= period.to && !linked.has(r.id) && !(r.evidence ?? '').includes('세금계산서'))
    .map(r => ({ id: r.id, date: r.entry_date, who: r.counterparty ?? '', amount: r.amount, vat: vatIn(r.amount), category: r.category }))
  const outputTax = sales.vat
  const inputTaxNondeduct = sumOf(buys.nondeduct, x => x.inv.vat)
  const inputTax = buys.vat - inputTaxNondeduct
  const cardOk = Math.max(0, byClass['공제 후보'].vat)
  const cardQ = Math.max(0, byClass['확인 필요'].vat)
  const expected = outputTax - inputTax - cardOk
  const low = outputTax - buys.vat - cardOk - cardQ
  const high = outputTax - inputTax
  const reviewRows = ledger.filter(r => r.needs_review && r.entry_date >= period.from && r.entry_date <= period.to).length
  const open = today <= period.to || reviewRows > 0

  const questions: string[] = []
  if (today <= period.to) questions.push(`과세기간이 아직 끝나지 않았습니다 (${period.to} 까지) — 남은 기간 자료가 들어오면 숫자가 바뀝니다.`)
  if (reviewRows) questions.push(`장부에 '확인 필요' 줄이 ${reviewRows}건 남아 있습니다 — 분류를 정한 뒤 다시 보세요.`)
  const vehicle = purchases.filter(p => p.reason.startsWith('차량'))
  if (vehicle.length) questions.push(`업무용 차량의 차종 확인 — 주유 · 주차 · 통행료 등 ${vehicle.length}건 (비영업용 소형승용차면 불공제, 경차 · 9인승 이상 · 화물차면 공제)`)
  const ent = purchases.filter(p => p.reason.startsWith('기업업무추진비'))
  if (ent.length) questions.push(`접대 · 선물로 보이는 카드 사용 ${ent.length}건 — 기업업무추진비면 불공제`)
  if (byClass['공제 후보'].count) questions.push(`식대 · 경비 중 거래처 접대분이 있는지 (있으면 불공제로 옮김)`)
  const foreign = purchases.filter(p => p.reason.startsWith('해외'))
  if (foreign.length) questions.push(`해외 서비스 결제 ${foreign.length}건 — 국내 부가세가 없으므로 공제 대상 아님 (국내 법인이 세금계산서를 발행했다면 계산서 쪽으로)`)
  if (byClass['확인 필요'].count) questions.push(`분류를 정하지 못한 카드 · 현금영수증 매입 ${byClass['확인 필요'].count}건 — 공제 여부 확인`)
  if (buys.nondeduct.length) questions.push(`매입 세금계산서 중 불공제 후보 ${buys.nondeduct.length}건 (승용차 · 접대 관련 낱말)`)
  if (sales.amended + buys.amended) questions.push(`수정 세금계산서 ${sales.amended + buys.amended}건 — 당초 공급 시기 · 귀속 과세기간 확인`)
  if (sales.zeroVat.length + buys.zeroVat.length) questions.push(`세액 0원 계산서 ${sales.zeroVat.length + buys.zeroVat.length}건 — 면세 계산서 · 영세율 여부 확인`)
  if (uninvoiced.length) questions.push(`세금계산서와 짝이 없는 매출 입금 ${uninvoiced.length}건 — 계산서 발행 여부 · 공급 시기 확인 (발행 안 했으면 매출 누락)`)
  if (period.filing === '확정 신고' && input.filing === '예정고지') questions.push('예정고지로 이미 낸 세액 — 확정 신고에서 빼야 함 (고지서 금액 확인)')
  questions.push('카드 가맹점 중 간이과세자(세금계산서 발급 안 하는 사업자) 확인 — 공제 안 됨')

  const assumptions = [
    { item: '카드 · 현금영수증 매입세액', assumption: '부가세 포함 금액 × 10/110 으로 추정', effect: '가맹점이 간이과세자 · 면세면 실제 공제액이 줄어듦' },
    { item: '식대 · 경비', assumption: '직원 복리후생으로 보고 공제 후보에 넣음', effect: '거래처 접대분이면 불공제' },
    { item: '해외 서비스 결제', assumption: '국내 부가세 없음 → 공제할 세액 0', effect: '국내 법인 세금계산서를 받은 경우는 계산서 쪽으로 공제' },
    { item: '세금계산서', assumption: '홈택스 목록 엑셀로 올린 계산서만 반영 (작성일자 기준)', effect: '올리지 않은 계산서는 빠짐 — 홈택스 합계표와 대조' },
    { item: '세금계산서와 짝지어진 카드 · 통장 줄', assumption: '카드 공제에서 뺌 (계산서로 공제)', effect: '짝이 잘못 지어졌으면 공제가 빠지거나 겹칠 수 있음' },
    { item: '예상 납부세액', assumption: '가산세 · 전자신고세액공제 · 예정고지세액 · 신용카드 발행공제 등 미반영', effect: '최종 세액은 세무대리인 신고서 기준' },
  ]
  return { company, period, sales, buys, purchases, byClass, uninvoiced, outputTax, inputTax, inputTaxNondeduct, expected, low, high, open, reviewRows, questions, assumptions }
}

// ---------- 홈택스 합계표 대조 ----------
export type SummaryCheck = {
  direction: '매출' | '매입'
  from: string
  to: string
  hometaxCount: number
  hometaxTotal: number
  mineCount: number
  mineTotal: number
  diffs: { biz: string; name: string; hc: number; ht: number; ic: number; it: number }[]
}

/** 과세기간과 겹치는 반기 합계표를 인트라넷 계산서와 맞춰 봄 (거래처 사업자번호 기준) */
export function summaryChecks(invoices: TaxInvoice[], sums: TaxInvoiceSummary[], company: CompanyKey | 'all', period: VatPeriod): SummaryCheck[] {
  const out: SummaryCheck[] = []
  const mineAll = invoices.filter(i => company === 'all' || companyOfInvoice(i) === company)
  const groups = new Map<string, TaxInvoiceSummary[]>()
  for (const s of sums) {
    if (company !== 'all' && s.company && s.company !== company) continue
    if (s.period_to < period.from || s.period_from > period.to) continue
    const k = `${s.direction}|${s.period_from}|${s.period_to}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const [k, hs] of groups) {
    const [direction, from, to] = k.split('|') as ['매출' | '매입', string, string]
    const inside = mineAll.filter(i => i.direction === direction && i.write_date >= from && i.write_date <= to)
    const bizs = new Set([...hs.map(h => h.partner_biz_no), ...inside.map(i => i.partner_biz_no ?? '')].filter(Boolean))
    const diffs: SummaryCheck['diffs'] = []
    for (const biz of bizs) {
      const h = hs.find(x => x.partner_biz_no === biz)
      const mine = inside.filter(i => i.partner_biz_no === biz)
      const it = sumOf(mine, i => i.total)
      if (h && h.total === it && h.count === mine.length) continue
      diffs.push({ biz, name: h?.partner_name || mine[0]?.partner_name || '(이름 없음)', hc: h?.count ?? 0, ht: h?.total ?? 0, ic: mine.length, it })
    }
    diffs.sort((a, b) => Math.abs(b.ht - b.it) - Math.abs(a.ht - a.it))
    out.push({ direction, from, to, hometaxCount: sumOf(hs, h => h.count), hometaxTotal: sumOf(hs, h => h.total), mineCount: inside.length, mineTotal: sumOf(inside, i => i.total), diffs })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.direction.localeCompare(b.direction))
}

/** 기한까지 남은 날 표시용 */
export const daysToDue = (due: string | null, today: string) => (due ? daysBetween(today, due) : null)
