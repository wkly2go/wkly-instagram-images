import { useMemo, useState } from 'react'
import { CheckSquare, Plus, Square } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
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
export function PendingReports({ reports, title = '미승인 업무 보고' }: { reports: Approval[]; title?: string }) {
  const { me, profileName } = useApp()
  const list = reports.filter(a => a.status === '대기' && (a.can_decide || a.requested_by === me.id)).sort((a, b) => reportDate(a).localeCompare(reportDate(b)))
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
export function WorkTodo({ projects, clients, tasks }: { projects: Project[]; clients: Client[]; tasks: Task[] }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const [text, setText] = useState('')
  const [pick, setPick] = useState('')
  const guessed = useMemo(() => (text.trim().length >= 2 ? guessLinks(text, projects, clients).projectId ?? '' : ''), [text, projects, clients])
  const projectId = pick || guessed
  const mine = tasks.filter(t => t.assignee_id === me.id && t.status !== '완료')
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
    if (await run(() => api.saveTask({ title: title.slice(0, 200), project_id: projectId || null, assignee_id: me.id, due_date: today, status: '할 일', memo: null }))) {
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
          placeholder="할 일 추가 (Enter) · 프로젝트 이름을 쓰면 자동 연결"
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
        {!pick && guessed && <span className="t-cap auto-link">✨ {name(guessed)}에 연결</span>}
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
                {t.due_date && <span className={`t-meta${late ? ' t-red' : ''}`}>{late ? '지연 ' : ''}{shortDate(t.due_date)}</span>}
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
