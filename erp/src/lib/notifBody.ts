// 알림 본문을 읽기 좋게 나눔 (2026-11-27 대표 지시 '보고를 읽기 좋게 만들어')
// AI 비서 보고처럼 여러 줄 · ' · ' 로 길게 이어진 글을 묶음 제목 · 항목 · 근거 줄로 나눈다. 글은 바꾸지 않고 나누기만 한다.

export type NotifLine =
  | { kind: 'head'; text: string }
  | { kind: 'item'; text: string; detail: string[]; late: boolean }
  | { kind: 'text'; text: string }

export interface NotifBody {
  lines: NotifLine[]
  /** 'AI 비서 자동 작성 · 사람 검수 전 · 근거: …' 같은 출처 줄 — 맨 아래 작게 */
  meta: string | null
}

const ITEM_RE = /^(?:[·•\-*]|\d{1,2}[).]|[①-⑳])\s*/
const META_RE = /^(AI 비서 자동 작성|AI 자동 작성|근거\s*:)/
const LATE_RE = /\d+\s*일\s*(지남|지연|째)|기한\s*지남/

/** 항목 한 줄: 첫 조각은 본문, 나머지 ' · ' 조각은 작은 부가 정보 */
function splitItem(text: string): { text: string; detail: string[] } {
  // '[프로젝트] 일 · 담당 · 마감' 꼴만 나눔 — '담당별: 이보아 3 · 박기호 1' 같은 줄은 그대로
  if (!text.startsWith('[')) return { text, detail: [] }
  const parts = text.split(/\s+·\s+/).map(s => s.trim()).filter(Boolean)
  if (parts.length <= 1) return { text, detail: [] }
  // '[프로젝트] 일 이름' 뒤에 오는 짧은 조각(담당 · 마감 등)은 부가 정보로
  return { text: parts[0], detail: parts.slice(1) }
}

export function parseNotifBody(body: string | null | undefined): NotifBody {
  const raw = (body ?? '').replace(/\r/g, '')
  const rows = raw.split('\n').map(s => s.trim()).filter(Boolean)
  let meta: string | null = null
  const lines: NotifLine[] = []
  rows.forEach((row, i) => {
    if (meta === null && META_RE.test(row)) {
      meta = row
      return
    }
    const m = ITEM_RE.exec(row)
    if (m) {
      const rest = row.slice(m[0].length).trim()
      if (!rest) return
      const { text, detail } = splitItem(rest)
      lines.push({ kind: 'item', text, detail, late: LATE_RE.test(rest) })
      return
    }
    if (/^■\s*/.test(row)) {
      lines.push({ kind: 'head', text: row.replace(/^■\s*/, '') })
      return
    }
    // 다음 줄이 항목이면 이 줄은 묶음 제목
    const next = rows[i + 1]
    if (next && ITEM_RE.test(next)) lines.push({ kind: 'head', text: row })
    else lines.push({ kind: 'text', text: row })
  })
  return { lines, meta }
}

/** 접힌 상태에서 보여 줄 줄 수 (제목 · 항목 합쳐) */
export const NOTIF_PREVIEW_LINES = 6
