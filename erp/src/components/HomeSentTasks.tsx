import { useState } from 'react'
import { useAction, useApp } from '../lib/app'
import { todayKey } from '../lib/date'
import type { Project, Task } from '../lib/types'
import { sentTasks } from '../lib/teamTasks'
import { TaskAssignModal } from '../pages/Schedule'
import { NEXT_TASK_STATUS, TaskBoard } from './TaskBoard'
import { Badge, SectionHead } from './ui'

const MORE_KEY = 'wkly-home-sent-more'
const readMore = () => { try { return localStorage.getItem(MORE_KEY) === '1' } catch { return false } }

/**
 * 홈 '내가 지시한 업무' (대표 지시 2026-11-25 '내가 지시한 업무 지시를 나도 볼 수 있게 만들어')
 * 받은 사람 · 상태 · 마감 · 지연을 한 표로 보고, 눌러서 고치기 · 상태 바꾸기. 최근 7일 안에 끝낸 것은 접어 둠.
 * 예전엔 프로젝트 › 내 할 일 화면 아래에만 있었음.
 */
export function HomeSentTasks({ tasks, projects }: { tasks: Task[]; projects: Project[] }) {
  const { api, me } = useApp()
  const { run } = useAction()
  const [editing, setEditing] = useState<Task | null>(null)
  const [more, setMore] = useState(readMore)
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { late, open, done } = sentTasks(tasks, me.id, todayKey(), weekAgo)
  if (!late.length && !open.length && !done.length) return null
  const toggleMore = () => {
    const next = !more
    setMore(next)
    try { localStorage.setItem(MORE_KEY, next ? '1' : '0') } catch { /* 저장 못 해도 화면은 그대로 */ }
  }
  const board = (label: string, list: Task[], tone: 'red' | 'yellow' | 'green') =>
    list.length ? (
      <div className="col gap-2">
        <div className="home-tasks-h">
          <span className={`t-bodyb ${tone === 'red' ? 't-red' : ''}`}>{label}</span>
          <Badge tone={tone}>{list.length}</Badge>
        </div>
        <TaskBoard list={list} late={tone === 'red'} projects={projects} onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT_TASK_STATUS[t.status] }))} onEdit={t => setEditing(t)} />
      </div>
    ) : null
  return (
    <section className="section home-tasks home-sent" aria-label="내가 지시한 업무">
      <SectionHead title="내가 지시한 업무" count={late.length + open.length} />
      <div className="col gap-10">
        {board('지연', late, 'red')}
        {board('진행 중 · 할 일', open, 'yellow')}
        {!late.length && !open.length && !more && <span className="t-cap">끝나지 않은 지시 업무가 없습니다.</span>}
        {more && board('최근 7일 완료', done, 'green')}
        {done.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm home-tasks-more" aria-expanded={more} onClick={toggleMore}>
            {more ? '접기' : `최근 7일 완료 ${done.length}건 보기`}
          </button>
        )}
      </div>
      {editing && <TaskAssignModal key={editing.id} task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
    </section>
  )
}
