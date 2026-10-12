// 결제 대장(엑셀) 가져오기: 시트 → 결제·예산 미리보기 (순수 함수, 저장은 호출하는 쪽에서)
// 형식: register(결제 대장) · installments(예산 + 1~4차 지급) · labor(노무비 대장)
import type { BudgetLine, ContractType, Draft, Payment, PaymentStatus, TaxInvoiceState } from './types'
import { CONTRACT_TYPES, OPEN_PAYMENT_STATUSES } from './types'
import { nextMonday } from './date'
import { colLetter, excelSerialToDate } from './xlsx'
import type { Cell, XlsxSheet } from './xlsx'

export type SheetFormat = 'register' | 'installments' | 'labor' | 'unknown'

export interface ImportIssue {
  level: 'info' | 'warn'
  /** 엑셀 행 번호 (1부터) */
  row?: number
  message: string
}

export interface ImportRow {
  /** 엑셀 행 번호 (1부터). 분할 지급은 같은 행에서 여러 줄이 나온다 */
  row: number
  payment: Draft<Payment>
  /** 이미 등록된 결제 id (업체·금액이 같고 날짜가 7일 이내) */
  duplicateOf?: string
  /** 기본으로 빼 두기를 권하는 줄 (예상 금액 · 중복) */
  suggestExclude?: boolean
}

export interface ImportPreview {
  sheet: string
  format: SheetFormat
  /** 시트 제목 (예: '성수 현장 결제 대장') */
  title: string | null
  /** 시트 순서 */
  rows: ImportRow[]
  /** installments 형식만 */
  budgetLines: Draft<BudgetLine>[]
  /** 표 아래 계약금액·수금·잔금 요약이 있을 때 */
  contract: { contract_amount: number | null; received: number | null } | null
  issues: ImportIssue[]
  skipped: { row: number; reason: string }[]
  /** count·amount·done·open 은 suggestExclude 가 아닌 줄, estimate 는 예상 금액 줄 전체 */
  totals: { count: number; amount: number; done: number; open: number; estimate: number }
}

type PaymentFields = Omit<Payment, 'id' | 'created_by' | 'created_at' | 'updated_at'>
type ExistingPayment = Pick<Payment, 'id' | 'payee' | 'amount' | 'requested_date' | 'due_date' | 'paid_date'>

// ---------------------------------------------------------------------------
// 형식 판별

/** headerRow: 머리글이 있는 엑셀 행 번호 (1부터) */
export function detectFormat(sheet: XlsxSheet): { format: SheetFormat; headerRow: number | null } {
  const limit = Math.min(sheet.rows.length, 40)
  for (let i = 0; i < limit; i++) {
    const hs = (sheet.rows[i] ?? []).map(normHeader).filter(Boolean)
    if (!hs.length) continue
    const has = (re: RegExp) => hs.some(h => re.test(h))
    if (has(/^예산/) && (has(/^1차(지급)?/) || hs.some(h => h.includes('실행') && h.includes('계약금')))) return { format: 'installments', headerRow: i + 1 }
    if (has(/^결제금액/) && has(/^(업체명|항목|공사구분|예금주|지급완료|은행)/)) return { format: 'register', headerRow: i + 1 }
    if (has(/^지급금액/) && has(/^성명/)) return { format: 'labor', headerRow: i + 1 }
  }
  return { format: 'unknown', headerRow: null }
}

// ---------------------------------------------------------------------------
// 시트 읽기

export function parseSheet(
  sheet: XlsxSheet,
  opts: { projectId: string | null; existing?: Pick<Payment, 'id' | 'payee' | 'amount' | 'requested_date' | 'due_date' | 'paid_date'>[] },
): ImportPreview {
  const { format, headerRow } = detectFormat(sheet)
  const title = findTitle(sheet.rows, headerRow)
  if (format === 'unknown' || headerRow === null) {
    return {
      sheet: sheet.name,
      format: 'unknown',
      title,
      rows: [],
      budgetLines: [],
      contract: null,
      issues: [{ level: 'warn', message: '결제 대장 형식이 아닙니다' }],
      skipped: [],
      totals: { count: 0, amount: 0, done: 0, open: 0, estimate: 0 },
    }
  }

  const rows = sheet.rows
  const header = headerRow - 1
  const cols = buildColumns(rows[header] ?? [])
  const { end, totalRow } = findTableEnd(rows, header, cols)
  const t: Table = { rows, cols, start: header + 1, end, projectId: opts.projectId }
  const out: Collector = {
    items: [],
    budgetLines: [],
    issues: [],
    skipped: [],
    estimates: [],
    notes: { contractType: [], tax: [], status: [], numericMemo: 0, overpaid: [] },
  }

  if (format === 'register') parseRegister(t, out)
  else if (format === 'installments') parseInstallments(t, out)
  else parseLabor(t, out)

  scanTable(t, header, totalRow ?? end - 1, out)
  summarize(out, format)

  const dup = markDuplicates(out.items, opts.existing ?? [])
  if (dup) out.issues.push({ level: 'warn', message: `이미 등록된 결제와 겹치는 ${dup}건(업체·금액이 같고 날짜가 7일 이내)은 기본으로 제외합니다.` })

  const totals = { count: 0, amount: 0, done: 0, open: 0, estimate: 0 }
  for (const it of out.items) {
    const p = it.p
    if (p.is_estimate) totals.estimate += p.amount
    if (it.suggestExclude) continue
    totals.count++
    totals.amount += p.amount
    if (p.status === '완료') totals.done += p.amount
    else if (OPEN_PAYMENT_STATUSES.includes(p.status)) totals.open += p.amount
  }

  return {
    sheet: sheet.name,
    format,
    title,
    rows: out.items.map(it => ({ row: it.row, payment: { ...it.p }, ...(it.duplicateOf ? { duplicateOf: it.duplicateOf } : {}), suggestExclude: it.suggestExclude })),
    budgetLines: out.budgetLines,
    contract: findContract(rows, totalRow !== null ? totalRow + 1 : end),
    issues: [...out.issues.filter(x => x.level === 'warn'), ...out.issues.filter(x => x.level === 'info')],
    skipped: out.skipped.sort((a, b) => a.row - b.row),
    totals,
  }
}

