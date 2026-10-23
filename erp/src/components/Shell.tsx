import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Bookmark, Bot, ListTodo, Plus, Search, Briefcase, HardDrive, MonitorDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, FolderKanban, Home, Library, Megaphone, MessageCircle, MoreHorizontal, Settings, Users, type LucideIcon } from 'lucide-react'
import { isDesktopApp } from '../lib/desktop'
import { AssignTaskModal } from './AssignTask'
import { NotificationBell } from './Notifications'
import { WebSearchBox, webSlot } from './WebSearch'
import { openCommandPalette } from './CommandPalette'
import { detailSlot } from './RightPanel'

/** 검색 창 자리(한 개뿐인 DOM)를 이 화면의 .body 끝으로 옮김 */
const mountWebSlot = (el: HTMLDivElement | null) => {
  if (!el) return
  // 순서: … 본 화면 │ 결과 칸 │ 인터넷 칸
  if (detailSlot && detailSlot.parentElement !== el) el.appendChild(detailSlot)
  if (webSlot && (webSlot.parentElement !== el || webSlot.previousSibling !== detailSlot)) el.appendChild(webSlot)
}
import { useApp, useAsync, initial } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addDays, addMonths, monthGrid, todayKey } from '../lib/date'
import { squareThumb } from '../lib/image'
import { inQuickWindow } from '../lib/pip'
import { Link, useRouter } from '../lib/router'
import { TODAY_STATUSES, type TodayStatus } from '../lib/types'
import { Presence, toneOf } from './ui'
import { countedUnread, rememberRoomLevels } from '../lib/chat'

export type TabKey = 'home' | 'approvals' | 'chat' | 'work' | 'projects' | 'clients' | 'library' | 'drive' | 'team' | 'agents' | 'ads' | 'admin'

export const TABS: { key: TabKey; label: string; path: string; admin?: boolean }[] = [
  { key: 'home', label: '홈', path: '/' },
  { key: 'approvals', label: '보고서 결제', path: '/approvals' },
  { key: 'chat', label: '채팅', path: '/chat' },
  { key: 'projects', label: '프로젝트', path: '/projects' },
  { key: 'drive', label: '드라이브', path: '/drive' },
  { key: 'team', label: '업무·근태', path: '/team' },
  { key: 'agents', label: 'AI팀', path: '/agents' },
  { key: 'ads', label: '광고', path: '/ads', admin: true },
  { key: 'admin', label: '관리', path: '/admin', admin: true },
]

/** 휴대폰 · 태블릿 아래 메뉴: 자주 쓰는 4개 + 더보기 */
const ICONS: Record<TabKey, LucideIcon> = {
  home: Home,
  approvals: ClipboardCheck,
  chat: MessageCircle,
  work: Briefcase,
  projects: FolderKanban,
  clients: Briefcase,
  library: Library,
  drive: HardDrive,
  team: Users,
  agents: Bot,
  ads: Megaphone,
  admin: Settings,
}
const MAIN_TABS: TabKey[] = ['home', 'approvals', 'chat', 'projects']
const SHORT: Partial<Record<TabKey, string>> = { approvals: '결제' }

export interface Summary {
  myOpenTasks: number
  pendingToDecide: number
  unread: number
  /** 나중에 보기 (안 끝낸 것) */
  saved?: number
}

/** 프로필 칸·탭·카운터에 쓰는 요약 숫자 */
export function useSummary(): Summary {
  const { api, me, version } = useApp()
  const { data } = useAsync<Summary>(
    async () => {
      const [tasks, approvals, rooms, saved] = await Promise.all([api.listTasks(), api.listApprovals(), api.listRooms(), api.listSaved().catch(() => [])])
      return {
        myOpenTasks: tasks.filter(t => t.assignee_id === me.id && t.status !== '완료').length,
        pendingToDecide: approvals.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin')).length,
        // 방마다 알림 단계 반영: 멘션만인 방은 나를 부른 것만, 끈 방은 세지 않음
        unread: (rememberRoomLevels(rooms), rooms.reduce((s, r) => s + countedUnread(r), 0)),
        saved: saved.length,
      }
    },
    [version, me.id],
    { myOpenTasks: 0, pendingToDecide: 0, unread: 0, saved: 0 },
  )
  return data
}

