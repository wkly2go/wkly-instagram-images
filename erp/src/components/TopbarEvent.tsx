import { useEffect, useMemo, useState } from 'react'
import { Award, Cake, Flag, Moon, Sparkles, TreePine, X, type LucideIcon } from 'lucide-react'
import { useApp } from '../lib/app'
import { Link } from '../lib/router'
import { EMPTY_TOPBAR_DATA, pickTopbarEvent, previewTopbarEvent, seoulToday, type TopbarEventData, type TopbarTheme } from '../lib/topbarEvent'

/**
 * 위쪽 바 기념일 · 이벤트 (대표 지시 2026-11-16)
 * 생일 · 크리스마스(한 달 전부터) · 설 · 추석 · 새해 · 연말 · 국경일 · 입사/회사 기념일에 맞춰
 * 위쪽 바 장식(html[data-topbar-event]) 과 인사말 칩을 저절로 바꾼다. 칩의 × 는 그 이벤트만 이 기기에서 숨김(장식은 유지).
 * 미리 보기: 주소 뒤에 ?topbar=birthday · christmas · newyear · yearend · seollal · chuseok · anniversary · holiday (이 탭만) · ?topbar=off 로 끔
 */
const ICONS: Record<TopbarTheme, LucideIcon> = {
  birthday: Cake,
  christmas: TreePine,
  newyear: Sparkles,
  yearend: Sparkles,
  seollal: Sparkles,
  chuseok: Moon,
  anniversary: Award,
  holiday: Flag,
}
const PREVIEW_KEY = 'wkly-topbar-preview'
const HIDE_KEY = 'wkly-topbar-hide'

function readPreview(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('topbar')
    if (q === 'off') sessionStorage.removeItem(PREVIEW_KEY)
    else if (q) sessionStorage.setItem(PREVIEW_KEY, q)
    return sessionStorage.getItem(PREVIEW_KEY)
  } catch {
    return null
  }
}

function hiddenKey(): string | null {
  try {
    return localStorage.getItem(HIDE_KEY)
  } catch {
    return null
  }
}

export function TopbarEvent() {
  const { api, me } = useApp()
  const [today, setToday] = useState(seoulToday)
  const [data, setData] = useState<TopbarEventData>(EMPTY_TOPBAR_DATA)
  const [hidden, setHidden] = useState(hiddenKey)
  const [preview] = useState(readPreview)

  // 날짜가 바뀌면(자정을 넘겨 켜 둔 경우) 다시 고름
  useEffect(() => {
    const t = window.setInterval(() => setToday(seoulToday()), 10 * 60_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    let live = true
    api.topbarEvents().then(d => live && setData(d)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [api, today])

  const ev = useMemo(() => (preview ? previewTopbarEvent(preview, today) : pickTopbarEvent(today, data, me.id)), [preview, today, data, me.id])

  useEffect(() => {
    const root = document.documentElement
    if (ev) root.dataset.topbarEvent = ev.theme
    else delete root.dataset.topbarEvent
    return () => {
      delete root.dataset.topbarEvent
    }
  }, [ev])

  if (!ev) return null
  const Icon = ICONS[ev.theme]
  const showChip = hidden !== ev.key
  const body = (
    <>
      <Icon size={13} aria-hidden="true" />
      <span className="tb-event-long">{ev.title}</span>
      <span className="tb-event-short">{ev.short}</span>
    </>
  )
  return (
    <>
      <span className="tb-deco" aria-hidden="true" />
      {showChip && (
        <span className={`tb-event tb-${ev.theme}`} role="status">
          {ev.link ? (
            <Link to={ev.link} className="tb-event-main" title={ev.title}>
              {body}
            </Link>
          ) : (
            <span className="tb-event-main" title={ev.title}>
              {body}
            </span>
          )}
          <button
            type="button"
            className="tb-event-x"
            aria-label="이 인사말 숨기기"
            onClick={() => {
              try {
                localStorage.setItem(HIDE_KEY, ev.key)
              } catch {
                /* 저장 못 해도 이번만 숨김 */
              }
              setHidden(ev.key)
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      )}
    </>
  )
}
