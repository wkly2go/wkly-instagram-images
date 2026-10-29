// 재무 계산 (화면 공용). 수익성은 공급가액(VAT 별도) 기준, 지급·입금 목록은 실제 금액 기준.
import { addDays, nextMonday } from './date'
import { LABOR_TYPES, OPEN_PAYMENT_STATUSES, type BudgetLine, type Client, type Payment, type Project, type ProjectFinance } from './types'

/** 공급가액 = 금액 - 부가세 */
export const supply = (p: Pick<Payment, 'amount' | 'vat'>) => p.amount - p.vat
/** 실제 결제 대상 (예상 비용·취소 제외) 중 아직 끝나지 않은 것 */
export const isOpen = (p: Payment) => !p.is_estimate && OPEN_PAYMENT_STATUSES.includes(p.status)
export const isDone = (p: Payment) => !p.is_estimate && p.status === '완료'
export const isOverdue = (p: Payment, today: string) => isOpen(p) && !!p.due_date && p.due_date < today
/** 대지급(현장소장 등이 먼저 낸 돈) 건: 대지급자 칸이 비어 있지 않음 */
export const isAdvance = (p: Payment) => !!p.advance_by?.trim()
/** 비용·마진 계산에 넣는 지급 (취소 제외, 예상 비용 포함) */
const isCost = (p: Payment) => p.direction === '지급' && p.status !== '취소'
const sum = (list: Payment[], f: (p: Payment) => number = supply) => list.reduce((n, p) => n + f(p), 0)

export interface Money {
  contract: number | null
  target: number | null
  received: number
  receivable: number
  paid: number
  payable: number
  estimate: number
  /** 지급 완료 + 미지급 + 예상 비용 */
  cost: number
  budget: number | null
  margin: number | null
  marginRate: number | null
  /** 지급 내역이 아직 없어 예산으로 계산했는지 */
  byBudget: boolean
  collectRate: number | null
  overdueIn: Payment[]
  overdueOut: Payment[]
}

/** 프로젝트 하나의 돈 흐름. payments·lines 는 그 프로젝트 것만 넘긴다. */
export function projectMoney(fin: ProjectFinance | undefined, payments: Payment[], lines: BudgetLine[], today: string): Money {
  const inflow = payments.filter(p => p.direction === '수금' && !p.is_estimate && p.status !== '취소')
  const outflow = payments.filter(isCost)
  const received = sum(inflow.filter(isDone))
  const receivable = sum(inflow.filter(isOpen))
  const paid = sum(outflow.filter(isDone))
  const payable = sum(outflow.filter(isOpen))
  const estimate = sum(outflow.filter(p => p.is_estimate))
  const budget = lines.length ? lines.reduce((n, l) => n + l.budget_amount, 0) : fin?.budget_cost ?? null
  const contract = fin?.contract_amount ?? null
  const byBudget = outflow.length === 0 && budget != null
  const cost = byBudget ? (budget ?? 0) : paid + payable + estimate
  const margin = contract != null ? contract - cost : null
  return {
    contract,
    target: fin?.target_margin ?? null,
    received,
    receivable,
    paid,
    payable,
    estimate,
    cost,
    budget,
    margin,
    marginRate: contract ? (margin! / contract) * 100 : null,
    byBudget,
    collectRate: contract ? (received / contract) * 100 : null,
    overdueIn: inflow.filter(p => isOverdue(p, today)),
    overdueOut: outflow.filter(p => isOverdue(p, today)),
  }
}

export interface CategoryRow {
  category: string
  /** 이 공사 구분의 예산 줄 (업체별로 여러 줄일 수 있음) */
  lines: BudgetLine[]
  payee: string | null
  budget: number
  contract: number | null
  done: number
  open: number
  estimate: number
  spent: number
  /** 예산 초과액 (예산이 없으면 집행액 전체) */
  over: number
  rate: number | null
}

const catKey = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '')

