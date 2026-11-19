// 다음날로 연기 (대표 지시 2026-11-19 '다음날로 연기 아이콘 만들어') — 할 일 표(TaskBoard) 의 달력 시계 아이콘
import type { Task } from './types'

const day = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** 마감이 지났거나 없으면 내일, 아니면 마감 다음 날. 시작일이 마감과 같던 하루짜리 일(또는 새 마감보다 늦은 시작일)은 시작일도 같이,
 *  알람은 마감이 옮겨진 날수만큼(최소 하루) 옮김 */
export function postponePatch(t: Pick<Task, 'due_date' | 'start_date' | 'remind_at'>, today: string): Partial<Task> {
  const base = !t.due_date || t.due_date < today ? today : t.due_date
  const due = day(base, 1)
  const out: Partial<Task> = { due_date: due }
  if (t.start_date && (t.start_date === t.due_date || t.start_date > due)) out.start_date = due
  if (t.remind_at) {
    const shift = t.due_date ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${t.due_date}T00:00:00Z`)) / 86400000) : 1
    out.remind_at = new Date(Date.parse(t.remind_at) + Math.max(1, shift) * 86400000).toISOString()
  }
  return out
}
