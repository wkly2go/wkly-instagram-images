/**
 * 모든 카드 접기 (대표 지시 2026-11-28 '모든 카드는 접을 수 있게 만들고 기본은 접은 상태야' · 범위 확인: 인트라넷 전체 카드)
 *  - 제목 줄(.section-h 등)이 있는 묶음은 제목만 보이고, 제목을 누르면 펼쳐짐 · 다시 누르면 접힘
 *  - 펼친 것은 이 브라우저에 기억(localStorage wkly-card-open · 화면 주소 + 제목) → 다음에 열어도 펼쳐져 있음
 *  - 알림 · 링크로 특정 항목을 열 때(주소에 id 등)는 그 화면에서 접지 않음 — 찾는 것이 가려지지 않게
 *  - React 가 그린 요소에는 data-* 표시만 붙임(요소를 넣거나 빼지 않음) · 모양은 mono.css [data-fold-head]
 */
const HEAD = '.section-h, .section-head, .sec-head, .week-day-h, .dash-card > :first-child, .div-card > :first-child, .board-head, .home-tasks-h, .guide-card-h, .myproj-h, .log-div-head, .weekly-div-head, .mf-h, .auto-camp-head, .md-head, .md-library-head, section.sales-pipe > h2:first-child, .card > h3:first-child, .box > h3:first-child, .box > h2:first-child'
const SKIP = '.modal, .dialog, .modal-col, .scrim, .board-page, .ast-panel, .chat-dock, .profile, .weekly-print, [data-no-fold]'
/** 제목 줄이 없는 묶음(숫자 카드 줄 · 오른쪽 일정 칸): 묶음 위에 이름 띠를 CSS 로 그려 그것을 눌러 접고 폄 */
const GROUPS: [string, string][] = [['.dash-kpis, .kpis, .home-kpis, .ledger-kpis, .weekly-kpis', '숫자 요약'], ['.right-sched', '일정']]
const KEY = 'wkly-card-open'
/** 주소에 이런 값이 있으면 특정 항목을 여는 길 → 접지 않음 */
const DIRECT = /[?&](id|inquiry|interview|item|task|project|open|room|thread|week|user)=/

export const cardKey = (path: string, title: string) => `${path}|${title.replace(/\s+/g, ' ').trim().slice(0, 60)}`
/** 제목 줄 글에서 숫자 배지 · 오른쪽 링크를 뺀 이름 */
export function headTitle(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/(전체 보기|전체|모두 보기|달력으로|할 일 보기)\s*[›>]?\s*$/u, '').replace(/\s*\d+\s*$/u, '').trim()
}
export function readOpen(raw: string | null): Record<string, 1> {
  try { const v = JSON.parse(raw ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
/** 기억은 400개까지 (오래된 것부터 버림) */
export function setOpen(map: Record<string, 1>, key: string, open: boolean): Record<string, 1> {
  const next = { ...map }
  if (open) next[key] = 1
  else delete next[key]
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete next[k]
  return next
}

function load(): Record<string, 1> { try { return readOpen(localStorage.getItem(KEY)) } catch { return {} } }
function save(m: Record<string, 1>) { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* 저장 못 해도 동작 */ } }

function titleOf(head: HTMLElement): string {
  const t = head.querySelector<HTMLElement>('.section-title, h1, h2, h3, h4, b, strong')
  return headTitle((t ?? head).textContent ?? '')
}

function apply(head: HTMLElement, folded: boolean) {
  head.dataset.foldHead = folded ? '1' : '0'
  head.setAttribute('aria-expanded', folded ? 'false' : 'true')
  const parent = head.parentElement
  if (!parent) return
  // 제목이 묶음의 첫 줄이면 묶음 전체를, 아니면 다음 제목 전까지의 형제를 접음
  if (parent.firstElementChild === head && !parent.matches('.main, .inner, .page, .app-page, .body, [data-fold-root]') && [...parent.children].filter(c => c.matches(HEAD)).length <= 1) {
    if (folded) parent.dataset.cardFold = '1'
    else delete parent.dataset.cardFold
    return
  }
  let n = head.nextElementSibling as HTMLElement | null
  while (n && !n.matches(HEAD)) {
    if (folded) n.dataset.cardHidden = '1'
    else delete n.dataset.cardHidden
    n = n.nextElementSibling as HTMLElement | null
  }
}

function scan() {
  const roots = [...document.querySelectorAll<HTMLElement>('.app-page .main, .app-page .web-panel')]
  if (!roots.length) return
  const direct = DIRECT.test(location.search)
  const open = load()
  const path = location.pathname + (new URLSearchParams(location.search).get('tab') ? `?tab=${new URLSearchParams(location.search).get('tab')}` : '')
  for (const [sel, label] of GROUPS) roots.forEach(root => root.querySelectorAll<HTMLElement>(sel).forEach((g, i) => {
    if (g.closest(SKIP) || g.parentElement?.closest('[data-fold-group]')) return
    const key = cardKey(path, `${label} ${i + 1}`)
    g.dataset.foldKey = key
    g.dataset.foldLabel = label
    if (g.dataset.foldGroup === undefined) g.dataset.foldGroup = direct || open[key] ? '0' : '1'
  }))
  roots.forEach(main => main.querySelectorAll<HTMLElement>(HEAD).forEach(head => {
    if (head.closest(SKIP)) return
    const title = titleOf(head)
    if (!title) return
    const key = cardKey(path, title)
    head.dataset.foldKey = key
    const want = direct ? false : !open[key]
    // 이미 같은 상태면 형제 표시만 다시 맞춤 (새로 그려진 줄이 있을 수 있음)
    apply(head, head.dataset.foldHead === undefined ? want : head.dataset.foldHead === '1')
  }))
}

export function startFoldCards() {
  if (typeof document === 'undefined') return
  let queued = false
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; scan() })
  }
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true })
  queue()
  const toggle = (head: HTMLElement) => {
    const folded = head.dataset.foldHead !== '1'
    apply(head, folded)
    if (head.dataset.foldKey) save(setOpen(load(), head.dataset.foldKey, !folded))
  }
  document.addEventListener('click', e => {
    const t = e.target as HTMLElement | null
    // 이름 띠(묶음의 ::before)를 누른 것 = 묶음 자신이 눌린 것
    if (t?.dataset.foldGroup !== undefined && e.target === t) {
      const folded = t.dataset.foldGroup !== '1'
      t.dataset.foldGroup = folded ? '1' : '0'
      if (t.dataset.foldKey) save(setOpen(load(), t.dataset.foldKey, !folded))
      return
    }
    const head = t?.closest<HTMLElement>('[data-fold-head]')
    if (!head || t?.closest('a, button, input, select, textarea, label, [role="button"]')) return
    toggle(head)
  })
  document.addEventListener('keydown', e => {
    const head = (e.target as HTMLElement | null)?.matches?.('[data-fold-head]') ? (e.target as HTMLElement) : null
    if (head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(head) }
  })
}
