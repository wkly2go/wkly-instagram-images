import { useEffect, useState } from 'react'
import { Smartphone, X } from 'lucide-react'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}
const KEY = 'wkly-install-dismissed-v2'
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const APK_URL = 'https://github.com/wkly2go/wkly-instagram-images/releases/download/android/wkly-erp.apk'
export const IOS_PROFILE_URL = '/wkly-erp.mobileconfig'

/**
 * 휴대폰 앱 내려받기 (대표 지시 2026-11-04 "두 개 버전 만들어서 인트라넷 메인에 다운받을 수 있게")
 *  - 갤럭시(안드로이드): APK · 아이폰: 설치 프로파일(웹 클립)
 *  - PC: 두 버전 QR (휴대폰 카메라로 찍어 받기) · 휴대폰: 내 기기에 맞는 버튼을 먼저
 *  - 앱으로 열었을 때(설치 후)는 보이지 않음 · 닫으면 이 기기에서 숨김 (사이드바 '휴대폰 앱'으로 다시)
 */
export function InstallCard() {
  const [evt, setEvt] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(read())
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  // iPadOS 는 맥으로 보고하므로 터치 지점 수로 구분
  const ipad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  const ios = ipad || /iPhone|iPad/i.test(navigator.userAgent)
  const android = /Android/i.test(navigator.userAgent)
  const mobile = ios || android
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setEvt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  if (hidden || standalone) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* 저장 안 돼도 이번만 숨김 */
    }
    setHidden(true)
  }
  const androidBox = (
    <div className="app-dl" key="android">
      <b className="app-dl-name">갤럭시 · 안드로이드</b>
      {!mobile && <img src="/qr-android.svg" alt="갤럭시 앱 QR" className="app-dl-qr" />}
      <a className="btn btn-blue" href={APK_URL} style={{ textDecoration: 'none' }}>
        갤럭시 앱 받기
      </a>
      <span className="t-cap">받은 파일 열기 › 설치 (처음이면 '출처를 알 수 없는 앱' 허용)</span>
      {evt && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={async () => {
            await evt.prompt()
            setEvt(null)
          }}
        >
          Chrome 으로 바로 설치
        </button>
      )}
    </div>
  )
  const iosBox = (
    <div className="app-dl" key="ios">
      <b className="app-dl-name">아이폰 · 아이패드</b>
      {!mobile && <img src="/qr-iphone.svg" alt="아이폰 앱 QR" className="app-dl-qr" />}
      <a className="btn btn-blue" href={IOS_PROFILE_URL} style={{ textDecoration: 'none' }}>
        아이폰 앱 받기
      </a>
      <span className="t-cap">Safari 에서 받기 › 허용 › 설정 › 프로파일이 다운로드됨 › 설치</span>
    </div>
  )
  return (
    <section className="install-card" aria-label="휴대폰 앱 받기">
      <div className="install-head">
        <Smartphone size={16} />
        <b className="grow">휴대폰 앱 받기</b>
        <a href="/install.html" target="_blank" rel="noreferrer" className="t-cap">
          자세한 설치 방법 ›
        </a>
        <button type="button" className="icon-btn" onClick={close} aria-label="닫기" title="이 기기에서 숨기기">
          <X size={14} />
        </button>
      </div>
      {!mobile && <span className="t-cap">휴대폰 카메라로 QR 을 찍으면 바로 받습니다. 화면 · 기능은 인트라넷과 같고, 새 기능은 앱을 다시 받지 않아도 자동으로 반영됩니다.</span>}
      <div className="app-dl-row">{ios ? [iosBox, androidBox] : [androidBox, iosBox]}</div>
    </section>
  )
}
