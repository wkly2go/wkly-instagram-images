// 평면 → 수량표 자동 반영: 수량을 견주는 글(quantitiesSignature)이 같은 수량에는 같고, 수량이 바뀌면 달라지는지
import test from 'node:test'
import assert from 'node:assert/strict'
import { modelLines, planQuantities, quantitiesSignature, type PlanGeometry } from '../src/lib/designPlan.ts'

const plan = (): PlanGeometry => ({
  unit: 'mm', height: 2700,
  walls: [
    { id: 'a', x1: 0, y1: 0, x2: 6000, y2: 0, t: 150, kind: 'existing', finish: 'PT-01' },
    { id: 'b', x1: 6000, y1: 0, x2: 6000, y2: 4000, t: 150, kind: 'existing' },
    { id: 'n', x1: 3800, y1: 0, x2: 3800, y2: 2400, t: 100, kind: 'new', finish: 'PT-02' },
  ],
  openings: [{ id: 'o3', wall: 'n', pos: 1500, width: 800, kind: 'door' }],
  items: [
    { id: 'i1', x: 400, y: 500, w: 2100, d: 900, h: 800, rot: 0, name: '3인 소파', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null },
    { id: 'i3', x: 4200, y: 300, w: 1500, d: 400, h: 1800, rot: 0, name: '진열 선반', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: '렌탈' },
  ],
})

test('줄 순서가 달라도 같은 글', () => {
  const lines = planQuantities(plan())
  assert.ok(lines.length >= 3)
  assert.equal(quantitiesSignature([...lines].reverse()), quantitiesSignature(lines))
})

test('수량은 소수 셋째 자리까지 견준다 · 같은 줄은 더하고 0 인 줄은 뺀다', () => {
  const l = { trade: 'T03', item: '가벽 설치', spec: 'H2700 · T100', unit: 'm2', section: null }
  assert.equal(quantitiesSignature([{ ...l, qty: 4.0001 }]), quantitiesSignature([{ ...l, qty: 4 }]))
  assert.notEqual(quantitiesSignature([{ ...l, qty: 4.002 }]), quantitiesSignature([{ ...l, qty: 4 }]))
  assert.equal(quantitiesSignature([{ ...l, qty: 1.5 }, { ...l, qty: 2.5 }]), quantitiesSignature([{ ...l, qty: 4 }]))
  assert.equal(quantitiesSignature([{ ...l, qty: 4 }, { ...l, item: '없는 줄', qty: 0 }]), quantitiesSignature([{ ...l, qty: 4 }]))
  assert.equal(quantitiesSignature([]), '')
})

test('소파를 옮기기만 하면 그대로', () => {
  const a = plan(), b = plan()
  b.items[0] = { ...b.items[0], x: 3100, y: 2200 }
  assert.equal(quantitiesSignature(planQuantities(b)), quantitiesSignature(planQuantities(a)))
})

test('새 가벽을 더하거나 부품 공종 · 크기(면적으로 세는 것)를 바꾸면 달라진다', () => {
  const a = plan(), b = plan(), c = plan()
  b.walls.push({ id: 'n2', x1: 1000, y1: 3000, x2: 2600, y2: 3000, t: 100, kind: 'new' })
  assert.notEqual(quantitiesSignature(planQuantities(b)), quantitiesSignature(planQuantities(a)))
  c.items.push({ id: 'i9', x: 0, y: 0, w: 2000, d: 1000, h: 50, rot: 0, name: '러그', trade_code: 'T09', spec: '', unit: 'm2', measure: 'area', section: null })
  const before = quantitiesSignature(planQuantities(c))
  c.items[2] = { ...c.items[2], w: 2400 }
  assert.notEqual(quantitiesSignature(planQuantities(c)), before)
})

test('수량표에 반영된 모델 줄과 평면 수량이 같으면 같은 글 (직접 넣은 줄 · 빈 구분 · 200자 넘는 규격)', () => {
  const g = plan()
  g.items[1] = { ...g.items[1], spec: '가'.repeat(230) }
  const lines = planQuantities(g)
  // 서버(design_apply_plan)가 넣는 꼴: 품목 · 규격 200자, 빈 구분은 null, 수량은 numeric(글로 올 수도 있다)
  const rows = lines.map(l => ({ trade_code: l.trade, item: l.item.slice(0, 200), spec: l.spec.slice(0, 200), unit: l.unit, qty: String(l.qty), section: l.section || null, source: 'model' }))
  rows.push({ trade_code: 'T99', item: '직접 넣은 줄', spec: '', unit: '식', qty: '1', section: null, source: 'manual' })
  assert.equal(quantitiesSignature(modelLines(rows)), quantitiesSignature(lines))
})