// ---------------------------------------------------------------------------
// 머리글 → 열

type Key =
  | 'no'
  | 'requested'
  | 'category'
  | 'title'
  | 'payee'
  | 'contractType'
  | 'bank'
  | 'account'
  | 'holder'
  | 'amount'
  | 'status'
  | 'due'
  | 'memo'
  | 'budget'
  | 'contract'
  | 'balance'

interface Columns {
  /** 처음 나온 열 */
  one: Partial<Record<Key, number>>
  /** 세금계산서 열 (두 개일 수 있음) */
  tax: number[]
  /** 지급일·입금일 열 */
  paid: { col: number; deposit: boolean }[]
  /** n차 지급 열 (바로 오른쪽 칸이 지급일) */
  inst: { k: number; col: number }[]
  first: number
  last: number
}

/** 공백·줄바꿈 제거, [..] 꼬리표 제거, 소문자 */
function normHeader(v: Cell): string {
  return typeof v === 'string' ? v.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '').toLowerCase() : ''
}

type Hit = { key: Key } | { key: 'tax' } | { key: 'paid'; deposit: boolean } | { key: 'inst'; k: number }

function headerKey(h: string): Hit | null {
  if (!h) return null
  if (/^(no\.?|번호|순번|연번)$/.test(h)) return { key: 'no' }
  const inst = /^([1-9])차(지급|지급액|지급금|금액)?$/.exec(h)
  if (inst) return { key: 'inst', k: Number(inst[1]) }
  if (/^(결제요청일|요청일|청구일)/.test(h)) return { key: 'requested' }
  if (/^(지급예정일|예정일|지급예정)/.test(h)) return { key: 'due' }
  if (/^(입금일|입금일자)/.test(h)) return { key: 'paid', deposit: true }
  if (/^(지급일|지급일자|지급완료일|송금일)/.test(h)) return { key: 'paid', deposit: false }
  if (/^(지급완료|지급여부|완료여부)/.test(h)) return { key: 'status' }
  if (/^(공사구분|구분|공종|분류)$/.test(h) || h.startsWith('공사구분')) return { key: 'category' }
  if (h.startsWith('항목') || /^(세부내용|내용|품명|내역)$/.test(h)) return { key: 'title' }
  if (h.startsWith('업체명') || /^(업체|거래처|지급처|성명|이름)$/.test(h)) return { key: 'payee' }
  if (/^(계약형태|고용형태|증빙)/.test(h)) return { key: 'contractType' }
  if (h.startsWith('은행')) return { key: 'bank' }
  if (h.startsWith('계좌')) return { key: 'account' }
  if (h.startsWith('예금주')) return { key: 'holder' }
  if (/^(결제금액|지급금액|금액)/.test(h)) return { key: 'amount' }
  if (/^(세금계산서|계산서)/.test(h)) return { key: 'tax' }
  if (/^(비고|메모)/.test(h)) return { key: 'memo' }
  if (h.startsWith('예산')) return { key: 'budget' }
  if (h.includes('계약금') || h.startsWith('실행')) return { key: 'contract' }
  if (/^(잔금|잔액)$/.test(h)) return { key: 'balance' }
  return null
}

function buildColumns(header: Cell[]): Columns {
  const cols: Columns = { one: {}, tax: [], paid: [], inst: [], first: -1, last: -1 }
  header.forEach((v, c) => {
    const h = normHeader(v)
    if (!h) return
    if (cols.first < 0) cols.first = c
    cols.last = c
    const hit = headerKey(h)
    if (!hit) return
    if (hit.key === 'tax') cols.tax.push(c)
    else if (hit.key === 'paid') cols.paid.push({ col: c, deposit: hit.deposit })
    else if (hit.key === 'inst') {
      if (!cols.inst.some(x => x.k === hit.k)) cols.inst.push({ k: hit.k, col: c })
    } else if (cols.one[hit.key] === undefined) cols.one[hit.key] = c
  })
  cols.inst.sort((a, b) => a.k - b.k)
  if (cols.first < 0) cols.first = 0
  return cols
}

function findTitle(rows: Cell[][], headerRow: number | null): string | null {
  const limit = headerRow ? headerRow - 1 : Math.min(rows.length, 10)
  for (let i = 0; i < limit; i++) {
    for (const v of rows[i] ?? []) if (typeof v === 'string' && v.replace(/\s/g, '').includes('대장')) return v.trim()
  }
  return null
}

/** 첫 번째 '합계' 줄(A~C열의 첫 값, 머리글이 B열보다 오른쪽에서 시작하면 그만큼 더) 또는 계약 요약 머리글에서 표가 끝난다 */
function findTableEnd(rows: Cell[][], header: number, cols: Columns): { end: number; totalRow: number | null } {
  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const first = firstValue(row, Math.max(2, cols.first + 2))
    const k = typeof first === 'string' ? first.replace(/\s/g, '') : ''
    if (k === '합계' || k === '총합계' || k === '총계') return { end: i, totalRow: i }
    if (contractHeaderAt(row)) return { end: i, totalRow: null }
  }
  return { end: rows.length, totalRow: null }
}

function firstValue(row: Cell[], lastCol: number): Cell {
  for (let c = 0; c <= lastCol && c < row.length; c++) if (!isBlank(row[c])) return row[c]
  return null
}

// ---------------------------------------------------------------------------
// 공통 상태

interface Item {
  row: number
  p: PaymentFields
  suggestExclude: boolean
  duplicateOf?: string
  /** 대지급 정산 줄 후보 */
  settlement: boolean
  /** 대지급 정산에 묶임 */
  claimed: boolean
  /** 공사 구분·항목을 위 줄에서 이어받음 */
  carried: boolean
  /** 날짜를 위 줄에서 이어받음 */
  dateCarried: boolean
}

