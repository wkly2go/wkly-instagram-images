import { useState, type ReactNode } from 'react'
import { CircleHelp, PictureInPicture2 } from 'lucide-react'
import { NotificationBell } from './Notifications'
import { useApp, useAsync, initial } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { Link, useRouter } from '../lib/router'
import { TODAY_STATUSES, type TodayStatus } from '../lib/types'
import { toneOf } from './ui'

export type TabKey = 'home' | 'approvals' | 'chat' | 'work' | 'projects' | 'clients' | 'library' | 'team' | 'admin'

const TABS: { key: TabKey; label: string; path: string; admin?: boolean }[] = [
  { key: 'home', label: '홈', path: '/' },
  { key: 'approvals', label: '승인', path: '/approvals' },
  { key: 'chat', label: '채팅', path: '/chat' },
  { key: 'work', label: '업무', path: '/work' },
  { key: 'projects', label: '프로젝트', path: '/projects' },
  { key: 'clients', label: '거래처', path: '/clients' },
  { key: 'library', label: '자료실', path: '/library' },
  { key: 'team', label: '팀', path: '/team' },
  { key: 'admin', label: '관리', path: '/admin', admin: true },
]

export interface Summary {
  myOpenTasks: number
  pendingToDecide: number
  unread: number
  todayLogs: number
  totalLogs: number
}

/** 프로필 칸·탭·카운터에 쓰는 요약 숫자 */
export function useSummary(): Summary {
  const { api, me, version } = useApp()
  const { data } = useAsync<Summary>(
    async () => {
      const today = todayKey()
      const [tasks, approvals, rooms, counts] = await Promise.all([api.listTasks(), api.listApprovals(), api.listRooms(), api.countWorkLogs(today)])
      return {
        myOpenTasks: tasks.filter(t => t.assignee_id === me.id && t.status !== '완료').length,
        pendingToDecide: approvals.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin')).length,
        unread: rooms.reduce((s, r) => s + r.unread, 0),
        todayLogs: counts.today,
        totalLogs: counts.total,
      }
    },
    [version, me.id],
    { myOpenTasks: 0, pendingToDecide: 0, unread: 0, todayLogs: 0, totalLogs: 0 },
  )
  return data
}

function ProfilePanel({ summary }: { summary: Summary }) {
  const { api, me, profiles, bump, toast } = useApp()
  const { navigate } = useRouter()
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
      <div className={`photo ${toneOf(me.name)}`} aria-hidden="true">
        {initial(me.name)}
      </div>
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
      <label className="surf">
        <select
          value=""
          onChange={e => e.target.value && navigate(`/work?user=${e.target.value}`)}
          aria-label="팀원 파도타기: 팀원의 오늘 업무 보기"
        >
          <option value="">팀원 파도타기</option>
          {profiles
            .filter(p => p.active && p.id !== me.id)
            .map(p => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.today_status}
              </option>
            ))}
        </select>
      </label>
    </aside>
  )
}

export function Shell({ active, flush, children }: { active: TabKey; flush?: boolean; children: ReactNode }) {
  const { api, me, openQuick } = useApp()
  const summary = useSummary()
  return (
    <div className="page">
      <div className="brandbar">
        <Link to="/" className="logo-link" aria-label="THE WKLY 홈">
          <img src="/wkly-logo-white.svg" alt="WKLY" width={120} height={38} />
        </Link>
        <span className="brand-sub">THE WKLY · 사내 미니홈피</span>
      </div>
      <div className="mini">
        <div className="book">
          <div className="inner">
            <header className="topbar">
              <div className="counter t-meta" title="오늘 / 전체 업무 기록 수">
                TODAY <span className="today">{summary.todayLogs}</span>
                <span className="sep">|</span>
                TOTAL <span className="total">{summary.totalLogs.toLocaleString('ko-KR')}</span>
              </div>
              <span className="site-title">THE WKLY 사내 미니홈피</span>
              <span className="site-url t-meta">{window.location.host}</span>
              <span className="grow" />
              {api.mode === 'demo' && <span className="mode-badge" title="Supabase 연결 전 체험 모드. 데이터는 이 브라우저에만 저장됩니다.">DEMO</span>}
              <NotificationBell />
              <Link to="/help" className="quick-btn" title="사용법" style={{ textDecoration: 'none' }}>
                <CircleHelp size={14} /> 사용법
              </Link>
              <button type="button" className="quick-btn" onClick={openQuick} title="다른 프로그램 위에 떠 있는 작은 기록 창">
                <PictureInPicture2 size={14} /> 빠른 기록 창 띄우기
              </button>
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
