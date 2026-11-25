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

/** 매체가 '전환' 칸에 넣는 값의 이름. Google 은 전환(페이지 조회 포함), 그 밖(메타 · 네이버 자동 수집)은 문의 건수입니다. */
export function resultLabel(platform: string): '전환' | '문의' {
  return platform === 'Google' ? '전환' : '문의'
}

/** 문의 합계와 문의당 비용. 전환 기준이 다른 Google 은 섞지 않습니다. 문의가 없으면 비용은 null. */
export function inquiryTotals<T extends { platform: string; cost: number | null; conversions: number | string | null }>(rows: T[]): { inquiries: number; cost: number; costPer: number | null; googleConversions: number } {
  let inquiries = 0, cost = 0, googleConversions = 0
  for (const row of rows) {
    const n = Number(row.conversions ?? 0) || 0
    if (row.platform === 'Google') { googleConversions += n; continue }
    inquiries += n
    cost += row.cost ?? 0
  }
  return { inquiries, cost, costPer: inquiries > 0 ? cost / inquiries : null, googleConversions }
}

export type AdFreshness = { state: 'none' } | { state: 'fresh'; last: string } | { state: 'stale'; last: string; gapDays: number }

/** 마지막 기록 날짜가 어제에서 며칠 떨어졌는지. 하루 늦는 것까지는 정상으로 봅니다(매체 집계 지연). */
export function adFreshness(last: string | null, today: string): AdFreshness {
  if (!last) return { state: 'none' }
  const yesterday = shiftDay(today, -1)
  const gapDays = Math.round((Date.parse(`${yesterday}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000)
  return gapDays <= 1 ? { state: 'fresh', last } : { state: 'stale', last, gapDays }
}
