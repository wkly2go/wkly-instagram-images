import test from 'node:test'
import assert from 'node:assert/strict'
import { normCode, renameFinishText, renameFinishRefs, renameBoardFinishRefs } from '../src/lib/designSpecSync.ts'
import { planQuantities, type PlanGeometry } from '../src/lib/designPlan.ts'
import type { ProposalBoard } from '../src/lib/designBoard.ts'

const OLD = { code: 'PT-01', name: '수성 페인트', spec: '백색 무광' }
const plan = (): PlanGeometry => ({
  unit: 'mm', height: 2700,
  walls: [
    { id: 'a', x1: 0, y1: 0, x2: 4000, y2: 0, t: 150, kind: 'existing', finish: 'PT-01' },
    { id: 'b', x1: 4000, y1: 0, x2: 4000, y2: 3000, t: 150, kind: 'existing', finish: 'PT 01 수성 페인트 백색 무광' },
    { id: 'c', x1: 4000, y1: 3000, x2: 0, y2: 3000, t: 150, kind: 'new', finish: 'pt-01 2회 도장' },
    { id: 'd', x1: 0, y1: 3000, x2: 0, y2: 0, t: 150, kind: 'existing', finish: 'PT-011' },
  ],
  openings: [{ id: 'o', wall: 'a', pos: 1000, width: 900, kind: 'door', finish: 'PT-01 수성 페인트', frame: 'MT-01' }],
  items: [{ id: 'i', x: 0, y: 0, w: 100, d: 100, h: 100, rot: 0, name: '선반', trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null, finish: 'PT01' }],
  rooms: [{ id: 'r', no: '101', name: '홀', floor: { mat: 'WF-01' }, base: { mat: 'MT-01' }, wall: { mat: 'PT-01', detail: 'W1' }, ceiling: { mat: '수성 페인트 PT-01' }, area: 12, perimeter: 14, lights: { 'DL-01': 4 } }],
})

test('normCode: 대소문자 · 띄어쓰기 · 하이픈을 무시한다', () => {
  assert.equal(normCode('PT-01'), normCode('pt 01'))
  assert.equal(normCode('PT-01'), normCode('PT01'))
  assert.notEqual(normCode('PT-01'), normCode('PT-011'))
})

test('renameFinishText: 번호만 · 옮겨 적은 이름 · 덧붙인 말 · 다른 번호', () => {
  const NEW = { code: 'PT-10', name: '친환경 페인트', spec: '웜화이트' }
  assert.equal(renameFinishText('PT-01', OLD, NEW), 'PT-10')
  assert.equal(renameFinishText('PT 01', OLD, NEW), 'PT-10')
  assert.equal(renameFinishText('PT-01 수성 페인트 백색 무광', OLD, NEW), 'PT-10 친환경 페인트 웜화이트')
  assert.equal(renameFinishText('PT-01 수성 페인트', OLD, NEW), 'PT-10 친환경 페인트')
  assert.equal(renameFinishText('PT-01 수성 페인트 백색 무광 (2회)', OLD, NEW), 'PT-10 친환경 페인트 웜화이트 (2회)')
  assert.equal(renameFinishText('PT-01 2회 도장', OLD, NEW), 'PT-10 2회 도장')
  assert.equal(renameFinishText('PT-011', OLD, NEW), 'PT-011')
  assert.equal(renameFinishText('수성 페인트 PT-01', OLD, NEW), '수성 페인트 PT-01')
  assert.equal(renameFinishText(undefined, OLD, NEW), undefined)
  // 번호는 그대로 두고 이름만 고친 경우: 번호만 적힌 글은 그대로, 이름을 옮겨 적은 글만 바뀐다
  const SAME = { code: 'PT-01', name: '수성 페인트', spec: '아이보리 무광' }
  assert.equal(renameFinishText('PT 01', OLD, SAME), 'PT 01')
  assert.equal(renameFinishText('PT-01 수성 페인트 백색 무광', OLD, SAME), 'PT-01 수성 페인트 아이보리 무광')
  // 새 번호를 비우면 연결을 끊지 않도록 건드리지 않는다
  assert.equal(renameFinishText('PT-01', OLD, { code: '', name: '수성 페인트', spec: null }), 'PT-01')
})