/** 왼쪽 프로필 사진: 눌러서 올리기 · 바꾸기 (256px 로 줄여 저장) */
function PhotoBox() {
  const { api, me, bump, toast } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const put = async (photo: string | null) => {
    setBusy(true)
    try {
      await api.updateProfile(me.id, { photo })
      bump()
      toast(photo ? '사진을 올렸습니다.' : '사진을 지웠습니다.')
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await put(await squareThumb(file))
    } catch (err) {
      toast(friendlyError(err))
    }
  }
  return (
    <div className="photo-wrap">
      <button
        type="button"
        className={`photo ${me.photo ? 'has-img' : toneOf(me.name)}`}
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={me.photo ? '프로필 사진 바꾸기' : '프로필 사진 올리기'}
        title={me.photo ? '사진 바꾸기' : '사진 올리기'}
      >
        {me.photo ? <img src={me.photo} alt="" /> : <span aria-hidden="true">{initial(me.name)}</span>}
        <Presence status={me.today_status} className="on-photo" />
        <span className="photo-cta">
          {busy ? '올리는 중…' : me.photo ? '사진 바꾸기' : '사진 올리기'}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {me.photo && (
        <button type="button" className="btn-ghost photo-del t-cap" onClick={() => put(null)} disabled={busy}>
          사진 지우기
        </button>
      )}
    </div>
  )
}

/**
 * 왼쪽 메뉴 (2026-10-23 "오른쪽 탭은 삭제, 다른 방법"): 아이콘 · 이름 · 처리할 숫자를 한 줄씩
 *  - 맨 위 '+ 새로 만들기' 하나로 할 일 · 결재 · 프로젝트 · 업무 일지 · 메시지 · AI 지시
 */
function SideNav({ active, summary }: { active: TabKey; summary: Summary }) {
  const { me } = useApp()
  const count = (k: TabKey) => (k === 'approvals' ? summary.pendingToDecide : k === 'chat' ? summary.unread : k === 'projects' ? summary.myOpenTasks : 0)
  return (
    <nav className="side-nav" aria-label="메뉴">
      <NewMenu />
      {TABS.filter(t => !t.admin || me.role === 'admin').map((t, i) => {
        const Icon = ICONS[t.key]
        const n = count(t.key)
        return (
          <Link key={t.key} to={t.path} className={`side-item ${t.key === active ? 'on' : ''} ${n && t.key !== 'projects' ? 'has-n' : ''}`} title={`${t.label} (Alt+${i + 1})`}>
            <Icon size={15} aria-hidden="true" />
            <span className="grow">{t.label}</span>
            {n > 0 && <span className={`side-n ${t.key === 'projects' ? 'soft' : ''}`}>{n > 99 ? '99+' : n}</span>}
          </Link>
        )
      })}
      {!!summary.saved && (
        <Link to="/chat?view=saved" className="side-item sub">
          <Bookmark size={13} aria-hidden="true" />
          <span className="grow">나중에 보기</span>
          <span className="side-n soft">{summary.saved}</span>
        </Link>
      )}
    </nav>
  )
}

