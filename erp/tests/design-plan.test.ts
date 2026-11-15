import test from 'node:test'
import assert from 'node:assert/strict'
import { floorArea, planQuantities, snapPoint, type PlanGeometry, type PlanWall } from '../src/lib/designPlan.ts'

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, kind: 'existing' | 'new' = 'existing'): PlanWall => ({ id, x1, y1, x2, y2, t: 100, kind })
const room = [wall('a', 0, 0, 6000, 0), wall('b', 6000, 0, 6000, 4000), wall('c', 6000, 4000, 0, 4000), wall('d', 0, 4000, 0, 0)]

test('닫힌 방의 바닥 면적만 계산하고, 열린 평면은 추정하지 않는다', () => {
  assert.equal(floorArea(room), 24)
  assert.equal(floorArea(room.slice(0, 3)), null)
})

test('가벽은 길이 × 높이에서 문 면적을 빼고, 같은 부품은 더한다', () => {
  const g: PlanGeometry = { unit: 'mm', height: 2400, walls: [...room, wall('n', 3000, 0, 3000, 4000, 'new')], openings: [{ id: 'o', wall: 'n', pos: 2000, width: 900, kind: 'door' }],
    items: [1, 2, 3].map(i => ({ id: `i${i}`, x: i * 1000, y: 500, w: 1200, d: 450, h: 900, rot: 0 as const, name: '진열 집기', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count' as const, section: '렌탈' })) }
  const q = planQuantities(g)
  const w = q.find(l => l.item === '가벽 설치')!
  assert.equal(w.qty, 7.71) // 4.0m × 2.4m − 0.9m × 2.1m
  assert.equal(w.unit, 'm2')
  const it = q.find(l => l.item === '진열 집기')!
  assert.deepEqual([it.qty, it.count, it.spec, it.section], [3, 3, 'W1200 D450 H900', '렌탈'])
  assert.equal(q.length, 2) // 기존 벽은 수량에 없다
})

test('격자와 직각 맞춤', () => {
  assert.deepEqual(snapPoint(1234, 987, 50), { x: 1250, y: 1000 })
  assert.deepEqual(snapPoint(3010, 240, 50, { x: 0, y: 0 }), { x: 3000, y: 0 })
})
