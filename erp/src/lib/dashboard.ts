// 홈 대시보드 계산 (2026-11-28 대표 지시 '홈은 대시보드로 만들어') — 순수 규칙 · AI 없음 · 시험 tests/dashboard.test.ts
// 홈 = 회사 전체를 보는 대시보드, 개인 일은 '개인 업무'(/my)로 나눔
import { addDays } from './date.ts'

export interface DashTask { id: string; title: string; project_id: string | null; assignee_id: string | null; due_date: string | null; start_date?: string | null; status: string }
export interface DashProject { id: string; name: string; code?: string | null; status: string; division?: string | null; start_date: string | null; end_date: string | null }
export type Div = 'AR' | 'TW' | 'RS'
export const divOf = (p: Pick<DashProject, 'code' | 'division'>): Div => (p.division as Div | undefined) ?? (p.code?.startsWith('TW') ? 'TW' : p.code?.startsWith('RS') ? 'RS' : 'AR')

export interface DashKpis { active: number; inquiry: number; dueToday: number; late: number; week: number; doneWeek: number }
/** 숫자 띠: 진행 · 문의 프로젝트 · 오늘 마감 · 지연 · 7일 안 마감 · 지난 7일 끝낸 일 */
export function dashKpis(tasks: readonly (DashTask & { completed_at?: string | null })[], projects: readonly DashProject[], today: string): DashKpis {
  const open = tasks.filter(t => t.status !== '완료')
  const weekEnd = addDays(today, 6), weekAgo = addDays(today, -6)
  return {
    active: projects.filter(p => p.status === '진행').length,
    inquiry: projects.filter(p => p.status === '문의').length,
    dueToday: open.filter(t => t.due_date === today).length,
    late: open.filter(t => !!t.due_date && t.due_date < today).length,
    week: open.filter(t => !!t.due_date && t.due_date >= today && t.due_date <= weekEnd).length,
    doneWeek: tasks.filter(t => t.status === '완료' && !!t.completed_at && t.completed_at.slice(0, 10) >= weekAgo).length,
  }
}

export interface DivRow { div: Div; active: number; inquiry: number; done: number; other: number; total: number }
/** 구분별 프로젝트 수 (진행 · 문의 · 완료 · 그 밖) */
export function byDivision(projects: readonly DashProject[]): DivRow[] {
  return (['AR', 'TW', 'RS'] as Div[]).map(div => {
    const list = projects.filter(p => divOf(p) === div)
    const n = (s: string) => list.filter(p => p.status === s).length
    const active = n('진행'), inquiry = n('문의'), done = n('완료')
    return { div, active, inquiry, done, other: list.length - active - inquiry - done, total: list.length }
  })
}

export interface LoadRow { id: string; name: string; open: number; late: number; today: number }
/** 팀원별 업무량: 안 끝난 일 · 지연 · 오늘 마감 (많은 순 · 일 없는 사람도 보임) */
export function teamLoad(tasks: readonly DashTask[], people: readonly { id: string; name: string }[], today: string): LoadRow[] {
  return people.map(p => {
    const mine = tasks.filter(t => t.assignee_id === p.id && t.status !== '완료')
    return { id: p.id, name: p.name, open: mine.length, late: mine.filter(t => !!t.due_date && t.due_date < today).length, today: mine.filter(t => t.due_date === today).length }
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'ko'))
}

export interface DayCell { date: string; items: { id: string; kind: 'task' | 'start' | 'end'; title: string; late?: boolean; projectId?: string | null }[] }
/** 오늘부터 7일: 마감인 할 일 · 시작하는 프로젝트 · 끝나는 프로젝트 */
export function weekAhead(tasks: readonly DashTask[], projects: readonly DashProject[], today: string, days = 7): DayCell[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i)
    const items: DayCell['items'] = []
    for (const p of projects) {
      if (p.status === '완료' || p.status === 'NIC' || p.status === '보류') continue
      if (p.end_date === date) items.push({ id: `e${p.id}`, kind: 'end', title: p.name, projectId: p.id })
      if (p.start_date === date) items.push({ id: `s${p.id}`, kind: 'start', title: p.name, projectId: p.id })
    }
    for (const t of tasks) if (t.status !== '완료' && t.due_date === date) items.push({ id: t.id, kind: 'task', title: t.title, projectId: t.project_id })
    return { date, items }
  })
}

export interface DeadlineRow { id: string; name: string; code: string; div: Div; daysLeft: number; progress: number; openTasks: number; lateTasks: number }
/** 마감이 가까운 진행 프로젝트 (끝나는 날 순 · 지난 것도 보임) — 진행률은 할 일 완료 비율 */
export function nearDeadlines(tasks: readonly DashTask[], projects: readonly DashProject[], today: string, limit = 6): DeadlineRow[] {
  const day = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)
  return projects.filter(p => p.status === '진행' && !!p.end_date).sort((a, b) => a.end_date!.localeCompare(b.end_date!)).slice(0, limit).map(p => {
    const mine = tasks.filter(t => t.project_id === p.id)
    const open = mine.filter(t => t.status !== '완료')
    return { id: p.id, name: p.name, code: p.code ?? '', div: divOf(p), daysLeft: day(p.end_date!, today), progress: mine.length ? Math.round(((mine.length - open.length) / mine.length) * 100) : 0, openTasks: open.length, lateTasks: open.filter(t => !!t.due_date && t.due_date < today).length }
  })
}

export const DASH_LAYOUTS = ['요약', '일정', '프로젝트'] as const
export type DashLayout = (typeof DASH_LAYOUTS)[number]
export const readLayout = (v: string | null | undefined): DashLayout => ((DASH_LAYOUTS as readonly string[]).includes(v ?? '') ? (v as DashLayout) : '요약')
