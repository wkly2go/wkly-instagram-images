import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react'
import { isDesktopApp } from '../lib/desktop'
import { NotificationBell } from './Notifications'
import { WebSearchBox } from './WebSearch'
import { useApp, useAsync, initial } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addDays, addMonths, monthGrid, todayKey } from '../lib/date'
import { squareThumb } from '../lib/image'
import { inQuickWindow } from '../lib/pip'
import { Link, useRouter } from '../lib/router'
import { TODAY_STATUSES, type TodayStatus } from '../lib/types'
import { toneOf } from './ui'

export type TabKey = 'home' | 'approvals' | 'chat' | 'work' | 'projects' | 'clients' | 'library' | 'team' | 'agents' | 'ads' | 'admin'

export const TABS: { key: TabKey; label: string; path: string; admin?: boolean }[] = [
  { key: 'home', label: '홈', path: '/' },
  { key: 'approvals', label: '승인', path: '/approvals' },
  { key: 'chat', label: '채팅', path: '/chat' },
  { key: 'work', label: '업무', path: '/work' },
  { key: 'projects', label: '프로젝트', path: '/projects' },
  { key: 'clients', label: '거래처', path: '/clients' },
  { key: 'library', label: '자료실', path: '/library' },
  { key: 'team', label: '팀·근태', path: '/team' },
  { key: 'agents', label: 'AI팀', path: '/agents', admin: true },
  { key: 'ads', label: '광고', path: '/ads', admin: true },
  { key: 'admin', label: '관리', path: '/admin', admin: true },
]

export interface Summary {
  myOpenTasks: number
  pendingToDecide: number
  unread: number
}

/** 프로필 칸·탭·카운터에 쓰는 요약 숫자 */
export function useSummary(): Summary {
  const { api, me, version } = useApp()
  const { data } = useAsync<Summary>(
    async () => {
      const [tasks, approvals, rooms] = await Promise.all([api.listTasks(), api.listApprovals(), api.listRooms()])
      return {
        myOpenTasks: tasks.filter(t => t.assignee_id === me.id && t.status !== '완료').length,
        pendingToDecide: approvals.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin')).length,
        unread: rooms.reduce((s, r) => s + r.unread, 0),
      }
    },
    [version, me.id],
    { myOpenTasks: 0, pendingToDecide: 0, unread: 0 },
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

function ProfilePanel({ summary }: { summary: Summary }) {
  const { api, me, bump, toast } = useApp()
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
      <nav className="my-counts" aria-label="내 현황">
        <Link to="/projects?view=mine">
          · 내 할 일 <span className="n">{summary.myOpenTasks}</span>
        </Link>
        <Link to="/approvals">
          · 승인 대기 <span className="n">{summary.pendingToDecide}</span>
        </Link>
        <Link to="/chat">
          · 안 읽은 채팅 <span className="n">{summary.unread}</span>
        </Link>
      </nav>
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

export function Shell({ active, flush, children }: { active: TabKey; flush?: boolean; children: ReactNode }) {
  const { api, me, openQuick } = useApp()
  const summary = useSummary()
  return (
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
              <WebSearchBox />
              <span className="grow" />
              {api.mode === 'demo' && <span className="mode-badge" title="Supabase 연결 전 체험 모드. 데이터는 이 브라우저에만 저장됩니다.">DEMO</span>}
              <NotificationBell />
              {!isDesktopApp() && (
                <Link to="/download" className="quick-btn pc-only" title="회사 컴퓨터용 PC 프로그램 (출근 기록)" style={{ textDecoration: 'none' }}>
                  PC 프로그램
                </Link>
              )}
              <Link to="/help" className="quick-btn" title="사용법" style={{ textDecoration: 'none' }}>
                <CircleHelp size={14} /> <span className="hide-phone">사용법</span>
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
            </header>
            <div className="body">
              <ProfilePanel summary={summary} />
              <main className={`main ${flush ? 'flush' : ''}`}>{children}</main>
            </div>
          </div>
        </div>
        <nav className="tabs" aria-label="메뉴">
          {TABS.filter(t => !t.admin || me.role === 'admin').map(t => {
            const dot = t.key === 'approvals' ? summary.pendingToDecide : t.key === 'chat' ? summary.unread : 0
            return (
              <Link key={t.key} to={t.path} className={`tab ${t.key === active ? 'active' : ''}`}>
                {t.label}
                {dot > 0 && t.key !== active && <span className="dot">{dot > 99 ? '99+' : dot}</span>}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
