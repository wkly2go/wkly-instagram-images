import type { TextareaHTMLAttributes } from 'react'
import { continueList, trimEmptyItem } from '../lib/listInput'

/**
 * 메모 칸 — 번호 입력이 기본 (대표 지시 2026-11-18 '번호입력 기본값으로')
 *  - 빈 칸을 누르면 '1. ' 로 시작 · Enter 로 줄을 바꾸면 다음 번호 (번호 없는 줄은 그냥 줄바꿈)
 *  - 빈 번호 줄에서 Enter → 목록 끝 · 칸을 떠날 때 내용 없는 번호는 지움
 */
export function ListTextarea({ value, onValue, maxLength = 2000, onFocus, onBlur, onKeyDown, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onValue: (v: string) => void }) {
  return (
    <textarea
      {...rest}
      value={value}
      maxLength={maxLength}
      onChange={e => onValue(e.target.value)}
      onFocus={e => {
        onFocus?.(e)
        if (!value) {
          const box = e.currentTarget
          box.value = '1. '
          box.setSelectionRange(3, 3)
          onValue('1. ')
        }
      }}
      onBlur={e => {
        onBlur?.(e)
        const v = trimEmptyItem(value)
        if (v !== value) onValue(v)
      }}
      onKeyDown={e => {
        onKeyDown?.(e)
        if (!e.defaultPrevented) continueList(e, onValue, maxLength, true)
      }}
    />
  )
}
