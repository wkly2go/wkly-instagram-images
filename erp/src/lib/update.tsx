import { useEffect, useState } from 'react'
import { desktop } from './desktop'

/**
 * 새 버전 알림: 새로 배포되면 위에 '새 버전' 띠만 띄운다. 저절로 새로고침하지 않는다
 * (대표 지시 2026-11-17 '업데이트를 자동으로 하지 말고 필요한 사람만 할 수 있게 표시만').
 *  - 휴대폰 30초 · PC 1분마다, 창으로 돌아올 때 /version.json 을 확인
 *  - 띠의 '업데이트'를 누르면 그때 새 버전으로 바뀜
 */
const PHONE = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(max-width: 640px)').matches)
const CHECK_MS = PHONE ? 30 * 1000 : 60 * 1000

async function latestId(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    return ((await r.json()) as { id?: string }).id ?? null
  } catch {
    return null
  }
}

function reload() {
  // 서비스 워커도 새 것으로 바꾼 뒤 새로고침
  navigator.serviceWorker
    ?.getRegistration('/')
    .then(r => r?.update())
    .catch(() => undefined)
    .finally(() => window.location.reload())
}

export function UpdateBanner() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let found = false
    const check = async () => {
      if (found) return
      const id = await latestId()
      if (id && id !== __BUILD_ID__) {
        found = true
        setReady(true)
      }
    }
    check()
    const timer = window.setInterval(() => check(), CHECK_MS)
    const onVis = () => document.visibilityState === 'visible' && check()
    const onFocus = () => check()
    // 뒤로 가기 캐시(bfcache)에서 되살아난 화면도 확인
    const onShow = (e: PageTransitionEvent) => e.persisted && check()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onShow)
    const onOnline = () => check()
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('online', onOnline)
    }
  }, [])
  const app = useDesktopUpdate()
  const outdated = useOutdatedDesktop()
  if (!app && outdated) {
    return (
      <div className="update-bar" role="status">
        <span>
          PC 프로그램 새 버전 {__DESKTOP_VERSION__}을 자동으로 받는 중입니다 (지금 {outdated}). 다 받으면 잠시 손을 뗄 때 저절로 설치돼요 — 다시 설치하실 필요 없습니다.
        </span>
        <a href="/download" style={{ color: 'inherit' }}>
          안 되면 내려받기
        </a>
      </div>
    )
  }
  if (app) {
    const bridge = desktop()!
    return (
      <div className="update-bar" role="status">
        <span>PC 프로그램 새 버전 {app}이 준비됐습니다. 다시 시작하면 바로 바뀌어요 (로그인 화면에서 잠시 쉬면 저절로 설치).</span>
        <button type="button" onClick={() => bridge.installUpdate?.()}>
          지금 다시 시작
        </button>
      </div>
    )
  }
  if (!ready) return null
  return (
    <div className="update-bar" role="status">
      <span>인트라넷 새 버전이 있습니다. 필요하실 때 눌러서 바꾸세요.</span>
      <button type="button" onClick={reload}>
        업데이트
      </button>
    </div>
  )
}

/** PC 프로그램(v1.4+)이 새 버전을 받아 두었으면 그 버전 */
function useDesktopUpdate(): string | null {
  const [ver, setVer] = useState<string | null>(() => {
    const st = desktop()?.updateState?.()
    return st?.ready ? st.version ?? '' : null
  })
  useEffect(() => desktop()?.onUpdate?.(st => setVer(st.ready ? st.version ?? '' : null)), [])
  return ver
}

const semver = (v: string) => v.split('.').map(n => Number(n) || 0)
const older = (a: string, b: string) => {
  const x = semver(a)
  const y = semver(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}
/** PC 프로그램이 이 배포본과 짝인 버전보다 낮으면 그 버전 (새 버전을 아직 못 받은 경우 안내용) */
function useOutdatedDesktop(): string | null {
  const d = desktop()
  if (!d || !import.meta.env.PROD) return null
  return older(d.version, __DESKTOP_VERSION__) ? d.version : null
}
