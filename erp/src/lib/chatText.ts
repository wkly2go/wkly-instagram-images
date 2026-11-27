// 채팅 글(특히 AI 비서 보고)을 묶음 제목 · 항목 · 글 줄로 나눔 (2026-11-27 대표 지시 '읽기 쉽게 만들어서 보고해')
// 글은 바꾸지 않고 나누기만. 항목 표시('· ' '- ' '1)' '■ ')가 없으면 null → 예전처럼 그대로 보여 줌.

export type ChatBlock =
  | { kind: 'head'; text: string }
  | { kind: 'item'; text: string; mark: string | null }
  | { kind: 'text'; text: string }
  | { kind: 'gap' }

const ITEM_RE = /^(?:([·•\-*])|(\d{1,2})[).])\s+/
const HEAD_RE = /^(?:■\s*|#{1,3}\s+)/

export function chatBlocks(text: string): ChatBlock[] | null {
  const rows = text.replace(/\r/g, '').split('\n')
  if (!rows.some(r => ITEM_RE.test(r.trim()) || HEAD_RE.test(r.trim()))) return null
  const out: ChatBlock[] = []
  rows.forEach((raw, i) => {
    const row = raw.trim()
    if (!row) {
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap' })
      return
    }
    const h = HEAD_RE.exec(row)
    if (h) {
      out.push({ kind: 'head', text: row.slice(h[0].length).replace(/^\*\*(.+)\*\*$/, '$1') })
      return
    }
    const m = ITEM_RE.exec(row)
    if (m) {
      out.push({ kind: 'item', text: row.slice(m[0].length), mark: m[2] ? `${m[2]}.` : null })
      return
    }
    const next = rows.slice(i + 1).find(r => r.trim())?.trim()
    const bold = /^\*\*(.+)\*\*:?$/.exec(row)
    if (bold || (next && ITEM_RE.test(next) && row.length <= 40 && !/[.!?。]$/.test(row))) {
      out.push({ kind: 'head', text: bold ? bold[1] : row.replace(/:$/, '') })
      return
    }
    out.push({ kind: 'text', text: row })
  })
  while (out.length && out[out.length - 1].kind === 'gap') out.pop()
  return out
}
