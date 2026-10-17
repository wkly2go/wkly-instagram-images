/**
 * PC 설치 프로그램(WKLY 인트라넷 앱)과 주고받기
 *  - 설치 프로그램은 이 웹을 그대로 띄우고, preload 로 window.wklyDesktop 을 넣어 준다
 *  - 접속 경로: 설치 프로그램(desktop) · 휴대폰(mobile) · 그 밖의 브라우저(web)
 */
export interface DesktopBridge {
  version: string
  platform: string
  /** v1.2+: 이 컴퓨터의 기기 ID (회사 PC 출근 확인) */
  deviceId?: string
  /** 로그인 상태를 알려 주면, 로그인 전에는 창을 못 닫고 맨 위에 고정 */
  setAuth(loggedIn: boolean): void
  /** 컴퓨터를 30분 안 쓰거나 화면 잠금 · 절전이면 호출됨 */
  onLock(cb: () => void): () => void
  /** v1.1+: 인트라넷 화면 안 칸에 구글 등 웹 페이지를 띄움 */
  searchOpen?(url: string, rect: { x: number; y: number; width: number; height: number }): void
  searchBounds?(rect: { x: number; y: number; width: number; height: number }): void
  searchNav?(action: 'back' | 'forward' | 'external'): void
  searchClose?(): void
  /** v1.4+: PC 프로그램 새 버전 준비 여부 · 다시 시작해 설치 */
  updateState?(): { ready: boolean; version: string | null }
  onUpdate?(cb: (st: { ready: boolean; version: string | null }) => void): () => void
  installUpdate?(): void
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
