import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from 'react'

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
  const currentLocation = useRef(loc)

  // 작성 화면은 저장 전 이동을 취소할 수 있다. 버튼·단축키·뒤로 가기도 같은 경로를 사용한다.
  const canNavigate = useCallback((to: string) => window.dispatchEvent(new CustomEvent('wkly:before-navigate', { cancelable: true, detail: { to } })), [])

  useEffect(() => {
    const onPop = () => {
      const to = current()
      if (to === currentLocation.current) return
      if (!canNavigate(to)) {
        window.history.pushState(null, '', currentLocation.current)
        return
      }
      currentLocation.current = to
      setLoc(to)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [canNavigate])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (!to.startsWith('/')) return // 앱 내부 경로만 허용
    if (to !== currentLocation.current && !canNavigate(to)) return
    if (opts?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    currentLocation.current = current()
    setLoc(currentLocation.current)
  }, [canNavigate])

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

export function Link({ to, className, children, title, style, onNavigate }: { to: string; className?: string; children: ReactNode; title?: string; style?: CSSProperties; onNavigate?: () => void }) {
  const { navigate } = useRouter()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onNavigate?.()
    navigate(to)
  }
  return (
    <a href={to} className={className} onClick={onClick} title={title} style={style}>
      {children}
    </a>
  )
}

/** 예전·외부 링크 별칭 (알림 링크 등) → 실제 화면 주소 */
export function normalizePath(to: string): string {
  const [pathname, search = ''] = to.split('?')
  if (pathname === '/library' && new URLSearchParams(search).get('tab') === 'reports') return '/research'
  if (pathname === '/library') {
    const query = new URLSearchParams(search)
    if (!query.get('tab') || query.get('tab') === 'research') {
      query.delete('tab')
      query.set('section', 'research')
      return `/approvals?${query.toString()}`
    }
  }
  if (to.startsWith('/finance')) return '/projects?view=payments'
  const chat = to.match(/^\/chat\/([\w-]+)/)
  if (chat) return `/chat?room=${chat[1]}`
  if (to.startsWith('/projects?task=')) return '/projects?view=mine'
  return to
}
