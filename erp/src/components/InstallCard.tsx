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

/** Chrome 이 '앱 설치' 를 허락하면 오는 신호: 화면이 뜨기 전에 올 수 있어 시작 때부터 잡아 둠 */
let installEvt: InstallEvent | null = null
const installSubs = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    installEvt = e as InstallEvent
    installSubs.forEach(f => f())
  })
  window.addEventListener('appinstalled', () => {
    installEvt = null
    installSubs.forEach(f => f())
  })
}
function useInstallEvt() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(n => n + 1)
    installSubs.add(f)
    return () => void installSubs.delete(f)
  }, [])
  return installEvt
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
 * 휴대폰 홈 맨 위 한 줄 (대표 지시 2026-11-04 "클릭만 해도 다운받을 수 있게 · 최상단" → "갤럭시도 웹 버전으로")
 *  - 갤럭시: 웹 앱(홈 화면에 추가) — 인트라넷 화면 그대로라 새 기능이 바로 반영됨
 *    Chrome 이 허락하면 버튼 한 번에 설치 창, 아니면 메뉴 위치 안내 · 예전 APK 는 작은 링크
 *  - 아이폰: 설치 프로파일(웹 클립) · 앱으로 열었으면(설치 후) 보이지 않음
 */
export function MobileAppBar() {
  const [hidden, setHidden] = useState(read())
  const [help, setHelp] = useState(false)
  const evt = useInstallEvt()
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  const ipad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  const ios = ipad || /iPhone|iPad/i.test(navigator.userAgent)
  const samsung = /SamsungBrowser/i.test(navigator.userAgent)
  if (hidden || standalone) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* 이번만 숨김 */
    }
    setHidden(true)
  }
  const androidTap = async () => {
    if (evt) {
      await evt.prompt()
      installEvt = null
      return
    }
    setHelp(h => !h)
  }
  return (
    <div className="m-appbar-wrap">
      <div className="m-appbar" role="region" aria-label="휴대폰 앱 설치">
        {ios ? (
          <a className="m-appbar-btn" href={IOS_PROFILE_URL}>
            <Smartphone size={18} />
            <span>
              <b>아이폰 앱 설치</b>
              <small>누른 뒤 설정 › 프로파일이 다운로드됨 › 설치</small>
            </span>
          </a>
        ) : (
          <button type="button" className="m-appbar-btn" onClick={() => void androidTap()}>
            <Smartphone size={18} />
            <span>
              <b>갤럭시 홈 화면에 앱 추가</b>
              <small>{evt ? '누르면 바로 설치 · 새 기능 자동 반영' : '웹 앱 · 새 기능이 바로 반영됩니다'}</small>
            </span>
          </button>
        )}
        <a className="m-appbar-alt" href={ios ? '/install.html#android' : IOS_PROFILE_URL}>
          {ios ? '갤럭시용' : '아이폰용'}
        </a>
        <button type="button" className="m-appbar-x" onClick={close} aria-label="닫기">
          <X size={16} />
        </button>
      </div>
      {help && !ios && (
        <div className="m-appbar-help" role="note">
          {samsung ? (
            <span>
              삼성 인터넷: 아래 <b>≡</b> 메뉴 › <b>현재 페이지 추가</b> › <b>홈 화면</b>
            </span>
          ) : (
            <span>
              Chrome: 오른쪽 위 <b>⋮</b> 메뉴 › <b>홈 화면에 추가</b> (또는 <b>앱 설치</b>) › <b>설치</b>
            </span>
          )}
          <a href={APK_URL}>예전 앱 파일(APK)</a>
        </div>
      )}
    </div>
  )
}

/**
 * PC 위쪽 바 검색창 옆 '휴대폰 앱' 버튼 (대표 지시 2026-11-04)
 *  - 누르면 갤럭시 · 아이폰 QR 두 개가 나옴: 휴대폰 카메라로 찍으면 바로 받기
 *  - QR 아래 링크로 이 PC 에서 직접 받을 수도 있음
 */
export function TopAppButton() {
  return (
    <details className="top-app">
      <summary className="quick-btn" title="휴대폰 앱 내려받기">
        <Smartphone size={14} /> 휴대폰 앱
      </summary>
      <div className="top-app-pop" role="dialog" aria-label="휴대폰 앱 받기">
        <p className="top-app-lead">휴대폰 카메라로 QR 을 찍으면 바로 받습니다</p>
        <div className="top-app-qrs">
          <div className="top-app-qr">
            <img src="/qr-android.svg" alt="갤럭시 앱 QR" width={132} height={132} />
            <b>갤럭시 · 안드로이드</b>
            <a href="/install.html#android" target="_blank" rel="noreferrer">
              웹 앱 설치 방법
            </a>
          </div>
          <div className="top-app-qr">
            <img src="/qr-iphone.svg" alt="아이폰 앱 QR" width={132} height={132} />
            <b>아이폰 · 아이패드</b>
            <a href={IOS_PROFILE_URL}>설치 파일 받기 (Safari)</a>
          </div>
        </div>
        <a href="/install.html" target="_blank" rel="noreferrer" className="top-app-help">
          설치 방법 보기 ›
        </a>
      </div>
    </details>
  )
}
