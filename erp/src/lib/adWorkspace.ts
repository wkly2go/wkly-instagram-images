export type AdRange = 7 | 14 | 30 | 'month'

/** URL에서 지원하는 기간만 사용하며, 비어 있거나 잘못된 값은 14일로 돌아갑니다. */
export function parseAdRange(value: string | null): AdRange {
  if (value === 'month') return 'month'
  if (value === '7') return 7
  if (value === '30') return 30
  return 14
}

// todayKey()가 전달한 한국 날짜를 시간대 변환 없이 달력 날짜로 계산합니다.
function shiftDay(key: string, offset: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** 오늘의 미완성 수치는 제외하고, 바로 앞의 같은 일수와 비교합니다. */
export function adPeriod(today: string, range: AdRange): { from: string; to: string; previousFrom: string; days: string[] } {
  const to = shiftDay(today, -1)
  const from = range === 'month' ? `${today.slice(0, 7)}-01` : shiftDay(to, 1 - range)
  const days: string[] = []
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day)
  return { from, to, previousFrom: shiftDay(from, -days.length), days }
}

/** YYYY-MM-DD 양끝을 포함합니다. 0원·0건 기록과 원본 순서는 그대로 유지합니다. */
export function selectAdRows<T extends { date: string; platform: string }>(rows: T[], from: string, to: string, platform: string | null): T[] {
  return rows.filter(row => row.date >= from && row.date <= to && (platform === null || row.platform === platform))
}
