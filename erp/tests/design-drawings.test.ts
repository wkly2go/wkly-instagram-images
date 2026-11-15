import test from 'node:test'
import assert from 'node:assert/strict'
import { pickScale, planDxf, sheetList } from '../src/lib/designDrawings.ts'
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
  assert.deepEqual(s.map(x => x.no), ['I-000', 'I-002', 'I-004', 'I-102', 'I-106', 'I-109', 'I-141', 'I-142', 'I-143', 'I-144'])
  assert.equal(s.find(x => x.no === 'I-102')!.scale, '1/30')
  assert.equal(sheetList({ ...g, walls: [], items: [] }).length, 3)
})

test('DXF has layers and entities in mm', () => {
  const d = planDxf(g)
  assert.ok(d.startsWith('0\nSECTION') && d.endsWith('0\nEOF\n'))
  for (const l of ['A-WALL', 'A-DOOR', 'I-FURN']) assert.ok(d.includes(`8\n${l}\n`), l)
  assert.equal((d.match(/0\nLINE\n/g) ?? []).length, 4 * 4 + 1 + 4)
})
