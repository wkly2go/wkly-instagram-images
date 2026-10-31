import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'

/**
 * 결과 칸: 전체 공통 4단 구성 (대표 지시 2026-10-17)
 * 프로필 │ 본 화면 │ 결과 │ 인터넷(항상 고정).
 * 목록에서 자료 · 링크를 누르면 본 화면 오른쪽에 결과 칸이 왼쪽→오른쪽으로 펼쳐지며 나타나고,
 * 가운데 두 칸(본 화면 · 결과)은 폭이 함께 늘고 줄어든다.
 */
export type PanelDetail = { key: string; title: string; node: ReactNode; wide?: boolean; onClose?: () => void }

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
export function useRightPanel(key: string | null, title: string, node: ReactNode, opts?: { wide?: boolean; onClose?: () => void }) {
  useEffect(() => {
    if (!key) return
    current = { key, title, node, wide: opts?.wide, onClose: opts?.onClose }
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

/** 넓은 작업(현장 작업일지 등)이 열려 있는 동안 결과 칸을 잠시 접음 (닫으면 다시 보임) */
let suppress = 0
const suppressListeners = new Set<() => void>()
export function useSuppressDetail(active: boolean) {
  useEffect(() => {
    if (!active) return
    suppress++
    for (const l of suppressListeners) l()
    return () => {
      suppress--
      for (const l of suppressListeners) l()
    }
  }, [active])
}
const useSuppressed = () =>
  useSyncExternalStore(
    cb => {
      suppressListeners.add(cb)
      return () => {
        suppressListeners.delete(cb)
      }
    },
    () => suppress > 0,
  )

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

/** 결과 칸(대시보드 · 상세) 폭: 끌어서 조절 · 이 PC에 기억 (대표 지시 2026-10-29 "대시보드의 크기를 조절") */
const W_KEY = 'wkly-detail-w'
const readW = (): number | null => {
  try {
    const v = Number(localStorage.getItem(W_KEY))
    return v >= 280 ? v : null
  } catch {
    return null
  }
}
const saveW = (v: number | null) => {
  try {
    if (v) localStorage.setItem(W_KEY, String(v))
    else localStorage.removeItem(W_KEY)
  } catch {
    /* 기억 못 해도 이번 화면에서는 적용 */
  }
}
const maxW = () => Math.round(window.innerWidth * 0.72)

/** 앱 맨 위에서 한 번만 그리는 결과 칸 */
export function DetailColumnHost() {
  const [w, setW] = useState<number | null>(readW)
  const d = usePanelDetail()
  const wide = usePanelWide()
  const [closed, setClosed] = useState<string | null>(null)
  const suppressed = useSuppressed()
  const show = !!d && wide && closed !== d.key && !suppressed
  // 닫은 뒤 같은 항목(목록 줄 · 보고 · 사람 등)을 다시 누르면 다시 열림
  useEffect(() => {
    if (!closed) return
    const reopen = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('main tr, main .item, main .team-person, main .report-toggle, main .g-task, main .proj-card, main .link-row')) setClosed(null)
    }
    document.addEventListener('click', reopen, true)
    return () => document.removeEventListener('click', reopen, true)
  }, [closed])
  useEffect(() => {
    document.documentElement.classList.toggle('detail-open', show)
    document.documentElement.classList.toggle('detail-wide', show && !!d?.wide)
    return () => document.documentElement.classList.remove('detail-open', 'detail-wide')
  }, [show, d?.wide])
  if (!show || !detailSlot) return null
  // 작은 화면(노트북)에서 프로젝트 등 넓은 상세는 화면의 60%로 시작 (대표 지시 2026-10-31 "작은 화면은 이런 비율로 시작")
  const eff = w ?? (d.wide && window.innerWidth <= 1680 ? Math.round(window.innerWidth * 0.6) : null)
  // 왼쪽 가장자리를 끌어 폭 조절 · 두 번 누르면 원래 크기
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const col = (e.currentTarget as HTMLElement).parentElement!
    const right = col.getBoundingClientRect().right
    document.documentElement.classList.add('col-resizing')
    let last = eff
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(Math.max(right - ev.clientX, 280), maxW()))
      setW(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.documentElement.classList.remove('col-resizing')
      saveW(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const big = !!eff && eff >= window.innerWidth * 0.5
  const toggleBig = () => {
    const v = big ? Math.round(window.innerWidth * 0.4) : Math.round(window.innerWidth * 0.6)
    setW(v)
    saveW(v)
  }
  return createPortal(
    // key 가 바뀌면 새로 그려 결과 칸 맨 뒤(=맨 위)에 붙음 → 수정 칸 등이 열려 있어도 새로 누른 자료가 그 위에 보임
    <aside key={d.key} className={`detail-col${d.wide ? ' wide' : ''}${eff ? ' sized' : ''}`} style={eff ? { flex: `0 0 ${Math.min(eff, maxW())}px` } : undefined} aria-label={d.title}>
      <div className="col-resize" onPointerDown={startDrag} onDoubleClick={() => (setW(null), saveW(null))} role="separator" aria-orientation="vertical" aria-label="결과 칸 폭 조절" title="끌어서 크기 조절 · 두 번 누르면 원래 크기" />
      <div className="detail-head">
        <span className="grow truncate">{d.title}</span>
        <button type="button" className="icon-btn sm" onClick={toggleBig} aria-label={big ? '원래 크기로' : '크게 보기'} title={big ? '원래 크기로' : '크게 보기'}>
          {big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button type="button" className="icon-btn sm" onClick={() => (d.onClose ? d.onClose() : setClosed(d.key))} aria-label="결과 칸 닫기" title="닫기">
          <X size={14} />
        </button>
      </div>
      <div className="detail-body">
        {d.node}
      </div>
    </aside>,
    detailSlot,
  )
}
