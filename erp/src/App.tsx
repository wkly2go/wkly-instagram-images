import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, AppProvider } from './lib/app'
import { friendlyError } from './lib/api'
import { openPipWindow, openQuickPopup, supportsPip } from './lib/pip'
import { useRouter } from './lib/router'
import type { Profile } from './lib/types'
import Approvals from './pages/Approvals'
import Chat from './pages/Chat'
import Clients from './pages/Clients'
import Home from './pages/Home'
import Login from './pages/Login'
import Projects from './pages/Projects'
import Quick from './pages/Quick'
import Team from './pages/Team'
import WorkLog from './pages/WorkLog'

const PAGES: Record<string, () => JSX.Element> = {
  '/': Home,
  '/approvals': Approvals,
  '/chat': Chat,
  '/work': WorkLog,
  '/projects': Projects,
  '/clients': Clients,
  '/team': Team,
}

export default function App() {
  const { path } = useRouter()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [pipWin, setPipWin] = useState<Window | null>(null)
  const toastTimer = useRef<number>()

  const bump = useCallback(() => setVersion(v => v + 1), [])
  const toast = useCallback((m: string) => {
    setToastMsg(m)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  useEffect(() => {
    api.getSessionUserId().then(setUserId)
    return api.onAuthChange(id => setUserId(id))
  }, [])

  useEffect(() => {
    if (!userId) {
      setProfiles(null)
      return
    }
    api
      .listProfiles()
      .then(p => {
        setProfiles(p)
        setLoadError(null)
      })
      .catch(e => setLoadError(friendlyError(e)))
  }, [userId, version])

  // 실시간: 새 채팅·승인·상태 변경이 오면 화면 숫자를 새로 고침
  useEffect(() => {
    if (!userId) return
    const offMsg = api.subscribeMessages(null, bump)
    const offChanges = api.subscribeChanges(['approvals', 'profiles'], bump)
    return () => {
      offMsg()
      offChanges()
    }
  }, [userId, bump])

  const openQuick = useCallback(async () => {
    if (supportsPip()) {
      try {
        const w = await openPipWindow()
        if (w) {
          setPipWin(w)
          w.addEventListener('pagehide', () => setPipWin(null), { once: true })
          return
        }
      } catch {
        /* 사용자가 거부하는 등 실패하면 팝업으로 */
      }
    }
    openQuickPopup()
  }, [])

  if (userId === undefined) return <div className="center-page t-bodyb">불러오는 중…</div>
  if (!userId) return <Login />
  if (loadError) return <Blocked message={loadError} />
  if (!profiles) return <div className="center-page t-bodyb">불러오는 중…</div>
  const me = profiles.find(p => p.id === userId)
  if (!me || !me.active) return <Blocked message="비활성화된 계정이거나 프로필이 없습니다. 관리자에게 문의하세요." />

  const Page = PAGES[path] ?? Home
  return (
    <AppProvider me={me} profiles={profiles} version={version} bump={bump} toast={toast} openQuick={openQuick}>
      {path === '/quick' ? <Quick /> : <Page />}
      {pipWin && createPortal(<Quick onClose={() => pipWin.close()} />, pipWin.document.body)}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </AppProvider>
  )
}

function Blocked({ message }: { message: string }) {
  return (
    <div className="center-page">
      <div className="login">
        <div className="inner" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p className="t-bodyb">{message}</p>
          <button type="button" className="btn btn-outline" onClick={() => api.signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}
