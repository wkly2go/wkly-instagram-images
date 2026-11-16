/**
 * 위쪽 바 기념일 · 이벤트 (대표 지시 2026-11-16)
 * '생일이면 생일축하 이벤트 디자인 · 크리스마스 한달전에는 크리스마스디자인 등 기념일과 이벤트에 반응하는 디자인'
 *
 * 날짜(한국 시각)와 서버가 준 오늘의 생일 · 입사 기념일 · 회사 기념일로 오늘 보여 줄 이벤트 하나를 고른다.
 * 우선순위: 생일 > 회사 기념일 > 입사 기념일 > 크리스마스 당일·이브 > 설 · 추석 > 새해 > 국경일 > 크리스마스 시즌 > 연말
 */
export type TopbarTheme = 'birthday' | 'christmas' | 'newyear' | 'yearend' | 'seollal' | 'chuseok' | 'anniversary' | 'holiday'

export type TopbarEventData = {
  birthdays: { id: string; name: string }[]
  anniversaries: { id: string; name: string; years: number }[]
  /** app_settings 'topbar_events' — 회사 창립일 등. date 는 'MM-DD' (매년) 또는 'YYYY-MM-DD' (그날만) */
  custom: { date: string; title: string; since?: number; theme?: TopbarTheme }[]
}

export type TopbarEvent = { key: string; theme: TopbarTheme; title: string; short: string; link?: string }

export const EMPTY_TOPBAR_DATA: TopbarEventData = { birthdays: [], anniversaries: [], custom: [] }

/** 설 · 추석 (양력 · 연휴 첫날 ~ 끝날 · 당일). 한국천문연구원 월력 기준 공휴일 */
const LUNAR: Record<number, { seollal: [string, string, string]; chuseok: [string, string, string] }> = {
  2027: { seollal: ['02-06', '02-07', '02-09'], chuseok: ['09-14', '09-15', '09-16'] },
  2028: { seollal: ['01-26', '01-27', '01-28'], chuseok: ['10-02', '10-03', '10-05'] },
  2029: { seollal: ['02-12', '02-13', '02-14'], chuseok: ['09-21', '09-22', '09-24'] },
  2030: { seollal: ['02-02', '02-03', '02-05'], chuseok: ['09-11', '09-12', '09-13'] },
}

const HOLIDAYS: Record<string, string> = {
  '03-01': '삼일절',
  '05-05': '어린이날',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
}

/** 한국 시각 오늘 'YYYY-MM-DD' */
export function seoulToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

function dayNum(iso: string): number {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / 86_400_000)
}

function names(list: { name: string }[]): string {
  const n = list.map(p => p.name)
  return n.length <= 2 ? n.join(' · ') : `${n.slice(0, 2).join(' · ')} 외 ${n.length - 2}명`
}

