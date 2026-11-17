import { useState } from 'react'
import { CalendarClock, FileCheck2, FolderKanban, MessageCircle } from 'lucide-react'
import { Linkify } from '../components/ui'
import { countedUnread } from '../lib/chat'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, dateLabel, dateTimeLabel, relativeLabel, shortDate, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import { type Approval, type ApprovalSummary, type ChatMessage, type ChatRoomSummary, type Project, type Task, type WorkLog } from '../lib/types'
import { CheckInCard } from '../components/CheckIn'
import { Shell } from '../components/Shell'
import { AgentDesk } from '../components/AgentDesk'
import { PushSetupCard } from '../components/PushSetup'
import { KindTag, Button, Empty, Modal, SectionHead, StatusBadge } from '../components/ui'
import { DailyReport, DecideButtons, reportSections } from './Approvals'
import { MonthCalendar } from './Schedule'
import { ProjectCards } from '../components/ProjectCards'
import { HomeMyTasks } from '../components/HomeMyTasks'

interface HomeData {
  approvals: ApprovalSummary[]
  logs: WorkLog[]
  tasks: Task[]
  projects: Project[]
  rooms: ChatRoomSummary[]
  shouts: ChatMessage[]
}

export default function Home() {
  const { api, me, version, profileName } = useApp()
  const today = todayKey()
  const { data, loading } = useAsync<HomeData>(
    async () => {
      const [approvals, logs, tasks, projects, rooms] = await Promise.all([api.listApprovals(), api.listWorkLogs({ date: today }), api.listTasks(), api.listProjects(), api.listRooms()])
      const all = rooms.find(r => r.name === '전체')
      const shouts = all ? (await api.listMessages(all.id, 3)).reverse() : []
      return { approvals, logs, tasks, projects, rooms, shouts }
    },
    [version, today],
    { approvals: [], logs: [], tasks: [], projects: [], rooms: [], shouts: [] },
  )

  const toDecide = data.approvals.filter(a => a.status === '대기' && a.can_decide && (a.requested_by !== me.id || me.role === 'admin'))
  const mine = data.approvals.filter(a => a.requested_by === me.id).slice(0, 4)
  const open = data.tasks.filter(t => t.status !== '완료')
  const dueToday = open.filter(t => t.due_date === today)
  const overdue = open.filter(t => t.due_date && t.due_date < today)
  const count = (s: Project['status']) => data.projects.filter(p => p.status === s).length
  const unreadRooms = data.rooms.filter(r => countedUnread(r) > 0)
  const report = data.approvals.filter(a => a.kind === '일일 보고').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  const myOpen = open.filter(t => t.assignee_id === me.id)
  const soon = addDays(today, 2)
  const focus = [...myOpen.filter(t => t.due_date && t.due_date < today), ...myOpen.filter(t => t.due_date === today), ...myOpen.filter(t => t.due_date && t.due_date > today && t.due_date <= soon)].slice(0, 3)
  const myLate = myOpen.filter(t => t.due_date && t.due_date < today).length
  const myToday = myOpen.filter(t => t.due_date === today).length
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date()))
  const hello = hour < 5 ? '늦은 시간까지 수고 많으세요' : hour < 11 ? '좋은 아침이에요' : hour < 17 ? '오후도 힘내세요' : '오늘 하루 수고 많으셨어요'
  const active = data.projects.filter(p => p.status === '진행').sort((a, b) => (a.end_date ?? '9').localeCompare(b.end_date ?? '9'))
  const unread = data.rooms.reduce((s, r) => s + countedUnread(r), 0)

  return (
    <Shell active="home">
      {/* 홈 맨 위: 인사 · 오늘 할 일 3개 · 숫자 카드 (디자인 개편 2단계 · 2026-11-16) */}
      <section className="home-hero" aria-label="오늘 한눈에">
        <div className="home-hello">
          <h1>
            {me.name}님, {hello}
          </h1>
          <span className="t-cap">
            {dateLabel(today)} · 내 할 일 오늘 {myToday}건{myLate ? ` · 지연 ${myLate}건` : ''}
          </span>
        </div>
        <div className="home-focus">
          {focus.length ? (
            focus.map(t => {
              const late = !!t.due_date && t.due_date < today
              const proj = data.projects.find(p => p.id === t.project_id)
              return (
                <Link key={t.id} to={`/projects?view=mine&task=${t.id}`} className={`home-focus-row${late ? ' late' : ''}`}>
                  <span className="home-focus-due">{late ? '지연' : t.due_date === today ? '오늘' : shortDate(t.due_date!)}</span>
                  <span className="truncate grow">{t.title}</span>
                  {proj && <span className="t-cap truncate home-focus-proj">{proj.code ?? proj.name}</span>}
                </Link>
              )
            })
          ) : (
            <span className="t-cap">{loading ? '불러오는 중…' : '이틀 안에 마감인 내 할 일이 없습니다.'}</span>
          )}
          {myOpen.length > focus.length && (
            <Link to="/projects?view=mine" className="t-cap home-focus-more">
              내 할 일 {myOpen.length}건 모두 보기 ›
            </Link>
          )}
        </div>
        <div className="home-kpis">
          <Link to="/approvals" className={`home-kpi${toDecide.length ? ' warn' : ''}`}>
            <span className="home-kpi-tile k-approve" aria-hidden="true"><FileCheck2 size={16} /></span>
            <span className="t-cap">승인 대기</span>
            <b>{toDecide.length}</b>
            <span className="t-cap">{toDecide.length ? '내가 처리할 결재' : '처리할 결재 없음'}</span>
          </Link>
          <Link to="/projects?view=tasks" className={`home-kpi${overdue.length ? ' bad' : ''}`}>
            <span className="home-kpi-tile k-due" aria-hidden="true"><CalendarClock size={16} /></span>
            <span className="t-cap">오늘 마감</span>
            <b>{dueToday.length}</b>
            <span className={`t-cap ${overdue.length ? 't-red' : ''}`}>{overdue.length ? `팀 지연 ${overdue.length}건` : '지연 없음'}</span>
          </Link>
          <Link to="/projects?view=list" className="home-kpi">
            <span className="home-kpi-tile k-proj" aria-hidden="true"><FolderKanban size={16} /></span>
            <span className="t-cap">진행 프로젝트</span>
            <b>{count('진행')}</b>
            <span className="t-cap">
              기획 {count('기획')} · NIC {count('NIC')} · 보류 {count('보류')}
            </span>
          </Link>
          <Link to="/chat" className="home-kpi">
            <span className="home-kpi-tile k-chat" aria-hidden="true"><MessageCircle size={16} /></span>
            <span className="t-cap">안 읽은 채팅</span>
            <b>{unread}</b>
            <span className="t-cap">{unreadRooms.length ? `채팅방 ${unreadRooms.length}곳` : `오늘 업무 기록 ${data.logs.length}건`}</span>
          </Link>
        </div>
      </section>

      {/* 내 할 일 표: 지연 · 오늘 · 이번 주를 홈에서 바로 처리 (대표 지시 2026-11-17 '홈에 내할일 넣어줘') */}
      <HomeMyTasks tasks={data.tasks} projects={data.projects} loading={loading} />

      {/* 진행 프로젝트 카드 줄 (구분 색 · 남은 기간 · 진행 막대 · 남은 할 일) */}
      {active.length > 0 && (
        <section className="section" aria-label="진행 프로젝트">
          <SectionHead title="진행 프로젝트" count={active.length} right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
          <ProjectCards projects={active} tasks={data.tasks} scroll limit={12} />
        </section>
      )}

      {/* 월별 일정표 (대표 지시 2026-10-23) */}
      <section className="section" aria-label="월별 일정표">
        <SectionHead title="월별 일정표" right={<Link to="/projects?view=calendar">크게 보기 ›</Link>} />
        <MonthCalendar projects={data.projects} tasks={data.tasks} />
      </section>
      <CheckInCard />
      <PushSetupCard />
      <SectionHead title="승인 대기" count={toDecide.length} right={<Link to="/approvals">전체 보기 ›</Link>} />
      {toDecide.length === 0 ? (
        mine.length ? (
          <div className="col">
            <span className="t-cap">처리할 승인이 없습니다. 내가 올린 요청:</span>
            {mine.map(a => (
              <div key={a.id} className="item-row">
                <KindTag kind={a.kind} />
                <Link to={`/approvals?id=${a.id}`} className="t-smallb truncate grow">
                  {a.title}
                </Link>
                <span className="t-cap">{relativeLabel(a.created_at)}</span>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>{loading ? '불러오는 중…' : '처리할 승인이 없습니다.'}</Empty>
        )
      ) : (
        <div className="col gap-2">
          {toDecide.slice(0, 5).map(a => (
            // 어떤 결재인지(제목)가 먼저 · 크게, 종류 · 요청자 · 시간은 아래 작은 줄 (대표 지시 2026-11-04)
            <div key={a.id} className="item-row decide-row">
              <div className="decide-main">
                <Link to={`/approvals?id=${a.id}`} className="decide-title">
                  {a.title}
                </Link>
                <span className="decide-meta">
                  <KindTag kind={a.kind} />
                  <span className="t-cap">
                    {profileName(a.requested_by)} · {relativeLabel(a.created_at)}
                  </span>
                </span>
              </div>
              <DecideButtons approval={a} compact />
            </div>
          ))}
        </div>
      )}

      {report && (
        <section className="section">
          <SectionHead title="일일 보고" right={<Link to={`/approvals?id=${report.id}`}>자세히 ›</Link>} />
          <div className="box col gap-6" style={{ background: 'var(--white)' }}>
            <div className="row wrap">
              <Link to={`/approvals?id=${report.id}`} className="t-smallb">
                {report.title}
              </Link>
              <StatusBadge status={report.status} />
              <span className="grow" />
              <span className="t-cap">
                {profileName(report.requested_by)} · {relativeLabel(report.created_at)}
              </span>
              <DecideButtons approval={report} compact />
            </div>
            <ReportPreview a={report} />
          </div>
        </section>
      )}

      <AgentDesk />

      <TeamShout shouts={data.shouts} roomId={data.rooms.find(r => r.name === '전체')?.id} />

    </Shell>
  )
}

/** 홈에서는 숫자 칸과 '이슈 · 리스크'만 */
function ReportPreview({ a }: { a: ApprovalSummary }) {
  const [open, setOpen] = useState(false)
  return <div className="col gap-6"><Button kind="ghost" onClick={() => setOpen(v => !v)}>{open ? '보고서 접기' : '요약 · 이슈 보기'}</Button>{open && <ReportPreviewBody key={a.id} id={a.id} />}</div>
}
function ReportPreviewBody({ id }: { id: string }) {
  const { api, version } = useApp()
  const { data: a, loading, error, reload } = useAsync(() => api.getApproval(id), [id, version], null as Approval | null)
  if (!a) return <span className="t-cap">{loading ? '본문 불러오는 중…' : error || '보고서를 찾을 수 없습니다.'}{error && <Button onClick={reload}>다시 시도</Button>}</span>
  const secs = reportSections(a.content)
  const summary = secs.find(x => /요약/.test(x.title))
  const issues = secs.find(x => /이슈|리스크/.test(x.title))
  return (
    <>
      {summary && <DailyReport a={{ ...a, content: `■ ${summary.title}\n${summary.lines.join('\n')}` }} />}
      {issues && issues.lines.length > 0 && (
        <div className="col gap-2">
          <span className="t-smallb">{issues.title}</span>
          {issues.lines.slice(0, 3).map((l, i) => (
            <span key={i} className="t-small">
              <Linkify text={l} />
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function TeamShout({ shouts, roomId }: { shouts: ChatMessage[]; roomId?: string }) {
  const { api, profileName } = useApp()
  const { busy, run } = useAction()
  const [text, setText] = useState('')
  const [all, setAll] = useState(false)
  const send = async () => {
    if (!roomId || !text.trim()) return
    if (await run(() => api.sendMessage(roomId, text.trim()))) setText('')
  }
  return (
    <>
      <SectionHead title="팀 한마디" right={<Link to={roomId ? `/chat?room=${roomId}` : '/chat'}>전체 채팅방 ›</Link>} />
      <div className="row">
        <input
          className="input"
          placeholder="팀원들에게 한마디 남기기"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
          maxLength={200}
          aria-label="팀 한마디"
        />
        <Button disabled={busy || !roomId || !text.trim()} onClick={send}>
          남기기
        </Button>
      </div>
      <div className="col gap-6">
        {shouts.map(m => (
          <div key={m.id} className="row t-small" style={{ alignItems: 'baseline', gap: 4 }}>
            <span className="t-blue">·</span>
            <span className="truncate"><Linkify text={m.content} /></span>
            <span className="t-cap t-blue" style={{ whiteSpace: 'nowrap' }}>
              ({profileName(m.user_id)}
            </span>
            <span className="t-meta" style={{ whiteSpace: 'nowrap', fontWeight: 400 }}>
              {dateTimeLabel(m.created_at)})
            </span>
          </div>
        ))}
        {shouts.length === 0 && <span className="t-cap">아직 한마디가 없습니다.</span>}
        {shouts.length > 0 && !all && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(true)}>
            일촌평처럼 더 보기
          </button>
        )}
      </div>
      {all && roomId && <ShoutAll roomId={roomId} onClose={() => setAll(false)} />}
    </>
  )
}

function ShoutAll({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { api, version, profileName } = useApp()
  const { data } = useAsync(() => api.listMessages(roomId, 30), [roomId, version], [] as ChatMessage[])
  return (
    <Modal title="팀 한마디" onClose={onClose}>
      <div className="col gap-6">
        {[...data].reverse().map(m => (
          <div key={m.id} className="t-small">
            <span className="t-blue">· </span>
            <Linkify text={m.content} /> <span className="t-cap t-blue">({profileName(m.user_id)}</span> <span className="t-meta">{dateTimeLabel(m.created_at)})</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
