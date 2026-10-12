import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type MouseEvent } from 'react'

// 화면 수가 적어 라우터 라이브러리 없이 History API 로 처리
interface RouterValue {
  path: string
  query: URLSearchParams
  navigate: (to: string, opts?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function current() {
  return window.location.pathname + window.location.search
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(current)

  useEffect(() => {
    const onPop = () => setLoc(current())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (!to.startsWith('/')) return // 앱 내부 경로만 허용
    if (opts?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLoc(current())
  }, [])

  const value = useMemo(() => {
    const url = new URL(loc, window.location.origin)
    return { path: url.pathname, query: url.searchParams, navigate }
  }, [loc, navigate])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('RouterProvider 가 필요합니다')
  return ctx
}

/** 현재 쿼리에 key=value 를 바꾼 경로 */
export function withQuery(path: string, query: URLSearchParams, patch: Record<string, string | null>): string {
  const q = new URLSearchParams(query)
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') q.delete(k)
    else q.set(k, v)
  }
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

export function Link({ to, className, children, title }: { to: string; className?: string; children: ReactNode; title?: string }) {
  const { navigate } = useRouter()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} className={className} onClick={onClick} title={title}>
      {children}
    </a>
  )
}
