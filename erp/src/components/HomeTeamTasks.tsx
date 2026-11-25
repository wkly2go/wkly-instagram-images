import { useState } from 'react'
import { useAction, useApp } from '../lib/app'
import { todayKey } from '../lib/date'
import type { Project, Task } from '../lib/types'
import { teamTaskCounts } from '../lib/teamTasks'
import { TaskAssignModal } from '../pages/Schedule'
import { NEXT_TASK_STATUS, TaskBoard } from './TaskBoard'
import { Empty, SectionHead } from './ui'

const PICK_KEY = 'wkly-home-team-pick'

/**
 * 홈 '팀원별 할 일' (대표 지시 2026-11-25 '각 팀원의 할 일을 볼 수 있게 만들어')
 * 팀원 칩(끝나지 않은 할 일 수 · 지연 수)을 누르면 그 사람의 할 일 표(지연 먼저 · 마감 순). 고르면 이 브라우저에 기억.
 * 표에서 상태 바꾸기 · 눌러서 고치기는 '내 할 일'과 같음(권한은 서버 규칙 그대로).
 */
export function HomeTeamTasks({ tasks, projects }: { tasks: Task[]; projects: Project[] }) {
  const { api, me, profiles } = useApp()
  const { run } = useAction()
  const today = todayKey()
  const people = profiles.filter(p => p.active && !p.is_agent && p.id !== me.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const counts = teamTaskCounts(tasks, people, today)
  const [pick, setPick] = useState<string | null>(() => { try { return localStorage.getItem(PICK_KEY) } catch { return null } })
  const [editing, setEditing] = useState<Task | null>(null)
  if (!people.length) return null
  const chosen = people.find(p => p.id === pick)?.id ?? counts.slice().sort((a, b) => b.late - a.late || b.open - a.open)[0]?.id
  const choose = (id: string) => {
    setPick(id)
    try { localStorage.setItem(PICK_KEY, id) } catch { /* 저장 못 해도 화면은 그대로 */ }
  }
  const list = tasks
    .filter(t => t.assignee_id === chosen && t.status !== '완료')
    .sort((a, b) => {
      const la = a.due_date && a.due_date < today ? 0 : 1
      const lb = b.due_date && b.due_date < today ? 0 : 1
      return la - lb || (a.due_date ?? '9').localeCompare(b.due_date ?? '9')
    })
  const lateList = list.filter(t => t.due_date && t.due_date < today)
  const rest = list.filter(t => !(t.due_date && t.due_date < today))
  const name = people.find(p => p.id === chosen)?.name ?? ''
  return (
    <section className="section home-tasks home-team" aria-label="팀원별 할 일">
      <SectionHead title="팀원별 할 일" count={counts.reduce((s, c) => s + c.open, 0)} />
      <div className="chips home-team-chips" role="tablist" aria-label="팀원">
        {counts.map(c => (
          <button key={c.id} type="button" role="tab" aria-selected={c.id === chosen} className={`chip${c.id === chosen ? ' active' : ''}`} onClick={() => choose(c.id)}>
            {c.name} <span className="home-team-n">{c.open}</span>{c.late > 0 && <span className="home-team-late">지연 {c.late}</span>}
          </button>
        ))}
      </div>
      {!list.length ? <Empty>{name}님에게 끝나지 않은 할 일이 없습니다.</Empty> : (
        <div className="col gap-10">
          {lateList.length > 0 && <div className="col gap-2"><span className="t-bodyb t-red">지연 {lateList.length}</span>
            <TaskBoard list={lateList} late projects={projects} onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT_TASK_STATUS[t.status] }))} onEdit={t => setEditing(t)} /></div>}
          {rest.length > 0 && <div className="col gap-2"><span className="t-bodyb">할 일 · 진행 중 {rest.length}</span>
            <TaskBoard list={rest} projects={projects} onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT_TASK_STATUS[t.status] }))} onEdit={t => setEditing(t)} /></div>}
        </div>
      )}
      {editing && <TaskAssignModal key={editing.id} task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
    </section>
  )
}
