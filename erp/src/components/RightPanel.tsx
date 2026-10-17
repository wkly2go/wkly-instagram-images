import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

/**
 * 오른쪽 칸 (인터넷 검색 칸) 에 띄우는 상세 내용.
 * 전체 공통 규칙 (대표 지시 2026-10-17 "버튼을 누르면 오른쪽에 결과 노출"):
 * 목록에서 항목을 누르면 가운데는 목록 그대로 두고 결과를 오른쪽 칸에 보여 준다.
 */
export type PanelDetail = { key: string; title: string; node: ReactNode }

let current: PanelDetail | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export const usePanelDetail = () => useSyncExternalStore(subscribe, () => current)

/** key 가 있으면 오른쪽 칸에 node 를 띄우고, key 가 바뀌거나 화면을 떠나면 내린다 */
export function useRightPanel(key: string | null, title: string, node: ReactNode) {
  useEffect(() => {
    if (!key) return
    current = { key, title, node }
    emit()
  })
  useEffect(() => {
    if (!key) return
    return () => {
      if (current?.key === key) {
        current = null
        emit()
      }
    }
  }, [key])
}

/** 오른쪽 칸이 화면에 늘 보이는 폭인지 (좁은 화면은 가운데에서 그대로 보여 줌) */
const WIDE = '(min-width: 900px)'
const wideNow = () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches
export function usePanelWide() {
  return useSyncExternalStore(
    cb => {
      const m = window.matchMedia?.(WIDE)
      m?.addEventListener('change', cb)
      return () => m?.removeEventListener('change', cb)
    },
    wideNow,
    () => false,
  )
}
