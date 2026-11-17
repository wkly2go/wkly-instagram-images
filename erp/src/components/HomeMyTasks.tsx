import { useState } from 'react'
import { useAction, useApp } from '../lib/app'
import { todayKey, weekRange } from '../lib/date'
import { Link } from '../lib/router'
import type { Project, Task } from '../lib/types'
import { TaskAssignModal } from '../pages/Schedule'
import { NEXT_TASK_STATUS, TaskBoard } from './TaskBoard'
import { Badge, Empty, SectionHead } from './ui'

const MORE_KEY = 'wkly-home-tasks-more'
const readMore = () => { try { return localStorage.getItem(MORE_KEY) === '1' } catch { return false } }

/**
 * 홈의 '내 할 일' 표 (대표 지시 2026-11-17 '홈에 내할일 넣어줘')
 * 프로젝트 › 내 할 일과 같은 표(체크 · 상태 · 할 일 · 프로젝트 · 담당 · 마감 · 알람)를 홈에서 바로 처리한다.
 * 지연 · 오늘 · 이번 주는 늘 보이고, 이후 · 날짜 없음은 접어 둔다. 고치면 업무 일지에도 자동으로 적힌다(서버 트리거).
 */
export function HomeMyTasks({ tasks, projects, loading }: { tasks: Task[]; projects: Project[]; loading: boolean }) {
  const { api, me } = useApp()
  const { run } = useAction()
  const today = todayKey()
  const [, we] = weekRange(today)
  const [editing, setEditing] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)
  const [more, setMore] = useState(readMore)
  const mine = tasks.filter(t => t.assignee_id === me.id && t.status !== '완료')
  const groups: [string, Task[]][] = [
    ['지연', mine.filter(t => t.due_date && t.due_date < today)],
    ['오늘', mine.filter(t => t.due_date === today)],
    ['이번 주', mine.filter(t => t.due_date && t.due_date > today && t.due_date <= we)],
  ]
  const later: [string, Task[]][] = [
    ['이후', mine.filter(t => t.due_date && t.due_date > we)],
    ['날짜 없음', mine.filter(t => !t.due_date)],
  ]
  const laterCount = later.reduce((s, [, l]) => s + l.length, 0)
  const toggleMore = () => {
    const next = !more
    setMore(next)
    try { localStorage.setItem(MORE_KEY, next ? '1' : '0') } catch { /* 저장 못 해도 화면은 그대로 */ }
  }
  const board = ([label, list]: [string, Task[]]) =>
    list.length ? (
      <div key={label} className="col gap-2">
        <div className="home-tasks-h">
          <span className={`t-bodyb ${label === '지연' ? 't-red' : ''}`}>{label}</span>
          <Badge tone={label === '지연' ? 'red' : 'yellow'}>{list.length}</Badge>
        </div>
        <TaskBoard list={list} late={label === '지연'} projects={projects} onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT_TASK_STATUS[t.status] }))} onEdit={t => setEditing(t)} />
      </div>
    ) : null
  return (
    <section className="section home-tasks" aria-label="내 할 일">
      <SectionHead
        title="내 할 일"
        count={mine.length}
        right={
          <>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
              할 일 추가
            </button>
            <Link to="/projects?view=mine">전체 보기 ›</Link>
          </>
        }
      />
      {mine.length === 0 ? (
        <Empty>{loading ? '불러오는 중…' : '나에게 배정된 할 일이 없습니다.'}</Empty>
      ) : (
        <div className="col gap-10">
          {groups.map(board)}
          {groups.every(([, l]) => l.length === 0) && !more && <span className="t-cap">이번 주까지 마감인 할 일이 없습니다.</span>}
          {more && later.map(board)}
          {laterCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm home-tasks-more" aria-expanded={more} onClick={toggleMore}>
              {more ? '접기' : `이후 · 날짜 없음 ${laterCount}건 보기`}
            </button>
          )}
        </div>
      )}
      {editing && <TaskAssignModal key={editing.id} task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
      {adding && <TaskAssignModal key="new" projects={projects} tasks={tasks} presetAssignee={me.id} presetDate={today} onClose={() => setAdding(false)} />}
    </section>
  )
}