/** 공사 구분별 실행 예산 대비 집행. 같은 공사 구분의 예산 줄은 합치고, 결제는 연결된 예산 줄 → 공사 구분 이름 순으로 맞춘다. */
export function budgetByCategory(lines: BudgetLine[], payments: Payment[]): CategoryRow[] {
  const groups = new Map<string, { category: string; lines: BudgetLine[] }>()
  for (const l of lines) {
    const k = catKey(l.category)
    const g = groups.get(k) ?? { category: l.category, lines: [] }
    g.lines.push(l)
    groups.set(k, g)
  }
  const lineCat = new Map(lines.map(l => [l.id, catKey(l.category)]))
  const byCat = new Map<string, Payment[]>()
  for (const p of payments.filter(isCost)) {
    const k = (p.budget_line_id && lineCat.get(p.budget_line_id)) || catKey(p.category) || '미분류'
    byCat.set(k, [...(byCat.get(k) ?? []), p])
  }
  const rows = [...groups.entries()].map(([k, g]) => {
    const contracts = g.lines.map(l => l.contract_amount).filter((n): n is number => n != null)
    const payees = [...new Set(g.lines.map(l => l.payee).filter((x): x is string => !!x))]
    return row(g.category, g.lines, payees.length > 2 ? `${payees.slice(0, 2).join(', ')} 외 ${payees.length - 2}` : payees.join(', ') || null, g.lines.reduce((n, l) => n + l.budget_amount, 0), contracts.length ? contracts.reduce((a, b) => a + b, 0) : null, byCat.get(k) ?? [])
  })
  for (const [k, list] of byCat) if (!groups.has(k)) rows.push(row(list[0].category?.trim() || '미분류', [], null, 0, null, list))
  return rows
}

function row(category: string, lines: BudgetLine[], payee: string | null, budget: number, contract: number | null, list: Payment[]): CategoryRow {
  const done = sum(list.filter(isDone))
  const open = sum(list.filter(isOpen))
  const estimate = sum(list.filter(p => p.is_estimate))
  const spent = done + open + estimate
  return { category, lines, payee, budget, contract, done, open, estimate, spent, over: Math.max(0, spent - budget), rate: budget > 0 ? (spent / budget) * 100 : null }
}

export interface VendorRow {
  key: string
  name: string
  clientId: string | null
  kind: Client['category'] | null
  receivable: number
  received: number
  payable: number
  paid: number
  overdue: number
  next: string | null
}

const normName = (s: string) => s.replace(/\s|㈜|\(주\)|주식회사/g, '').toLowerCase()

/** 업체별 결제 현황 (공급가액). 거래처로 연결된 건 거래처 이름으로, 아니면 업체명으로 묶는다. */
export function vendorSummary(payments: Payment[], clients: Client[], today: string): VendorRow[] {
  const byId = new Map(clients.map(c => [c.id, c]))
  const map = new Map<string, VendorRow>()
  for (const p of payments) {
    if (p.is_estimate || p.status === '취소') continue
    const client = p.client_id ? byId.get(p.client_id) : undefined
    const name = client?.name ?? p.payee?.trim() ?? ''
    if (!name) continue
    const key = client ? `c:${client.id}` : `p:${normName(name)}`
    const r = map.get(key) ?? { key, name, clientId: client?.id ?? null, kind: client?.category ?? null, receivable: 0, received: 0, payable: 0, paid: 0, overdue: 0, next: null }
    const v = supply(p)
    if (p.direction === '수금') {
      if (p.status === '완료') r.received += v
      else r.receivable += v
    } else if (p.status === '완료') r.paid += v
    else r.payable += v
    if (isOverdue(p, today)) r.overdue++
    if (isOpen(p) && p.due_date && p.due_date >= today && (!r.next || p.due_date < r.next)) r.next = p.due_date
    map.set(key, r)
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.receivable + b.payable - (a.receivable + a.payable) || b.received + b.paid - (a.received + a.paid))
}

/** 월별 수금·지급 (완료 기준, 지급일의 달, 공급가액) */
export function monthlyFlow(payments: Payment[], months: string[]): { month: string; inflow: number; outflow: number }[] {
  return months.map(month => {
    const done = payments.filter(p => isDone(p) && p.paid_date?.startsWith(month))
    return { month, inflow: sum(done.filter(p => p.direction === '수금')), outflow: sum(done.filter(p => p.direction === '지급')) }
  })
}

/** 지급예정일이 n일 안이거나 지난 미결제 (실제 금액 순서는 날짜) */
export function upcomingPayments(payments: Payment[], today: string, days = 14): Payment[] {
  const until = addDays(today, days)
  return payments.filter(p => isOpen(p) && p.due_date && p.due_date <= until).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
}

export interface AdvanceGroup {
  by: string
  items: Payment[]
  total: number
}

