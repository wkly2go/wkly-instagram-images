/**
 * 휴대폰에서 긴 글 접기 (대표 지시 2026-11-04 "모바일에서 긴 게시물 접을 수 있게")
 *  - 본문 칸(.pre · 채팅 말풍선 · 메모 등)이 길면 처음 몇 줄만 보이고 아래에 '더 보기 ▾'
 *  - 아래쪽 '더 보기' / '접기 ▴' 를 누르면 펼침 · 접힘 (링크 · 버튼을 누른 것은 그대로 동작)
 *  - 화면 배치는 styles.css 의 [data-fold] (640px 이하에서만)
 */
const SELECTOR = '.pre, .cell-pre, .memo-text, .bubble, .note'
const LIMIT = 260 // 이보다 길면 접음 (px)
const mobile = () => window.matchMedia('(max-width: 640px)').matches

/** 글 뒤 바탕색: 접힌 끝을 그 색으로 흐리게 */
function bgOf(el: HTMLElement): string {
  let n: HTMLElement | null = el
  while (n) {
    const c = getComputedStyle(n).backgroundColor
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
    n = n.parentElement
  }
  return '#fff'
}

function scan() {
  const on = mobile()
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach(el => {
    // 접힌 글 안의 또 다른 글 칸은 건너뜀 (겹쳐 접히지 않게) · 입력칸 안은 제외
    if (el.parentElement?.closest('[data-fold]') || el.closest('textarea, [contenteditable], .modal-edit')) return
    const state = el.dataset.fold
    if (!on) {
      if (state) delete el.dataset.fold
      return
    }
    if (state === 'open') return
    const full = el.scrollHeight
    if (full > LIMIT) {
      if (state !== '1') {
        el.dataset.fold = '1'
        el.style.setProperty('--fold-bg', bgOf(el))
      }
    } else if (state === '1' && full <= LIMIT) {
      delete el.dataset.fold
    }
  })
}

export function startFoldLong() {
  if (typeof document === 'undefined') return
  let queued = false
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      scan()
    })
  }
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, characterData: true })
  window.addEventListener('resize', queue)
  // 아래쪽 '더 보기' · '접기' 자리를 누르면 펼치고 접음
  document.addEventListener('click', e => {
    const t = e.target as HTMLElement | null
    const el = t?.closest<HTMLElement>('[data-fold]')
    if (!el || t?.closest('a, button, input, select, textarea, label')) return
    const r = el.getBoundingClientRect()
    if (e.clientY < r.bottom - 48) return
    e.preventDefault()
    e.stopPropagation()
    if (el.dataset.fold === 'open') {
      el.dataset.fold = '1'
      // 접으면 글 머리가 화면에 보이도록
      if (el.getBoundingClientRect().top < 60) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    } else el.dataset.fold = 'open'
  }, true)
  queue()
}
