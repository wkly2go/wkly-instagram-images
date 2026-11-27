// 분개 초안 · 시산표 (세무대리인 검토용 · 회계 프로그램에 옮기기 전 초안)
//  - 세금계산서: 발행(작성)일에 외상매출금 · 외상매입금 (발생 기준)
//  - 통장 · 카드 줄: 계산서와 짝지어진 줄은 외상 정리, 나머지는 장부 분류 → 계정과목
//  - 카드 사용은 미지급금(카드), 카드대금 출금은 그 미지급금을 갚는 것 · 내 통장끼리 이체는 '자금 이동'으로 서로 지움
//  - 모든 분개는 차변 = 대변 (시험이 확인). 계정 이름만 쓰고 회계 프로그램 코드는 세무대리인이 맞춤
import type { LedgerEntry, TaxInvoice } from './types'
import type { CompanyKey } from './company.ts'
import { companyOfInvoice } from './company.ts'
import { classifyPurchase } from './acctVat.ts'
import { vatIn } from './acct.ts'

export type JournalLine = { account: string; debit: number; credit: number }
export type JournalEntry = { no: string; date: string; memo: string; who: string; evidence: string; source: string; lines: JournalLine[]; review: string | null }
export type AccountGroup = '자산' | '부채' | '수익' | '비용' | '대체'

const EXPENSE: Record<string, string> = {
  '외주 · 협력사': '외주비',
  인건비: '급여',
  임대료: '지급임차료',
  '재료 · 소품': '재료비',
  광고비: '광고선전비',
  '구독 · 소프트웨어': '지급수수료',
  '세금 · 공과금': '세금과공과',
  '식대 · 경비': '복리후생비',
  '교통 · 운반': '여비교통비',
  통신비: '통신비',
  수수료: '지급수수료',
  보험료: '보험료',
  '이자 · 금융비용': '이자비용',
}
const REVENUE: Record<string, string> = {
  '매출 · 용역': '용역매출',
  '매출 · 광고': '광고매출',
  '매출 · 대관': '임대료수입',
  지원금: '정부보조금 (확인)',
}
export const CARD_PAYABLE = '미지급금 (카드)'
export const TRANSFER = '자금 이동 (내 통장끼리)'

const GROUP_RULES: [RegExp, AccountGroup][] = [
  [/^(보통예금|현금|외상매출금|부가세대급금|가지급금|선납세금|기타 결제)/, '자산'],
  [/^(미지급금|외상매입금|부가세예수금|가수금|예수금|미지급세금)/, '부채'],
  [/^자금 이동/, '대체'],
  [/(매출|수입|수익|보조금|잡이익)/, '수익'],
]
export const groupOf = (account: string): AccountGroup => GROUP_RULES.find(([re]) => re.test(account))?.[1] ?? '비용'

/** 돈이 오간 쪽 계정 */
export function cashAccount(r: Pick<LedgerEntry, 'method' | 'account'>): string {
  if (r.method === '카드') return CARD_PAYABLE
  if (r.method === '현금') return '현금'
  if (r.method === '계좌') return `보통예금 (${r.account || '통장'})`
  return '기타 결제 수단'
}

/** 비용 계정 (분류 + 거래처 낱말) — 확인이 필요하면 이유를 함께 돌려줌 */
export function expenseAccount(r: Pick<LedgerEntry, 'category' | 'counterparty' | 'memo'>): { account: string; review: string | null } {
  const text = `${r.counterparty ?? ''} ${r.memo ?? ''}`
  if (r.category === '인건비' && /(건강보험|국민연금|고용보험|산재)/.test(text)) return { account: '4대보험 (예수금 · 회사 부담분 나눔 필요)', review: '4대보험 — 근로자 몫(예수금)과 회사 몫(복리후생비 · 보험료)을 나눠야 함' }
  if (r.category === '세금 · 공과금' && /원천|지방소득/.test(text)) return { account: '예수금 (원천세)', review: null }
  if (r.category === '세금 · 공과금' && /부가/.test(text)) return { account: '미지급세금 (부가세)', review: null }
  if (r.category === '세금 · 공과금' && /법인세/.test(text)) return { account: '선납세금 · 법인세비용 (확인)', review: '법인세 납부 — 중간예납(선납세금)인지 확정 납부인지 확인' }
  if (r.category === '교통 · 운반' && /(퀵|용달|화물|택배|운송|배송)/.test(text)) return { account: '운반비', review: null }
  if (r.category === '식대 · 경비' && /(골프|주점|선물|화환|꽃집|상품권)/.test(text)) return { account: '기업업무추진비', review: '접대 · 선물로 보임 — 기업업무추진비 한도 · 불공제' }
  const mapped = EXPENSE[r.category]
  if (mapped) return { account: mapped, review: null }
  return { account: '잡비 (분류 필요)', review: `분류 '${r.category}' — 계정과목을 정해 주세요` }
}