/** 대지급(현장소장 등이 먼저 결제) 중 아직 정산하지 않은 묶음 */
export function advanceGroups(payments: Payment[]): AdvanceGroup[] {
  const map = new Map<string, Payment[]>()
  for (const p of payments) if (isAdvance(p) && p.direction === '지급' && isOpen(p)) map.set(p.advance_by!.trim(), [...(map.get(p.advance_by!.trim()) ?? []), p])
  return [...map.entries()].map(([by, items]) => ({ by, items, total: items.reduce((n, p) => n + p.amount, 0) })).sort((a, b) => b.total - a.total)
}

/** 노무비 대장 대상: 개인 노무비(사업소득·일용·4대보험) 또는 공사 구분이 노무비 */
export const isLabor = (p: Payment) => p.direction === '지급' && p.status !== '취소' && !p.is_estimate && (LABOR_TYPES.includes(p.contract_type as never) || (p.category ?? '').replace(/\s/g, '') === '노무비')
/** 인력업체(세금계산서 받는 업체) 지급분: 개인 노무비와 세무 처리가 다름 */
export const isAgency = (p: Payment) => isLabor(p) && p.contract_type != null && !LABOR_TYPES.includes(p.contract_type as never)

export interface LaborMonth {
  month: string
  people: number
  total: number
  insured: number
  uninsured: number
  agency: number
  count: number
}

/** 월별 노무비 요약 (지급일 기준, 지급 완료분만) */
export function laborMonthly(payments: Payment[], year: string): LaborMonth[] {
  const rows = payments.filter(p => isLabor(p) && p.status === '완료' && p.paid_date?.startsWith(year))
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`
    const list = rows.filter(p => p.paid_date!.startsWith(month))
    const people = list.filter(p => !isAgency(p))
    return {
      month,
      count: list.length,
      people: new Set(people.map(p => normName(p.payee ?? p.account_holder ?? ''))).size,
      total: list.reduce((n, p) => n + p.amount, 0),
      insured: people.filter(p => p.contract_type === '4대보험 근로').reduce((n, p) => n + p.amount, 0),
      uninsured: people.filter(p => p.contract_type !== '4대보험 근로').reduce((n, p) => n + p.amount, 0),
      agency: list.filter(isAgency).reduce((n, p) => n + p.amount, 0),
    }
  })
}

/** 계좌번호 가리기: 뒤 4자리만 */
export function maskAccount(no: string | null | undefined): string {
  if (!no) return ''
  const digits = no.replace(/\D/g, '')
  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`
}

/** 업체명 비교용 */
export const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normName(a) === normName(b)

/** 지급일(월요일): 오늘이 월요일이면 오늘, 아니면 다음 월요일 */
export function runMonday(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1 ? today : nextMonday(today)
}

export interface RunGroup {
  key: string
  holder: string
  bank: string | null
  account: string | null
  items: Payment[]
  total: number
}

/** 월요일 지급 목록: 그 날짜까지 지급할 미결제(대지급·예상·보류 제외), 받는 계좌별로 묶음 */
export function paymentRun(payments: Payment[], date: string): { groups: RunGroup[]; waiting: Payment[]; held: number; advances: number } {
  const due = payments.filter(p => p.direction === '지급' && !p.is_estimate && !isAdvance(p) && p.due_date && p.due_date <= date)
  const ready = due.filter(p => p.status === '예정' || p.status === '청구')
  const map = new Map<string, RunGroup>()
  for (const p of ready) {
    const account = p.account_no?.replace(/\s/g, '') || null
    const holder = p.account_holder || p.payee || '받는 분 미기재'
    const key = account ? `${p.bank_name ?? ''}|${account.replace(/\D/g, '')}` : `none|${normName(holder)}|${p.id}`
    const g = map.get(key) ?? { key, holder, bank: p.bank_name, account, items: [], total: 0 }
    g.items.push(p)
    g.total += p.amount
    map.set(key, g)
  }
  return {
    groups: [...map.values()].sort((a, b) => Number(!a.account) - Number(!b.account) || b.total - a.total),
    waiting: due.filter(p => p.status === '대기'),
    held: due.filter(p => p.status === '보류').length,
    advances: payments.filter(p => p.direction === '지급' && isAdvance(p) && isOpen(p) && p.due_date && p.due_date <= date).length,
  }
}

export interface PaymentCheck {
  key: string
  title: string
  why: string
  level: 'high' | 'mid'
  items: Payment[]
}

