// 통합 검색 창(Ctrl+K · ⌘K · 위쪽 검색 단추)은 처음 열 때 불러온다 — 첫 화면 묶음을 가볍게 (2026-11-19 성능)
// 불러오기 전에는 이 작은 부품이 단축키와 열기 요청만 받아 두었다가, 검색 창이 뜨면 그대로 넘긴다.
import { lazy, Suspense, useEffect, useState } from 'react'

const load = () => import('./CommandPalette')
let loaded = false
/** 검색 창이 뜨기 전에 받은 열기 요청의 검색어 (없으면 null) */
let pending: string | null = null
let wake: (() => void) | null = null

/** 통합 검색 열기 — 아직 안 불러왔으면 불러온 뒤 연다 */
export function openCommandPalette(q = '') {
  if (loaded) { void load().then(m => m.openCommandPalette(q)); return }
  pending = q
  wake?.()
}

const Palette = lazy(() =>
  load().then(m => ({
    default: function PaletteAfterLoad() {
      useEffect(() => {
        loaded = true
        if (pending === null) return
        const q = pending
        pending = null
        m.openCommandPalette(q)
      }, [])
      return <m.CommandPalette />
    },
  })),
)

export function CommandPaletteHost() {
  const [ready, setReady] = useState(loaded)
  useEffect(() => {
    if (ready) return
    wake = () => setReady(true)
    // 검색 창이 뜬 뒤에는 검색 창이 직접 단축키를 받는다 (여기서는 처음 한 번만)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        pending = pending ?? ''
        setReady(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      wake = null
      window.removeEventListener('keydown', onKey)
    }
  }, [ready])
  if (!ready) return null
  return (
    <Suspense fallback={null}>
      <Palette />
    </Suspense>
  )
}