/** 오늘 보여 줄 이벤트 하나 (없으면 null) */
export function pickTopbarEvent(today: string, data: TopbarEventData = EMPTY_TOPBAR_DATA, meId?: string): TopbarEvent | null {
  const year = Number(today.slice(0, 4))
  const md = today.slice(5)
  const t = dayNum(today)
  const on = (mmdd: string) => dayNum(`${year}-${mmdd}`)

  if (data.birthdays.length) {
    const mine = meId && data.birthdays.some(p => p.id === meId)
    const others = data.birthdays.filter(p => p.id !== meId)
    const me = data.birthdays.find(p => p.id === meId)
    const title = mine && !others.length
      ? `${me!.name}님, 생일 축하드려요! 오늘 하루 행복하세요`
      : `오늘은 ${names(data.birthdays)}님 생일이에요 · 축하 한마디 남겨 주세요`
    return { key: `birthday-${today}`, theme: 'birthday', title, short: '생일 축하해요', link: mine && !others.length ? undefined : '/chat' }
  }

  for (const c of data.custom ?? []) {
    if (!c?.date || !c?.title) continue
    const hit = c.date.length === 5 ? c.date === md : c.date === today
    if (!hit) continue
    const years = c.since && c.date.length === 5 ? year - c.since : 0
    const title = years > 0 ? `${c.title} ${years}주년` : c.title
    return { key: `custom-${today}-${c.title}`, theme: c.theme ?? 'anniversary', title: `오늘은 ${title}이에요`, short: title }
  }

  if (data.anniversaries.length) {
    const a = data.anniversaries
    const title = a.length === 1 ? `${a[0].name}님 입사 ${a[0].years}주년을 축하해요` : `${names(a)}님 입사 기념일을 축하해요`
    return { key: `anniv-${today}`, theme: 'anniversary', title, short: '입사 기념일', link: '/chat' }
  }

  if (md === '12-25') return { key: `xmas-${year}`, theme: 'christmas', title: '메리 크리스마스! 따뜻한 하루 보내세요', short: '메리 크리스마스' }
  if (md === '12-24') return { key: `xmas-eve-${year}`, theme: 'christmas', title: '크리스마스 이브예요 · 오늘은 일찍 마무리해요', short: '크리스마스 이브' }

  const lunar = LUNAR[year]
  if (lunar) {
    for (const [kind, [start, day, end]] of [['seollal', lunar.seollal], ['chuseok', lunar.chuseok]] as const) {
      const s = on(start), d = on(day), e = on(end)
      const label = kind === 'seollal' ? '설' : '추석'
      if (t >= s - 5 && t < s) return { key: `${kind}-${year}-pre`, theme: kind, title: `${label} 연휴까지 D-${s - t} · 고향 가는 길 미리 챙기세요`, short: `${label} D-${s - t}` }
      if (t >= s && t <= e) {
        const title = kind === 'seollal' ? (t === d ? '새해 복 많이 받으세요 · 설날이에요' : '즐거운 설 연휴 보내세요') : (t === d ? '풍성한 한가위 보내세요' : '즐거운 추석 연휴 보내세요')
        return { key: `${kind}-${year}`, theme: kind, title, short: label }
      }
    }
  }

  if (md >= '01-01' && md <= '01-07') return { key: `newyear-${year}`, theme: 'newyear', title: `${year}년 새해 복 많이 받으세요`, short: `${year} 새해` }

  if (HOLIDAYS[md]) return { key: `holiday-${today}`, theme: 'holiday', title: `오늘은 ${HOLIDAYS[md]}이에요`, short: HOLIDAYS[md] }

  // 크리스마스 한 달 전(11/25)부터
  const xmas = on('12-25')
  if (t >= xmas - 30 && t < xmas) return { key: `xmas-season-${year}`, theme: 'christmas', title: `크리스마스까지 D-${xmas - t}`, short: `성탄 D-${xmas - t}` }

  if (md >= '12-26') return { key: `yearend-${year}`, theme: 'yearend', title: `${year}년 한 해 수고 많으셨어요`, short: '한 해 수고 많으셨어요' }

  return null
}

/** 미리 보기용 (주소 ?topbar=birthday 등 · 이 탭에서만) */
export function previewTopbarEvent(theme: string, today: string): TopbarEvent | null {
  const y = today.slice(0, 4)
  const samples: Record<string, TopbarEvent> = {
    birthday: { key: 'p-birthday', theme: 'birthday', title: '오늘은 김하늘님 생일이에요 · 축하 한마디 남겨 주세요', short: '생일 축하해요', link: '/chat' },
    christmas: { key: 'p-xmas', theme: 'christmas', title: '크리스마스까지 D-30', short: '성탄 D-30' },
    newyear: { key: 'p-ny', theme: 'newyear', title: `${Number(y) + 1}년 새해 복 많이 받으세요`, short: '새해' },
    yearend: { key: 'p-ye', theme: 'yearend', title: `${y}년 한 해 수고 많으셨어요`, short: '연말' },
    seollal: { key: 'p-sl', theme: 'seollal', title: '즐거운 설 연휴 보내세요', short: '설' },
    chuseok: { key: 'p-cs', theme: 'chuseok', title: '풍성한 한가위 보내세요', short: '추석' },
    anniversary: { key: 'p-an', theme: 'anniversary', title: '오늘은 더위클리 창립 1주년이에요', short: '창립 1주년' },
    holiday: { key: 'p-ho', theme: 'holiday', title: '오늘은 한글날이에요', short: '한글날' },
  }
  return samples[theme] ?? null
}
