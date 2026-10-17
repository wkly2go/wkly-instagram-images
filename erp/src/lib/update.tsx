import { useEffect, useState } from 'react'
import { desktop } from './desktop'

/**
 * 자동 업데이트: 새로 배포되면 열려 있는 창이 스스로 새 버전으로 바뀐다.
 *  - 3분마다 · 창으로 돌아올 때 /version.json 을 확인
 *  - 새 버전이면: 창이 가려져 있거나 1분 넘게 손대지 않았으면 바로 새로고침
 *    (글을 쓰는 중이면 기다렸다가), 아니면 위에 '새 버전' 띠를 띄움
 */
const CHECK_MS = 3 * 60 * 1000
const IDLE_MS = 60 * 1000

let lastInput = Date.now()
if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart'])
    window.addEventListener(ev, () => (lastInput = Date.now()), { passive: true, capture: true })
}

/** 입력칸에 쓰다 만 글이 있으면 자동 새로고침을 미룸 */
function typing(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(el.type)))) return !!el.value
  return [...document.querySelectorAll('textarea')].some(t => t.value.trim())
}

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
    const tryApply = () => {
      if (!found) return
      if (document.visibilityState === 'hidden' || (Date.now() - lastInput > IDLE_MS && !typing())) reload()
    }
    const check = async () => {
      if (!found) {
        const id = await latestId()
        if (id && id !== __BUILD_ID__) {
          found = true
          setReady(true)
        }
      }
      tryApply()
    }
    check()
    const timer = window.setInterval(check, CHECK_MS)
    const idle = window.setInterval(tryApply, 20 * 1000)
    const onVis = () => (document.visibilityState === 'visible' ? check() : tryApply())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(idle)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', check)
    }
  }, [])
  const app = useDesktopUpdate()
  const outdated = useOutdatedDesktop()
  if (!app && outdated) {
    return (
      <div className="update-bar" role="status">
        <span>
          PC 프로그램이 예전 버전({outdated})입니다. 최신 {__DESKTOP_VERSION__}은 작업 표시줄 오른쪽 아래(맥은 위 메뉴 막대) 아이콘 → <b>종료</b> 뒤 다시 실행하면 설치됩니다.
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
      <span>인트라넷이 새 버전으로 바뀌었습니다. 잠시 손을 떼면 저절로 새로고침돼요.</span>
      <button type="button" onClick={reload}>
        지금 새로고침
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
