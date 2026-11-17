// 평면 편집기 고침 (2026-11-17 점검): 벽을 바꾼 뒤 문 · 창 다시 앉히기 · 길이 없는 벽 막기 · 닫힌 방 규칙 하나 · 저장 비교 글
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampSize, closedShell, floorArea, planCanon, planQuantities, roomArea, type PlanGeometry, type PlanWall } from '../src/lib/designPlan.ts'
import { moveCorner, openingOverlaps, outwardSides, reseatOpenings, seatOpening, setWallLength, wallPieces } from '../src/lib/designPlanDraw.ts'

const rect = (): PlanWall[] => [
  { id: 'a', x1: 0, y1: 0, x2: 4000, y2: 0, t: 150, kind: 'existing' },
  { id: 'b', x1: 4000, y1: 0, x2: 4000, y2: 3000, t: 150, kind: 'existing' },
  { id: 'c', x1: 4000, y1: 3000, x2: 0, y2: 3000, t: 150, kind: 'existing' },
  { id: 'd', x1: 0, y1: 3000, x2: 0, y2: 0, t: 150, kind: 'existing' },
]
const plan = (walls: PlanWall[], openings: PlanGeometry['openings'] = []): PlanGeometry => ({ unit: 'mm', height: 2700, walls, openings, items: [] })

test('shortening a new wall keeps its door inside the wall and the quantity matches the drawn wall', () => {
  const g = plan([{ id: 'n', x1: 0, y1: 0, x2: 5000, y2: 0, t: 100, kind: 'new' }], [{ id: 'o', wall: 'n', pos: 4500, width: 900, kind: 'door' }])
  const walls = setWallLength(g.walls, 'n', 3000)
  const r = reseatOpenings({ ...g, walls }, g.walls)
  assert.equal(r.dropped, 0)
  assert.equal(r.plan.openings[0].pos, 2550)
  // 3D 조각에도 문 자리가 남는다 (벽 밖이면 조각 하나뿐)
  assert.ok(wallPieces(r.plan.walls[0], r.plan.openings, 2700).length > 1)
  assert.equal(planQuantities(r.plan)[0].qty, 6.21)
})

test('a door that is wider than the shortened wall is removed', () => {
  const g = plan([{ id: 'n', x1: 0, y1: 0, x2: 5000, y2: 0, t: 100, kind: 'new' }], [{ id: 'o', wall: 'n', pos: 1000, width: 900, kind: 'door' }])
  const r = reseatOpenings({ ...g, walls: setWallLength(g.walls, 'n', 600) }, g.walls)
  assert.equal(r.dropped, 1)
  assert.equal(r.plan.openings.length, 0)
})

test('moving the start corner along the wall leaves the door where it was on the plan', () => {
  const g = plan(rect(), [{ id: 'o', wall: 'a', pos: 1000, width: 900, kind: 'door' }])
  const walls = moveCorner(g.walls, { x: 0, y: 0 }, { x: -1000, y: 0 })
  const r = reseatOpenings({ ...g, walls }, g.walls)
  assert.equal(r.plan.openings[0].pos, 2000)
})

test('walls whose shape did not change keep their openings untouched (same object)', () => {
  const g = plan(rect(), [{ id: 'o', wall: 'c', pos: 1500, width: 900, kind: 'door' }])
  const walls = moveCorner(g.walls, { x: 4000, y: 0 }, { x: 4500, y: 0 })
  const r = reseatOpenings({ ...g, walls }, g.walls)
  assert.equal(r.plan, g.walls === walls ? g : r.plan)
  assert.equal(r.plan.openings[0], g.openings[0])
  assert.equal(reseatOpenings(g, g.walls).plan, g)
})

test('zero-length walls are refused by setWallLength and dropped with their openings', () => {
  const walls = moveCorner(rect(), { x: 4000, y: 0 }, { x: 4000, y: 3000 })
  const b = walls.find(w => w.id === 'b')!
  assert.equal(Math.hypot(b.x2 - b.x1, b.y2 - b.y1), 0)
  assert.equal(setWallLength(walls, 'b', 2000), walls)
  const r = reseatOpenings(plan(walls, [{ id: 'o', wall: 'b', pos: 0, width: 900, kind: 'window' }]), rect())
  assert.equal(r.collapsed, 1)
  assert.equal(r.dropped, 1)
  assert.ok(!r.plan.walls.some(w => w.id === 'b'))
})

test('seatOpening clamps a typed position into the wall', () => {
  assert.deepEqual(seatOpening(9000, 900, 4000), { pos: 3550, width: 900 })
  assert.deepEqual(seatOpening(0, 900, 4000), { pos: 450, width: 900 })
  assert.equal(seatOpening(500, 1200, 1000), null)
})

test('a new opening on top of an existing one is detected', () => {
  const ops = [{ id: 'o1', wall: 'c', pos: 1500, width: 900, kind: 'door' as const }]
  assert.ok(openingOverlaps(ops, 'c', 1500, 1200))
  assert.equal(openingOverlaps(ops, 'c', 3000, 1200), null)
  assert.equal(openingOverlaps(ops, 'a', 1500, 1200), null)
  assert.equal(openingOverlaps(ops, 'c', 1500, 900, 'o1'), null)
})

test('closed-shell rule ignores a dangling stub wall, the same way everywhere', () => {
  const walls = [...rect(), { id: 's', x1: 2000, y1: 0, x2: 2000, y2: 1500, t: 100, kind: 'existing' as const }]
  // 벽 a 가 (2000,0) 에서 나뉘지 않아도 떠 있는 벽은 빠진다
  assert.equal(floorArea(walls), null)
  assert.equal(closedShell(walls)?.length, 4)
  assert.equal(roomArea(walls), 12)
  const sides = outwardSides({ walls })
  // 닫힌 방으로 보므로 바깥쪽을 안다: 위쪽 벽 a 의 왼쪽(화면 위)이 바깥
  assert.equal(sides.get('a'), 1)
  assert.equal(sides.get('c'), 1)
})

test('plan comparison ignores notes, lighting counts and key order', () => {
  const g: PlanGeometry = { ...plan(rect()), rooms: [{ id: 'r', no: '101', name: '', floor: {}, base: {}, wall: {}, ceiling: {}, lights: { 'DL-01': 3 } }], notes: [{ id: 'n', x: 0, y: 0, text: 'a', by: 'x', at: '2026' }] }
  const shuffled = JSON.parse(JSON.stringify({ items: [], openings: [], walls: g.walls.map(w => ({ t: w.t, kind: w.kind, y2: w.y2, x2: w.x2, y1: w.y1, x1: w.x1, id: w.id })), height: 2700, unit: 'mm', rooms: [{ ceiling: {}, wall: {}, base: {}, floor: {}, name: '', no: '101', id: 'r', lights: { 'DL-01': 9 } }] }))
  assert.equal(planCanon(g), planCanon(shuffled))
  assert.notEqual(planCanon(g), planCanon({ ...g, height: 2800 }))
  assert.equal(planCanon(null), 'null')
})

test('item sizes are clamped to 10..20000 mm', () => {
  assert.equal(clampSize(1200600900), 20000)
  assert.equal(clampSize(0), 10)
  assert.equal(clampSize(1200), 1200)
})
