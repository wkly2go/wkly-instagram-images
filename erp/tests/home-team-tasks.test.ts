import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sentTasks, teamTaskCounts } from '../src/lib/teamTasks.ts'

const t = (o: Record<string, unknown>) => ({ id: String(Math.random()), title: 'x', status: '할 일', due_date: null, completed_at: null, created_by: 'me', assignee_id: 'a', ...o }) as never

test('내가 지시한 업무: 남에게 맡긴 것만 · 지연 / 진행 / 7일 안 완료', () => {
  const r = sentTasks([
    t({ due_date: '2026-11-20' }), t({ due_date: '2026-11-30' }), t({ assignee_id: 'me' }), t({ created_by: 'b' }),
    t({ status: '완료', completed_at: '2026-11-24T00:00:00Z' }), t({ status: '완료', completed_at: '2026-11-01T00:00:00Z' }),
  ], 'me', '2026-11-25', '2026-11-18T00:00:00Z')
  assert.equal(r.late.length, 1); assert.equal(r.open.length, 1); assert.equal(r.done.length, 1)
})

test('팀원별 할 일 수 · 지연 수', () => {
  const c = teamTaskCounts([t({ due_date: '2026-11-20' }), t({}), t({ status: '완료' }), t({ assignee_id: 'b' })], [{ id: 'a', name: '가' }, { id: 'b', name: '나' }], '2026-11-25')
  assert.deepEqual(c.map(x => [x.open, x.late]), [[2, 1], [1, 0]])
})
