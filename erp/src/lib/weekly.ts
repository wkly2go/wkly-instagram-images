import { addDays } from './date'
import { DIVISION_KEYS, projectBrand, type Division, type LeaveRecord, type Project, type Task, type WorkLog } from './types'

/** 주간 보고의 한 주: 월요일 ~ 일요일 */
export function mondayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(key, -((dow + 6) % 7))
}
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

export interface ProjectLogs { project: Project | null; logs: WorkLog[]; minutes: number }
export interface DivisionLogs { division: Division | null; projects: ProjectLogs[]; count: number; minutes: number }

/**
 * 업무 일지를 구분(아트리어 · 더위클리 · 내부 리서치) → 프로젝트로 나눔 (대표 지시 2026-11-16)
 *  - 프로젝트 없는 기록은 맨 뒤 '프로젝트 미지정'
 *  - 프로젝트 순서는 연번, 그 안의 기록은 날짜 · 쓴 순서
 */
export function groupLogsByProject(logs: WorkLog[], projects: Project[]): DivisionLogs[] {
  const byId = new Map(projects.map(p => [p.id, p]))
  const buckets = new Map<string, ProjectLogs>()
  for (const l of logs) {
    const p = l.project_id ? byId.get(l.project_id) ?? null : null
    const key = p?.id ?? ''
    const b = buckets.get(key) ?? { project: p, logs: [], minutes: 0 }
    b.logs.push(l)
    b.minutes += l.minutes ?? 0
    buckets.set(key, b)
  }
  const out: DivisionLogs[] = []
  for (const d of [...DIVISION_KEYS, null] as (Division | null)[]) {
    const list = [...buckets.values()]
      .filter(b => (b.project ? projectBrand(b.project) : null) === d)
      .sort((a, b) => (a.project?.code ?? a.project?.name ?? '').localeCompare(b.project?.code ?? b.project?.name ?? ''))
    for (const b of list) b.logs.sort((x, y) => x.log_date.localeCompare(y.log_date) || x.created_at.localeCompare(y.created_at))
    if (list.length) out.push({ division: d, projects: list, count: list.reduce((n, b) => n + b.logs.length, 0), minutes: list.reduce((n, b) => n + b.minutes, 0) })
  }
  return out
}

export interface WeeklyGaps {
  /** 기록이 한 건도 없는 평일 (오늘까지 · 승인된 휴가 날 제외) */
  emptyDays: string[]
  /** 프로젝트를 고르지 않은 기록 */
  noProject: WorkLog[]
  /** 이번 주에 끝낸 내 할 일인데 그날 그 프로젝트 일지에 흔적이 없는 것 */
  doneTasks: Task[]
  /** 내가 맡은 진행 중 프로젝트인데 이번 주 기록이 없는 것 */
  quietProjects: Project[]
}

const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10)

/** 주간 보고에서 보완할 빠진 부분 찾기 */
export function findWeeklyGaps(a: { monday: string; today: string; userId: string; logs: WorkLog[]; tasks: Task[]; projects: Project[]; leaves: LeaveRecord[] }): WeeklyGaps {
  const days = weekDays(a.monday)
  const sunday = days[6]
  const logged = new Set(a.logs.map(l => l.log_date))
  const off = (d: string) => a.leaves.some(l => l.profile_id === a.userId && l.status === '승인' && l.start_date <= d && d <= l.end_date && Number(l.days) >= 1)
  const emptyDays = days.slice(0, 5).filter(d => d <= a.today && !logged.has(d) && !off(d))
  const noProject = a.logs.filter(l => !l.project_id)
  const doneTasks = a.tasks.filter(t => {
    if (t.assignee_id !== a.userId || t.status !== '완료' || !t.completed_at) return false
    const d = kstDay(t.completed_at)
    if (d < a.monday || d > sunday) return false
    // 할 일에서 자동으로 적힌(또는 연결된) 기록이 이번 주에 있으면 이미 일지에 있는 것 (20261117150000 · work_logs.task_id)
    if (a.logs.some(l => l.task_id === t.id && l.log_date >= a.monday && l.log_date <= sunday)) return false
    const head = t.title.trim().slice(0, 12)
    return !a.logs.some(l => l.log_date === d && (l.project_id ?? null) === (t.project_id ?? null) && (!head || l.content.includes(head) || !!t.project_id))
  })
  const active = new Set(a.logs.map(l => l.project_id).filter(Boolean))
  const mine = new Set(a.tasks.filter(t => t.assignee_id === a.userId && t.status !== '완료' && t.project_id).map(t => t.project_id!))
  const quietProjects = a.projects.filter(p => (p.status === '진행' || p.status === '기획') && (p.owner_id === a.userId || mine.has(p.id)) && !active.has(p.id))
  return { emptyDays, noProject, doneTasks, quietProjects }
}
export const taskDoneDay = (t: Task) => (t.completed_at ? kstDay(t.completed_at) : null)
