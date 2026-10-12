// 모든 날짜는 한국 시간(Asia/Seoul) 기준

const TZ = 'Asia/Seoul'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

/** 'YYYY-MM-DD' (KST) */
export function toDateKey(d: Date | string): string {
  return ymd.format(typeof d === 'string' ? new Date(d) : d)
}

export function todayKey(): string {
  return toDateKey(new Date())
}

/** 'YYYY-MM-DD' ± n일 */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export function weekday(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** '2026.10.12 (월)' */
export function dateLabel(key: string): string {
  return `${key.replace(/-/g, '.')} (${weekday(key)})`
}

/** '10.12' */
export function shortDate(key: string | null | undefined): string {
  if (!key) return ''
  return key.slice(5).replace('-', '.')
}

/** 'HH:mm' (KST) */
export function timeLabel(iso: string): string {
  return hm.format(new Date(iso))
}

/** 오늘이면 'HH:mm', 어제면 '어제', 그 외 'MM.DD' */
export function relativeLabel(iso: string): string {
  const key = toDateKey(iso)
  const today = todayKey()
  if (key === today) return timeLabel(iso)
  if (key === addDays(today, -1)) return '어제'
  return shortDate(key)
}

/** '2026.10.12 10:44' */
export function dateTimeLabel(iso: string): string {
  return `${toDateKey(iso).replace(/-/g, '.')} ${timeLabel(iso)}`
}

/** 이번 주(일~토) 범위 */
export function weekRange(key: string): [string, string] {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return [addDays(key, -dow), addDays(key, 6 - dow)]
}

/** 'YYYY-MM' 달의 달력 칸 (일요일 시작, null = 빈 칸) */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + n, 1))
  return dt.toISOString().slice(0, 7)
}

/** 분 → '2시간 40분' */
export function minutesLabel(min: number): string {
  if (!min) return '0분'
  const h = Math.floor(min / 60)
  const m = min % 60
  return [h ? `${h}시간` : '', m ? `${m}분` : ''].filter(Boolean).join(' ')
}

export function won(n: number | null | undefined): string {
  return n == null ? '' : `${n.toLocaleString('ko-KR')}원`
}
