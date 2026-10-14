/**
 * 로그인 규칙 (PC 프로그램 · 브라우저 · 휴대폰 모두 같음)
 *  - 로그인은 그날만 유지: 날짜가 바뀌면 다시 로그인
 *  - 30분 동안 조작이 없으면 화면 잠금 → 비밀번호를 다시 넣어야 열림
 *    (PC 프로그램은 컴퓨터 전체 사용 기준 · 화면 잠금 · 절전 때도 잠금)
 *  - 잠금 상태는 이 컴퓨터의 모든 인트라넷 창(빠른 창 포함)에 같이 적용
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import type { Api } from './api'
import { friendlyError } from './api'
import { todayKey } from './date'
import { desktop } from './desktop'
import type { Profile } from './types'

export const IDLE_LOCK_MS = 30 * 60_000
const DAY_KEY = 'wkly-login-day'
const LAST_KEY = 'wkly-last-active'
const LOCK_KEY = 'wkly-locked'

const get = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const set = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* noop */
  }
}

/** 로그인 성공 직후 호출: 오늘 로그인함 · 잠금 해제 */
export function markLogin() {
  set(DAY_KEY, todayKey())
  set(LAST_KEY, String(Date.now()))
  set(LOCK_KEY, null)
}

/** 로그인한 동안 규칙 적용. 잠겨 있으면 true */
export function useSessionPolicy(api: Api, userId: string | null | undefined): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(() => get(LOCK_KEY) === '1')
  const lock = useCallback(() => {
    set(LOCK_KEY, '1')
    setLocked(true)
  }, [])
  const unlock = useCallback(() => {
    markLogin()
    setLocked(false)
  }, [])

  // PC 프로그램에 로그인 상태 알리기 (로그인 전 · 잠금 중엔 창을 못 닫음)
  useEffect(() => {
    desktop()?.setAuth(!!userId && !locked)
  }, [userId, locked])

  useEffect(() => {
    if (!userId) return
    // 날짜가 바뀌면 다시 로그인
    const checkDay = () => {
      const day = get(DAY_KEY)
      if (!day) set(DAY_KEY, todayKey()) // 이 기능 이전부터 로그인돼 있던 경우: 오늘부터 적용
      else if (day !== todayKey()) {
        set(LOCK_KEY, null)
        api.signOut().catch(() => undefined)
      }
    }
    // 30분 미사용 → 잠금 (PC 프로그램은 컴퓨터 전체 사용 시간을 기준으로 프로그램이 알려 줌)
    const bridge = desktop()
    const checkIdle = () => {
      if (bridge) return
      const last = Number(get(LAST_KEY) ?? 0)
      if (last && Date.now() - last > IDLE_LOCK_MS) lock()
    }
    let lastWrite = 0
    const active = () => {
      const now = Date.now()
      if (now - lastWrite < 15_000) return
      lastWrite = now
      // 잠금 화면에서 움직여도 풀리지 않게, 잠겨 있지 않을 때만 기록
      if (get(LOCK_KEY) !== '1') set(LAST_KEY, String(now))
    }
    if (!get(LAST_KEY)) set(LAST_KEY, String(Date.now()))
    checkDay()
    checkIdle()
    const tick = () => {
      checkDay()
      checkIdle()
    }
    const id = window.setInterval(tick, 30_000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCK_KEY) setLocked(e.newValue === '1')
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const
    for (const ev of events) window.addEventListener(ev, active, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('storage', onStorage)
    const offLock = bridge?.onLock(lock)
    return () => {
      window.clearInterval(id)
      for (const ev of events) window.removeEventListener(ev, active, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('storage', onStorage)
      offLock?.()
    }
  }, [api, userId, lock])

  return { locked: !!userId && locked, unlock }
}

/** 잠금 화면: 비밀번호를 다시 넣어야 열림 */
export function LockScreen({ api, me, onUnlock }: { api: Api; me: Profile; onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password && api.mode !== 'demo') return
    setBusy(true)
    setError(null)
    try {
      await api.signIn(me.email ?? '', password)
      onUnlock()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="화면 잠금">
      <form className="login" onSubmit={submit}>
        <div className="inner">
          <div className="lock-icon">
            <Lock size={22} />
          </div>
          <h1 className="t-title" style={{ textAlign: 'center', margin: 0 }}>
            화면이 잠겼습니다
          </h1>
          <p className="t-small" style={{ textAlign: 'center', margin: 0 }}>
            30분 동안 사용하지 않아 잠갔습니다. <b>{me.name}</b>님의 비밀번호를 넣으면 이어서 쓸 수 있습니다.
          </p>
          <input
            className="input"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder={api.mode === 'demo' ? '체험 모드: 비워 두고 열기' : '비밀번호'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            aria-label="비밀번호"
          />
          {error && (
            <p className="err" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-blue btn-block" disabled={busy}>
            {busy ? '확인 중…' : '잠금 해제'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              set(LOCK_KEY, null)
              api.signOut().catch(() => undefined)
            }}
          >
            다른 계정으로 로그인
          </button>
        </div>
      </form>
    </div>
  )
}
