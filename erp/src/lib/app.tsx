import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DependencyList, type ReactNode } from 'react'
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
  /** 빠른 기록 창 띄우기 (PiP 또는 팝업) */
  openQuick: () => void
}

const AppContext = createContext<AppValue | null>(null)

interface ProviderProps {
  me: Profile
  profiles: Profile[]
  version: number
  bump: () => void
  toast: (m: string) => void
  openQuick: () => void
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
  return (name ?? '?').trim().charAt(0) || '?'
}

/** 비동기 데이터 로딩. deps 또는 전역 version 이 바뀌면 다시 불러온다. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, initialValue: T): { data: T; loading: boolean; error: string | null; reload: () => void; setData: (v: T) => void } {
  const [data, setData] = useState<T>(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    let alive = true
    setLoading(true)
    fnRef
      .current()
      .then(v => {
        if (alive) {
          setData(v)
          setError(null)
        }
      })
      .catch(e => alive && setError(friendlyError(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
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
