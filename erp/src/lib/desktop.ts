/**
 * PC 설치 프로그램(WKLY 인트라넷 앱)과 주고받기
 *  - 설치 프로그램은 이 웹을 그대로 띄우고, preload 로 window.wklyDesktop 을 넣어 준다
 *  - 접속 경로: 설치 프로그램(desktop) · 휴대폰(mobile) · 그 밖의 브라우저(web)
 */
export interface DesktopBridge {
  version: string
  platform: string
  /** 로그인 상태를 알려 주면, 로그인 전에는 창을 못 닫고 맨 위에 고정 */
  setAuth(loggedIn: boolean): void
  /** 컴퓨터를 30분 안 쓰거나 화면 잠금 · 절전이면 호출됨 */
  onLock(cb: () => void): () => void
}

declare global {
  interface Window {
    wklyDesktop?: DesktopBridge
  }
}

export const desktop = (): DesktopBridge | null => (typeof window !== 'undefined' && window.wklyDesktop) || null
export const isDesktopApp = () => !!desktop()

export type AccessSource = 'desktop' | 'web' | 'mobile'

export function accessSource(): AccessSource {
  if (isDesktopApp()) return 'desktop'
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return 'mobile'
  return 'web'
}

export const SOURCE_LABEL: Record<AccessSource, string> = { desktop: 'PC 프로그램', web: '브라우저', mobile: '휴대폰' }

/** 설치 파일 (GitHub 릴리스 · 최신 버전으로 자동 연결) */
const RELEASES = 'https://github.com/wkly2go/wkly-instagram-images/releases/latest/download'
export const DOWNLOADS = {
  windows: `${RELEASES}/WKLY-Intranet-Setup.exe`,
  mac: `${RELEASES}/WKLY-Intranet.dmg`,
}
