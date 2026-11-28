import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byDivision, dashKpis, dayFlow, nearDeadlines, sparkOf, teamLoad, weekAhead } from '../src/lib/dashboard.ts'

const T = '2026-11-28'
const tasks = [
  { id: 't1', title: '시안', project_id: 'p1', assignee_id: 'a', due_date: '2026-11-28', status: '할 일' },
  { id: 't2', title: '견적', project_id: 'p1', assignee_id: 'a', due_date: '2026-11-20', status: '진행 중' },
  { id: 't3', title: '발주', project_id: 'p1', assignee_id: 'b', due_date: '2026-12-02', status: '할 일' },
  { id: 't4', title: '끝낸 일', project_id: 'p1', assignee_id: 'b', due_date: '2026-11-25', status: '완료', completed_at: '2026-11-26T03:00:00Z' },
  { id: 't5', title: '오래전', project_id: 'p2', assignee_id: 'b', due_date: null, status: '완료', completed_at: '2026-10-01T03:00:00Z' },
]
const projects = [
  { id: 'p1', name: '팝업 A', code: 'AR2611-01', status: '진행', start_date: '2026-11-01', end_date: '2026-12-01' },
  { id: 'p2', name: '매거진', code: 'TW2611-02', status: '문의', start_date: '2026-11-30', end_date: null },
  { id: 'p3', name: '끝난 것', code: 'AR2610-01', status: '완료', start_date: null, end_date: '2026-11-29' },
  { id: 'p4', name: '운영', code: 'RS2611-01', division: 'RS', status: '진행', start_date: null, end_date: '2026-11-20' },
]

test('숫자 띠', () => {
  assert.deepEqual(dashKpis(tasks, projects, T), { active: 2, inquiry: 1, dueToday: 1, late: 1, week: 2, doneWeek: 1 })
})

test('구분별 · 팀원별', () => {
  const d = byDivision(projects)
  assert.deepEqual(d.map(x => [x.div, x.active, x.inquiry, x.done, x.total]), [['AR', 1, 0, 1, 2], ['TW', 0, 1, 0, 1], ['RS', 1, 0, 0, 1]])
  const l = teamLoad(tasks, [{ id: 'b', name: '나' }, { id: 'a', name: '가' }, { id: 'c', name: '다' }], T)
  assert.deepEqual(l.map(r => [r.name, r.open, r.late, r.today]), [['가', 2, 1, 1], ['나', 1, 0, 0], ['다', 0, 0, 0]])
})

test('앞으로 7일 · 끝난 프로젝트는 빼고', () => {
  const w = weekAhead(tasks, projects, T)
  assert.equal(w.length, 7)
  assert.deepEqual(w[0].items.map(i => i.id), ['t1'])
  assert.deepEqual(w[1].items, [])
  assert.deepEqual(w[2].items.map(i => i.kind), ['start'])
  assert.deepEqual(w[3].items.map(i => i.kind), ['end'])
  assert.deepEqual(w[4].items.map(i => i.id), ['t3'])
})

test('마감이 가까운 프로젝트 · 진행률', () => {
  const n = nearDeadlines(tasks, projects, T)
  assert.deepEqual(n.map(p => [p.id, p.daysLeft, p.progress, p.openTasks, p.lateTasks]), [['p4', -8, 0, 0, 0], ['p1', 3, 25, 3, 1]])
})

test('업무 흐름 · 작은 막대', () => {
  const f = dayFlow(tasks, T, 13, 14)
  assert.equal(f.length, 28)
  const at = (d: string) => f.find(x => x.date === d)!
  assert.deepEqual(at('2026-11-26'), { date: '2026-11-26', done: 1, due: 0, late: 0 })
  assert.deepEqual(at('2026-11-20'), { date: '2026-11-20', done: 0, due: 0, late: 1 })
  assert.deepEqual(at(T), { date: T, done: 0, due: 1, late: 0 })
  assert.deepEqual(sparkOf([0, 2, 4]), [0, 0.5, 1])
  assert.deepEqual(sparkOf([0, 0]), [0, 0])
})