interface Table {
  rows: Cell[][]
  cols: Columns
  start: number
  end: number
  projectId: string | null
}

interface Collector {
  items: Item[]
  budgetLines: Draft<BudgetLine>[]
  issues: ImportIssue[]
  skipped: { row: number; reason: string }[]
  estimates: Item[]
  notes: { contractType: string[]; tax: string[]; status: string[]; numericMemo: number; overpaid: string[] }
}

const at = (row: Cell[], c: number | undefined): Cell => (c === undefined ? null : row[c] ?? null)

function basePayment(projectId: string | null): PaymentFields {
  return {
    direction: '지급',
    project_id: projectId,
    client_id: null,
    budget_line_id: null,
    approval_id: null,
    category: null,
    title: '결제',
    payee: null,
    contract_type: null,
    stage: null,
    amount: 0,
    vat: 0,
    tax_invoice: '미발행',
    tax_invoice_date: null,
    status: '예정',
    is_estimate: false,
    requested_date: null,
    due_date: null,
    paid_date: null,
    advance_by: null,
    bank_name: null,
    account_no: null,
    account_holder: null,
    memo: null,
  }
}

function newItem(row: number, p: PaymentFields, extra: Partial<Item> = {}): Item {
  return { row, p, suggestExclude: false, settlement: false, claimed: false, carried: false, dateCarried: false, ...extra }
}

/** 표 안(머리글 열 범위)에 No. 말고 값이 있는 줄인가 (0·'-'·빈 문자열은 값 아님) */
function rowHasContent(row: Cell[], cols: Columns): boolean {
  const lim = Math.min(row.length - 1, cols.last)
  for (let c = 0; c <= lim; c++) {
    if (c === cols.one.no) continue
    const v = row[c]
    if (v === null || v === false) continue
    if (typeof v === 'number') {
      if (v !== 0) return true
    } else if (typeof v === 'string') {
      const s = v.trim()
      if (s && !isDash(s)) return true
    } else return true
  }
  return false
}

function isSubtotalRow(row: Cell[], cols: Columns): boolean {
  const re = /^(소계|중간합계|중계|누계|합계)$/
  const first = firstValue(row, Math.max(2, cols.first + 2))
  const texts = [first, at(row, cols.one.category), at(row, cols.one.title)]
  return texts.some(v => typeof v === 'string' && re.test(v.replace(/\s/g, '')))
}

/** 공사 구분·항목 이어받기: 공사 구분이 비었거나 같으면 같은 묶음 */
function groupCarry() {
  let cat: string | null = null
  let title: string | null = null
  return (catRaw: string | null, titleRaw: string | null) => {
    const newGroup = catRaw !== null && catRaw !== cat
    const category = catRaw ?? cat
    const titleCarried = titleRaw === null && !newGroup ? title : null
    const carried = (catRaw === null && cat !== null) || titleCarried !== null
    if (catRaw !== null) {
      if (newGroup) title = null
      cat = catRaw
    }
    if (titleRaw !== null) title = titleRaw
    return { category, title: titleRaw ?? titleCarried, carried }
  }
}

interface RowBasics {
  cat: string | null
  title: string | null
  payeeRaw: string | null
  bankRaw: string | null
  account: string | null
  holderRaw: string | null
  /** 은행·예금주 칸에 '카드결제' */
  card: boolean
  bankCard: boolean
  holderCard: boolean
}

function rowBasics(row: Cell[], cols: Columns): RowBasics {
  const bankRaw = textOf(at(row, cols.one.bank))
  const holderRaw = textOf(at(row, cols.one.holder))
  const bankCard = isCardText(bankRaw)
  const holderCard = isCardText(holderRaw)
  return {
    cat: textOf(at(row, cols.one.category)),
    title: textOf(at(row, cols.one.title)),
    payeeRaw: textOf(at(row, cols.one.payee)),
    bankRaw,
    account: toAccount(at(row, cols.one.account)),
    holderRaw,
    card: bankCard || holderCard,
    bankCard,
    holderCard,
  }
}

/** 업체명이 비면 예금주를 받는 사람으로 */
function fillBank(p: PaymentFields, b: RowBasics): void {
  p.payee = b.payeeRaw ?? (b.holderCard ? null : b.holderRaw)
  p.bank_name = b.bankCard ? null : b.bankRaw
  p.account_no = b.account
  p.account_holder = b.holderCard ? null : b.holderRaw
}

function memoOf(row: Cell[], cols: Columns, out: Collector, extra: (string | null)[] = []): string | null {
  const parts: string[] = []
  const v = at(row, cols.one.memo)
  if (typeof v === 'number') {
    parts.push(fmtNum(v))
    out.notes.numericMemo++
  } else {
    const s = textOf(v)
    if (s) parts.push(s)
  }
  for (const e of extra) if (e) parts.push(e)
  return parts.length ? parts.join(' / ') : null
}

/** 지급일·입금일 열 (입금일 우선) */
function paidDates(row: Cell[], cols: Columns): { deposit: string | null; pay: string | null } {
  let deposit: string | null = null
  let pay: string | null = null
  for (const p of cols.paid) {
    const d = toDate(at(row, p.col), true)
    if (!d) continue
    if (p.deposit) deposit ??= d
    else pay ??= d
  }
  return { deposit, pay }
}

function skipReason(cell: Cell, amount: number | null): string {
  if (typeof cell === 'string' && ERROR_RE.test(cell.trim())) return `금액 칸 오류 (${cell.trim()})`
  return amount === 0 ? '금액이 0원' : '금액 없음'
}

const isEstimateText = (b: RowBasics) => /예상/.test(b.title ?? '') || /예상/.test(b.cat ?? '')

// ---------------------------------------------------------------------------
// register: 결제 대장

