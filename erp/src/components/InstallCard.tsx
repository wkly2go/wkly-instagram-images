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

/**
 * 휴대폰 홈 맨 위 한 줄 (대표 지시 2026-11-04 "클릭만 해도 다운받을 수 있게 하고 최상단에 배치")
 *  - 내 기기에 맞는 버튼 하나: 누르면 바로 내려받기 (갤럭시 = APK · 아이폰 = 설치 프로파일)
 *  - 다른 기기용은 옆에 작은 글자 링크 · 앱으로 열었으면(설치 후) 보이지 않음
 */
export function MobileAppBar() {
  const [hidden, setHidden] = useState(read())
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  const ipad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  const ios = ipad || /iPhone|iPad/i.test(navigator.userAgent)
  if (hidden || standalone) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* 이번만 숨김 */
    }
    setHidden(true)
  }
  return (
    <div className="m-appbar" role="region" aria-label="휴대폰 앱 내려받기">
      <a className="m-appbar-btn" href={ios ? IOS_PROFILE_URL : APK_URL} download={ios ? undefined : 'wkly-erp.apk'}>
        <Smartphone size={18} />
        <span>
          <b>{ios ? '아이폰 앱 다운로드' : '갤럭시 앱 다운로드'}</b>
          <small>{ios ? '누른 뒤 설정 › 프로파일이 다운로드됨 › 설치' : '누른 뒤 받은 파일 열기 › 설치'}</small>
        </span>
      </a>
      <a className="m-appbar-alt" href={ios ? APK_URL : IOS_PROFILE_URL}>
        {ios ? '갤럭시용' : '아이폰용'}
      </a>
      <button type="button" className="m-appbar-x" onClick={close} aria-label="닫기">
        <X size={16} />
      </button>
    </div>
  )
}

/** PC 위쪽 바 검색창 옆 '휴대폰 앱' 버튼 (대표 지시 2026-11-04 "PC 창에 모바일 버전 받는 버튼을 검색창 옆에 · QR 삭제") */
export function TopAppButton() {
  return (
    <details className="top-app">
      <summary className="quick-btn" title="휴대폰 앱 내려받기">
        <Smartphone size={14} /> 휴대폰 앱
      </summary>
      <div className="top-app-pop" role="menu">
        <a role="menuitem" href={APK_URL} download="wkly-erp.apk">
          <b>갤럭시 · 안드로이드</b>
          <span>앱 파일(APK) 바로 받기</span>
        </a>
        <a role="menuitem" href={IOS_PROFILE_URL}>
          <b>아이폰 · 아이패드</b>
          <span>설치 파일 받기 (Safari)</span>
        </a>
        <a role="menuitem" href="/install.html" target="_blank" rel="noreferrer" className="top-app-help">
          설치 방법 보기 ›
        </a>
      </div>
    </details>
  )
}
