import test from 'node:test'
import assert from 'node:assert/strict'
import { materialKind, wallFaceArea, wallFinishRows, elevationItems, furnitureTypes, pickScale, planDxf, sheetList } from '../src/lib/designDrawings.ts'
import type { PlanGeometry } from '../src/lib/designPlan.ts'

const g: PlanGeometry = { unit: 'mm', height: 2700, openings: [{ id: 'o', wall: 'a', pos: 1500, width: 900, kind: 'door' }],
  walls: [['a', 0, 0, 8000, 0], ['b', 8000, 0, 8000, 5000], ['c', 8000, 5000, 0, 5000], ['d', 0, 5000, 0, 0]].map(([id, x1, y1, x2, y2]) => ({ id: id as string, x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number, t: 150, kind: 'existing' as const })),
  items: [{ id: 'i', x: 1000, y: 1000, w: 1200, d: 600, h: 900, rot: 0, name: '테이블', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null }] }

test('scale comes from the standard list and fits the paper', () => {
  assert.equal(pickScale(8000, 5000, 300, 215), 30)
  assert.equal(pickScale(60000, 40000, 300, 215), 200)
})

test('sheet list follows the learned numbering: general, plan series, one elevation per wall', () => {
  const s = sheetList(g)
  assert.deepEqual(s.map(x => x.no), ['I-000', 'I-002', 'I-006', 'I-008', 'I-102', 'I-106', 'I-109', 'I-141', 'I-142', 'I-143', 'I-144', 'ID-401', 'IF-701'])
  assert.equal(s.find(x => x.no === 'I-102')!.scale, '1/30')
  assert.equal(sheetList({ ...g, walls: [], openings: [], items: [] }).length, 4)
})

test('DXF has layers and entities in mm', () => {
  const d = planDxf(g)
  assert.ok(d.startsWith('0\nSECTION') && d.endsWith('0\nEOF\n'))
  for (const l of ['A-WALL', 'A-DOOR', 'I-FURN']) assert.ok(d.includes(`8\n${l}\n`), l)
  assert.equal((d.match(/0\nLINE\n/g) ?? []).length, 4 * 4 + 1 + 4 + 4 * 4 + 4 + 3 * 4)
})

test('finish table splits every 36 rows; new walls and furniture types get detail sheets', () => {
  const s = sheetList({ ...g, walls: [...g.walls, { id: 'n', x1: 4000, y1: 0, x2: 4000, y2: 2000, t: 100, kind: 'new' }], items: [...g.items, { ...g.items[0], id: 'j', x: 3000 }] }, 80)
  assert.deepEqual(s.filter(x => x.kind === 'finish').map(x => x.no), ['I-008', 'I-009', 'I-010'])
  assert.equal(s.find(x => x.kind === 'wallDetail')!.title, '벽체 상세 T100')
  assert.equal(s.filter(x => x.kind === 'furnDetail').length, 1)
  assert.equal(furnitureTypes({ ...g, items: [...g.items, { ...g.items[0], id: 'j' }] })[0].count, 2)
})

test('elevation picks up items standing against the wall', () => {
  const near = { ...g.items[0], id: 'k', x: 2000, y: 100 }
  const e = elevationItems({ ...g, items: [...g.items, near] }, g.walls[0])
  assert.deepEqual(e.map(x => [x.id, x.a, x.b, x.h]), [['k', 2000, 3200, 900]])
})

test('wall finish rows use the elevation label and net face area', () => {
  const walls = g.walls.map(w => (w.id === 'a' ? { ...w, finish: '수성 페인트 백색' } : w))
  assert.equal(wallFaceArea(g, g.walls[0]), 19.71)
  assert.deepEqual(wallFinishRows({ ...g, walls }), [{ label: '입면 A', finish: '수성 페인트 백색', area: 19.71 }])
})

test('material kind comes from the code prefix', () => { assert.equal(materialKind('PT-01'), '도장'); assert.equal(materialKind('x'), '') })
