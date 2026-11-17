import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_LIBRARY, LIBRARY_FINISH_GROUPS, LIBRARY_FIXTURE_GROUPS, finishText, fixtureToItem, fixtureTrade, itemToFixture, validLibraryData, type LibraryFinish, type LibraryFixture } from '../src/lib/designLibrary.ts'
import { ITEM_SHAPES, finishLook, itemShape } from '../src/lib/designPlanLook.ts'
import { emptyBoard, mergeBoardComments, readBoard } from '../src/lib/designBoard.ts'

const trades = [{ code: 'T03', name: '목공 · 가벽' }, { code: 'T10', name: '설비 · 위생' }, { code: 'T11', name: '전기 · 조명' }, { code: 'T15', name: '가구 · 집기' }]
const finishes = BUILTIN_LIBRARY.filter(e => e.kind === 'finish'), fixtures = BUILTIN_LIBRARY.filter(e => e.kind === 'fixture')

test('기본 라이브러리: 번호가 겹치지 않고, 묶음과 모양이 정해진 것만 쓴다', () => {
  assert.equal(new Set(BUILTIN_LIBRARY.map(e => e.id)).size, BUILTIN_LIBRARY.length)
  assert.ok(finishes.length >= 30 && fixtures.length >= 55, `${finishes.length} / ${fixtures.length}`)
  assert.ok(finishes.every(e => LIBRARY_FINISH_GROUPS.includes(e.group)) && fixtures.every(e => LIBRARY_FIXTURE_GROUPS.includes(e.group)))
  const shapes = new Set(ITEM_SHAPES.map(([k]) => k))
  assert.deepEqual(fixtures.filter(e => !shapes.has((e.data as LibraryFixture).shape)).map(e => e.name), [])
  assert.ok(BUILTIN_LIBRARY.every(e => e.builtin && validLibraryData(e.kind, e.data)))
})

test('마감재: 번호 앞 글자로 재료 종류가 읽히고, 검정은 없다', () => {
  for (const e of finishes) {
    const f = e.data as LibraryFinish
    assert.equal(finishLook(finishText(f)).kind, f.kind, finishText(f))
    assert.match(f.color, /^#[0-9a-f]{6}$/)
    const [r, g, b] = [1, 3, 5].map(i => parseInt(f.color.slice(i, i + 2), 16))
    assert.ok(r + g + b > 150, `${f.code} 너무 어두움`)
    assert.ok(f.use.length > 0)
  }
})

test('기구: 치수가 실제 범위 안이고, 공종을 이름으로 찾는다', () => {
  for (const e of fixtures) {
    const f = e.data as LibraryFixture
    assert.ok(f.w >= 40 && f.w <= 6000 && f.d >= 20 && f.d <= 6000 && f.h >= 10 && f.h <= 3000, `${f.name} ${f.w}x${f.d}x${f.h}`)
    assert.ok(['count', 'area', 'length'].includes(f.measure) && f.unit)
  }
  const by = (n: string) => fixtures.find(e => e.name === n)!.data as LibraryFixture
  assert.equal(fixtureTrade(by('3인 소파'), trades), 'T15')
  assert.equal(fixtureTrade(by('양변기'), trades), 'T10')
  assert.equal(fixtureTrade(by('펜던트 조명 Φ400'), trades), 'T11')
  assert.equal(fixtureTrade(by('포토월 3000'), trades), 'T03')
  assert.equal(fixtureTrade(by('3인 소파'), []), '')
})

test('기구 ↔ 평면 부품 왕복', () => {
  const f = fixtures.find(e => e.name === 'TV 65인치 (벽걸이)')!.data as LibraryFixture
  const it = fixtureToItem(f, { x: 1234.4, y: 500 }, trades, 'i1')
  assert.deepEqual([it.id, it.x, it.y, it.w, it.d, it.h, it.rot, it.shape, it.z, it.unit, it.measure, it.section], ['i1', 1234, 500, 1450, 80, 840, 0, 'tv', 900, 'EA', 'count', null])
  const back = itemToFixture(it)
  assert.deepEqual([back.name, back.shape, back.w, back.d, back.h, back.z], [f.name, 'tv', 1450, 80, 840, 900])
  assert.equal(itemToFixture({ ...it, shape: '없는모양', name: ' ' }).shape, 'box')
  assert.equal(validLibraryData('fixture', { name: 'x', shape: 'box', w: 0, d: 1, h: 1 }), false)
  assert.equal(validLibraryData('finish', { name: 'x', code: 'PT-01', kind: 'paint', color: 'red', use: [] }), false)
})

test('이름에 낱말이 여럿이면 뒤에 나온 것이 모양을 정한다', () => {
  assert.deepEqual(['소파 테이블', '카운터 의자', '테이블 스탠드', '3인 소파', 'TV 장식장'].map(n => itemShape(n)), ['table', 'chair', 'light', 'sofa', 'tv'])
})

test('제안 보드: 저장 값 확인과 댓글 합치기', () => {
  assert.equal(readBoard(null), null); assert.equal(readBoard({ pages: 'x' }), null)
  const b = readBoard({ pages: [{ id: 'p', name: 1, els: [{ id: 'e', x: 0, y: 0, w: 10, h: 10 }, { id: 'bad', x: 'a' }] }], comments: [{ id: 'c' }, null] })!
  assert.deepEqual([b.pages[0].name, b.pages[0].w, b.pages[0].els.length, b.comments.length], ['1', 1600, 1, 1])
  assert.equal(emptyBoard().pages.length, 1)
  const mine = [{ id: 'a', page: 'p', x: 0, y: 0, text: '내 글', by: '가', at: '2026-11-17T01:00:00Z' }]
  const latest = [{ id: 'a', page: 'p', x: 0, y: 0, text: '옛 글', by: '가', at: '2026-11-17T01:00:00Z', replies: [{ by: '나', at: '2026-11-17T02:00:00Z', text: '답' }] }, { id: 'b', page: 'p', x: 1, y: 1, text: '남의 글', by: '나', at: '2026-11-17T03:00:00Z' }, { id: 'c', page: 'p', x: 2, y: 2, text: '지운 글', by: '가', at: '2026-11-17T04:00:00Z' }]
  const m = mergeBoardComments(mine, latest, ['c'])
  assert.deepEqual(m.map(c => [c.id, c.text, c.replies?.length ?? 0]), [['a', '내 글', 1], ['b', '남의 글', 0]])
})
