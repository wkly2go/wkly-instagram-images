// 재무 계산 (화면 공용). 수익성은 공급가액(VAT 별도) 기준, 지급·입금 목록은 실제 금액 기준.
import { addDays } from './date'
import { LABOR_TYPES, OPEN_PAYMENT_STATUSES, type BudgetLine, type Client, type Payment, type ProjectFinance } from './types'

/** 공급가액 = 금액 - 부가세 */
export const supply = (p: Pick<Payment, 'amount' | 'vat'>) => p.amount - p.vat
/** 실제 결제 대상 (예상 비용·취소 제외) 중 아직 끝나지 않은 것 */
export const isOpen = (p: Payment) => !p.is_estimate && OPEN_PAYMENT_STATUSES.includes(p.status)
export const isDone = (p: Payment) => !p.is_estimate && p.status === '완료'
export const isOverdue = (p: Payment, today: string) => isOpen(p) && !!p.due_date && p.due_date < today
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
  for (const p of payments) if (p.advance_by && p.direction === '지급' && isOpen(p)) map.set(p.advance_by, [...(map.get(p.advance_by) ?? []), p])
  return [...map.entries()].map(([by, items]) => ({ by, items, total: items.reduce((n, p) => n + p.amount, 0) })).sort((a, b) => b.total - a.total)
}

/** 노무비 대장 대상: 개인 노무비(사업소득·일용·4대보험) 또는 공사 구분이 노무비 */
export const isLabor = (p: Payment) => p.direction === '지급' && p.status !== '취소' && !p.is_estimate && (LABOR_TYPES.includes(p.contract_type as never) || (p.category ?? '').replace(/\s/g, '') === '노무비')
/** 인력업체(세금계산서 받는 업체) 지급분: 개인 노무비와 세무 처리가 다름 */
export const isAgency = (p: Payment) => isLabor(p) && !LABOR_TYPES.includes(p.contract_type as never)

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