function parseRegister(t: Table, out: Collector): void {
  const { rows, cols } = t
  const group = groupCarry()
  const batch = { req: null as string | null, due: null as string | null }

  for (let i = t.start; i < t.end; i++) {
    const row = rows[i] ?? []
    const excelRow = i + 1
    if (!rowHasContent(row, cols)) continue
    if (isSubtotalRow(row, cols)) {
      out.skipped.push({ row: excelRow, reason: '소계 줄' })
      continue
    }
    const b = rowBasics(row, cols)
    const amountCell = at(row, cols.one.amount)
    const raw = toAmount(amountCell)
    const amount = raw === null ? null : Math.round(raw)

    // 업체·공사구분·항목·은행·계좌가 모두 비고 금액만 있는 줄 → 예상·일괄 금액
    if (amount && !b.payeeRaw && !b.cat && !b.title && !b.bankRaw && !b.account) {
      const label = findLabel(row, cols)
      const p = basePayment(t.projectId)
      p.title = label?.text ?? '예상 비용'
      p.amount = amount
      p.is_estimate = true
      p.status = '예정'
      p.tax_invoice = resolveTax(cols.tax.map(c => at(row, c)), null, false, out).state
      const memoCol = cols.one.memo
      p.memo = label && label.col === memoCol ? null : memoOf(row, cols, out)
      const it = newItem(excelRow, p, { suggestExclude: true })
      out.items.push(it)
      out.estimates.push(it)
      continue
    }

    const settlement = /대지급/.test(b.title ?? '') || /대지급/.test(b.cat ?? '')
    const grp = settlement ? { category: b.cat, title: b.title, carried: false } : group(b.cat, b.title)
    const dates = registerDates(row, cols, batch)

    if (amount === null || amount === 0) {
      out.skipped.push({ row: excelRow, reason: skipReason(amountCell, amount) })
      continue
    }

    const ct = normContractType(at(row, cols.one.contractType))
    const contractType: ContractType | null = ct.type ?? (b.card ? '카드' : null)
    const st = parseStatus(at(row, cols.one.status))
    const own = paidDates(row, cols)
    const ownPaid = own.deposit ?? own.pay
    const status: PaymentStatus = st.status ?? (ownPaid || st.date ? '완료' : '예정')
    const tax = resolveTax(cols.tax.map(c => at(row, c)), contractType, b.card, out)
    if (ct.raw) out.notes.contractType.push(ct.raw)
    if (st.raw) out.notes.status.push(st.raw)

    const p = basePayment(t.projectId)
    p.category = grp.category
    p.title = grp.title ?? grp.category ?? '결제'
    fillBank(p, b)
    p.contract_type = contractType
    p.amount = amount
    p.stage = amount < 0 ? '환불' : null
    p.tax_invoice = tax.state
    p.tax_invoice_date = tax.date
    p.status = status
    p.requested_date = dates.req
    p.due_date = dates.due
    p.paid_date = status === '완료' ? ownPaid ?? st.date ?? dates.due ?? dates.req : null
    p.memo = memoOf(row, cols, out, [ct.raw && `계약형태: ${ct.raw}`, ...tax.raws.map(r => `세금계산서: ${r}`), st.raw && `지급완료: ${st.raw}`])
    const estimate = !settlement && isEstimateText(b)
    if (estimate) {
      p.is_estimate = true
      p.status = '예정'
      p.paid_date = null
    }
    const it = newItem(excelRow, p, { settlement, carried: grp.carried, dateCarried: dates.carried, suggestExclude: estimate })
    out.items.push(it)
    if (estimate) out.estimates.push(it)
  }
  applySettlements(out)
}

/**
 * 결제요청일·지급예정일: 요청 묶음의 첫 줄에만 적는 대장이라, 결제요청일이 빈 줄은 묶음 첫 줄의
 * 결제요청일을, 지급예정일까지 비었으면 묶음의 지급예정일을 이어받는다.
 * 지급예정일이 비고 결제요청일이 있으면 차주 월요일. 결제요청일 '-' 는 날짜 없음 (묶음도 끝).
 */
function registerDates(row: Cell[], cols: Columns, batch: { req: string | null; due: string | null }) {
  const reqCell = at(row, cols.one.requested)
  const dueCell = at(row, cols.one.due)
  const ownReq = toDate(reqCell, true)
  const ownDue = toDate(dueCell, true)
  if (ownReq) {
    batch.req = ownReq
    batch.due = ownDue ?? nextMonday(ownReq)
    return { req: ownReq, due: batch.due, carried: false }
  }
  if (isBlank(reqCell)) {
    const req = batch.req
    const due = ownDue ?? (isBlank(dueCell) ? batch.due : req ? nextMonday(req) : null)
    return { req, due, carried: req !== null }
  }
  batch.req = null
  batch.due = null
  return { req: null, due: ownDue, carried: false }
}

/** '현장소장 대지급' 줄: 바로 위의 미지급(예정) 줄들을 한 번에 정산한 이체 */
function applySettlements(out: Collector): void {
  const items = out.items
  const removed = new Set<Item>()
  let lines = 0
  let claimed = 0
  let sum = 0
  for (let si = 0; si < items.length; si++) {
    const s = items[si]
    if (!s.settlement) continue
    const block: Item[] = []
    let acc = 0
    let matched = false
    for (let j = si - 1; j >= 0; j--) {
      const c = items[j]
      if (c.settlement || c.claimed || c.p.is_estimate || c.p.status !== '예정') break
      block.push(c)
      acc += c.p.amount
      if (acc === s.p.amount) {
        matched = true
        break
      }
    }
    if (!matched) {
      s.settlement = false
      out.issues.push({
        level: 'warn',
        row: s.row,
        message: `${s.row}행 대지급 ${won(s.p.amount)}: 바로 위 미지급(N) 줄들의 합계와 맞지 않아 일반 결제로 두었습니다.`,
      })
      continue
    }
    removed.add(s)
    out.skipped.push({ row: s.row, reason: '대지급 정산 줄' })
    const paid = s.p.status === '완료' ? s.p.paid_date ?? s.p.due_date ?? s.p.requested_date : null
    for (const c of block) {
      c.claimed = true
      c.p.advance_by = s.p.payee
      c.p.status = s.p.status
      c.p.paid_date = s.p.status === '완료' ? paid : null
    }
    lines++
    claimed += block.length
    sum += s.p.amount
  }
  if (removed.size) out.items = items.filter(it => !removed.has(it))
  if (lines) {
    out.issues.push({
      level: 'info',
      message: `대지급 정산 줄 ${lines}개(합계 ${won(sum)})를 바로 위 결제 ${claimed}건에 반영했습니다: 대지급자를 표시하고 정산 줄의 상태·지급일을 적용. 정산 줄 자체는 가져오지 않습니다.`,
    })
  }
}