function NewMenu() {
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [task, setTask] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const items: [string, LucideIcon, () => void][] = [
    ['할 일 · 업무 지시', ListTodo, () => setTask(true)],
    ['보고서 결제 올리기', ClipboardCheck, () => navigate('/approvals?new=1')],
    ['새 프로젝트', FolderKanban, () => navigate('/projects?new=1')],
    ['업무 일지 쓰기', Briefcase, () => navigate('/work')],
    ['메시지 · 1:1 대화', MessageCircle, () => navigate('/chat')],
    ['AI 에게 시키기', Bot, () => openCommandPalette()],
  ]
  return (
    <div className="new-menu" ref={ref}>
      <button type="button" className="new-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Plus size={15} /> 새로 만들기
      </button>
      {open && (
        <div className="new-pop" role="menu">
          {items.map(([label, Icon, run]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                run()
              }}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {task && <AssignTaskModal onClose={() => setTask(false)} />}
    </div>
  )
}

function ProfilePanel({ summary, active }: { summary: Summary; active: TabKey }) {
  const { api, me, bump, toast, openQuick } = useApp()
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState(me.status_message ?? '')

  const save = async (patch: { today_status?: TodayStatus; status_message?: string | null }) => {
    try {
      await api.updateProfile(me.id, patch)
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <aside className="profile" aria-label="내 프로필">
      <PhotoBox />
      <MiniCalendar />
      <SideNav active={active} summary={summary} />
      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <span className="t-bodyb">{me.name}</span>
        {me.title && <span className="t-cap">{me.title}</span>}
      </div>
      <label className="today-is">
        <span className="t-meta">TODAY IS</span>
        <select value={me.today_status} onChange={e => save({ today_status: e.target.value as TodayStatus })} aria-label="오늘 상태">
          {TODAY_STATUSES.map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {editing ? (
        <div className="status-msg">
          <textarea
            autoFocus
            rows={3}
            maxLength={80}
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (msg !== (me.status_message ?? '')) save({ status_message: msg.trim() || null })
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
            aria-label="오늘의 한마디"
          />
        </div>
      ) : (
        <div
          className="status-msg"
          role="button"
          tabIndex={0}
          title="눌러서 오늘의 한마디 수정"
          onClick={() => {
            setMsg(me.status_message ?? '')
            setEditing(true)
          }}
          onKeyDown={e => e.key === 'Enter' && setEditing(true)}
        >
          {me.status_message || <span className="t-muted">오늘의 한마디를 남겨 보세요.</span>}
        </div>
      )}
      <div className="side-tools">
        <Link to="/help" className="quick-btn" title="사용법" style={{ textDecoration: 'none' }}>
          <CircleHelp size={14} /> 사용법
        </Link>
        {inQuickWindow() ? (
          <Link to="/quick" className="quick-btn" style={{ textDecoration: 'none' }}>
            빠른 창으로
          </Link>
        ) : (
          <button type="button" className="quick-btn pc-only" onClick={() => openQuick('window')} title="작은 독립 창. 전체 창을 닫아도 계속 쓸 수 있습니다.">
            빠른 창 띄우기
          </button>
        )}
      </div>
    </aside>
  )
}

/** 왼쪽 위 작은 달력: 일정이 있는 날에 점, 날짜를 누르면 큰 달력으로 */
function MiniCalendar() {
  const { api, me, version, profileName } = useApp()
  const { navigate, path, query } = useRouter()
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const { data } = useAsync(
    async () => {
      const [tasks, projects, leaves] = await Promise.all([api.listTasks(), api.listProjects(), api.listLeave()])
      return { tasks, projects, leaves }
    },
    [version],
    { tasks: [], projects: [], leaves: [] } as { tasks: Awaited<ReturnType<typeof api.listTasks>>; projects: Awaited<ReturnType<typeof api.listProjects>>; leaves: Awaited<ReturnType<typeof api.listLeave>> },
  )
  const byDay = useMemo(() => {
    const m = new Map<string, { mine: boolean; labels: string[] }>()
    const add = (d: string | null | undefined, label: string, mine = false) => {
      if (!d || d.slice(0, 7) !== month) return
      const cur = m.get(d) ?? { mine: false, labels: [] }
      m.set(d, { mine: cur.mine || mine, labels: [...cur.labels, label] })
    }
    for (const t of data.tasks) {
      if (t.status === '완료') continue
      add(t.due_date ?? t.start_date, `${t.title} · ${profileName(t.assignee_id)}`, t.assignee_id === me.id)
    }
    for (const p of data.projects) {
      if (p.status === '보류') continue
      add(p.start_date, `${p.name} 시작`)
      add(p.end_date, `${p.name} 종료`)
    }
    for (const l of data.leaves) {
      if (l.status !== '승인') continue
      for (let d = l.start_date; d <= l.end_date; d = addDays(d, 1)) add(d, `${profileName(l.profile_id)} ${l.kind}`, l.profile_id === me.id)
    }
    return m
  }, [data, month, me.id, profileName])
  const [y, mo] = month.split('-')
  // 주간 보기 중이면 그 주(월~일)를 표시
  const weekOf = useMemo<[string, string] | null>(() => {
    if (path !== '/projects' || query.get('view') !== 'week') return null
    const d = query.get('date') ?? today
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
    return [addDays(d, -dow), addDays(d, 6 - dow)]
  }, [path, query, today])
  return (
    <section className="mini-cal" aria-label="이번 달 달력">
      <div className="row">
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="mini-cal-title grow" onClick={() => setMonth(today.slice(0, 7))} title="이번 달로">
          {y}.{mo}
        </button>
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map(w => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {monthGrid(month).map((d, i) => {
          if (!d) return <span key={i} />
          const ev = byDay.get(d)
          const dow = i % 7
          return (
            <button
              key={d}
              type="button"
              className={`day${d === today ? ' today' : ''}${dow === 0 ? ' sun' : ''}${weekOf && d >= weekOf[0] && d <= weekOf[1] ? ' in-week' : ''}`}
              title={ev ? ev.labels.join('\n') : '이 주 일정 보기'}
              onClick={() => navigate(`/projects?view=week&date=${d}`)}
            >
              {Number(d.slice(8))}
              {ev && <i className={ev.mine ? 'mine' : ''} />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** 로고: 흰 로고는 시리즈 블루 위에서만 (로고 규정 허용 조합). 로그인 카드 위에 씀 */
export function LogoTile() {
  return (
    <Link to="/" className="profile-logo" aria-label="THE WKLY 홈" style={{ alignSelf: 'center' }}>
      <img src="/logo-on-series.svg" alt="WKLY" width={120} height={54} />
    </Link>
  )
}

/**
 * 화면 틀 (위쪽 줄 · 프로필 · 왼쪽 메뉴 · 인터넷 칸)은 한 번만 만들고 계속 유지 (2026-10-22 "화면 전환 애니메이션이 부자연스러워")
 *  - 예전: 화면마다 <Shell> 을 새로 만들어 이동할 때마다 틀 전체가 지워졌다 다시 그려짐 → 깜빡임 · 숫자 0 표시 · 인터넷 칸 다시 나타남
 *  - 지금: App 이 <ShellFrame> 을 한 번 그리고, 각 화면의 <Shell> 은 탭 표시(active · flush)만 알려 줌. 가운데만 부드럽게 바뀜
 */
type ShellState = { active: TabKey; flush: boolean }
const ShellCtx = createContext<((s: ShellState) => void) | null>(null)

export function Shell({ active, flush, children }: { active: TabKey; flush?: boolean; children: ReactNode }) {
  const set = useContext(ShellCtx)
  useLayoutEffect(() => {
    set?.({ active, flush: !!flush })
  }, [set, active, flush])
  if (!set) return <ShellFrame initial={{ active, flush: !!flush }}>{children}</ShellFrame>
  return <>{children}</>
}

function OneBox() {
  return (
    <div className="top-ai one-box" onClick={() => openCommandPalette()}>
      <Search size={14} aria-hidden="true" />
      <input
        readOnly
        value=""
        placeholder="찾기 · WKLY 총괄에게 묻기 · 인터넷 검색"
        aria-label="찾기 · AI 에게 묻기 · 인터넷 검색 (Ctrl K)"
        title="사람 · 프로젝트 · 파일 찾기, AI 에게 묻기, 인터넷 검색"
        // 한글 입력(IME)이 끊기지 않게, 칸에 들어오면 바로 찾기 창으로 옮겨 그곳에서 입력
        onFocus={e => {
          e.currentTarget.blur()
          openCommandPalette()
        }}
      />
      <kbd className="pc-only">Ctrl K</kbd>
    </div>
  )
}

export function ShellFrame({ children, initial }: { children: ReactNode; initial?: ShellState }) {
  const { api } = useApp()
  const { path } = useRouter()
  const summary = useSummary()
  const [{ active, flush }, setState] = useState<ShellState>(initial ?? { active: 'home', flush: false })
  const set = useCallback((s: ShellState) => setState(o => (o.active === s.active && o.flush === s.flush ? o : s)), [])
  const mainRef = useRef<HTMLElement>(null)
  // 화면을 옮기면 가운데 창은 맨 위부터
  useLayoutEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 })
  }, [path])
  return (
    <ShellCtx.Provider value={set}>
    <div className={`page app-page tab-${active}`}>
      <div className="mini">
        <div className="book">
          <div className="inner">
            <header className="topbar">
              <Link to="/" className="top-logo" aria-label="THE WKLY 홈">
                <img src="/wkly-logo-blue.svg" alt="WKLY" width={76} height={24} />
              </Link>
              <span className="site-title">사내 인트라넷</span>
              <span className="site-url t-meta">{window.location.host}</span>
              {api.mode === 'demo' && <span className="mode-badge" title="Supabase 연결 전 체험 모드. 데이터는 이 브라우저에만 저장됩니다.">DEMO</span>}
              {/* 입력칸 하나 (2026-10-23): 찾기 · AI 에게 묻기 · 인터넷 검색을 Ctrl K 한 칸으로 */}
              <OneBox />
              <NotificationBell />
              {!isDesktopApp() && (
                <Link to="/download" className="quick-btn pc-only" title="PC 프로그램 내려받기 (회사 컴퓨터 · 출근 기록)" style={{ textDecoration: 'none' }}>
                  <MonitorDown size={15} aria-label="PC 프로그램 내려받기" />
                </Link>
              )}
              {/* 검색창만 오른쪽 끝, 나머지(알림 · 창 숨기기 · 글자 크기 등)는 왼쪽 — 순서는 styles.css 의 order */}
              <WebSearchBox inputHidden />
              <span className="grow" />
            </header>
            <div className="body" ref={mountWebSlot}>
              <ProfilePanel summary={summary} active={active} />
              <main ref={mainRef} className={`main ${flush ? 'flush' : ''}`}>
                {/* 가운데 창 뒤로 · 앞으로 (인트라넷 화면 이동 기록) */}
                <div className="main-nav" role="group" aria-label="화면 이동">
                  <button type="button" className="main-nav-btn" onClick={() => window.history.back()} aria-label="이전 화면" title="이전 화면">
                    <ChevronLeft size={13} /> 뒤로
                  </button>
                  <button type="button" className="main-nav-btn" onClick={() => window.history.forward()} aria-label="다음 화면" title="다음 화면">
                    앞으로 <ChevronRight size={13} />
                  </button>
                </div>
                {/* 화면이 바뀔 때만 가운데 내용이 살짝 나타남 (같은 화면 안 탭 · 검색 이동은 그대로) */}
                <div className="main-view" key={path}>
                  {children}
                </div>
              </main>
            </div>
          </div>
        </div>
        <MobileNav active={active} summary={summary} />
      </div>
    </div>
    </ShellCtx.Provider>
  )
}

/** 휴대폰 · 태블릿(터치 화면) 아래 고정 메뉴: 홈 · 결제 · 채팅 · 프로젝트 · 더보기 (나머지 메뉴는 더보기 시트) */
function MobileNav({ active, summary }: { active: TabKey; summary: Summary }) {
  const { me } = useApp()
  const [more, setMore] = useState(false)
  const tabs = TABS.filter(t => !t.admin || me.role === 'admin')
  const rest = tabs.filter(t => !MAIN_TABS.includes(t.key))
  const dotOf = (k: TabKey) => (k === 'approvals' ? summary.pendingToDecide : k === 'chat' ? summary.unread : 0)
  const restActive = rest.some(t => t.key === active)
  return (
    <>
      <nav className="m-nav" aria-label="메뉴">
        {tabs
          .filter(t => MAIN_TABS.includes(t.key))
          .map(t => {
            const Icon = ICONS[t.key]
            const dot = dotOf(t.key)
            return (
              <Link key={t.key} to={t.path} className={t.key === active ? 'on' : ''} aria-current={t.key === active ? 'page' : undefined}>
                <Icon size={20} aria-hidden="true" />
                {SHORT[t.key] ?? t.label}
                {dot > 0 && <span className="m-dot">{dot > 99 ? '99+' : dot}</span>}
              </Link>
            )
          })}
        <button type="button" className={restActive || more ? 'on' : ''} onClick={() => setMore(v => !v)} aria-expanded={more}>
          <MoreHorizontal size={20} aria-hidden="true" />
          {restActive ? (SHORT[active] ?? TABS.find(t => t.key === active)?.label) : '더보기'}
        </button>
      </nav>
      {more && (
        <div className="m-more-scrim" onClick={() => setMore(false)}>
          <div className="m-more" role="dialog" aria-label="전체 메뉴" onClick={e => e.stopPropagation()}>
            <div className="m-more-grid">
              {rest.map(t => {
                const Icon = ICONS[t.key]
                return (
                  <Link key={t.key} to={t.path} className={t.key === active ? 'on' : ''} onNavigate={() => setMore(false)}>
                    <Icon size={22} aria-hidden="true" />
                    {t.label}
                  </Link>
                )
              })}
              <Link to="/help" onNavigate={() => setMore(false)}>
                <CircleHelp size={22} aria-hidden="true" />
                사용법
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
