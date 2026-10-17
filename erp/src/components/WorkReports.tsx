import { useMemo, useState } from 'react'
import { CheckSquare, Plus, Square } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, shortDate, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { Approval, Client, Project, Task } from '../lib/types'
import { guessLinks, SearchPick } from './LogForm'
import { Badge, Empty } from './ui'

export const REPORT_KIND = '업무 보고'
export const reportDate = (a: Approval) => (typeof a.payload?.date === 'string' ? a.payload.date : a.created_at.slice(0, 10))

/** 업무 보고 목록 (내가 올린 것 + 내가 승인할 것) */
export function useWorkReports() {
  const { api, version } = useApp()
  return useAsync(async () => (await api.listApprovals()).filter(a => a.kind === REPORT_KIND), [version], [] as Approval[])
}

/** 업무 보고 승인 체크박스: 승인할 수 있는 사람만 누름. 승인되면 할 일 목록에서 빠짐 */
export function ReportCheck({ a }: { a: Approval }) {
  const { api, profileName } = useApp()
  const { busy, run } = useAction()
  const done = a.status === '승인'
  const can = !!a.can_decide && a.status === '대기'
  return (
    <button
      type="button"
      className={`report-check${done ? ' done' : ''}`}
      disabled={!can || busy}
      onClick={() => can && run(() => api.decideApproval(a.id, '승인'), '업무 보고를 승인했습니다.')}
      title={done ? `${profileName(a.decided_by)} 승인` : can ? '눌러서 승인' : a.status === '대기' ? '승인 대기 중' : a.status}
      aria-label={done ? '승인됨' : '업무 보고 승인'}
    >
      {done ? <CheckSquare size={16} /> : <Square size={16} />}
      <span>{done ? '승인' : a.status === '대기' ? (can ? '승인하기' : '승인 대기') : a.status}</span>
    </button>
  )
}

/** 미승인 업무 보고: 내가 승인할 것 + 내가 올리고 아직 승인 안 된 것 */
export function PendingReports({ reports, title = '미승인 업무 보고', userId }: { reports: Approval[]; title?: string; userId?: string | null }) {
  const { me, profileName } = useApp()
  // userId: 그 사람의 보고만 (업무 화면 왼쪽에서 고른 팀원과 연동), 없으면 내가 볼 수 있는 전체
  const list = reports.filter(a => a.status === '대기' && (a.can_decide || a.requested_by === me.id) && (!userId || a.requested_by === userId)).sort((a, b) => reportDate(a).localeCompare(reportDate(b)))
  if (!list.length) return null
  return (
    <div className="col gap-4 pending-reports">
      <div className="section-h">
        <span className="t-bodyb t-red">{title}</span>
        <Badge tone="red">{list.length}</Badge>
      </div>
      {list.map(a => (
        <div key={a.id} className="row todo-row">
          <ReportCheck a={a} />
          <Link to={`/approvals?id=${a.id}`} className="grow truncate t-small">
            {shortDate(reportDate(a))} · {a.requested_by === me.id ? '내 업무 보고' : `${profileName(a.requested_by)} 업무 보고`}
          </Link>
        </div>
      ))}
    </div>
  )
}