// ---------------------------------------------------------------------------
// installments: 예산 + 실행&계약금 + 1~4차 지급 + 잔금

function parseInstallments(t: Table, out: Collector): void {
  const { rows, cols } = t
  const group = groupCarry()

  for (let i = t.start; i < t.end; i++) {
    const row = rows[i] ?? []
    const excelRow = i + 1
    if (!rowHasContent(row, cols)) continue
    if (isSubtotalRow(row, cols)) {
      out.skipped.push({ row: excelRow, reason: '소계 줄' })
      continue
    }
    const b = rowBasics(row, cols)
    const grp = group(b.cat, b.title)
    const budget = toAmount(at(row, cols.one.budget))
    const contract = toAmount(at(row, cols.one.contract))
    const balance = toAmount(at(row, cols.one.balance))
    const insts = cols.inst.map(x => {
      const a = toAmount(at(row, x.col))
      return { k: x.k, amount: a === null ? 0 : Math.round(a), date: toDate(at(row, x.col + 1), false) }
    })
    if (!budget && !contract && !insts.some(x => x.amount) && !(balance && balance > 0)) {
      out.skipped.push({ row: excelRow, reason: '금액 없음' })
      continue
    }

    const contractType: ContractType | null = b.card ? '카드' : null
    const tax = resolveTax(cols.tax.map(c => at(row, c)), contractType, b.card, out)
    const st = parseStatus(at(row, cols.one.status))
    if (st.raw) out.notes.status.push(st.raw)
    const memo = memoOf(row, cols, out, [...tax.raws.map(r => `세금계산서: ${r}`), st.raw && `지급완료: ${st.raw}`])
    const estimate = isEstimateText(b)
    const payee = b.payeeRaw ?? (b.holderCard ? null : b.holderRaw)

    out.budgetLines.push({
      ...(t.projectId ? { project_id: t.projectId } : {}),
      category: grp.category ?? '기타',
      item: grp.title,
      payee,
      budget_amount: budget ? Math.round(budget) : 0,
      contract_amount: contract === null ? null : Math.round(contract),
      sort_order: excelRow,
      memo,
    })

    const make = (stage: string, amount: number, status: PaymentStatus, date: string | null) => {
      const p = basePayment(t.projectId)
      p.category = grp.category
      p.title = grp.title ?? grp.category ?? '결제'
      fillBank(p, b)
      p.contract_type = contractType
      p.stage = amount < 0 ? '환불' : stage
      p.amount = amount
      p.tax_invoice = tax.state
      p.tax_invoice_date = tax.date
      p.status = estimate ? '예정' : status
      p.is_estimate = estimate
      p.due_date = date
      p.paid_date = p.status === '완료' ? date ?? st.date : null
      p.memo = memo
      const it = newItem(excelRow, p, { carried: grp.carried, suggestExclude: estimate })
      out.items.push(it)
      if (estimate) out.estimates.push(it)
    }

    let made = 0
    let paidSum = 0
    for (const x of insts) {
      if (!x.amount) continue
      paidSum += x.amount
      make(`${x.k}차`, x.amount, x.date ? '완료' : st.status ?? '예정', x.date)
      made++
    }
    if (balance && Math.round(balance) > 0) {
      make('잔금', Math.round(balance), st.status ?? '예정', null)
      made++
    }
    if (!made) out.skipped.push({ row: excelRow, reason: '지급 금액 없음 (예산 줄만 만듦)' })
    if (contract !== null && paidSum > contract + 0.5) out.notes.overpaid.push(`${excelRow}행 ${won(paidSum)} > ${won(contract)}`)
  }
}

// ---------------------------------------------------------------------------
// labor: 노무비 대장

function parseLabor(t: Table, out: Collector): void {
  const { rows, cols } = t
  const group = groupCarry()
  let carryPaid: string | null = null

  for (let i = t.start; i < t.end; i++) {
    const row = rows[i] ?? []
    const excelRow = i + 1
    if (!rowHasContent(row, cols)) {
      carryPaid = null // 빈 줄이 나오면 지급 묶음이 끝난 것으로 본다
      continue
    }
    if (isSubtotalRow(row, cols)) {
      out.skipped.push({ row: excelRow, reason: '소계 줄' })
      continue
    }
    const b = rowBasics(row, cols)
    const grp = group(b.cat, b.title)
    const { deposit, pay } = paidDates(row, cols)
    const own = deposit ?? pay
    const paid: string | null = own ?? carryPaid
    carryPaid = paid
    const amountCell = at(row, cols.one.amount)
    const raw = toAmount(amountCell)
    const amount = raw === null ? null : Math.round(raw)
    if (amount === null || amount === 0) {
      out.skipped.push({ row: excelRow, reason: skipReason(amountCell, amount) })
      continue
    }
    const ct = normContractType(at(row, cols.one.contractType))
    if (ct.raw) out.notes.contractType.push(ct.raw)
    const st = parseStatus(at(row, cols.one.status))
    if (st.raw) out.notes.status.push(st.raw)
    const estimate = isEstimateText(b)

    const p = basePayment(t.projectId)
    p.category = grp.category ?? '노무비'
    p.title = grp.title ?? '노무비'
    fillBank(p, b)
    p.contract_type = ct.type
    p.amount = amount
    p.stage = amount < 0 ? '환불' : null
    p.tax_invoice = '해당 없음'
    p.status = estimate ? '예정' : st.status ?? (paid ? '완료' : '예정')
    p.is_estimate = estimate
    p.due_date = pay ?? paid
    p.paid_date = p.status === '완료' ? paid ?? st.date : null
    p.memo = memoOf(row, cols, out, [ct.raw && `고용형태: ${ct.raw}`, st.raw && `지급완료: ${st.raw}`])
    const it = newItem(excelRow, p, { carried: grp.carried, dateCarried: !own && !!paid, suggestExclude: estimate })
    out.items.push(it)
    if (estimate) out.estimates.push(it)
  }
}

