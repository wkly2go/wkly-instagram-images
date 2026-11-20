import test from 'node:test'
import assert from 'node:assert/strict'
import { boardFilePath, boardTitle, mergeElements, readScene, sceneForSave, sceneSignature, type BoardElement } from '../src/lib/board.ts'

const el = (id: string, version: number, extra: Partial<BoardElement> = {}): BoardElement => ({ id, version, versionNonce: 10, ...extra })

test('요소별 합치기: 더 새 판을 남기고 한쪽에만 있는 것도 남김', () => {
  const mine = [el('a', 3), el('b', 1), el('c', 1)]
  const theirs = [el('a', 2), el('b', 4), el('d', 1)]
  const m = mergeElements(mine, theirs)
  assert.deepEqual(m.map(e => `${e.id}${e.version}`), ['a3', 'b4', 'd1', 'c1'])
})

test('같은 판이면 versionNonce 가 작은 쪽', () => {
  const m = mergeElements([el('a', 2, { versionNonce: 5, x: 1 })], [el('a', 2, { versionNonce: 9, x: 2 })])
  assert.equal(m[0].x, 1)
})

test('지운 요소도 판이 새면 지운 상태가 남음 (다른 사람이 지운 것을 되살리지 않음)', () => {
  const m = mergeElements([el('a', 1)], [el('a', 2, { isDeleted: true })])
  assert.equal(m[0].isDeleted, true)
})

test('표시: 같은 요소면 같고 판이 바뀌면 다름', () => {
  assert.equal(sceneSignature([el('a', 1)]), sceneSignature([el('a', 1)]))
  assert.notEqual(sceneSignature([el('a', 1)]), sceneSignature([el('a', 2)]))
})

test('저장: 쓰는 사진만 남김', () => {
  const files = { f1: { id: 'f1', mimeType: 'image/png', path: 'b/f1.png', created: 1 }, f2: { id: 'f2', mimeType: 'image/png', path: 'b/f2.png', created: 1 } }
  const s = sceneForSave([el('i', 1, { type: 'image', fileId: 'f1' }), el('j', 1, { type: 'image', fileId: 'f2', isDeleted: true })], files)
  assert.deepEqual(Object.keys(s.files), ['f1'])
  assert.equal(s.elements.length, 2)
})

test('읽기: 모양이 틀린 줄은 버림', () => {
  const s = readScene({ elements: [el('a', 1), { id: 3 }, null], files: { x: { path: 'p', mimeType: 'image/png' }, y: { nope: 1 } } })
  assert.equal(s.elements.length, 1)
  assert.deepEqual(Object.keys(s.files), ['x'])
  assert.deepEqual(readScene(null), { elements: [], files: {}, background: undefined })
})

test('보관함 경로 · 제목', () => {
  assert.equal(boardFilePath('b1', 'abc/../x', 'image/jpeg'), 'b1/abcx.jpg')
  assert.equal(boardTitle('  회의   보드 '), '회의 보드')
  assert.equal(boardTitle('   '), '새 보드')
})
