import { useMemo, useState } from 'react'
import { AlarmClock, ArrowLeft, ChevronLeft, ChevronRight, Folder, MessageCircle, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addMonths, dateLabel, monthGrid, shortDate, timeLabel, toDateKey, todayKey, weekRange, weekday } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { PROJECT_CATEGORIES, PROJECT_STATUSES, type ChatRoomSummary, type Client, type Project, type ProjectStatus, type Task, type TaskStatus, type WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { Avatar, Badge, Button, Chip, Empty, Field, KindBadge, Modal, SectionHead, StatusBadge } from '../components/ui'
import { NewApproval } from './Approvals'
import { FinancePanel } from '../components/FinancePanel'
import { ProjectDashboard } from './ProjectDashboard'
import { Payments } from './Payments'
import { Gantt, MonthCalendar, SentTasks, TaskAssignModal } from './Schedule'

interface Data {
  projects: Project[]
  tasks: Task[]
  clients: Client[]
}

export default function Projects() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const { me } = useApp()
  const admin = me.role === 'admin'
  const view = query.get('view') // null(대시보드) | 'schedule' | 'calendar' | 'list' | 'mine' | 'tasks' | 'payments'
  const status = (query.get('status') as ProjectStatus | 'all' | null) ?? '진행'
  const selectedId = query.get('id')
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [assigning, setAssigning] = useState(false)
  const { data, loading } = useAsync<Data>(
    async () => {
      const [projects, tasks, clients] = await Promise.all([api.listProjects(), api.listTasks(), api.listClients()])
      return { projects, tasks, clients }
    },
    [version],
    { projects: [], tasks: [], clients: [] },
  )
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const selected = data.projects.find(p => p.id === selectedId)

  if (selectedId) {
    return (
      <Shell active="projects">
        {selected ? <ProjectDetail project={selected} data={data} onEdit={() => setEditing(selected)} onBack={() => go({ id: null })} /> : <Empty>{loading ? '불러오는 중…' : '프로젝트를 찾을 수 없습니다.'}</Empty>}
        {editing && <ProjectForm project={editing === 'new' ? null : editing} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />}
      </Shell>
    )
  }

  const counts = (s: ProjectStatus) => data.projects.filter(p => p.status === s).length
  const list = status === 'all' ? data.projects : data.projects.filter(p => p.status === status)
  const tabs: [string | null, string][] = [
    [null, '대시보드'],
    ['schedule', '일정표'],
    ['calendar', '캘린더'],
    ['list', '프로젝트 목록'],
    ['mine', '내 할 일'],
    ['tasks', '팀 할 일'],
    ...(admin ? ([['payments', '결제 대장']] as [string, string][]) : []),
  ]
  return (
    <Shell active="projects">
      <div className="row wrap">
        <div className="chips">
          {tabs.map(([v, label]) => (
            <Chip key={label} active={view === v || (v === null && !tabs.some(t => t[0] === view))} onClick={() => navigate(v ? `/projects?view=${v}` : '/projects', { replace: true })}>
              {label}
            </Chip>
          ))}
        </div>
        <span className="grow" />
        {!view && admin && <span className="t-cap">{todayKey().slice(0, 4)}년 · 공급가액(VAT 별도)</span>}
        {view !== 'payments' && view !== 'schedule' && (
          <Button kind="outline" onClick={() => setAssigning(true)}>
            <Send size={13} /> 업무 지시
          </Button>
        )}
        {view !== 'payments' && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={14} /> 프로젝트
          </Button>
        )}
      </div>
      {view === 'payments' && admin ? (
        <Payments projects={data.projects} clients={data.clients} />
      ) : view === 'schedule' ? (
        <Gantt projects={data.projects} tasks={data.tasks} />
      ) : view === 'calendar' ? (
        <MonthCalendar projects={data.projects} tasks={data.tasks} />
      ) : view === 'mine' || view === 'tasks' ? (
        <div className="col gap-12">
          {view === 'mine' && <SentTasks projects={data.projects} tasks={data.tasks} />}
          <TaskList tasks={data.tasks} projects={data.projects} mineOnly={view === 'mine'} />
        </div>
      ) : view === 'list' ? (
        <div className="row top gap-12" style={{ flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
          <div className="col grow" style={{ flexBasis: 320 }}>
            <div className="chips" style={{ paddingBottom: 4 }}>
              {PROJECT_STATUSES.map(s => (
                <Chip key={s} active={status === s} onClick={() => go({ status: s === '진행' ? null : s })}>
                  {s} {counts(s)}
                </Chip>
              ))}
              <Chip active={status === 'all'} onClick={() => go({ status: 'all' })}>
                전체 {data.projects.length}
              </Chip>
            </div>
            {list.map(p => (
              <ProjectRow key={p.id} p={p} data={data} />
            ))}
            {list.length === 0 && <Empty>{loading ? '불러오는 중…' : '프로젝트가 없습니다.'}</Empty>}
          </div>
          <MiniCalendar data={data} />
        </div>
      ) : (
        <ProjectDashboard projects={data.projects} tasks={data.tasks} clients={data.clients} />
      )}
      {editing && <ProjectForm project={editing === 'new' ? null : editing} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />}
      {assigning && <TaskAssignModal projects={data.projects} tasks={data.tasks} onClose={() => setAssigning(false)} />}
    </Shell>
  )
}

function ProjectRow({ p, data }: { p: Project; data: Data }) {
  const { profileName } = useApp()
  const tasks = data.tasks.filter(t => t.project_id === p.id)
  const done = tasks.filter(t => t.status === '완료').length
  const client = data.clients.find(c => c.id === p.client_id)
  return (
    <Link to={`/projects?id=${p.id}`} className="item-row" title={p.name}>
      <span className="avatar sm" style={{ background: p.status === '진행' ? 'var(--yellow)' : 'var(--paper)', borderColor: 'var(--line)' }}>
        <Folder size={14} />
      </span>
      <span className="col gap-2 grow">
        <span className="t-smallb truncate">{p.name}</span>
        <span className="t-cap truncate">{[client?.name ?? '자체', p.category, p.location].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="col gap-2" style={{ alignItems: 'flex-end', flexShrink: 0 }}>
        <span className="t-meta">{p.start_date || p.end_date ? `${shortDate(p.start_date)} – ${shortDate(p.end_date)}` : ''}</span>
        <span className="t-cap">{tasks.length ? `할 일 ${done}/${tasks.length}` : ''}</span>
      </span>
      {p.owner_id && <Avatar name={profileName(p.owner_id)} size="xs" />}
      <StatusBadge status={p.status} />
    </Link>
  )
}

function MiniCalendar({ data }: { data: Data }) {
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sel, setSel] = useState<string | null>(null)
  const events = useMemo(() => {
    const m = new Map<string, { label: string; red?: boolean; to: string }[]>()
    const push = (d: string | null, e: { label: string; red?: boolean; to: string }) => d && m.set(d, [...(m.get(d) ?? []), e])
    for (const t of data.tasks) if (t.status !== '완료') push(t.due_date, { label: t.title, to: t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=tasks' })
    for (const p of data.projects) if (p.status !== '완료') push(p.end_date, { label: `${p.name} 종료`, red: true, to: `/projects?id=${p.id}` })
    return m
  }, [data])
  const [ws, we] = weekRange(today)
  const listDays = sel ? [sel] : [...events.keys()].filter(d => d >= ws && d <= we).sort()
  return (
    <aside className="box col gap-6" style={{ width: 250, flexShrink: 0 }} aria-label="일정 달력">
      <div className="row">
        <button type="button" className="icon-btn sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달">
          <ChevronLeft size={14} />
        </button>
        <span className="t-meta t-blue">{month.replace('-', '.')}</span>
        <button type="button" className="icon-btn sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRight size={14} />
        </button>
        <span className="grow" />
        {month !== today.slice(0, 7) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(today.slice(0, 7))}>
            오늘
          </button>
        )}
      </div>
      <div className="cal">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {monthGrid(month).map((d, i) =>
          d ? (
            <button key={d} type="button" className={`${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d === sel ? null : d)} aria-label={`${dateLabel(d)} 일정 ${events.get(d)?.length ?? 0}건`}>
              <span className="n">{Number(d.slice(8))}</span>
              <span className="dots">
                {(events.get(d) ?? []).slice(0, 3).map((e, j) => (
                  <i key={j} className={e.red ? 'red' : ''} />
                ))}
              </span>
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <div className="dashed" />
      <span className="t-smallb">{sel ? dateLabel(sel) : '이번 주 일정'}</span>
      {listDays.flatMap(d =>
        (events.get(d) ?? []).map((e, j) => (
          <Link key={`${d}-${j}`} to={e.to} className="row t-cap" title={e.label}>
            <span className={`t-meta ${e.red ? 't-red' : ''}`}>
              {shortDate(d)} {weekday(d)}
            </span>
            <span className="truncate">{e.label}</span>
          </Link>
        )),
      )}
      {listDays.every(d => !(events.get(d) ?? []).length) && <span className="t-cap">일정이 없습니다.</span>}
    </aside>
  )
}

const NEXT: Record<TaskStatus, TaskStatus> = { '할 일': '진행 중', '진행 중': '완료', 완료: '할 일' }

/** datetime-local 값 ↔ ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
const alarmLabel = (iso: string) => `${shortDate(toDateKey(iso))} ${timeLabel(iso)}`

/** 할 일 추가 줄: 제목 · 담당 · 마감 · 알람 */
function TaskAdder({ projectId, defaultAssignee }: { projectId: string | null; defaultAssignee: string }) {
  const { api, profiles } = useApp()
  const { busy, run } = useAction()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(defaultAssignee)
  const [due, setDue] = useState('')
  const [alarm, setAlarm] = useState('')
  const add = async () => {
    if (!title.trim()) return
    if (await run(() => api.saveTask({ project_id: projectId, title: title.trim(), assignee_id: assignee || null, due_date: due || null, remind_at: fromLocalInput(alarm) }), alarm ? `알람을 ${alarmLabel(fromLocalInput(alarm)!)}에 맞췄어요.` : undefined)) {
      setTitle('')
      setDue('')
      setAlarm('')
    }
  }
  return (
    <div className="row wrap" style={{ paddingTop: 2 }}>
      <input className="input" style={{ flex: '2 1 180px' }} placeholder="할 일 추가 (Enter)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && add()} aria-label="새 할 일" />
      <select className="select" style={{ width: 104 }} value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="담당자">
        <option value="">담당 없음</option>
        {profiles
          .filter(x => x.active)
          .map(x => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
      </select>
      <input className="input" style={{ width: 132 }} type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="마감일" title="마감일" />
      <label className="row" style={{ gap: 4 }} title="이 시각에 알림 (PC 알림을 켜면 화면 밖에서도 알려 줘요)">
        <AlarmClock size={15} className="t-blue" />
        <input className="input" style={{ width: 178 }} type="datetime-local" value={alarm} onChange={e => setAlarm(e.target.value)} aria-label="알람 시각" />
      </label>
      <Button onClick={add} disabled={busy || !title.trim()}>
        추가
      </Button>
    </div>
  )
}

function TaskList({ tasks, projects, mineOnly }: { tasks: Task[]; projects: Project[]; mineOnly: boolean }) {
  const { api, me, profileName } = useApp()
  const { run } = useAction()
  const today = todayKey()
  const [, we] = weekRange(today)
  const [showDone, setShowDone] = useState(false)
  const rows = tasks.filter(t => (!mineOnly || t.assignee_id === me.id) && (showDone || t.status !== '완료'))
  const groups: [string, Task[]][] = [
    ['지연', rows.filter(t => t.status !== '완료' && t.due_date && t.due_date < today)],
    ['오늘', rows.filter(t => t.due_date === today)],
    ['이번 주', rows.filter(t => t.due_date && t.due_date > today && t.due_date <= we)],
    ['이후', rows.filter(t => t.due_date && t.due_date > we)],
    ['날짜 없음', rows.filter(t => !t.due_date)],
    ['완료', showDone ? rows.filter(t => t.status === '완료' && t.due_date && t.due_date < today) : []],
  ]
  return (
    <div className="col gap-10">
      <TaskAdder projectId={null} defaultAssignee={me.id} />
      <label className="row t-cap" style={{ gap: 6 }}>
        <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 완료한 할 일도 보기
      </label>
      {groups.map(([label, list]) =>
        list.length ? (
          <div key={label} className="col gap-2">
            <div className="section-h">
              <span className={`t-bodyb ${label === '지연' ? 't-red' : ''}`}>{label}</span>
              <Badge tone={label === '지연' ? 'red' : 'yellow'}>{list.length}</Badge>
            </div>
            {list.map(t => (
              <TaskRow
                key={t.id}
                t={t}
                late={label === '지연'}
                projectName={projects.find(p => p.id === t.project_id)?.name}
                assignee={profileName(t.assignee_id)}
                onStatus={() => run(() => api.saveTask({ id: t.id, status: NEXT[t.status] }))}
                onAlarm={v => run(() => api.saveTask({ id: t.id, remind_at: v }), v ? `알람을 ${alarmLabel(v)}에 맞췄어요.` : '알람을 껐어요.')}
              />
            ))}
          </div>
        ) : null,
      )}
      {rows.length === 0 && <Empty>{mineOnly ? '나에게 배정된 할 일이 없습니다.' : '할 일이 없습니다.'}</Empty>}
    </div>
  )
}

function TaskRow({ t, late, projectName, assignee, onStatus, onDelete, onAlarm }: { t: Task; late?: boolean; projectName?: string; assignee: string; onStatus: () => void; onDelete?: () => void; onAlarm?: (iso: string | null) => void }) {
  const { profileOf } = useApp()
  const [editAlarm, setEditAlarm] = useState(false)
  const creator = profileOf(t.created_by)
  const pending = t.remind_at && !t.reminded_at && t.status !== '완료'
  return (
    <div className="item-row">
      <input type="checkbox" checked={t.status === '완료'} onChange={onStatus} aria-label={`${t.title} 상태 바꾸기`} title="눌러서 상태 변경 (할 일 → 진행 중 → 완료)" />
      <span className="col gap-2 grow">
        <span className="t-smallb truncate" style={t.status === '완료' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
          {t.title}
        </span>
        <span className="t-cap truncate">
          {projectName && (
            <Link to={`/projects?id=${t.project_id}`} className="t-cap">
              {projectName}
            </Link>
          )}
          {t.source_research_id && (
            <>
              {projectName ? ' · ' : ''}
              <Link to={`/library?id=${t.source_research_id}`}>📚 리서치에서 만든 할 일</Link>
            </>
          )}
          {creator?.is_agent && <span className="t-blue">{projectName || t.source_research_id ? ' · ' : ''}🤖 {creator.name} 배정</span>}
          {t.phase && <span>{projectName || t.source_research_id || creator?.is_agent ? ' · ' : ''}{t.phase}</span>}
          {creator && !creator.is_agent && creator.id !== t.assignee_id && <span className="t-blue">{projectName || t.phase ? ' · ' : ''}{creator.name} 지시</span>}
          {t.start_date && t.due_date && t.start_date !== t.due_date && <span>{' · '}{shortDate(t.start_date)}~{shortDate(t.due_date)}</span>}
        </span>
      </span>
      {editAlarm && onAlarm ? (
        <input
          className="input"
          style={{ width: 178 }}
          type="datetime-local"
          autoFocus
          defaultValue={toLocalInput(t.remind_at)}
          onBlur={e => {
            setEditAlarm(false)
            const v = fromLocalInput(e.target.value)
            if (v !== t.remind_at) onAlarm(v)
          }}
          aria-label="알람 시각"
        />
      ) : t.remind_at && t.status !== '완료' ? (
        <button type="button" className={`badge ${pending ? 'paper' : 'outline'}`} style={{ cursor: onAlarm ? 'pointer' : 'default', gap: 4 }} onClick={() => onAlarm && setEditAlarm(true)} title={pending ? '알람 예정 (눌러서 변경)' : '알람 울림'}>
          <AlarmClock size={11} /> {alarmLabel(t.remind_at)}
        </button>
      ) : (
        onAlarm &&
        t.status !== '완료' && (
          <button type="button" className="icon-btn sm" onClick={() => setEditAlarm(true)} aria-label="알람 맞추기" title="알람 맞추기">
            <AlarmClock size={13} />
          </button>
        )
      )}
      {t.due_date && <span className={`t-meta ${late ? 't-red' : ''}`}>{t.due_date === todayKey() ? '오늘' : `${shortDate(t.due_date)} ${weekday(t.due_date)}`}</span>}
      <button type="button" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={onStatus} title="상태 변경">
        <StatusBadge status={late ? '지연' : t.status} />
      </button>
      {t.assignee_id && <Avatar name={assignee} size="xs" />}
      {onDelete && (
        <button type="button" className="icon-btn sm" onClick={onDelete} aria-label="할 일 삭제" title="삭제">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

function ProjectDetail({ project: p, data, onEdit, onBack }: { project: Project; data: Data; onEdit: () => void; onBack: () => void }) {
  const { api, me, profileName, version } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const [approving, setApproving] = useState(false)
  const tasks = data.tasks.filter(t => t.project_id === p.id)
  const client = data.clients.find(c => c.id === p.client_id)
  const today = todayKey()
  const { data: extra } = useAsync(
    async () => {
      const [logs, rooms] = await Promise.all([api.listWorkLogs({ projectId: p.id, limit: 20 }), api.listRooms()])
      return { logs, room: rooms.find(r => r.project_id === p.id) ?? null }
    },
    [p.id, version],
    { logs: [] as WorkLog[], room: null as ChatRoomSummary | null },
  )

  const openRoom = async () => {
    if (extra.room) return navigate(`/chat?room=${extra.room.id}`)
    let id = ''
    const ok = await run(async () => {
      id = (await api.createRoom({ name: p.name, project_id: p.id })).id
    }, '프로젝트 채팅방을 만들었습니다.')
    if (ok) navigate(`/chat?room=${id}`)
  }

  return (
    <>
      <div className="row wrap">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        <h2 className="t-title truncate">{p.name}</h2>
        <StatusBadge status={p.status} />
        <Badge>{p.category}</Badge>
        <span className="grow" />
        <Button kind="outline" size="sm" onClick={openRoom} disabled={busy}>
          <MessageCircle size={13} /> {extra.room ? '채팅방' : '채팅방 만들기'}
        </Button>
        <Button kind="outline" size="sm" onClick={() => setApproving(true)}>
          승인 요청
        </Button>
        <Button kind="yellow" size="sm" onClick={onEdit}>
          <Pencil size={13} /> 수정
        </Button>
        {me.role === 'admin' && (
          <Button
            kind="ghost"
            size="sm"
            onClick={async () => {
              if (window.confirm(`'${p.name}' 프로젝트와 할 일을 모두 삭제할까요?`) && (await run(() => api.deleteProject(p.id), '삭제했습니다.'))) onBack()
            }}
          >
            삭제
          </Button>
        )}
      </div>
      <div className="box">
        <dl className="kv">
          <dt>거래처</dt>
          <dd>{client ? <Link to={`/clients?id=${client.id}`}>{client.name}</Link> : '자체'}</dd>
          <dt>담당</dt>
          <dd>{p.owner_id ? profileName(p.owner_id) : '-'}</dd>
          <dt>기간</dt>
          <dd>{p.start_date || p.end_date ? `${p.start_date ? dateLabel(p.start_date) : '?'} – ${p.end_date ? dateLabel(p.end_date) : '?'}` : '-'}</dd>
          {p.location && (
            <>
              <dt>장소</dt>
              <dd>{p.location}</dd>
            </>
          )}
          {p.description && (
            <>
              <dt>설명</dt>
              <dd className="pre">{p.description}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="row top gap-12" style={{ flexWrap: 'wrap' }}>
        <div className="col grow" style={{ flexBasis: 300 }}>
          <SectionHead title="할 일" count={`${tasks.filter(t => t.status === '완료').length}/${tasks.length}`} />
          {tasks.map(t => (
            <TaskRow
              key={t.id}
              t={t}
              late={t.status !== '완료' && !!t.due_date && t.due_date < today}
              assignee={profileName(t.assignee_id)}
              onStatus={() => run(() => api.saveTask({ id: t.id, status: NEXT[t.status] }))}
              onDelete={() => window.confirm('이 할 일을 삭제할까요?') && run(() => api.deleteTask(t.id))}
              onAlarm={v => run(() => api.saveTask({ id: t.id, remind_at: v }), v ? `알람을 ${alarmLabel(v)}에 맞췄어요.` : '알람을 껐어요.')}
            />
          ))}
          <TaskAdder projectId={p.id} defaultAssignee={me.id} />
        </div>
        <div className="col" style={{ flexBasis: 240, flexGrow: 1, maxWidth: 360 }}>
          <SectionHead title="관련 업무 기록" right={<Link to={`/work?team=1`}>업무 일지 ›</Link>} />
          {extra.logs.map(l => (
            <div key={l.id} className="col gap-2 dashed" style={{ padding: '6px 0' }}>
              <div className="row">
                <span className="t-meta">
                  {shortDate(l.log_date)} {timeLabel(l.created_at)}
                </span>
                <KindBadge kind={l.kind} />
                <span className="t-cap">{profileName(l.user_id)}</span>
              </div>
              <span className="t-small t-blue pre">{l.content}</span>
            </div>
          ))}
          {extra.logs.length === 0 && <span className="t-cap">업무 일지에서 이 프로젝트를 선택해 기록하면 여기에 모입니다.</span>}
        </div>
      </div>
      {me.role === 'admin' && <FinancePanel project={p} clients={data.clients} projects={data.projects} />}
      {approving && <NewApproval preset={{ kind: '프로젝트', target_id: p.id, title: `프로젝트: ${p.name}` }} onClose={() => setApproving(false)} onCreated={id => navigate(`/approvals?view=mine&id=${id}`)} />}
    </>
  )
}

export function ProjectForm({ project, clients, onClose, onSaved }: { project: Project | null; clients: Client[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Partial<Project>>(() => project ?? { name: '', category: '팝업', status: '기획', owner_id: me.id, client_id: null, start_date: null, end_date: null, location: null, description: null })
  const set = (p: Partial<Project>) => setF(prev => ({ ...prev, ...p }))
  const submit = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await api.saveProject({ ...f, name: (f.name ?? '').trim() })).id
    }, project ? '저장했습니다.' : '프로젝트를 만들었습니다.')
    if (ok) {
      onClose()
      onSaved(id)
    }
  }
  return (
    <Modal
      title={project ? '프로젝트 수정' : '새 프로젝트'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !f.name?.trim()} onClick={submit}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="이름" className="full">
          <input className="input" autoFocus value={f.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="예) 성수 팝업 '오브제 위크'" />
        </Field>
        <Field label="거래처">
          <select className="select" value={f.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null })}>
            <option value="">자체</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="담당">
          <select className="select" value={f.owner_id ?? ''} onChange={e => set({ owner_id: e.target.value || null })}>
            <option value="">없음</option>
            {profiles
              .filter(x => x.active)
              .map(x => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="구분">
          <select className="select" value={f.category} onChange={e => set({ category: e.target.value as Project['category'] })}>
            {PROJECT_CATEGORIES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <select className="select" value={f.status} onChange={e => set({ status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="시작일">
          <input className="input" type="date" value={f.start_date ?? ''} onChange={e => set({ start_date: e.target.value || null })} />
        </Field>
        <Field label="종료일">
          <input className="input" type="date" value={f.end_date ?? ''} min={f.start_date ?? undefined} onChange={e => set({ end_date: e.target.value || null })} />
        </Field>
        <Field label="장소" className="full">
          <input className="input" value={f.location ?? ''} onChange={e => set({ location: e.target.value || null })} />
        </Field>
        <Field label="설명" className="full">
          <textarea className="textarea" rows={3} value={f.description ?? ''} onChange={e => set({ description: e.target.value || null })} />
        </Field>
      </div>
    </Modal>
  )
}

