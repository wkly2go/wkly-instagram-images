import type { KeyboardEvent } from 'react'

/**
 * 번호 · 글머리 목록 자동 이어쓰기 (대표 지시 2026-11-16 '숫자 자동으로 연속 연장')
 *  - 줄바꿈(Shift+Enter)할 때 지금 줄이 '1. ' · '1) ' · '- ' · '· ' 로 시작하면 다음 줄에 다음 번호 · 같은 글머리를 넣음
 *  - 번호만 있고 내용이 빈 줄에서 줄바꿈하면 그 번호를 지움(목록 끝)
 * 처리했으면 true (호출한 쪽은 그대로 return)
 */
export function continueList(e: KeyboardEvent<HTMLTextAreaElement>, setValue: (v: string) => void, max = 4000): boolean {
  if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing) return false
  const box = e.currentTarget
  const { selectionStart: at, selectionEnd: end, value } = box
  if (at !== end) return false
  const lineStart = value.lastIndexOf('\n', at - 1) + 1
  const line = value.slice(lineStart, at)
  const m = line.match(/^(\s*)(?:(\d{1,3})([.)])|([-·•*]))\s+(.*)$/)
  if (!m) return false
  e.preventDefault()
  const [, indent, num, sep, bullet, rest] = m
  let next: string
  let caret: number
  if (!rest.trim()) {
    // 빈 항목 → 목록 끝
    next = value.slice(0, lineStart) + value.slice(at)
    caret = lineStart
  } else {
    const mark = num ? `${Number(num) + 1}${sep} ` : `${bullet} `
    const add = `\n${indent}${mark}`
    if (value.length + add.length > max) return true
    next = value.slice(0, at) + add + value.slice(at)
    caret = at + add.length
  }
  // 화면 값과 커서를 먼저 맞추고 상태를 따라가게 함 (빨리 치면 커서가 밀리는 것 방지)
  box.value = next
  box.setSelectionRange(caret, caret)
  setValue(next)
  return true
}
