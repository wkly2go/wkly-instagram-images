import { useState } from 'react'
import { countedUnread } from '../lib/chat'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel, dateTimeLabel, relativeLabel, todayKey } from '../lib/date'
import { Link, useRouter } from '../lib/router'
import type { Approval, ChatMessage, ChatRoomSummary, Project, Task, WorkLog } from '../lib/types'
import { CheckInCard } from '../components/CheckIn'
import { InstallCard } from '../components/InstallCard'
import { Shell } from '../components/Shell'
import { AgentDesk } from '../components/AgentDesk'
import { PushSetupCard } from '../components/PushSetup'
import { KindTag, Button, Empty, Modal, SectionHead, StatusBadge } from '../components/ui'
import { DailyReport, DecideButtons, reportSections } from './Approvals'
import { MonthCalendar } from './Schedule'

interface HomeData {
  approvals: Approval[]
  logs: WorkLog[]
  tasks: Task[]
  projects: Project[]
  rooms: ChatRoomSummary[]
  shouts: ChatMessage[]
}

export default function Home() {
  const { api, me, version, profileName } = useApp()
  const { navigate } = useRouter()
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
  const byKind = (k: string) => data.logs.filter(l => l.kind.startsWith(k)).length
  const count = (s: Project['status']) => data.projects.filter(p => p.status === s).length
  const unreadRooms = data.rooms.filter(r => countedUnread(r) > 0)
  const report = data.approvals.filter(a => a.kind === '일일 보고').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

  return (
    <Shell active="home">
      <CheckInCard />
      <InstallCard />
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
            <div key={a.id} className="item-row" style={{ borderBottom: 0, padding: '3px 0' }}>
              <KindTag kind={a.kind} />
              <Link to={`/approvals?id=${a.id}`} className="t-smallb truncate">
                {a.title}
              </Link>
              <span className="t-cap" style={{ whiteSpace: 'nowrap' }}>
                {profileName(a.requested_by)} · {relativeLabel(a.created_at)}
              </span>
              <span className="grow" />
              <DecideButtons approval={a} compact />
            </div>
          ))}
        </div>
      )}

      <SectionHead title="오늘의 현황" right={dateLabel(today)} />
      <div className="stats">
        <button type="button" className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/work?team=1')}>
          <span className="t-cap">업무 기록</span>
          <span className="t-num">{data.logs.length}</span>
          <span className="t-cap">
            메일 {byKind('메일')} · 미팅 {byKind('미팅')} · 전화 {byKind('전화')}
          </span>
        </button>
        <button type="button" className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/projects?view=tasks')}>
          <span className="t-cap">오늘 마감</span>
          <span className="t-num">{dueToday.length}</span>
          <span className={`t-cap ${overdue.length ? 't-red' : ''}`}>{overdue.length ? `지연 ${overdue.length}건` : '지연 없음'}</span>
        </button>
        <button type="button" className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/projects?view=list')}>
          <span className="t-cap">진행 프로젝트</span>
          <span className="t-num">{count('진행')}</span>
          <span className="t-cap">
            기획 {count('기획')} · NIC {count('NIC')} · 보류 {count('보류')}
          </span>
        </button>
        <button type="button" className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/chat')}>
          <span className="t-cap">안 읽은 채팅</span>
          <span className="t-num">{data.rooms.reduce((s, r) => s + countedUnread(r), 0)}</span>
          <span className="t-cap">{unreadRooms.length ? `채팅방 ${unreadRooms.length}곳` : '모두 읽음'}</span>
        </button>
      </div>

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

      <section className="section" aria-label="월별 일정표">
        <SectionHead title="월별 일정표" right={<Link to="/projects?view=calendar">크게 보기 ›</Link>} />
        <MonthCalendar projects={data.projects} tasks={data.tasks} />
      </section>
    </Shell>
  )
}

/** 홈에서는 숫자 칸과 '이슈 · 리스크'만 */
function ReportPreview({ a }: { a: Approval }) {
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
              {l}
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
            <span className="truncate">{m.content}</span>
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
            {m.content} <span className="t-cap t-blue">({profileName(m.user_id)}</span> <span className="t-meta">{dateTimeLabel(m.created_at)})</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
