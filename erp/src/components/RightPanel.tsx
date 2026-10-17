import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * 결과 칸: 전체 공통 4단 구성 (대표 지시 2026-10-17)
 * 프로필 │ 본 화면 │ 결과 │ 인터넷(항상 고정).
 * 목록에서 자료 · 링크를 누르면 본 화면 오른쪽에 결과 칸이 왼쪽→오른쪽으로 펼쳐지며 나타나고,
 * 가운데 두 칸(본 화면 · 결과)은 폭이 함께 늘고 줄어든다.
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

/** 결과 칸이 들어갈 자리 (인터넷 칸 바로 왼쪽, 화면이 바뀌어도 같은 DOM 재사용) */
export const detailSlot: HTMLDivElement | null = typeof document !== 'undefined' ? document.createElement('div') : null
if (detailSlot) detailSlot.className = 'detail-slot'

/** 앱 맨 위에서 한 번만 그리는 결과 칸 */
export function DetailColumnHost() {
  const d = usePanelDetail()
  const wide = usePanelWide()
  const [closed, setClosed] = useState<string | null>(null)
  const show = !!d && wide && closed !== d.key
  useEffect(() => {
    document.documentElement.classList.toggle('detail-open', show)
    return () => document.documentElement.classList.remove('detail-open')
  }, [show])
  if (!show || !detailSlot) return null
  return createPortal(
    <aside className="detail-col" aria-label={d.title}>
      <div className="detail-head">
        <span className="grow truncate">{d.title}</span>
        <button type="button" className="icon-btn sm" onClick={() => setClosed(d.key)} aria-label="결과 칸 닫기" title="닫기">
          <X size={14} />
        </button>
      </div>
      <div className="detail-body" key={d.key}>
        {d.node}
      </div>
    </aside>,
    detailSlot,
  )
}
