import { addDays, todayKey } from './date'

/**
 * 채팅 입력칸 / 명령 (2026-10-23 "손에 붙게")
 *  /할일 사진 셀렉 @김하늘 내일 3시   → 할 일 (담당 · 마감 · 알람)
 *  /일정 현장 미팅 10/28 14:00        → 일정 (달력)
 *  /결재 촬영 소품 구매                → 보고서 결제
 *  /ai 다음 주 수금 정리해줘            → AI 총괄에게 (이 방에서 답함)
 *  /파일                               → 파일 올리기
 */
export const SLASH = [
  { cmd: '할일', hint: '할 일 만들기 · @담당 · 내일 3시', example: '/할일 현장 사진 셀렉 @김하늘 내일 6시' },
  { cmd: '일정', hint: '달력에 일정 넣기 · 날짜 · 시간', example: '/일정 현장 미팅 10/28 14:00' },
  { cmd: '결재', hint: '보고서 결제 올리기', example: '/결재 촬영 소품 구매' },
  { cmd: 'ai', hint: 'AI 총괄에게 시키기 (이 방에서 답함)', example: '/ai 이번 주 할 일 정리해줘' },
  { cmd: '파일', hint: '파일 · 사진 올리기', example: '/파일' },
] as const
export type SlashCmd = (typeof SLASH)[number]['cmd']

/** 입력 중인 / 명령 고르기 목록 (첫 단어만 칠 때) */
export function slashMenu(text: string) {
  const m = /^\/(\S*)$/.exec(text)
  if (!m) return []
  const k = m[1].toLowerCase()
  return SLASH.filter(s => s.cmd.toLowerCase().startsWith(k) || (k === '할' && s.cmd === '할일'))
}

export function parseSlash(text: string): { cmd: SlashCmd; rest: string } | null {
  const m = /^\/(할일|할 일|일정|결재|ai|AI|파일)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  const cmd = (m[1] === '할 일' ? '할일' : m[1].toLowerCase() === 'ai' ? 'ai' : m[1]) as SlashCmd
  return { cmd, rest: (m[2] ?? '').trim() }
}

export interface Parsed {
  title: string
  assigneeId: string | null
  date: string | null
  /** HH:MM (24시) */
  time: string | null
}

/** 제목에서 @담당 · 날짜 · 시간을 떼어 냄 */
export function parseTaskText(rest: string, people: { id: string; name: string }[], today = todayKey()): Parsed {
  let s = ` ${rest} `
  let assigneeId: string | null = null
  // @이름: 긴 이름부터 (예: '김하늘' 이 '김하' 보다 먼저)
  for (const p of [...people].filter(p => p.name.trim()).sort((a, b) => b.name.length - a.name.length)) {
    const at = s.indexOf(`@${p.name}`)
    if (at >= 0) {
      assigneeId = p.id
      s = s.slice(0, at) + ' ' + s.slice(at + p.name.length + 1)
      break
    }
  }
  let date: string | null = null
  const take = (re: RegExp, fn: (m: RegExpExecArray) => string | null) => {
    const m = re.exec(s)
    if (!m) return
    const v = fn(m)
    if (v) {
      date = v
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)
    }
  }
  const y = Number(today.slice(0, 4))
  const ymd = (yy: number, mm: number, dd: number) => (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` : null)
  take(/\s(\d{4})-(\d{1,2})-(\d{1,2})\s/, m => ymd(+m[1], +m[2], +m[3]))
  if (!date) take(/\s(\d{1,2})[/.](\d{1,2})\s/, m => {
    const v = ymd(y, +m[1], +m[2])
    return v && v < addDays(today, -60) ? ymd(y + 1, +m[1], +m[2]) : v // 지난 달 훨씬 전이면 내년
  })
  if (!date) take(/\s(\d{1,2})월\s?(\d{1,2})일\s/, m => ymd(y, +m[1], +m[2]))
  if (!date) take(/\s(오늘|내일|모레)\s/, m => addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m[1] as '오늘' | '내일' | '모레']))
  if (!date) take(/\s다음\s?주\s/, () => {
    const dow = new Date(`${today}T00:00:00`).getDay()
    return addDays(today, dow === 0 ? 1 : 8 - dow) // 다음 주 월요일
  })
  let time: string | null = null
  const tm = /\s(오전|오후)?\s?(\d{1,2})(?::(\d{2})|시(?:\s?(\d{1,2})분|\s?반)?)\s/.exec(s)
  if (tm) {
    let h = +tm[2]
    const min = tm[3] ? +tm[3] : tm[4] ? +tm[4] : /반\s$/.test(tm[0]) ? 30 : 0
    if (tm[1] === '오후' && h < 12) h += 12
    else if (!tm[1] && !tm[3] && h >= 1 && h <= 7) h += 12 // '3시' 는 보통 오후 3시
    if (h <= 23 && min <= 59) {
      time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
      s = s.slice(0, tm.index) + ' ' + s.slice(tm.index + tm[0].length)
    }
  }
  if (time && !date) date = today
  return { title: s.replace(/\s+/g, ' ').trim(), assigneeId, date, time }
}

/** 날짜 + 시각 → 알람 시각 (한국 시간) */
export function remindIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`).toISOString()
}
