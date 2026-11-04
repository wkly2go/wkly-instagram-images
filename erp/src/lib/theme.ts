import { useEffect, useState } from 'react'

/**
 * 화면 밝기 선택 (대표 지시 2026-11-04 "갤럭시 다크 모드 선택할 수 있게")
 *  - 기본은 늘 밝게. 어둡게는 본인이 고를 때만 (이 기기에만 기억)
 *  - 어둡게도 검정이 아니라 짙은 초록 계열 (styles.css html[data-theme='dark'])
 */
export type Theme = 'light' | 'dark'
const KEY = 'wkly-theme'

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#13261a' : '#FFFFFF')
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(readTheme)
  useEffect(() => applyTheme(t), [t])
  return [
    t,
    next => {
      try {
        if (next === 'dark') localStorage.setItem(KEY, 'dark')
        else localStorage.removeItem(KEY)
      } catch {
        /* 저장 못 해도 이번만 적용 */
      }
      setT(next)
    },
  ]
}