// ---------------------------------------------------------------------------
// 표 전체 점검 · 안내 문구

const ERROR_RE = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|UNKNOWN!|ERROR!)$/

/** 오류 셀(머리글~합계 줄), 표 밖 금액(마지막 머리글 열 + 2 보다 오른쪽), No. 중복 */
function scanTable(t: Table, header: number, lastRow: number, out: Collector): void {
  const { rows, cols } = t
  const errorRows: number[] = []
  let errors = 0
  for (let i = header; i <= lastRow && i < rows.length; i++) {
    let hit = false
    for (const v of rows[i] ?? []) {
      if (typeof v === 'string' && ERROR_RE.test(v.trim())) {
        errors++
        hit = true
      }
    }
    if (hit) errorRows.push(i + 1)
  }
  if (errors) out.issues.push({ level: 'warn', row: errorRows[0], message: `오류 값(#REF! 등)이 든 셀 ${errors}개가 있습니다 (${rowList(errorRows)}행). 원본 수식을 확인해 주세요.` })

  const outside: { row: number; col: number; value: number }[] = []
  const nos = new Map<string, number[]>()
  for (let i = t.start; i < t.end; i++) {
    const row = rows[i] ?? []
    for (let c = cols.last + 3; c < row.length; c++) {
      const v = row[c]
      if (typeof v === 'number' && Math.abs(v) >= 1000) outside.push({ row: i + 1, col: c, value: v })
    }
    const no = textOf(at(row, cols.one.no))
    if (no !== null && rowHasContent(row, cols)) nos.set(no, [...(nos.get(no) ?? []), i + 1])
  }
  if (outside.length) {
    const letters = [...new Set(outside.map(o => o.col))].sort((a, b) => a - b).map(colLetter)
    const sum = outside.reduce((a, o) => a + o.value, 0)
    out.issues.push({
      level: 'warn',
      row: outside[0].row,
      message: `표 밖(열 ${letters.join(', ')})에 적힌 금액 ${outside.length}건, 합계 ${won(sum)}은 가져오지 않습니다 (${rowList([...new Set(outside.map(o => o.row))])}행).`,
    })
  }
  const dupNos = [...nos].filter(([, r]) => r.length > 1)
  if (dupNos.length) {
    out.issues.push({ level: 'info', row: dupNos[0][1][0], message: `No. 값이 겹칩니다: ${dupNos.map(([no, r]) => `${no} (${r.join('·')}행)`).join(', ')}` })
  }
}

function summarize(out: Collector, format: SheetFormat): void {
  const { items, notes, issues } = out
  if (out.estimates.length) {
    const sum = out.estimates.reduce((a, it) => a + it.p.amount, 0)
    const list = out.estimates.map(it => `${it.p.title}(${it.row}행)`)
    const uniq = [...new Set(list)]
    issues.push({
      level: 'warn',
      row: out.estimates[0].row,
      message: `예상·일괄 금액 ${out.estimates.length}건(합계 ${won(sum)})은 실제 결제가 아니어서 기본으로 제외합니다: ${uniq.join(', ')}`,
    })
  }
  if (notes.overpaid.length) {
    issues.push({ level: 'warn', message: `지급 합계가 실행&계약금보다 큰 줄이 있습니다: ${notes.overpaid.join(', ')}` })
  }
  const negatives = items.filter(it => it.p.amount < 0)
  if (negatives.length) {
    issues.push({ level: 'info', row: negatives[0].row, message: `음수 금액(환불·차감) ${negatives.length}건은 단계 '환불'로 가져옵니다 (${rowList(negatives.map(it => it.row))}행).` })
  }
  const carried = new Set(items.filter(it => it.carried).map(it => it.row)).size
  if (carried) issues.push({ level: 'info', message: `공사 구분·항목이 빈 ${carried}줄은 위 줄 값을 이어받았습니다.` })
  const dated = items.filter(it => it.dateCarried).length
  if (dated) {
    issues.push({
      level: 'info',
      message:
        format === 'labor'
          ? `입금일이 빈 ${dated}줄은 위 줄의 입금일을 이어받았습니다.`
          : `결제요청일이 빈 ${dated}줄은 위 줄의 결제요청일·지급예정일을 이어받았습니다 (같은 요청 묶음으로 봄).`,
    })
  }
  const listOf = (xs: string[]) => [...new Set(xs)].slice(0, 5).join(', ')
  if (notes.tax.length) issues.push({ level: 'info', message: `세금계산서 칸의 기타 값 ${notes.tax.length}건(${listOf(notes.tax)})은 '미발행'으로 두고 메모에 남겼습니다.` })
  if (notes.contractType.length) issues.push({ level: 'info', message: `계약형태 ${notes.contractType.length}건(${listOf(notes.contractType)})은 '기타'로 두고 원래 값은 메모에 남겼습니다.` })
  if (notes.status.length) issues.push({ level: 'info', message: `지급완료 칸의 알 수 없는 값 ${notes.status.length}건(${listOf(notes.status)})은 메모에 남겼습니다.` })
  if (notes.numericMemo) issues.push({ level: 'info', message: `비고 칸의 숫자 ${notes.numericMemo}건(소계 등)은 메모에 그대로 남겼습니다.` })
}