test('renameFinishRefs: 벽 · 문 · 부품 · 실별 마감을 바꾸고 바뀐 곳 수를 센다 · 수량표도 따라온다', () => {
  const p = plan()
  const r = renameFinishRefs(p, OLD, { code: 'PT-02', name: '수성 페인트', spec: '백색 무광' })
  assert.equal(r.changed, 6)
  assert.deepEqual(r.plan.walls.map(w => w.finish), ['PT-02', 'PT-02 수성 페인트 백색 무광', 'PT-02 2회 도장', 'PT-011'])
  assert.equal(r.plan.openings[0].finish, 'PT-02 수성 페인트')
  assert.equal(r.plan.openings[0].frame, 'MT-01')
  assert.equal(r.plan.items[0].finish, 'PT-02')
  assert.deepEqual(r.plan.rooms![0].wall, { mat: 'PT-02', detail: 'W1' })
  assert.equal(r.plan.rooms![0].ceiling.mat, '수성 페인트 PT-01')
  assert.equal(r.plan.rooms![0].floor, p.rooms![0].floor)
  // 원본은 그대로 (새 자료를 돌려준다)
  assert.equal(p.walls[0].finish, 'PT-01')
  // 수량(→ 견적)의 벽 마감 줄이 새 번호로
  const specs = planQuantities(r.plan).filter(l => l.item === '벽 마감').map(l => l.spec)
  assert.ok(specs.includes('PT-02'))
  assert.ok(!specs.includes('PT-01'))
})

test('renameFinishRefs: 바꿀 것이 없으면 받은 평면 그대로 · 조명 기호 열쇠도 옮긴다', () => {
  const p = plan()
  const none = renameFinishRefs(p, { code: 'ZZ-09', name: '없음', spec: null }, { code: 'ZZ-10', name: '없음', spec: null })
  assert.equal(none.changed, 0)
  assert.equal(none.plan, p)
  assert.equal(renameFinishRefs(p, { code: null, name: 'a', spec: null }, { code: 'PT-03', name: 'a', spec: null }).changed, 0)
  const lit = renameFinishRefs(p, { code: 'DL-01', name: '다운라이트', spec: null }, { code: 'DL-05', name: '다운라이트', spec: null })
  assert.equal(lit.changed, 1)
  assert.deepEqual(lit.plan.rooms![0].lights, { 'DL-05': 4 })
  const both = { ...p, rooms: [{ ...p.rooms![0], lights: { 'DL-01': 4, 'DL-05': 2 } }] }
  assert.deepEqual(renameFinishRefs(both, { code: 'DL 01' }, { code: 'DL-05' }).plan.rooms![0].lights, { 'DL-05': 6 })
})

test('renameBoardFinishRefs: 마감 견본 글만 바꾼다', () => {
  const b: ProposalBoard = { v: 1, comments: [], pages: [{ id: 'p', name: '표지', w: 1600, h: 900, els: [
    { id: 's', type: 'swatch', x: 0, y: 0, w: 10, h: 10, z: 0, finish: 'PT-01 수성 페인트 백색 무광' },
    { id: 't', type: 'text', x: 0, y: 0, w: 10, h: 10, z: 1, text: 'PT-01' },
  ] }, { id: 'q', name: '빈', w: 1600, h: 900, els: [] }] }
  const r = renameBoardFinishRefs(b, OLD, { code: 'PT-07', name: '수성 페인트', spec: '백색 무광' })
  assert.equal(r.changed, 1)
  assert.equal(r.board.pages[0].els[0].finish, 'PT-07 수성 페인트 백색 무광')
  assert.equal(r.board.pages[0].els[1].text, 'PT-01')
  assert.equal(r.board.pages[1], b.pages[1])
  assert.equal(renameBoardFinishRefs(b, { code: 'XX-1' }, { code: 'XX-2' }).board, b)
})
