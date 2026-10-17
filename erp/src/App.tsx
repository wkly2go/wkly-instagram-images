import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WebPanelHost } from './components/WebSearch'
import { api, AppProvider } from './lib/app'
import { friendlyError } from './lib/api'
import { openPipWindow, openQuickPopup, supportsPip } from './lib/pip'
import { normalizePath, useRouter } from './lib/router'
import type { Profile } from './lib/types'
import Approvals from './pages/Approvals'
import Chat from './pages/Chat'
import Clients from './pages/Clients'
import Home from './pages/Home'
import Login from './pages/Login'
import Projects from './pages/Projects'
import Quick from './pages/Quick'
import Admin from './pages/Admin'
import Library from './pages/Library'
import Help from './pages/Help'
import Team from './pages/Team'
import WorkLog from './pages/WorkLog'
import { playAlert } from './lib/sound'
import { accessSource } from './lib/desktop'
import { LockScreen, useSessionPolicy } from './lib/session'
import Download from './pages/Download'
import Agents from './pages/Agents'
import Ads from './pages/Ads'

const PAGES: Record<string, () => JSX.Element> = {
  '/': Home,
  '/approvals': Approvals,
  '/chat': Chat,
  '/work': WorkLog,
  '/projects': Projects,
  '/clients': Clients,
  '/library': Library,
  '/team': Team,
  '/admin': Admin,
  '/agents': Agents,
  '/ads': Ads,
  '/help': Help,
  '/download': Download,
}


export default function App() {
  const { path, query, navigate } = useRouter()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [pipWin, setPipWin] = useState<Window | null>(null)
  const toastTimer = useRef<number>()

  const session = useSessionPolicy(api, userId)

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
      // 처음 불러올 때만 화면을 막고, 이미 열린 뒤 잠깐 끊긴 것은 알림만 (입력 중인 내용 유지)
      .catch(e => (profilesRef.current ? toast(friendlyError(e)) : setLoadError(friendlyError(e))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, version])
  const profilesRef = useRef<Profile[] | null>(null)
  profilesRef.current = profiles

  // 실시간: 새 채팅·승인·상태 변경이 오면 화면 숫자를 새로 고침
  useEffect(() => {
    if (!userId) return
    // 남이 보낸 새 메시지면 알림음 (1:1 대화는 내 방 것만 들어옴)
    const offMsg = api.subscribeMessages(null, e => {
      if (e.type === 'INSERT' && e.message.user_id !== userId) playAlert('chat')
      bump()
    })
    const offChanges = api.subscribeChanges(['approvals', 'profiles', 'notifications'], bump)
    return () => {
      offMsg()
      offChanges()
    }
  }, [userId, bump])

  // 알람: 1분마다 시각이 지난 할 일을 알림으로 (서버 pg_cron 이 없어도 앱이 열려 있으면 동작)
  useEffect(() => {
    if (!userId) return
    let alive = true
    const run = async () => {
      const sent = await api.runReminders().catch(() => 0)
      if (alive && sent > 0) bump()
    }
    run()
    const id = window.setInterval(run, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [userId, bump])

  // 예전·외부 링크(알림 링크 등)를 화면 주소로
  useEffect(() => {
    const full = query.toString() ? `${path}?${query.toString()}` : path
    const alias = normalizePath(full)
    if (alias !== full) navigate(alias, { replace: true })
  }, [path, query, navigate])

  // 근태: 오늘 첫 접속 = 출근. 열려 있는 동안 5분마다·창으로 돌아올 때 마지막 접속 갱신
  useEffect(() => {
    if (!userId) return
    // 창이 보일 때만 기록 (밤새 열어 둔 탭이 자정 출근으로 찍히지 않게)
    const touch = () => document.visibilityState === 'visible' && api.touchAttendance(accessSource()).catch(() => undefined)
    touch()
    const id = window.setInterval(touch, 5 * 60_000)
    const onVisible = () => document.visibilityState === 'visible' && touch()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])

  const openQuick = useCallback(async (kind: 'window' | 'pin' = 'window') => {
    if (kind === 'pin' && supportsPip()) {
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
  if (!userId && path === '/download') return <Download />
  if (!userId) return <Login />
  if (loadError) return <Blocked message={loadError} />
  if (!profiles) return <div className="center-page t-bodyb">불러오는 중…</div>
  const me = profiles.find(p => p.id === userId)
  if (!me || !me.active) return <Blocked message="비활성화된 계정이거나 프로필이 없습니다. 관리자에게 문의하세요." />

  if (session.locked) return <LockScreen api={api} me={me} onUnlock={session.unlock} />

  const Page = PAGES[path] ?? Home
  return (
    <AppProvider me={me} profiles={profiles} version={version} bump={bump} toast={toast} openQuick={openQuick}>
      {path === '/quick' ? <Quick /> : <Page />}
      {path !== '/quick' && <WebPanelHost />}
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
