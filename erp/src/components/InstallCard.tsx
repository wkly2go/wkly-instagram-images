import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}
const KEY = 'wkly-install-dismissed'
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** 휴대폰 홈 화면에 인트라넷 앱 추가 안내 (안드로이드: 바로 설치 · 아이폰: 공유 › 홈 화면에 추가) */
export function InstallCard() {
  const [evt, setEvt] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(read())
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  // iPadOS 는 맥으로 보고하므로 터치 지점 수로 구분
  const ipad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  const mobile = ipad || /Android|iPhone|iPad/i.test(navigator.userAgent)
  const ios = ipad || /iPhone|iPad/i.test(navigator.userAgent)
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setEvt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  if (hidden || standalone || !mobile || (!evt && !ios)) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* 저장 안 돼도 이번만 숨김 */
    }
    setHidden(true)
  }
  return (
    <div className="install-card">
      <span className="grow t-small">
        {ios ? (
          <>
            휴대폰 · 태블릿 홈 화면에 인트라넷 앱을 추가하세요: Safari <b>공유</b> 버튼 › <b>홈 화면에 추가</b>. 출근 체크 · 알림을 앱처럼 씁니다.
          </>
        ) : (
          '휴대폰 · 태블릿 홈 화면에 인트라넷 앱을 추가하면 출근 체크 · 알림을 앱처럼 쓸 수 있습니다.'
        )}
      </span>
      {evt && (
        <button
          type="button"
          className="btn btn-blue btn-sm"
          onClick={async () => {
            await evt.prompt()
            setEvt(null)
            close()
          }}
        >
          설치
        </button>
      )}
      <button type="button" className="icon-btn" onClick={close} aria-label="닫기">
        <X size={14} />
      </button>
    </div>
  )
}