/** 결제 대장 점검: 엑셀에서 놓치기 쉬웠던 것들을 자동으로 찾음 */
export function paymentChecks(payments: Payment[], lines: BudgetLine[], projects: Project[], today: string): PaymentCheck[] {
  const live = payments.filter(p => p.status !== '취소')
  const out = live.filter(p => p.direction === '지급')
  const real = out.filter(p => !p.is_estimate)
  const nameOk = (a: string | null, b: string | null) => !a || !b || sameName(a, b) || a.includes(b) || b.includes(a)
  const lineKeys = new Map<string, Set<string>>()
  for (const l of lines) lineKeys.set(l.project_id, (lineKeys.get(l.project_id) ?? new Set()).add(catKey(l.category)))
  const linked = new Set(lines.map(l => l.id))
  const overBudget = projects.flatMap(pr => {
    const pl = lines.filter(l => l.project_id === pr.id)
    if (!pl.length) return []
    const cats = budgetByCategory(pl, out.filter(p => p.project_id === pr.id)).filter(r => r.over > 0 && r.budget > 0).map(r => catKey(r.category))
    return out.filter(p => p.project_id === pr.id && cats.includes(catKey(p.budget_line_id && linked.has(p.budget_line_id) ? pl.find(l => l.id === p.budget_line_id)?.category : p.category)))
  })
  const checks: PaymentCheck[] = [
    { key: 'overdue-out', title: '지급예정일이 지난 미지급', why: '지급예정일이 오늘 이전인데 아직 완료가 아닙니다.', level: 'high', items: real.filter(p => isOverdue(p, today)) },
    { key: 'overdue-in', title: '입금 예정일이 지난 미수금', why: '받을 날짜가 지났는데 수금이 완료되지 않았습니다.', level: 'high', items: live.filter(p => p.direction === '수금' && isOverdue(p, today)) },
    { key: 'no-account', title: '계좌 정보 없는 미지급', why: '이체할 계좌(은행·계좌번호)가 없습니다. 카드·대지급 건은 제외했습니다.', level: 'high', items: real.filter(p => isOpen(p) && !isAdvance(p) && p.contract_type !== '카드' && !p.account_no) },
    { key: 'invoice-in', title: '세금계산서 미수취', why: '세금계산서·계산서 거래인데 지급 완료 후에도 발행 표시가 없습니다.', level: 'mid', items: real.filter(p => p.status === '완료' && (p.contract_type === '세금계산서' || p.contract_type === '계산서') && p.tax_invoice === '미발행') },
    { key: 'invoice-out', title: '세금계산서 미발행 (수금)', why: '청구했거나 입금된 수금 건에 세금계산서 발행 표시가 없습니다.', level: 'mid', items: live.filter(p => p.direction === '수금' && !p.is_estimate && (p.status === '완료' || p.status === '청구') && p.tax_invoice === '미발행') },
    { key: 'over-budget', title: '예산 초과 공사 구분의 지출', why: '공사 구분별 실행 예산을 넘긴 항목입니다. 프로젝트 재무에서 예산을 확인하세요.', level: 'mid', items: overBudget },
    { key: 'no-budget', title: '예산에 없는 공사 구분', why: '실행 예산이 있는 현장인데 어느 공사 구분에도 속하지 않는 지출입니다.', level: 'mid', items: out.filter(p => p.project_id && lineKeys.has(p.project_id) && !(p.budget_line_id && linked.has(p.budget_line_id)) && !lineKeys.get(p.project_id)!.has(catKey(p.category))) },
    { key: 'no-request', title: '결제요청일 없음', why: '요청일이 없으면 차주 월요일 지급예정일이 잡히지 않습니다.', level: 'mid', items: real.filter(p => !p.requested_date && isOpen(p) && !p.due_date) },
    { key: 'labor-type', title: '노무비 고용형태 없음', why: '사업소득·일용·4대보험 중 무엇인지 없으면 세무사 요약에서 나눌 수 없습니다.', level: 'mid', items: real.filter(p => isLabor(p) && !p.contract_type) },
    { key: 'labor-holder', title: '성명과 예금주가 다른 노무비', why: '신고 대상자가 누구인지 세무사와 확인이 필요합니다.', level: 'mid', items: real.filter(p => isLabor(p) && !isAgency(p) && !nameOk(p.payee, p.account_holder)) },
    { key: 'advance-old', title: '2주 넘은 대지급 미정산', why: '현장소장 등이 먼저 낸 돈을 14일 넘게 정산하지 않았습니다.', level: 'mid', items: out.filter(p => isAdvance(p) && isOpen(p) && (p.requested_date ?? p.created_at.slice(0, 10)) < addDays(today, -14)) },
    { key: 'stale-estimate', title: '날짜가 지난 예상 비용', why: '예정일이 지난 예상 비용은 실제 결제로 바꾸거나 취소하세요.', level: 'mid', items: out.filter(p => p.is_estimate && p.due_date && p.due_date < today) },
  ]
  return checks.filter(c => c.items.length)
}

