// 홈 '내가 지시한 업무' · '팀원별 할 일' 계산 (2026-11-25 · 시험 tests/home-team-tasks.test.ts)
import type { Profile, Task } from './types'

/** 내가 지시한 업무만 고름 — 내가 만들고 다른 사람(AI 팀원 포함)에게 맡긴 할 일 */
export function sentTasks(tasks: Task[], meId: string, today: string, weekAgo: string) {
  const sent = tasks.filter(t => t.created_by === meId && t.assignee_id && t.assignee_id !== meId)
  const open = sent.filter(t => t.status !== '완료')
  const byDue = (a: Task, b: Task) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9')
  return {
    late: open.filter(t => t.due_date && t.due_date < today).sort(byDue),
    open: open.filter(t => !(t.due_date && t.due_date < today)).sort(byDue),
    done: sent.filter(t => t.status === '완료' && t.completed_at && t.completed_at >= weekAgo).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
  }
}

/** 팀원마다 끝나지 않은 할 일 · 지연 수 */
export function teamTaskCounts(tasks: Task[], people: Pick<Profile, 'id' | 'name'>[], today: string) {
  return people.map(p => {
    const open = tasks.filter(t => t.assignee_id === p.id && t.status !== '완료')
    return { id: p.id, name: p.name, open: open.length, late: open.filter(t => t.due_date && t.due_date < today).length }
  })
}