/** 이미 등록된 결제와 겹침: 업체(정규화)·금액이 같고 결제요청·예정·지급일 중 하나라도 7일 이내 (1:1 대응) */
function markDuplicates(items: Item[], existing: ExistingPayment[]): number {
  if (!existing.length) return 0
  const index = new Map<string, ExistingPayment[]>()
  for (const e of existing) {
    const k = normPayee(e.payee)
    if (!k) continue
    const key = `${k}|${Number(e.amount)}`
    index.set(key, [...(index.get(key) ?? []), e])
  }
  const used = new Set<string>()
  let n = 0
  for (const it of items) {
    const k = normPayee(it.p.payee)
    const cands = k ? index.get(`${k}|${it.p.amount}`) : undefined
    if (!cands) continue
    // 조건에 맞는 것 중 가장 가까운 것 (같은 종류의 날짜끼리 맞는 것을 먼저)
    let hit: ExistingPayment | null = null
    let best = Infinity
    for (const e of cands) {
      if (used.has(e.id)) continue
      const d = dateScore(it.p, e)
      if (d !== null && d < best) {
        best = d
        hit = e
      }
    }
    if (!hit) continue
    used.add(hit.id)
    it.duplicateOf = hit.id
    it.suggestExclude = true
    n++
  }
  return n
}

type DateFields = { requested_date: string | null; due_date: string | null; paid_date: string | null }
const DATE_KEYS = ['requested_date', 'due_date', 'paid_date'] as const

/** 결제요청·예정·지급일 중 어느 둘이라도 7일 이내면 점수(작을수록 가까움), 아니면 null. 둘 다 날짜가 없으면 0 */
function dateScore(a: DateFields, b: DateFields): number | null {
  const da = dateList(a)
  const db = dateList(b)
  if (!da.length && !db.length) return 0
  let cross = Infinity
  for (const x of da) for (const y of db) cross = Math.min(cross, Math.abs(x - y))
  if (cross > 7) return null
  let same = Infinity
  for (const key of DATE_KEYS) {
    const x = a[key]
    const y = b[key]
    if (x && y) same = Math.min(same, Math.abs(dayNumber(x) - dayNumber(y)))
  }
  return same <= 7 ? same : 8 + cross
}

function normPayee(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\s+/g, '')
    .replace(/㈜|\(주\)|（주）|주식회사|^주\)/g, '')
    .toLowerCase()
}

function dateList(p: DateFields): number[] {
  return [p.requested_date, p.due_date, p.paid_date].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).map(dayNumber)
}

function dayNumber(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000
}

// ---------------------------------------------------------------------------
// 계약 요약 (계약금액 · 수금 · 잔금)

/** 머리글 줄: 숫자 없이 '계약금(액)' 과 '수금'·'중도금'·'잔금' 중 하나 */
function contractHeaderAt(row: Cell[]): { contract: number; received: number; mid: number; balance: number } | null {
  let contract = -1
  let received = -1
  let mid = -1
  let balance = -1
  for (let c = 0; c < row.length; c++) {
    const v = row[c]
    if (typeof v === 'number') return null
    const h = normHeader(v)
    if (!h) continue
    if (contract < 0 && /^(총)?계약(금액|금|액)(\(.*\))?$/.test(h)) contract = c
    else if (received < 0 && /^(수금|기수금|입금)(액|금액|합계|누계)?(\(.*\))?$/.test(h)) received = c
    else if (mid < 0 && h.startsWith('중도금')) mid = c
    else if (balance < 0 && contract >= 0 && /^(잔금|미수금|잔액)(\(.*\))?$/.test(h)) balance = c
  }
  return contract >= 0 && (received >= 0 || mid >= 0 || balance >= 0) ? { contract, received, mid, balance } : null
}

function findContract(rows: Cell[][], from: number): ImportPreview['contract'] {
  for (let i = from; i < rows.length; i++) {
    const hd = contractHeaderAt(rows[i] ?? [])
    if (!hd) continue
    const total = (col: number) => (col < 0 ? null : columnTotal(rows, i + 1, col))
    const contract = total(hd.contract)
    const bal = total(hd.balance)
    const received = hd.received >= 0 ? total(hd.received) : contract !== null && bal !== null ? contract - bal : total(hd.mid)
    if (!contract && !received) continue
    return { contract_amount: contract ? Math.round(contract) : null, received: received === null ? null : Math.round(received) }
  }
  return null
}

/** 머리글 아래 숫자들: 마지막 값이 앞 값들의 합이면 그것이 합계, 아니면 모두 더함 */
function columnTotal(rows: Cell[][], from: number, col: number): number | null {
  const vals: number[] = []
  let gap = 0
  for (let k = from; k < rows.length && gap < 3; k++) {
    const v = rows[k]?.[col] ?? null
    if (typeof v === 'number') {
      vals.push(v)
      gap = 0
    } else if (isBlank(v)) gap++
    else break
  }
  if (!vals.length) return null
  const all = vals.reduce((a, b) => a + b, 0)
  if (vals.length >= 2) {
    const last = vals[vals.length - 1]
    if (Math.abs(last - (all - last)) < 0.5) return last
  }
  return all
}

// ---------------------------------------------------------------------------
// 값 변환

const DASH_RE = /^[-‐‑‒–—―－]+$/
const isDash = (s: string) => DASH_RE.test(s)
const isBlank = (v: Cell) => v === null || (typeof v === 'string' && v.trim() === '')

function textOf(v: Cell): string | null {
  if (v === null) return null
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : v ? 'TRUE' : 'FALSE'
  return s === '' || isDash(s) ? null : s
}

function isCardText(s: string | null): boolean {
  return !!s && /^(카드|카드결제|법인카드|신용카드|체크카드|개인카드)$/.test(s.replace(/\s/g, ''))
}

/** 숫자 셀 또는 '1,234,000원' 같은 글자 → 숫자 */
function toAmount(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[\s,원₩\\]/g, '')
  if (!s || isDash(s)) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (/^[△▲]/.test(s)) {
    neg = true
    s = s.slice(1)
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return neg ? -n : n
}