/** 업무 할 일 (프로젝트별). 업무 일지와 같은 방식으로 내용에서 프로젝트를 찾아 연결 */
/** userId: 그 사람의 할 일 (기본 = 나), null = 팀 전체 */
export function WorkTodo({ projects, clients, tasks, userId }: { projects: Project[]; clients: Client[]; tasks: Task[]; userId?: string | null }) {
  const { api, me, profileName } = useApp()
  const owner = userId === undefined ? me.id : userId
  const team = owner === null
  const { busy, run } = useAction()
  const today = todayKey()
  const [text, setText] = useState('')
  const [pick, setPick] = useState('')
  const guessed = useMemo(() => (text.trim().length >= 2 ? guessLinks(text, projects, clients).projectId ?? '' : ''), [text, projects, clients])
  const projectId = pick || guessed
  const mine = tasks.filter(t => (team ? !!t.assignee_id : t.assignee_id === owner) && t.status !== '완료')
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of mine) m.set(t.project_id ?? '', [...(m.get(t.project_id ?? '') ?? []), t])
    for (const list of m.values()) list.sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
    return [...m.entries()].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1))
  }, [mine])
  const name = (id: string) => (id ? projects.find(p => p.id === id)?.name ?? '프로젝트' : '프로젝트 없음')
  const add = async () => {
    const title = text.trim()
    if (!title) return
    if (await run(() => api.saveTask({ title: title.slice(0, 200), project_id: projectId || null, assignee_id: owner ?? me.id, due_date: today, status: '할 일', memo: null }))) {
      setText('')
      setPick('')
    }
  }
  return (
    <div className="col gap-6">
      <div className="col gap-4">
        <input
          className="input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          placeholder={owner && owner !== me.id ? `${profileName(owner)}에게 할 일 추가 (Enter)` : '할 일 추가 (Enter) · 프로젝트 이름을 쓰면 자동 연결'}
          aria-label="할 일 추가"
        />
        {text.trim() && (
          <div className="row" style={{ gap: 4 }}>
            <div className="grow">
              <SearchPick
                label="프로젝트"
                placeholder="프로젝트 검색"
                value={projectId}
                onChange={setPick}
                items={projects.filter(p => p.status !== '완료').map(p => ({ id: p.id, label: p.name }))}
              />
            </div>
            <button type="button" className="icon-btn" onClick={add} disabled={busy} aria-label="할 일 추가">
              <Plus size={16} />
            </button>
          </div>
        )}
        {!pick && guessed && <span className="t-cap auto-link">{name(guessed)}에 연결</span>}
      </div>
      {groups.length === 0 && <Empty>남은 할 일이 없습니다.</Empty>}
      {groups.map(([pid, list]) => (
        <div key={pid || 'none'} className="col gap-2">
          <div className="row" style={{ gap: 6 }}>
            {pid ? (
              <Link to={`/projects?id=${pid}`} className="t-smallb truncate grow">
                📁 {name(pid)}
              </Link>
            ) : (
              <span className="t-smallb grow">{name(pid)}</span>
            )}
            <span className="t-meta">{list.length}</span>
          </div>
          {list.map(t => {
            const late = !!t.due_date && t.due_date < today
            return (
              <label key={t.id} className={`row todo-row${late ? ' late' : ''}`}>
                <input type="checkbox" checked={false} onChange={() => run(() => api.saveTask({ id: t.id, status: '완료' }), '완료했습니다.')} aria-label={`${t.title} 완료`} />
                <span className="grow t-small">{t.title}</span>
                {team && t.assignee_id && <span className="t-meta">{profileName(t.assignee_id)}</span>}
                {t.due_date && <span className={`t-meta${late ? ' t-red' : ''}`}>{late ? '지연 ' : ''}{shortDate(t.due_date)}</span>}
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 지연 업무 정리: 마감 지난 할 일을 한 번에 완료 · 마감 연장 · 다른 사람에게 */
export function OverdueCleanup() {
  const { api, me, version, profiles, profileName } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const admin = me.role === 'admin'
  const [all, setAll] = useState(false)
  const { data } = useAsync(() => api.listTasks(), [version], [] as Task[])
  const list = data
    .filter(t => t.status !== '완료' && t.due_date && t.due_date < today && (all ? true : t.assignee_id === me.id))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const people = profiles.filter(p => p.active && !p.is_agent)
  if (!list.length && !all) return null
  const plus = (n: number) => addDays(today, n)
  return (
    <div className="col gap-4 overdue-box">
      <div className="section-h">
        <span className="t-bodyb t-red">마감 지난 업무 정리</span>
        <Badge tone="red">{list.length}</Badge>
        {admin && (
          <span className="more">
            <label className="row t-small" style={{ gap: 4 }}>
              <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> 팀 전체
            </label>
          </span>
        )}
      </div>
      {list.length === 0 && <Empty>마감 지난 업무가 없습니다.</Empty>}
      {list.slice(0, 40).map(t => (
        <div key={t.id} className="row todo-row wrap">
          <span className="grow t-small" style={{ minWidth: 160 }}>
            {t.title}
            <span className="t-meta t-red"> · {shortDate(t.due_date!)}</span>
            {all && <span className="t-meta"> · {profileName(t.assignee_id)}</span>}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.saveTask({ id: t.id, status: '완료' }), '완료했습니다.')}>
            완료
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.saveTask({ id: t.id, due_date: plus(3) }), `마감을 ${shortDate(plus(3))}로 옮겼습니다.`)}>
            +3일
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.saveTask({ id: t.id, due_date: plus(7) }), `마감을 ${shortDate(plus(7))}로 옮겼습니다.`)}>
            +7일
          </button>
          <select
            className="select"
            style={{ width: 110 }}
            value=""
            disabled={busy}
            onChange={e => e.target.value && run(() => api.saveTask({ id: t.id, assignee_id: e.target.value, due_date: plus(3) }), `${profileName(e.target.value)}님에게 넘겼습니다.`)}
            aria-label="다른 사람에게"
          >
            <option value="">넘기기…</option>
            {people
              .filter(p => p.id !== t.assignee_id)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      ))}
    </div>
  )
}
