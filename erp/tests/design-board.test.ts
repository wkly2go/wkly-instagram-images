import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_W, PAGE_H, PAGE_GAP, readBoard, emptyBoard, mergeBoardComments, snapValue, snapMove, resizeBox, cardGrid, chunk, boxesTouch, boundsOf, restack, topZ, cloneEls, pageLeft, type BoardComment, type BoardEl } from '../src/lib/designBoard.ts'

const el = (id: string, z: number, more: Partial<BoardEl> = {}): BoardEl => ({ id, type: 'rect', x: 0, y: 0, w: 100, h: 100, z, ...more })
const note = (id: string, at: string, more: Partial<BoardComment> = {}): BoardComment => ({ id, page: 'p', x: 1, y: 1, text: id, by: '가', at, ...more })

test('readBoard: 보드 모양이 아니면 null, 깨진 페이지 · 요소는 걸러 낸다', () => {
  assert.equal(readBoard(null), null)
  assert.equal(readBoard('x'), null)
  assert.equal(readBoard({ pages: 'no' }), null)
  const b = readBoard({ pages: [{ id: 'a', name: 3, els: [el('1', 0), { id: 'bad', x: 'k', y: 0, w: 1, h: 1 }, null] }, { name: '번호 없음', els: [] }, { id: 'b' }], comments: [{ id: 'c1', at: '2026' }, { text: 'id 없음' }, null] })!
  assert.equal(b.pages.length, 1)
  assert.equal(b.pages[0].name, '3')
  assert.equal(b.pages[0].w, PAGE_W)
  assert.equal(b.pages[0].h, PAGE_H)
  assert.deepEqual(b.pages[0].els.map(e => e.id), ['1'])
  assert.deepEqual(b.comments.map(c => c.id), ['c1'])
})
test('readBoard: 페이지가 하나도 없으면 표지 한 장을 만든다 · emptyBoard 는 그대로 통과', () => {
  const b = readBoard({ pages: [] })!
  assert.equal(b.pages.length, 1)
  assert.equal(b.pages[0].name, '표지')
  assert.deepEqual(b.comments, [])
  const e = emptyBoard()
  assert.deepEqual(readBoard(JSON.parse(JSON.stringify(e))), e)
})
test('mergeBoardComments: 남의 댓글은 지키고, 내가 지운 것은 빼고, 답글은 많은 쪽을 쓴다', () => {
  const latest = [note('a', '2026-11-17T01:00:00Z'), note('b', '2026-11-17T02:00:00Z', { replies: [{ by: '나', at: 't', text: '1' }, { by: '다', at: 't', text: '2' }] }), note('gone', '2026-11-17T03:00:00Z')]
  const mine = [note('b', '2026-11-17T02:00:00Z', { done: true, replies: [{ by: '나', at: 't', text: '1' }] }), note('new', '2026-11-17T00:30:00Z')]
  const out = mergeBoardComments(mine, latest, ['gone'])
  assert.deepEqual(out.map(c => c.id), ['new', 'a', 'b'])
  const b = out.find(c => c.id === 'b')!
  assert.equal(b.done, true)
  assert.equal(b.replies?.length, 2)
  assert.equal(mergeBoardComments([], latest).length, 3)
  // 답글 수가 같으면 내 것
  assert.equal(mergeBoardComments([note('a', '2026-11-17T01:00:00Z', { text: '고침' })], latest).find(c => c.id === 'a')!.text, '고침')
})
test('snapValue · snapMove: 페이지 가운데와 다른 요소 가장자리에 붙고, 멀면 그대로', () => {
  assert.deepEqual(snapValue(103, [0, 100, 200], 6), { v: 100, hit: 100 })
  assert.deepEqual(snapValue(120, [0, 100, 200], 6), { v: 120, hit: null })
  const page = { w: PAGE_W, h: PAGE_H }
  const c = snapMove({ x: 703, y: 300, w: 200, h: 100 }, [], page, 6)   // 가운데 803 → 800
  assert.equal(c.x, 700); assert.equal(c.gx, 800); assert.equal(c.gy, null); assert.equal(c.y, 300)
  const o = snapMove({ x: 404, y: 498, w: 100, h: 100 }, [{ x: 200, y: 500, w: 200, h: 50 }], page, 6)
  assert.equal(o.x, 400); assert.equal(o.gx, 400); assert.equal(o.y, 500); assert.equal(o.gy, 500)
  const far = snapMove({ x: 333, y: 222, w: 50, h: 50 }, [], page, 6)
  assert.deepEqual([far.x, far.y, far.gx, far.gy], [333, 222, null, null])
})
test('resizeBox: 반대쪽 모서리는 제자리 · 최소 크기 · 비율 지키기', () => {
  const s = { x: 100, y: 100, w: 200, h: 100 }
  assert.deepEqual(resizeBox(s, 'se', 50, 20), { x: 100, y: 100, w: 250, h: 120 })
  assert.deepEqual(resizeBox(s, 'nw', 50, 20), { x: 150, y: 120, w: 150, h: 80 })
  assert.deepEqual(resizeBox(s, 'e', -500, 0), { x: 100, y: 100, w: 16, h: 100 })
  assert.deepEqual(resizeBox(s, 'w', 500, 0), { x: 284, y: 100, w: 16, h: 100 })
  const r = resizeBox(s, 'se', 100, 0, true)
  assert.deepEqual(r, { x: 100, y: 100, w: 300, h: 150 })
  const k = resizeBox(s, 'nw', -100, 0, true)
  assert.deepEqual(k, { x: 0, y: 50, w: 300, h: 150 })
  const m = resizeBox(s, 'se', -1000, -1000, true)
  assert.equal(m.w / m.h, 2); assert.ok(m.h >= 16)
})
test('cardGrid · chunk: 칸 밖으로 나가지 않고 서로 겹치지 않는다', () => {
  const area = { x: 80, y: 180, w: 1440, h: 640 }
  assert.deepEqual(cardGrid(0, area), [])
  for (const n of [1, 3, 5, 8]) {
    const g = cardGrid(n, area)
    assert.equal(g.length, n)
    for (const b of g) { assert.ok(b.x >= area.x && b.y >= area.y); assert.ok(b.x + b.w <= area.x + area.w + 1, `${n} 가로`); assert.ok(b.y + b.h <= area.y + area.h + 1, `${n} 세로`) }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.equal(boxesTouch(g[i], g[j]), false, `${n}: ${i}·${j}`)
  }
  assert.equal(cardGrid(8, area)[4].y > cardGrid(8, area)[0].y, true)
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 3), [])
})
test('restack · topZ · cloneEls · boundsOf · pageLeft', () => {
  const els = [el('a', 0), el('b', 1), el('c', 2)]
  assert.deepEqual(restack(els, ['a'], 'front').map(e => [e.id, e.z]), [['a', 2], ['b', 0], ['c', 1]])
  assert.deepEqual(restack(els, ['c'], 'back').map(e => [e.id, e.z]), [['a', 1], ['b', 2], ['c', 0]])
  assert.equal(topZ(els), 3); assert.equal(topZ([]), 0)
  const copy = cloneEls([el('b', 1, { locked: true, style: { bold: true } })], els)
  assert.equal(copy.length, 1); assert.notEqual(copy[0].id, 'b'); assert.equal(copy[0].z, 3); assert.equal(copy[0].x, 24); assert.equal(copy[0].locked, undefined); assert.deepEqual(copy[0].style, { bold: true })
  assert.deepEqual(boundsOf([{ x: 10, y: 20, w: 30, h: 40 }, { x: 0, y: 50, w: 20, h: 20 }]), { x: 0, y: 20, w: 40, h: 50 })
  assert.equal(boundsOf([]), null)
  const pages = [{ w: PAGE_W }, { w: PAGE_W }, { w: PAGE_W }]
  assert.equal(pageLeft(pages, 0), 0); assert.equal(pageLeft(pages, 2), (PAGE_W + PAGE_GAP) * 2)
})
