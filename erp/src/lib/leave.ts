import { addDays } from './date'
import type { LeaveRecord } from './types'

/** 연차에서 차감하는 휴가 (병가 · 경조사 · 기타는 차감하지 않음) */
export const DEDUCTS = (kind: LeaveRecord['kind']) => kind === '연차' || kind === '반차'

const ym = (key: string) => key.split('-').map(Number) as [number, number, number]

/** joined 부터 today 까지 꽉 채운 개월 수 */
export function fullMonths(joined: string, today: string): number {
  const [y1, m1, d1] = ym(joined)
  const [y2, m2, d2] = ym(today)
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0))
}

/** joined 에서 n년 뒤 같은 날 (2/29 입사는 2/28) */
function anniversary(joined: string, years: number): string {
  const [y, m, d] = ym(joined)
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate()
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export interface LeaveBalance {
  /** 근속 연수 (꽉 채운 해) */
  years: number
  /** 이번 연차 기간 (입사일 기준) */
  periodStart: string
  periodEnd: string
  /** 이번 기간 발생 연차 */
  granted: number
  /** 이번 기간 사용 (승인된 연차 · 반차) */
  used: number
  /** 승인 대기 중인 연차 · 반차 */
  pending: number
  remaining: number
  /** 계산 근거 한 줄 */
  rule: string
}

/**
 * 근로기준법 제60조 기준 연차 (입사일 기준 회계):
 * - 1년 미만: 1개월 개근마다 1일, 최대 11일 (입사일 ~ 1주년 전날)
 * - 1년 이상: 15일 + 최초 1년을 넘는 2년마다 1일 가산, 최대 25일 (매 입사 기념일 ~ 다음 기념일 전날)
 * 개근 여부·출근율 80% 미만은 반영하지 않음(전부 출근으로 가정).
 */
export function leaveBalance(joined: string, today: string, records: LeaveRecord[]): LeaveBalance {
  const months = fullMonths(joined, today)
  const years = Math.floor(months / 12)
  let periodStart: string
  let periodEnd: string
  let granted: number
  let rule: string
  if (years < 1) {
    periodStart = joined
    periodEnd = addDays(anniversary(joined, 1), -1)
    granted = Math.min(11, months)
    rule = `입사 1년 미만: 1개월 개근마다 1일 (${months}개월 → ${granted}일, 최대 11일)`
  } else {
    periodStart = anniversary(joined, years)
    periodEnd = addDays(anniversary(joined, years + 1), -1)
    granted = Math.min(25, 15 + Math.floor((years - 1) / 2))
    rule = `근속 ${years}년: 기본 15일${granted > 15 ? ` + 가산 ${granted - 15}일` : ''} (2년마다 1일, 최대 25일)`
  }
  const inPeriod = records.filter(r => DEDUCTS(r.kind) && r.start_date >= periodStart && r.start_date <= periodEnd)
  const used = sum(inPeriod.filter(r => r.status === '승인'))
  const pending = sum(inPeriod.filter(r => r.status === '신청'))
  return { years, periodStart, periodEnd, granted, used, pending, remaining: granted - used, rule }
}

const sum = (rs: LeaveRecord[]) => Math.round(rs.reduce((s, r) => s + Number(r.days), 0) * 10) / 10

/** 시작~종료 사이 평일 수 (주말 제외, 공휴일은 직접 조정) */
export function weekdaysBetween(start: string, end: string): number {
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (w !== 0 && w !== 6) n++
    if (n > 400) break
  }
  return n
}