const add = (lines: JournalLine[], account: string, amount: number, side: 'D' | 'C') => {
  if (!amount) return
  // 음수는 반대쪽으로 (수정 세금계산서 · 취소)
  const s = amount < 0 ? (side === 'D' ? 'C' : 'D') : side
  const v = Math.abs(Math.round(amount))
  lines.push({ account, debit: s === 'D' ? v : 0, credit: s === 'C' ? v : 0 })
}

export function buildJournal(input: { from: string; to: string; ledger: LedgerEntry[]; invoices: TaxInvoice[]; company: CompanyKey | 'all' }): JournalEntry[] {
  const { from, to, company } = input
  const inv = input.invoices.filter(i => (company === 'all' || companyOfInvoice(i) === company) && i.total !== 0)
  const sold = new Set<number>()
  const bought = new Set<number>()
  for (const i of inv) for (const id of i.ledger_ids ?? []) (i.direction === '매출' ? sold : bought).add(id)
  const rowsById = new Map(input.ledger.map(r => [r.id, r]))
  const out: JournalEntry[] = []

  // ① 세금계산서 (작성일자 기준)
  for (const i of inv) {
    if (i.write_date < from || i.write_date > to) continue
    const lines: JournalLine[] = []
    if (i.direction === '매출') {
      add(lines, '외상매출금', i.total, 'D')
      add(lines, '용역매출', i.supply, 'C')
      add(lines, '부가세예수금', i.vat, 'C')
    } else {
      const firstRow = (i.ledger_ids ?? []).map(id => rowsById.get(id)).find(Boolean)
      const exp = firstRow ? expenseAccount(firstRow) : { account: '외주비 (계정 확인)', review: '짝지어진 지급 줄이 없어 계정을 외주비로 가정' }
      add(lines, exp.account, i.supply, 'D')
      add(lines, '부가세대급금', i.vat, 'D')
      add(lines, '외상매입금', i.total, 'C')
      out.push({ no: '', date: i.write_date, memo: `${i.item ?? '세금계산서'} (매입 계산서)`, who: i.partner_name, evidence: '세금계산서', source: `계산서 ${i.approval_no}`, lines, review: exp.review })
      continue
    }
    out.push({ no: '', date: i.write_date, memo: `${i.item ?? '세금계산서'} (매출 계산서)`, who: i.partner_name, evidence: '세금계산서', source: `계산서 ${i.approval_no}`, lines, review: i.vat === 0 ? '세액 0원 — 면세 · 영세율 여부 확인' : null })
  }

  // ② 통장 · 카드 줄
  for (const r of input.ledger) {
    if (r.entry_date < from || r.entry_date > to) continue
    const lines: JournalLine[] = []
    const cash = cashAccount(r)
    let review: string | null = r.needs_review ? "장부에서 '확인 필요'로 표시된 줄" : null
    const inn = r.direction === '입금'
    if (sold.has(r.id) && inn) {
      add(lines, cash, r.amount, 'D')
      add(lines, '외상매출금', r.amount, 'C')
    } else if (bought.has(r.id) && !inn) {
      add(lines, '외상매입금', r.amount, 'D')
      add(lines, cash, r.amount, 'C')
    } else if (r.category === '카드대금') {
      add(lines, inn ? cash : CARD_PAYABLE, r.amount, 'D')
      add(lines, inn ? CARD_PAYABLE : cash, r.amount, 'C')
    } else if (r.category === '내 통장 이체' || (r.is_transfer && r.category !== '대표 가지급 · 가수')) {
      add(lines, inn ? cash : TRANSFER, r.amount, 'D')
      add(lines, inn ? TRANSFER : cash, r.amount, 'C')
    } else if (r.category === '대표 가지급 · 가수') {
      add(lines, inn ? cash : '가지급금', r.amount, 'D')
      add(lines, inn ? '가수금' : cash, r.amount, 'C')
      review = review ?? (inn ? '대표 가수금 — 가지급금 회수인지 가수금인지 확인' : '대표 가지급금 — 인정이자 · 상여 처분 위험 (세무대리인 확인)')
    } else if (!inn || (r.method === '카드' && inn)) {
      // 지출 (카드 입금 = 승인 취소 · 환불 → 같은 계정을 반대로)
      const sign = inn ? -1 : 1
      const exp = inn && !EXPENSE[r.category] ? { account: '카드 취소 · 환불 (비용 차감 · 원래 계정 확인)', review: null } : expenseAccount(r)
      const vatOk = (r.method === '카드' || (r.evidence ?? '').includes('현금영수증')) && classifyPurchase(r).cls === '공제 후보'
      const vat = vatOk ? vatIn(r.amount) : 0
      add(lines, exp.account, sign * (r.amount - vat), 'D')
      add(lines, '부가세대급금', sign * vat, 'D')
      add(lines, cash, sign * r.amount, 'C')
      review = review ?? exp.review
    } else {
      // 입금 (계산서와 짝 없음)
      const rev = REVENUE[r.category]
      const account = rev ?? (r.category === '이자 · 환급' ? '이자수익 · 환급 (확인)' : '잡이익 (분류 필요)')
      add(lines, cash, r.amount, 'D')
      add(lines, account, r.amount, 'C')
      review = review ?? (r.category.startsWith('매출') ? '세금계산서와 짝이 없는 매출 입금 — 계산서 발행 · 부가세 포함 여부 확인' : rev ? null : `분류 '${r.category}' — 수익 계정 확인`)
    }
    out.push({ no: '', date: r.entry_date, memo: r.memo ?? r.category, who: r.counterparty ?? '', evidence: r.evidence ?? (r.method === '카드' ? '카드' : ''), source: `장부 ${r.id}`, lines, review })
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source))
  let day = ''
  let n = 0
  for (const e of out) {
    if (e.date !== day) {
      day = e.date
      n = 0
    }
    n++
    e.no = `${e.date.replaceAll('-', '')}-${String(n).padStart(3, '0')}`
  }
  return out
}

