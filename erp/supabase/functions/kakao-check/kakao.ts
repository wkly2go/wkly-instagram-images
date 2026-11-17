/**
 * 카카오톡 '대화 내용 내보내기' 파일 읽기 (로드맵 1-3 · 2026-11-11)
 *  - PC  : "--------------- 2026년 11월 10일 화요일 ---------------" 날짜 줄 + "[보낸이] [오후 3:24] 내용"
 *  - 안드로이드: "2026년 11월 10일 오후 3:24, 보낸이 : 내용"  (날짜 줄 "2026년 11월 10일 화요일")
 *  - 아이폰 : "2026. 11. 10. 오후 3:24, 보낸이 : 내용"  (날짜 줄 "2026년 11월 10일 화요일")
 *  - CSV  : "Date,User,Message" (PC 의 CSV 내보내기)
 *  - 내용이 여러 줄이면 다음 줄들은 앞 메시지에 이어 붙임
 */
export interface KakaoMsg {
  sent_at: string // ISO (한국 시각 기준)
  sender: string
  content: string
  /** '사진' '동영상' '파일: 이름' 등 첨부 표시 */
  attachment: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (y: number, mo: number, d: number, ampm: string | null, h: number, mi: number) => {
  let hh = h
  if (ampm === '오후' && hh < 12) hh += 12
  if (ampm === '오전' && hh === 12) hh = 0
  if (ampm === 'PM' && hh < 12) hh += 12
  if (ampm === 'AM' && hh === 12) hh = 0
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mi)}:00+09:00`
}

const ATTACH: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^사진(?:\s*\d+장)?$/, m => m[0]],
  [/^동영상$/, () => '동영상'],
  [/^이모티콘$/, () => '이모티콘'],
  [/^음성메시지$/, () => '음성메시지'],
  [/^파일:\s*(.+)$/, m => `파일: ${m[1]}`],
  [/^\S+\.(?:jpg|jpeg|png|gif|heic|webp|mp4|mov|pdf|xlsx?|docx?|pptx?|hwp|zip)$/i, m => `파일: ${m[0]}`],
]
const attachOf = (text: string) => {
  const t = text.trim()
  for (const [re, f] of ATTACH) {
    const m = t.match(re)
    if (m) return f(m)
  }
  return null
}

const RE_PC_DATE = /^-{5,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*?-{5,}\s*$/
const RE_PC_MSG = /^\[(.+?)\]\s*\[(오전|오후|AM|PM)\s*(\d{1,2}):(\d{2})\]\s?(.*)$/
const RE_AND = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s?(.*)$/
const RE_IOS = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s?(.*)$/
const RE_DAYLINE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\S*요일\s*$/
const RE_SYS_AND = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),?\s*(.+)$/
const RE_SYS_IOS = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2}):?\s*(.+)$/

function parseCsv(text: string): KakaoMsg[] {
  const out: KakaoMsg[] = []
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur || row.length) rows.push([...row, cur])
  for (const r of rows.slice(1)) {
    if (r.length < 3) continue
    const d = new Date(r[0].replace(' ', 'T') + (r[0].includes('+') ? '' : '+09:00'))
    if (isNaN(d.getTime())) continue
    const content = r.slice(2).join(',')
    out.push({ sent_at: d.toISOString(), sender: r[1].trim(), content, attachment: attachOf(content) })
  }
  return out
}

export function parseKakao(raw: string): { title: string; messages: KakaoMsg[] } {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const first = text.split('\n', 1)[0] ?? ''
  if (/^Date,User,Message/i.test(first)) return { title: '카카오톡 대화 (CSV)', messages: parseCsv(text) }
  const title = first.includes('카카오톡 대화') ? first.trim().slice(0, 100) : '카카오톡 대화'
  const out: KakaoMsg[] = []
  let day: [number, number, number] | null = null
  let last: KakaoMsg | null = null
  for (const line of text.split('\n')) {
    let m: RegExpMatchArray | null
    if ((m = line.match(RE_PC_DATE)) || (m = line.match(RE_DAYLINE))) {
      day = [Number(m[1]), Number(m[2]), Number(m[3])]
      last = null
      continue
    }
    if ((m = line.match(RE_PC_MSG)) && day) {
      last = { sent_at: toIso(day[0], day[1], day[2], m[2], Number(m[3]), Number(m[4])), sender: m[1].trim(), content: m[5], attachment: attachOf(m[5]) }
      out.push(last)
      continue
    }
    if ((m = line.match(RE_AND)) || (m = line.match(RE_IOS))) {
      last = { sent_at: toIso(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null, Number(m[5]), Number(m[6])), sender: m[7].trim(), content: m[8], attachment: attachOf(m[8]) }
      out.push(last)
      continue
    }
    // 들어옴 · 나감 같은 시스템 줄(보낸이 없음)은 건너뜀
    if (RE_SYS_AND.test(line) || RE_SYS_IOS.test(line)) {
      last = null
      continue
    }
    if (/^저장한 날짜\s*:|^Date Saved\s*:/.test(line)) continue
    if (last && line.trim()) {
      last.content += '\n' + line
      if (!last.attachment) last.attachment = attachOf(line)
    }
  }
  for (const msg of out) msg.content = msg.content.trimEnd()
  return { title, messages: out.filter(x => x.content || x.attachment) }
}

/** 같은 메시지를 두 번 올려도 한 번만 남게 하는 열쇠 */
export async function kakaoHash(m: KakaoMsg): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${m.sent_at}|${m.sender}|${m.content}`))
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
}