/** 업체(받는 사람)별 계약 · 지급 진행 (공급가액). 대표 지시 2026-10-29 "계약이 된 건지, 몇 프로 지급했는지, 남은 금액이 얼마인지" */
export interface ContractRow {
  key: string
  projectId: string | null
  payee: string
  category: string | null
  /** 예산 줄의 업체 계약금 합 (없으면 계약 없음) */
  contract: number | null
  /** 잡힌 지급 합 (예상 · 취소 제외) */
  scheduled: number
  paid: number
  open: number
  /** 계약이 있으면 계약 대비, 없으면 잡힌 지급 대비 % */
  rate: number | null
  /** (계약 ?? 잡힌 지급) − 지급 완료 */
  remain: number
  count: number
  doneCount: number
  next: string | null
  bank: string | null
  account: string | null
  holder: string | null
}

export const contractKey = (p: Pick<Payment, 'project_id' | 'payee' | 'title'>) => `${p.project_id ?? '-'}|${normName(p.payee?.trim() || p.title)}`

export function contractRows(payments: Payment[], lines: BudgetLine[]): ContractRow[] {
  const map = new Map<string, { items: Payment[] }>()
  for (const p of payments) {
    if (p.direction !== '지급' || p.is_estimate || p.status === '취소') continue
    const k = contractKey(p)
    const g = map.get(k) ?? { items: [] }
    g.items.push(p)
    map.set(k, g)
  }
  return [...map.entries()].map(([key, { items }]) => {
    const first = items[0]
    const name = normName(first.payee?.trim() || first.title)
    const ids = new Set(items.map(p => p.budget_line_id).filter(Boolean))
    const mine = lines.filter(l => l.project_id === first.project_id && ((l.payee && normName(l.payee) === name) || ids.has(l.id)))
    const cs = mine.map(l => l.contract_amount).filter((n): n is number => n != null)
    const contract = cs.length ? cs.reduce((a, b) => a + b, 0) : null
    const paid = sum(items.filter(isDone))
    const open = sum(items.filter(isOpen))
    const scheduled = paid + open
    const base = contract ?? scheduled
    const withAcc = [...items].reverse().find(p => p.account_no)
    const next = items.filter(p => isOpen(p) && p.due_date).map(p => p.due_date!).sort()[0] ?? null
    return {
      key,
      projectId: first.project_id,
      payee: first.payee?.trim() || first.title,
      category: mine[0]?.category ?? first.category,
      contract,
      scheduled,
      paid,
      open,
      rate: base > 0 ? (paid / base) * 100 : null,
      remain: base - paid,
      count: items.length,
      doneCount: items.filter(isDone).length,
      next,
      bank: withAcc?.bank_name ?? null,
      account: withAcc?.account_no ?? null,
      holder: withAcc?.account_holder ?? null,
    }
  })
}

/** 노무비 사람별 합계 */
export interface LaborPerson {
  key: string
  name: string
  types: string[]
  projects: string[]
  count: number
  total: number
  open: number
  bank: string | null
  account: string | null
  holder: string | null
}

export function laborPeople(list: Payment[]): LaborPerson[] {
  const map = new Map<string, LaborPerson>()
  for (const p of list) {
    const name = p.payee?.trim() || p.account_holder?.trim() || '이름 없음'
    const k = normName(name)
    const r = map.get(k) ?? { key: k, name, types: [], projects: [], count: 0, total: 0, open: 0, bank: null, account: null, holder: null }
    if (p.contract_type && !r.types.includes(p.contract_type)) r.types.push(p.contract_type)
    if (p.project_id && !r.projects.includes(p.project_id)) r.projects.push(p.project_id)
    if (isDone(p)) {
      r.count++
      r.total += p.amount
    } else if (isOpen(p)) r.open += p.amount
    if (p.account_no) {
      r.bank = p.bank_name
      r.account = p.account_no
      r.holder = p.account_holder
    }
    map.set(k, r)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.open - a.open)
}
