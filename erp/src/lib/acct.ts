// 경리 · 회계 고도화 (2026-11-27 대표 지시 '우리 인트라넷에 경리 회계관련 전문성있게 고도화시켜')
// 장부 › '세무 · 결산' 탭이 쓰는 공통 타입 · 서버 API 정의 · 작은 도우미.
// 모든 산출물은 세무대리인 검토용 준비 자료다 — 신고 · 납부 · 이체 · 홈택스 로그인은 사람이 한다.
import type { CompanyKey } from './company'

export const ACCT_DISCLAIMER = '세무대리인 검토용 준비자료이며 세무 자문이 아닙니다.'

/** 세무 일정 한 줄 (서버 private.acct_tax_events 가 계산 — 규칙은 서버 한 곳에만) */
export type TaxEvent = {
  company: CompanyKey
  task_key: string
  /** wht 원천세 · ins 4대보험 · einv 세금계산서 발급 · daily 일용 · sbiz 3.3% 간이 · swage 근로 간이 · vat 부가세 · stmt 지급명세서 · hitotal · eitotal 보수총액 · cit 법인세 · lit 지방소득세 · citmid 중간예납 · res 주민세 */
  kind: string
  title: string
  period: string
  /** 법에 적힌 날짜 */
  base_date: string
  /** 주말 · 공휴일을 넘긴 실제 기한 */
  due_date: string
  prep: string
  basis: string
  note: string | null
  holidays_loaded: boolean
  done: boolean
  done_at: string | null
  memo: string | null
}

/** 회사별 회계 설정 (세무 일정 계산 기준 · 관리자 전용) */
export type AcctSettings = {
  company: CompanyKey
  withholding_cycle: '매월' | '반기'
  fiscal_end_month: number
  vat_filing: '예정신고' | '예정고지'
  has_payroll: boolean
  has_freelancers: boolean
  has_daily_workers: boolean
  bookkeeper: string
  payroll_day: number | null
  approval_limit: number | null
  alerts: boolean
  note: string
  source: string
  confirmed_at: string | null
  updated_at: string
}
export type AcctSettingsPatch = Partial<Pick<AcctSettings, 'withholding_cycle' | 'fiscal_end_month' | 'vat_filing' | 'has_payroll' | 'has_freelancers' | 'has_daily_workers' | 'bookkeeper' | 'payroll_day' | 'approval_limit' | 'alerts' | 'note'>>

/** 월 마감 기록 (장부를 연 동안만 읽고 씀) */
export type MonthClose = {
  company: CompanyKey
  month: string
  closed: boolean
  closed_at: string | null
  closed_by: string | null
  snapshot: CloseSnapshot
  note: string | null
  reopened_at: string | null
  updated_at: string
}
/** 마감 때 남겨 두는 숫자 */
export type CloseSnapshot = { rows?: number; inflow?: number; outflow?: number; review?: number; unclassified?: number; noEvidence?: number; breaks?: number }

export interface AcctApi {
  /** 기간 안 세무 일정 (관리자) */
  acctTaxCalendar(from: string, to: string): Promise<TaxEvent[]>
  /** 끝냄 · 되돌림 */
  acctTaxMark(company: CompanyKey, key: string, done: boolean, memo?: string | null): Promise<void>
  listAcctSettings(): Promise<AcctSettings[]>
  /** 고치면 대표 확인으로 기록 (confirmed_at) */
  saveAcctSettings(company: CompanyKey, patch: AcctSettingsPatch): Promise<void>
  /** 공휴일 (세무 기한 계산용) */
  listAcctHolidays(): Promise<{ day: string; name: string }[]>
  listMonthClose(): Promise<MonthClose[]>
  saveMonthClose(row: { company: CompanyKey; month: string; closed: boolean; snapshot?: CloseSnapshot; note?: string | null }): Promise<void>
}

/** 일정 종류 이름 (거르기 칩) */
export const TAX_KIND_LABEL: Record<string, string> = {
  vat: '부가세',
  wht: '원천세',
  ins: '4대보험',
  einv: '세금계산서 발급',
  sbiz: '간이지급 (3.3%)',
  swage: '간이지급 (근로)',
  daily: '일용 지급명세서',
  stmt: '지급명세서',
  hitotal: '보수총액',
  eitotal: '보수총액',
  cit: '법인세',
  lit: '지방소득세',
  citmid: '중간예납',
  res: '주민세',
}

/** 날짜 사이 일수 (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** 'D-3' · '오늘' · '3일 지남' */
export function dLabel(due: string, today: string): string {
  const d = daysBetween(today, due)
  if (d === 0) return '오늘'
  return d > 0 ? `D-${d}` : `${-d}일 지남`
}

/** 원 단위 정수 덧셈 (소수 · NaN 막기) */
export const sumOf = <T>(list: T[], f: (x: T) => number) => list.reduce((n, x) => n + (Number.isFinite(f(x)) ? Math.round(f(x)) : 0), 0)

/** 부가세 포함 금액 → 추정 세액 (10/110 · 원 미만 반올림) */
export const vatIn = (gross: number) => Math.round(gross / 11)

/** 그 달의 첫날 · 마지막 날 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

// ---------- 통장 잔액 순서 ----------
// 은행 거래내역 파일은 최근 거래가 위에 있어 같은 날 안에서는 장부 번호(id) 순서를 믿을 수 없다.
// 앞 잔액 ± 금액 = 다음 잔액이 되도록 같은 날 거래를 다시 줄 세운다.
export type BalanceRow = { id: number; entry_date: string; direction: '입금' | '출금'; amount: number; balance_after?: number | null }
export const balDelta = (r: BalanceRow) => (r.direction === '입금' ? r.amount : -r.amount)

/** 같은 날 거래를 잔액이 이어지는 순서로. 앞 잔액(prev)에서 이어지는 줄이 없으면 '끊김'으로 남기고 그날 첫 거래부터 다시 */
export function orderDay<T extends BalanceRow>(rows: T[], prev: number | null): { ordered: T[]; breaks: { row: T; expected: number }[] } {
  const left = [...rows]
  const ordered: T[] = []
  const breaks: { row: T; expected: number }[] = []
  let cur = prev
  while (left.length) {
    let i = cur == null ? -1 : left.findIndex(r => (cur as number) + balDelta(r) === r.balance_after)
    if (i < 0) {
      // 그날 첫 거래 = 다른 줄의 잔액에서 이어지지 않는 줄
      const start = left.findIndex(r => !left.some(o => o !== r && o.balance_after === (r.balance_after as number) - balDelta(r)))
      i = start < 0 ? 0 : start
      if (cur != null) breaks.push({ row: left[i], expected: cur + balDelta(left[i]) })
    }
    cur = left[i].balance_after as number
    ordered.push(left[i])
    left.splice(i, 1)
  }
  return { ordered, breaks }
}

/** 한 통장 줄들(잔액 칸 있는 것) → 시간 순 마지막 줄 */
export function lastBalanceRow<T extends BalanceRow>(rows: T[]): T | null {
  const days = new Map<string, T[]>()
  for (const r of rows) if (r.balance_after != null) days.set(r.entry_date, [...(days.get(r.entry_date) ?? []), r])
  let prev: number | null = null
  let last: T | null = null
  for (const d of [...days.keys()].sort()) {
    const { ordered } = orderDay(days.get(d) as T[], prev)
    last = ordered[ordered.length - 1]
    prev = last.balance_after as number
  }
  return last
}