const DATE_RE = /^(\d{4})\s*[.\/\-년]\s*(\d{1,2})\s*[.\/\-월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]*\))?\s*(?:[T ]?\d{1,2}:\d{2}(?::\d{2})?)?$/

/** 'YYYY-MM-DD'(읽기 결과) · '2026.5.4' · '2026년 5월 4일' 등. serialOk 면 날짜 서식이 없는 일련번호도 날짜로 */
function toDate(v: Cell, serialOk = false): string | null {
  if (typeof v === 'number') return serialOk && v >= 20000 && v < 80000 ? excelSerialToDate(v) || null : null
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (y < 1900 || y > 2200 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 계좌번호: 숫자 셀은 지수 표기 없이 숫자만, 글자는 하이픈 그대로 */
function toAccount(v: Cell): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  return textOf(v)
}

function normContractType(v: Cell): { type: ContractType | null; raw: string | null } {
  const s = textOf(v)
  if (!s) return { type: null, raw: null }
  const k = s.replace(/\s/g, '')
  const exact = CONTRACT_TYPES.find(x => x.replace(/\s/g, '') === k)
  if (exact) return { type: exact, raw: null }
  if (k.includes('사업소득') || k.includes('3.3')) return { type: '사업소득(3.3%)', raw: null }
  if (k.includes('일용')) return { type: '일용근로', raw: null }
  if (k.includes('4대')) return { type: '4대보험 근로', raw: null }
  if (k.includes('세금계산서')) return { type: '세금계산서', raw: null }
  if (k.includes('현금영수증')) return { type: '현금영수증', raw: null }
  if (isCardText(k)) return { type: '카드', raw: null }
  return { type: '기타', raw: s }
}

function parseStatus(v: Cell): { status: PaymentStatus | null; date: string | null; raw: string | null } {
  if (typeof v === 'boolean') return { status: v ? '완료' : '예정', date: null, raw: null }
  const date = toDate(v)
  if (date) return { status: '완료', date, raw: null }
  const s = textOf(v)
  if (!s) return { status: null, date: null, raw: null }
  const k = s.replace(/\s/g, '').toLowerCase()
  if (/^(y|yes|o|○|◯|●|v|✓|✔|완료|지급완료|지급|입금완료|송금완료|ok|true)$/.test(k)) return { status: '완료', date: null, raw: null }
  if (/^(n|no|x|×|✕|미지급|미완료|미입금|false)$/.test(k)) return { status: '예정', date: null, raw: null }
  if (k === '예정' || k === '대기' || k === '보류' || k === '취소' || k === '청구') return { status: k, date: null, raw: null }
  return { status: null, date: null, raw: s }
}

const NO_INVOICE_TYPES: ContractType[] = ['카드', '사업소득(3.3%)', '일용근로', '4대보험 근로']

/**
 * 세금계산서 칸(여러 개 가능): Y·발행 → 발행, N → 미발행, '-' → 해당 없음,
 * 비면 카드·사업소득·일용·4대보험은 해당 없음 그 외 미발행, 다른 값은 미발행 + 메모
 */
function resolveTax(cells: Cell[], ct: ContractType | null, card: boolean, out: Collector): { state: TaxInvoiceState; date: string | null; raws: string[] } {
  let y = false
  let n = false
  let dash = false
  let date: string | null = null
  const raws: string[] = []
  for (const v of cells) {
    if (v === null || isBlank(v)) continue
    if (typeof v === 'boolean') {
      if (v) y = true
      else n = true
      continue
    }
    if (typeof v === 'number') {
      raws.push(fmtNum(v))
      continue
    }
    const s = v.trim()
    const d = toDate(s)
    if (d) {
      y = true
      date ??= d
      continue
    }
    const k = s.replace(/\s/g, '').toLowerCase()
    if (isDash(s) || /^(해당없음|없음|n\/a|na|불필요|면세)$/.test(k)) dash = true
    else if (/^(y|yes|o|○|◯|●|v|✓|✔|발행|발행완료|수취|수취완료|완료|true)$/.test(k)) y = true
    else if (/^(n|no|x|×|✕|미발행|미수취|false)$/.test(k)) n = true
    else raws.push(s)
  }
  out.notes.tax.push(...raws)
  let state: TaxInvoiceState
  if (y) state = '발행'
  else if (card) state = '해당 없음'
  else if (n || raws.length) state = '미발행'
  else if (dash) state = '해당 없음'
  else state = ct && NO_INVOICE_TYPES.includes(ct) ? '해당 없음' : '미발행'
  return { state, date, raws }
}

/** 예상·일괄 금액 줄의 이름표: 예금주 → 비고 → 그 밖의 표 안 글자 */
function findLabel(row: Cell[], cols: Columns): { text: string; col: number } | null {
  const skip = new Set([cols.one.amount, cols.one.no, cols.one.status, ...cols.tax])
  const order = [cols.one.holder, cols.one.memo, ...Array.from({ length: cols.last + 1 }, (_, c) => c)]
  for (const c of order) {
    if (c === undefined || skip.has(c)) continue
    const v = row[c]
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (!s || isDash(s) || toDate(s) || /^[yn]$/i.test(s) || ERROR_RE.test(s)) continue
    return { text: s, col: c }
  }
  return null
}

function fmt(n: number): string {
  const r = Math.round(n)
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return r < 0 ? `-${s}` : s
}

const fmtNum = (n: number) => (Number.isInteger(n) ? fmt(n) : String(n))
const won = (n: number) => `${fmt(n)}원`

/** [81,82,83,96] → '81–83, 96' */
function rowList(rows: number[]): string {
  const xs = [...new Set(rows)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < xs.length; i++) {
    let j = i
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
    parts.push(j > i ? `${xs[i]}–${xs[j]}` : String(xs[i]))
    i = j
  }
  return parts.join(', ')
}
