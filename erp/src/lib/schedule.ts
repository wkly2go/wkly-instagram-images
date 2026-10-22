import type { AgentSchedule } from './types'

/** 한국 시각 'YYYY-MM-DD' + 'HH:MM' → Date */
const kstDate = (day: string, hm: string) => new Date(`${day}T${hm.slice(0, 5)}:00+09:00`)
const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** 다음 실행 시각 (DB 의 private.schedule_next 와 같은 규칙 · 체험 모드 · 미리 보기용) */
export function nextRun(s: Pick<AgentSchedule, 'repeat' | 'run_at' | 'time_of_day' | 'weekdays' | 'month_day'>, after = new Date()): Date | null {
  if (s.repeat === '한 번') return s.run_at && new Date(s.run_at) > after ? new Date(s.run_at) : null
  if (!s.time_of_day) return null
  const start = kstDay(after)
  for (let i = 0; i <= 62; i++) {
    const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10)
    const t = kstDate(day, s.time_of_day)
    if (t <= after) continue
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
    const last = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()
    if (
      s.repeat === '매일' ||
      (s.repeat === '평일' && dow >= 1 && dow <= 5) ||
      (s.repeat === '매주' && s.weekdays.includes(dow)) ||
      (s.repeat === '매월' && s.month_day != null && Number(day.slice(8)) === Math.min(s.month_day, last))
    )
      return t
  }
  return null
}

const WD = ['일', '월', '화', '수', '목', '금', '토']
/** '평일 09:00' · '매주 월 · 수 15:30' · '매월 25일 10:00' · '10/24 (금) 15:00' */
export function scheduleLabel(s: Pick<AgentSchedule, 'repeat' | 'run_at' | 'time_of_day' | 'weekdays' | 'month_day'>): string {
  const hm = s.time_of_day?.slice(0, 5) ?? ''
  if (s.repeat === '한 번') {
    if (!s.run_at) return '한 번'
    const d = new Date(new Date(s.run_at).getTime() + 9 * 3600_000)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WD[d.getUTCDay()]}) ${d.toISOString().slice(11, 16)}`
  }
  if (s.repeat === '매주') return `매주 ${[...s.weekdays].sort().map(w => WD[w]).join(' · ')} ${hm}`
  if (s.repeat === '매월') return `매월 ${s.month_day}일 ${hm}`
  return `${s.repeat} ${hm}`
}
export const WEEKDAY_LABELS = WD
