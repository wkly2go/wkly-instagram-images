/**
 * 휴대폰에서 모든 기록지 표를 위아래(카드)로 (대표 지시 2026-11-04 "모든 기록지의 텍스트 배치는 상하로")
 *  - 표 머리(th)의 글을 읽어 각 칸에 data-label 을 붙이고, 표에 data-stack 을 붙임
 *  - 머리가 두 줄(rowSpan · colSpan)인 표도 칸 위치를 계산해 '금일 · 주간' 처럼 붙임
 *  - 화면 배치는 styles.css 의 table[data-stack] (640px 이하에서만)
 */
const SELECTOR = 'table.table, table.ledger-table, table.site-table, table.vendor-sum, table.pay-groups, table.brief-nums'

const clean = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim()
  // '공 종' · '총 합 계' 처럼 한 글자씩 띄운 머리는 붙여서
  return /^(\S )+\S$/.test(s) ? s.replace(/ /g, '') : s
}

/** 행들을 격자로 펼쳐 칸마다 [시작 열, 열 수] 를 구함 (rowSpan · colSpan 반영) */
function layout(rows: HTMLTableRowElement[]) {
  const taken: number[][] = []
  const out: { cell: HTMLTableCellElement; col: number; span: number; row: number }[] = []
  rows.forEach((tr, r) => {
    let c = 0
    for (const cell of Array.from(tr.cells)) {
      while (taken[r]?.[c]) c++
      const span = Math.max(1, cell.colSpan || 1)
      const rs = Math.max(1, cell.rowSpan || 1)
      for (let i = 0; i < rs; i++) for (let j = 0; j < span; j++) (taken[r + i] ??= [])[c + j] = 1
      out.push({ cell, col: c, span, row: r })
      c += span
    }
  })
  return out
}

function label(table: HTMLTableElement) {
  const head = table.tHead ? Array.from(table.tHead.rows) : []
  if (!head.length) return
  const names: string[][] = []
  for (const { cell, col, span } of layout(head)) {
    const t = clean(cell.textContent ?? '')
    if (!t) continue
    for (let j = 0; j < span; j++) {
      const list = (names[col + j] ??= [])
      if (!list.includes(t)) list.push(t)
    }
  }
  const nameOf = (col: number) => (names[col] ?? []).join(' · ')
  const sig = names.map(n => n?.join('|') ?? '').join('/')
  const bodies = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]
  for (const body of bodies) {
    for (const { cell, col } of layout(Array.from(body.rows))) {
      const l = nameOf(col)
      if (cell.getAttribute('data-label') !== l) cell.setAttribute('data-label', l)
    }
  }
  if (table.dataset.stack !== sig) table.dataset.stack = sig || '1'
}

export function startStackTables() {
  if (typeof document === 'undefined') return
  let queued = false
  const run = () => {
    queued = false
    document.querySelectorAll<HTMLTableElement>(SELECTOR).forEach(t => {
      try {
        label(t)
      } catch {
        /* 표 하나가 이상해도 나머지는 계속 */
      }
    })
  }
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
  }
  // 내가 붙인 속성 변화에는 반응하지 않도록 자식 · 글자 변화만 봄
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, characterData: true })
  queue()
}
