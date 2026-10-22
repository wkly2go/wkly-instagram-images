import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DependencyList, type ReactNode, useSyncExternalStore } from 'react'
import { friendlyError, type Api } from './api'
import { createDemoApi } from './demoApi'
import { createSupabaseApi } from './supabaseApi'
import type { Profile } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const api: Api = url && key ? createSupabaseApi(url, key) : createDemoApi()

interface AppValue {
  api: Api
  me: Profile
  profiles: Profile[]
  profileName: (id: string | null | undefined) => string
  profileOf: (id: string | null | undefined) => Profile | undefined
  /** 데이터가 바뀌었을 때 화면들이 다시 불러오도록 */
  version: number
  bump: () => void
  toast: (msg: string) => void
  /** 빠른 창 띄우기. 'window': 독립 창(전체 창을 닫아도 계속 사용) · 'pin': 다른 프로그램 위에 항상 떠 있는 창(PiP) */
  openQuick: (kind?: 'window' | 'pin') => void
}

const AppContext = createContext<AppValue | null>(null)

interface ProviderProps {
  me: Profile
  profiles: Profile[]
  version: number
  bump: () => void
  toast: (m: string) => void
  openQuick: (kind?: 'window' | 'pin') => void
  children: ReactNode
}

export function AppProvider({ me, profiles, version, bump, toast, openQuick, children }: ProviderProps) {
  const value = useMemo<AppValue>(() => {
    const byId = new Map(profiles.map(p => [p.id, p]))
    return {
      api,
      me,
      profiles,
      profileOf: id => (id ? byId.get(id) : undefined),
      profileName: id => (id ? byId.get(id)?.name ?? '알 수 없음' : '알 수 없음'),
      version,
      bump,
      toast,
      openQuick,
    }
  }, [me, profiles, version, bump, toast, openQuick])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppProvider 가 필요합니다')
  return ctx
}

export function initial(name: string | null | undefined): string {
  return Array.from((name ?? '?').trim())[0] ?? '?'
}

/** 비동기 데이터 로딩. deps 또는 전역 version 이 바뀌면 다시 불러온다. */
/**
 * 처음 불러오는 중인 데이터 수 (2026-10-22 UI 개선): 불러오는 동안 '없습니다'가 먼저 보였다 바뀌는 깜빡임 대신 '불러오는 중'
 *  - 화면마다 처음 한 번만 셉니다 (다시 불러올 때는 이전 내용을 그대로 보여 줌)
 */
let firstLoads = 0
const firstLoadListeners = new Set<() => void>()
const bumpFirst = (d: number) => {
  firstLoads = Math.max(0, firstLoads + d)
  firstLoadListeners.forEach(l => l())
}
export const useFirstLoading = () =>
  useSyncExternalStore(
    cb => {
      firstLoadListeners.add(cb)
      return () => firstLoadListeners.delete(cb)
    },
    () => firstLoads > 0,
  )

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, initialValue: T): { data: T; loading: boolean; error: string | null; reload: () => void; setData: (v: T) => void } {
  const [data, setData] = useState<T>(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const loaded = useRef(false)
  useEffect(() => {
    let alive = true
    const first = !loaded.current
    if (first) bumpFirst(1)
    let counted = first
    const done = () => {
      if (counted) {
        counted = false
        bumpFirst(-1)
      }
    }
    setLoading(true)
    fnRef
      .current()
      .then(v => {
        if (alive) {
          setData(v)
          setError(null)
          loaded.current = true
        }
      })
      .catch(e => alive && setError(friendlyError(e)))
      .finally(() => {
        done()
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      done()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, error, reload, setData }
}

/** 버튼 처리용: 실행 중 표시 + 오류 토스트 */
export function useAction() {
  const { toast, bump } = useApp()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMsg?: string) => {
      setBusy(true)
      try {
        await fn()
        bump()
        if (okMsg) toast(okMsg)
        return true
      } catch (e) {
        toast(friendlyError(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [toast, bump],
  )
  return { busy, run }
}
