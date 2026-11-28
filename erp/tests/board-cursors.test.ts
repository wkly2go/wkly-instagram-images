import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collaboratorsOf, cursorColor, cursorTopic, CURSOR_MAX_PEERS, CURSOR_STALE_MS, dropCursor, pruneCursors, putCursor, readCursor } from '../src/lib/boardCursors.ts'

test('방송 주제는 64자 열쇠일 때만', () => {
  assert.equal(cursorTopic('a'.repeat(64)), `bl-${'a'.repeat(64)}`)
  assert.equal(cursorTopic('board:123'), null)
  assert.equal(cursorTopic(undefined), null)
})

test('받은 커서는 거른다', () => {
  assert.deepEqual(readCursor({ id: 'guest:1', name: ' 김담당\n ', x: 10.4, y: -3 }, 5), { id: 'guest:1', name: '김담당', x: 10.4, y: -3, at: 5 })
  assert.equal(readCursor({ id: 'a', name: 'n', x: 'NaN', y: 1 }, 0), null)
  assert.equal(readCursor({ id: 'a', name: 'n', x: 1e12, y: 1 }, 0), null)
  assert.equal(readCursor({ id: '', name: 'n', x: 1, y: 1 }, 0), null)
  assert.equal(readCursor({ id: 'a', name: '', x: 1, y: 1 }, 0), null)
  assert.equal(readCursor('x', 0), null)
  assert.equal(readCursor({ id: 'a', name: '가'.repeat(99), x: 1, y: 1 }, 0)?.name.length, 30)
})

test('넣기 · 나 자신 제외 · 오래된 사람 빼기 · 한도', () => {
  let list = putCursor([], { id: 'a', name: 'A', x: 1, y: 1, at: 0 }, 'me', 0)
  list = putCursor(list, { id: 'a', name: 'A', x: 2, y: 2, at: 100 }, 'me', 100)
  assert.equal(list.length, 1)
  assert.equal(list[0].x, 2)
  assert.equal(putCursor(list, { id: 'me', name: '나', x: 0, y: 0, at: 100 }, 'me', 100).length, 1)
  assert.equal(putCursor(list, { id: 'b', name: 'B', x: 0, y: 0, at: CURSOR_STALE_MS + 200 }, 'me', CURSOR_STALE_MS + 200).map(p => p.id).join(), 'b')
  assert.equal(pruneCursors(list, 200), list)
  assert.equal(pruneCursors(list, CURSOR_STALE_MS + 200).length, 0)
  assert.equal(dropCursor(list, 'a').length, 0)
  let many: ReturnType<typeof putCursor> = []
  for (let i = 0; i < CURSOR_MAX_PEERS + 5; i++) many = putCursor(many, { id: `p${i}`, name: 'P', x: 0, y: 0, at: 0 }, 'me', 0)
  assert.equal(many.length, CURSOR_MAX_PEERS)
})

test('같은 사람은 같은 색 · 검정 없음 · Excalidraw 모양', () => {
  assert.equal(cursorColor('guest:1'), cursorColor('guest:1'))
  assert.notEqual(cursorColor('guest:1'), '#000000')
  const m = collaboratorsOf([{ id: 'a', name: 'A', x: 3, y: 4, at: 0 }])
  assert.deepEqual(m.get('a')?.pointer, { x: 3, y: 4, tool: 'pointer' })
  assert.equal(m.get('a')?.username, 'A')
})
