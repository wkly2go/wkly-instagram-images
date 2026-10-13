import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, addMonths, monthGrid, shortDate, todayKey, weekday } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { TASK_STATUSES, type LeaveRecord, type Project, type Task, type TaskStatus } from '../lib/types'
import { Avatar, Badge, Button, Chip, Empty, Field, Modal, StatusBadge } from '../components/ui'

const DAY = 86_400_000
const ms = (key: string) => Date.parse(`${key}T00:00:00Z`)
/** 그 주 월요일 */
export function mondayOf(key: string): string {
  const dow = new Date(ms(key)).getUTCDay()
  return addDays(key, -((dow + 6) % 7))
}
const weeksBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / (7 * DAY))

/** 업무 기간: 시작일이 없으면 마감일 하루, 마감일이 없으면 시작일 하루 */
const spanOf = (t: Task): [string, string] | null => {
  const s = t.start_date ?? t.due_date
  const e = t.due_date ?? t.start_date
  return s && e ? [s, e] : null
}

const PHASE_ORDER = ['디자인 기획', '디자인 개발', '디자인 보고', '시공', '운영']

// ---------------------------------------------------------------------
// 업무 지시 (새 업무 · 고치기)
// ---------------------------------------------------------------------

export function TaskAssignModal({ task, projects, tasks, presetProject, onClose }: { task?: Task; projects: Project[]; tasks: Task[]; presetProject?: string | null; onClose: () => void }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({
    title: task?.title ?? '',
    assignee_id: task?.assignee_id ?? '',
    project_id: task?.project_id ?? presetProject ?? '',
    phase: task?.phase ?? '',
    start_date: task?.start_date ?? '',
    due_date: task?.due_date ?? '',
    status: task?.status ?? ('할 일' as TaskStatus),
    memo: task?.memo ?? '',
  })
  const phases = useMemo(() => [...new Set([...PHASE_ORDER, ...tasks.map(t => t.phase).filter((p): p is string => !!p)])], [tasks])
  const bad = !f.title.trim() || !f.assignee_id || (!!f.start_date && !!f.due_date && f.start_date > f.due_date)
  const people = profiles.filter(p => p.active && !p.is_agent)
  const save = async () => {
    if (bad) return
    const draft = {
      ...(task ? { id: task.id } : {}),
      title: f.title.trim(),
      assignee_id: f.assignee_id,
      project_id: f.project_id || null,
      phase: f.phase.trim() || null,
      start_date: f.start_date || null,
      due_date: f.due_date || null,
      status: f.status,
      memo: f.memo.trim() || null,
    }
    const who = profiles.find(p => p.id === f.assignee_id)?.name ?? ''
    if (await run(() => api.saveTask(draft), task ? '업무를 고쳤습니다.' : `${who}님에게 업무를 지시했습니다. 일정표와 할 일 목록에 들어갔어요.`)) onClose()
  }
  const remove = async () => {
    if (task && window.confirm(`'${task.title}' 업무를 삭제할까요?`) && (await run(() => api.deleteTask(task.id), '삭제했습니다.'))) onClose()
  }
  return (
    <Modal
      title={task ? '업무 고치기' : '업무 지시'}
      onClose={onClose}
      actions={
        <>
          {task && (
            <Button kind="ghost" onClick={remove} disabled={busy} className="del-btn" style={{ marginRight: 'auto' }}>
              <Trash2 size={13} /> 삭제
            </Button>
          )}
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || bad}>
            <Send size={13} /> {task ? '저장' : '지시하기'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="label full" role="group" aria-label="받는 사람">
          <span>받는 사람</span>
          <div className="chips">
            {people.map(p => (
              <Chip key={p.id} active={f.assignee_id === p.id} onClick={() => setF({ ...f, assignee_id: p.id })}>
                {p.name}
                {p.id === me.id ? ' (나)' : ''}
              </Chip>
            ))}
          </div>
        </div>
        <Field label="업무" className="full">
          <input className="input" autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="예) 평면 프로그램 개발" maxLength={200} />
        </Field>
        <Field label="프로젝트">
          <select className="select" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}>
            <option value="">없음</option>
            {projects
              .filter(p => p.status !== '완료' || p.id === f.project_id)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="단계 (일정표 묶음)">
          <input className="input" list="task-phases" value={f.phase} onChange={e => setF({ ...f, phase: e.target.value })} placeholder="예) 디자인 기획" maxLength={40} />
          <datalist id="task-phases">
            {phases.map(p => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Field label="시작일">
          <input className="input" type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label="마감일">
          <input className="input" type="date" value={f.due_date} min={f.start_date || undefined} onChange={e => setF({ ...f, due_date: e.target.value })} />
        </Field>
        {task && (
          <div className="label full" role="group" aria-label="상태">
            <span>상태</span>
            <div className="chips">
              {TASK_STATUSES.map(s => (
                <Chip key={s} active={f.status === s} onClick={() => setF({ ...f, status: s })}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <Field label="메모 (선택)" className="full">
          <textarea className="textarea" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} maxLength={2000} placeholder="참고 자료 · 요청 사항" />
        </Field>
      </div>
      {f.start_date && f.due_date && f.start_date > f.due_date && <span className="t-cap t-red">시작일이 마감일보다 늦습니다.</span>}
      {!task && <span className="t-cap">받는 사람에게 알림이 가고, 그 사람의 '내 할 일'과 프로젝트 일정표에 바로 들어갑니다.</span>}
    </Modal>
  )
}

// ---------------------------------------------------------------------
// 업무 일정표 (주 단위 간트)
// ---------------------------------------------------------------------

export function Gantt({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const { profileName } = useApp()
  const { query, path, navigate } = useRouter()
  const today = todayKey()
  const active = projects.filter(p => p.status === '진행' || p.status === '기획')
  const projectId = query.get('project') ?? 'all'
  const project = projects.find(p => p.id === projectId) ?? null
  const [editing, setEditing] = useState<Task | 'new' | null>(null)

  const items = project ? tasks.filter(t => t.project_id === project.id && spanOf(t)) : []
  const dates = project
    ? [project.start_date, project.end_date, ...items.flatMap(t => spanOf(t)!)]
    : active.flatMap(p => [p.start_date, p.end_date])
  const known = dates.filter((d): d is string => !!d).sort()
  const from = mondayOf(known[0] ?? addDays(today, -14))
  const lastDay = known[known.length - 1] ?? addDays(today, 56)
  const weeks = Math.min(60, Math.max(8, weeksBetween(from, mondayOf(lastDay)) + 1))
  const cols = Array.from({ length: weeks }, (_, i) => addDays(from, i * 7))
  const todayCol = weeksBetween(from, mondayOf(today))
  const months: { label: string; span: number }[] = []
  for (const c of cols) {
    const label = `${Number(c.slice(5, 7))}월`
    if (months.length && months[months.length - 1].label === label) months[months.length - 1].span++
    else months.push({ label, span: 1 })
  }
  const colOf = (d: string) => Math.max(0, Math.min(weeks - 1, weeksBetween(from, mondayOf(d))))
  const grid = { gridTemplateColumns: `minmax(150px, 200px) repeat(${weeks}, minmax(30px, 1fr))` }

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of items) m.set(t.phase || '기타', [...(m.get(t.phase || '기타') ?? []), t])
    for (const list of m.values()) list.sort((a, b) => spanOf(a)![0].localeCompare(spanOf(b)![0]))
    return [...m.entries()].sort(([a], [b]) => (PHASE_ORDER.indexOf(a) + 1 || 99) - (PHASE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
  }, [items])
  const unscheduled = project ? tasks.filter(t => t.project_id === project.id && !spanOf(t)) : []

  const cells = (row: number) => (
    <>
      {cols.map((c, i) => (
        <span key={c} className={`g-cell ${i === todayCol ? 'today' : ''}`} style={{ gridRow: row, gridColumn: i + 2 }} />
      ))}
    </>
  )
  let row = 2
  return (
    <div className="col gap-10">
      <div className="row wrap">
        <div className="chips">
          <Chip active={!project} onClick={() => navigate(withQuery(path, query, { project: null }), { replace: true })}>
            전체 프로젝트
          </Chip>
          {active.map(p => (
            <Chip key={p.id} active={p.id === projectId} onClick={() => navigate(withQuery(path, query, { project: p.id }), { replace: true })}>
              {p.name}
            </Chip>
          ))}
        </div>
        <span className="grow" />
        <Button onClick={() => setEditing('new')}>
          <Send size={13} /> 업무 지시
        </Button>
      </div>
      {project && (
        <div className="row wrap t-cap">
          <Link to={`/projects?id=${project.id}`} className="t-bodyb">
            {project.name}
          </Link>
          <span>
            {shortDate(project.start_date)} ~ {shortDate(project.end_date)} · 담당 {profileName(project.owner_id)}
          </span>
        </div>
      )}
      <div className="gantt-wrap">
        <div className="gantt" style={grid} role="table" aria-label="업무 일정표">
          <span className="g-head g-label" style={{ gridRow: '1 / span 2', gridColumn: 1 }}>
            {project ? '업무 상세' : '프로젝트'}
          </span>
          {months.reduce<{ el: JSX.Element[]; at: number }>(
            (acc, m) => {
              acc.el.push(
                <span key={`m${acc.at}`} className="g-head g-month" style={{ gridRow: 1, gridColumn: `${acc.at + 2} / span ${m.span}` }}>
                  {m.label}
                </span>,
              )
              acc.at += m.span
              return acc
            },
            { el: [], at: 0 },
          ).el}
          {cols.map((c, i) => (
            <span key={c} className={`g-head g-week ${i === todayCol ? 'today' : ''}`} style={{ gridRow: 2, gridColumn: i + 2 }} title={`${shortDate(c)} 주`}>
              {i + 1}주
            </span>
          ))}
          {project
            ? groups.map(([phase, list]) => {
                const head = ++row
                return (
                  <div key={phase} style={{ display: 'contents' }}>
                    <span className="g-phase" style={{ gridRow: head, gridColumn: `1 / span ${weeks + 1}` }}>
                      {phase}
                    </span>
                    {list.map(t => {
                      const r = ++row
                      const [s, e] = spanOf(t)!
                      const late = t.status !== '완료' && !!t.due_date && t.due_date < today
                      return (
                        <div key={t.id} style={{ display: 'contents' }}>
                          <button type="button" className="g-label g-task" style={{ gridRow: r, gridColumn: 1 }} onClick={() => setEditing(t)} title="눌러서 고치기">
                            <span className="truncate">{t.title}</span>
                            <span className="t-cap">{profileName(t.assignee_id)}</span>
                          </button>
                          {cells(r)}
                          <button
                            type="button"
                            className={`g-bar s-${t.status === '완료' ? 'done' : t.status === '진행 중' ? 'doing' : 'todo'} ${late ? 'late' : ''}`}
                            style={{ gridRow: r, gridColumn: `${colOf(s) + 2} / ${colOf(e) + 3}` }}
                            onClick={() => setEditing(t)}
                            title={`${t.title} · ${profileName(t.assignee_id)} · ${shortDate(s)}~${shortDate(e)} · ${late ? '지연' : t.status}`}
                          >
                            {t.title}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            : active.map(p => {
                const r = ++row
                const s = p.start_date ?? p.end_date
                const e = p.end_date ?? p.start_date
                const ts = tasks.filter(t => t.project_id === p.id)
                const done = ts.filter(t => t.status === '완료').length
                return (
                  <div key={p.id} style={{ display: 'contents' }}>
                    <button type="button" className="g-label g-task" style={{ gridRow: r, gridColumn: 1 }} onClick={() => navigate(withQuery(path, query, { project: p.id }), { replace: true })}>
                      <span className="truncate">{p.name}</span>
                      <span className="t-cap">
                        {profileName(p.owner_id)} · 업무 {done}/{ts.length}
                      </span>
                    </button>
                    {cells(r)}
                    {s && e && (
                      <button
                        type="button"
                        className={`g-bar ${p.status === '진행' ? 's-doing' : 's-todo'}`}
                        style={{ gridRow: r, gridColumn: `${colOf(s) + 2} / ${colOf(e) + 3}` }}
                        onClick={() => navigate(withQuery(path, query, { project: p.id }), { replace: true })}
                        title={`${p.name} · ${shortDate(s)}~${shortDate(e)} · ${p.status}`}
                      >
                        {p.name}
                      </button>
                    )}
                  </div>
                )
              })}
        </div>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--blue)' }} />
          완료
        </span>
        <span>
          <i style={{ background: 'var(--acid)', outline: '1px solid var(--blue)' }} />
          진행 중
        </span>
        <span>
          <i style={{ background: 'var(--blue-tint)' }} />
          할 일
        </span>
        <span>
          <i style={{ background: 'var(--white)', outline: '2px solid var(--red)' }} />
          지연
        </span>
        <span>
          <i style={{ background: 'var(--yellow)', outline: '1px solid var(--line)' }} />
          이번 주
        </span>
      </div>
      {project && groups.length === 0 && <Empty>아직 일정이 있는 업무가 없습니다. '업무 지시'로 시작일 · 마감일을 넣어 추가하세요.</Empty>}
      {unscheduled.length > 0 && (
        <span className="t-cap">
          날짜가 없는 업무 {unscheduled.length}건은 일정표에 나오지 않습니다:{' '}
          {unscheduled.map((t, i) => (
            <button key={t.id} type="button" className="name-btn t-cap" onClick={() => setEditing(t)}>
              {t.title}
              {i < unscheduled.length - 1 ? ',' : ''}
            </button>
          ))}
        </span>
      )}
      {editing && <TaskAssignModal task={editing === 'new' ? undefined : editing} projects={projects} tasks={tasks} presetProject={project?.id} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------
// 월간 캘린더 (업무 기간 · 마감 · 프로젝트 시작/종료 · 휴가)
// ---------------------------------------------------------------------

interface CalItem {
  key: string
  label: string
  tone: 'task' | 'late' | 'done' | 'project' | 'leave'
  task?: Task
  to?: string
}

export function MonthCalendar({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const { api, me, version, profileName } = useApp()
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [mine, setMine] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const { data: leaves } = useAsync(() => api.listLeave(), [version], [] as LeaveRecord[])

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>()
    const push = (d: string, it: CalItem) => m.set(d, [...(m.get(d) ?? []), it])
    const first = `${month}-01`
    const last = addDays(`${addMonths(month, 1)}-01`, -1)
    for (const t of tasks) {
      if (mine && t.assignee_id !== me.id) continue
      const sp = spanOf(t)
      if (!sp) continue
      const late = t.status !== '완료' && !!t.due_date && t.due_date < today
      const tone = t.status === '완료' ? 'done' : late ? 'late' : 'task'
      // 기간 업무는 시작일과 마감일에, 하루 업무는 그날에
      const who = profileName(t.assignee_id)
      if (sp[0] === sp[1]) push(sp[0], { key: t.id, label: `${t.title} · ${who}`, tone, task: t })
      else {
        if (sp[0] >= first && sp[0] <= last) push(sp[0], { key: `${t.id}s`, label: `▶ ${t.title} · ${who}`, tone, task: t })
        push(sp[1], { key: `${t.id}e`, label: `■ ${t.title} 마감 · ${who}`, tone, task: t })
      }
    }
    for (const p of projects) {
      if (p.status === '보류') continue
      if (p.start_date) push(p.start_date, { key: `${p.id}s`, label: `${p.name} 시작`, tone: 'project', to: `/projects?id=${p.id}` })
      if (p.end_date) push(p.end_date, { key: `${p.id}e`, label: `${p.name} 종료`, tone: 'project', to: `/projects?id=${p.id}` })
    }
    for (const l of leaves) {
      if (l.status !== '승인' || (mine && l.profile_id !== me.id)) continue
      for (let d = l.start_date; d <= l.end_date; d = addDays(d, 1)) push(d, { key: `${l.id}${d}`, label: `${profileName(l.profile_id)} ${l.kind}`, tone: 'leave', to: '/team?view=leave' })
    }
    return m
  }, [tasks, projects, leaves, mine, me.id, month, today, profileName])

  const item = (it: CalItem) =>
    it.task ? (
      <button key={it.key} type="button" className={`cal-item c-${it.tone}`} onClick={() => setEditing(it.task!)} title={it.label}>
        {it.label}
      </button>
    ) : (
      <Link key={it.key} to={it.to ?? '#'} className={`cal-item c-${it.tone}`} title={it.label}>
        {it.label}
      </Link>
    )
  return (
    <div className="col gap-10">
      <div className="row wrap">
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달">
          <ChevronLeft size={16} />
        </button>
        <span className="t-title">
          {month.slice(0, 4)}년 {Number(month.slice(5))}월
        </span>
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRight size={16} />
        </button>
        {month !== today.slice(0, 7) && (
          <Button kind="ghost" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
            오늘
          </Button>
        )}
        <span className="grow" />
        <div className="chips">
          <Chip active={!mine} onClick={() => setMine(false)}>
            팀 전체
          </Chip>
          <Chip active={mine} onClick={() => setMine(true)}>
            내 일정
          </Chip>
        </div>
      </div>
      <div className="bigcal">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {monthGrid(month).map((d, i) => {
          if (!d) return <span key={`e${i}`} className="day empty" />
          const list = byDay.get(d) ?? []
          return (
            <div key={d} className={`day ${d === today ? 'today' : ''}`}>
              <span className="n">
                {Number(d.slice(8))}
                {d === today && <Badge tone="yellow">오늘</Badge>}
              </span>
              {list.slice(0, 3).map(item)}
              {list.length > 3 && (
                <button type="button" className="more" onClick={() => setOpenDay(d)}>
                  +{list.length - 3}건 더
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--blue-tint)' }} />
          업무 (▶ 시작 · ■ 마감)
        </span>
        <span>
          <i style={{ background: 'var(--red)' }} />
          지연
        </span>
        <span>
          <i style={{ background: 'var(--paper)', outline: '1px solid var(--line)' }} />
          완료
        </span>
        <span>
          <i style={{ background: 'var(--green)' }} />
          프로젝트 시작 · 종료
        </span>
        <span>
          <i style={{ background: 'var(--pink)' }} />
          휴가
        </span>
      </div>
      {openDay && (
        <Modal title={`${shortDate(openDay)} (${weekday(openDay)}) 일정`} onClose={() => setOpenDay(null)}>
          <div className="col gap-6">
            {(byDay.get(openDay) ?? []).map(item)}
          </div>
        </Modal>
      )}
      {editing && <TaskAssignModal task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------
// 내가 지시한 업무 (받은 사람 · 진행 상태)
// ---------------------------------------------------------------------

export function SentTasks({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const { me, profileName } = useApp()
  const today = todayKey()
  const [editing, setEditing] = useState<Task | null>(null)
  const sent = tasks.filter(t => t.created_by === me.id && t.assignee_id && t.assignee_id !== me.id && t.status !== '완료').sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
  if (!sent.length) return null
  return (
    <div className="col gap-2">
      <div className="section-h">
        <span className="t-bodyb">내가 지시한 업무</span>
        <Badge tone="blue">{sent.length}</Badge>
      </div>
      {sent.map(t => {
        const late = !!t.due_date && t.due_date < today
        return (
          <button key={t.id} type="button" className="item-row" style={{ textAlign: 'left', width: '100%', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setEditing(t)}>
            <Avatar name={profileName(t.assignee_id)} size="xs" />
            <span className="col gap-2 grow">
              <span className="t-smallb truncate">{t.title}</span>
              <span className="t-cap truncate">
                {profileName(t.assignee_id)}
                {t.project_id ? ` · ${projects.find(p => p.id === t.project_id)?.name ?? ''}` : ''}
                {t.phase ? ` · ${t.phase}` : ''}
              </span>
            </span>
            {t.due_date && <span className={`t-meta ${late ? 't-red' : ''}`}>{shortDate(t.due_date)}</span>}
            <StatusBadge status={late ? '지연' : t.status} />
          </button>
        )
      })}
      {editing && <TaskAssignModal task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
    </div>
  )
}