export type TbRow = { account: string; group: AccountGroup; debit: number; credit: number; balance: number }

/** 시산표 (기간 발생액 · 기초 잔액 미반영) */
export function trialBalance(entries: JournalEntry[]): { rows: TbRow[]; debit: number; credit: number; revenue: number; expense: number; transferLeft: number } {
  const m = new Map<string, TbRow>()
  let debit = 0
  let credit = 0
  for (const e of entries)
    for (const l of e.lines) {
      const row = m.get(l.account) ?? { account: l.account, group: groupOf(l.account), debit: 0, credit: 0, balance: 0 }
      row.debit += l.debit
      row.credit += l.credit
      row.balance = row.debit - row.credit
      m.set(l.account, row)
      debit += l.debit
      credit += l.credit
    }
  const order: AccountGroup[] = ['자산', '부채', '수익', '비용', '대체']
  const rows = [...m.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.account.localeCompare(b.account, 'ko'))
  const revenue = rows.filter(r => r.group === '수익').reduce((n, r) => n + (r.credit - r.debit), 0)
  const expense = rows.filter(r => r.group === '비용').reduce((n, r) => n + (r.debit - r.credit), 0)
  const transferLeft = rows.filter(r => r.group === '대체').reduce((n, r) => n + r.balance, 0)
  return { rows, debit, credit, revenue, expense, transferLeft }
}

/** 회계 프로그램에 옮기기 쉬운 줄 모양 (분개 한 줄 = 계정 한 줄) */
export function journalRows(entries: JournalEntry[]): Record<string, string | number>[] {
  return entries.flatMap(e =>
    e.lines.map(l => ({ 전표번호: e.no, 일자: e.date, 계정과목: l.account, 차변: l.debit || '', 대변: l.credit || '', 거래처: e.who, 적요: e.memo, 증빙: e.evidence, 근거: e.source, 확인: e.review ?? '' })),
  )
}
