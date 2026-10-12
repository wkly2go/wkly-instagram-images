// CSV 만들기·내려받기 (엑셀에서 한글이 깨지지 않도록 BOM 포함)

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  // 수식으로 해석되는 값(=, +, -, @ 로 시작) 방지
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d[\d,.]*$/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  const cols = columns ?? [...new Set(rows.flatMap(r => Object.keys(r)))].map(k => ({ key: k, label: k }))
  const lines = [cols.map(c => cell(c.label)).join(','), ...rows.map(r => cols.map(c => cell(r[c.key])).join(','))]
  return '\uFEFF' + lines.join('\r\n')
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1500)
}

/** 아주 단순한 CSV 읽기 (따옴표·줄바꿈 지원) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter(r => r.some(c => c.trim()))
}
