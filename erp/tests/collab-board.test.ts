// 외부 협업방 › 화이트보드: 외부인이 보낸 그림을 걸러 내는 규칙 (서버 함수 collab-board/board.ts)
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanGuestScene, guestFilePathOk, scenePaths, GUEST_BOARD_MAX_ELEMENTS } from '../supabase/functions/collab-board/board.ts'

const B = '11111111-2222-4333-8444-555555555555'
const el = (id: string, extra: Record<string, unknown> = {}) => ({ id, version: 1, versionNonce: 1, type: 'rectangle', ...extra })

test('사진 경로: 이 보드 폴더의 사진만 · SVG · 다른 폴더 · 경로 장난은 거절', () => {
  assert.ok(guestFilePathOk(B, `${B}/abc_DEF-12.png`))
  assert.ok(guestFilePathOk(B, `${B}/a.jpg`))
  assert.ok(!guestFilePathOk(B, `${B}/a.svg`))
  assert.ok(!guestFilePathOk(B, `other/a.png`))
  assert.ok(!guestFilePathOk(B, `${B}/../x/a.png`))
  assert.ok(!guestFilePathOk(B, `${B}/a/b.png`))
  assert.ok(!guestFilePathOk(B, `${B}/.png`))
})

test('그림 걸러 내기: 모양이 틀린 요소는 버리고 아는 칸만 남김', () => {
  const s = cleanGuestScene({ elements: [el('a'), { id: 3 }, null, { id: 'x' }, el('b', { link: 'javascript:alert(1)' }), el('c', { link: 'https://example.com' })], files: {}, background: '#ffffff', extra: 'x' }, B, new Set())
  assert.deepEqual(s.elements.map(e => e.id), ['a', 'b', 'c'])
  assert.equal(s.elements[1].link, null)
  assert.equal(s.elements[2].link, 'https://example.com')
  assert.equal(s.background, '#ffffff')
  assert.ok(!('extra' in s))
  assert.equal(cleanGuestScene({ elements: [], background: 'url(x)' }, B, new Set()).background, undefined)
})

test('사진: 서버 그림에 있던 경로(복사한 보드의 원본 폴더 포함)와 이 보드에 올린 것만', () => {
  const known = scenePaths({ files: { f1: { path: 'old-board/pic.png', mimeType: 'image/png' } } })
  assert.ok(known.has('old-board/pic.png'))
  const ok = cleanGuestScene({ elements: [el('a')], files: { f1: { path: 'old-board/pic.png', mimeType: 'image/png', created: 1 }, f2: { path: `${B}/new1.jpg`, mimeType: 'image/jpeg', created: 2 } } }, B, known)
  assert.deepEqual(Object.keys(ok.files), ['f1', 'f2'])
  assert.equal(ok.files.f2.id, 'f2')
  assert.throws(() => cleanGuestScene({ elements: [], files: { f: { path: 'secret/other.png', mimeType: 'image/png' } } }, B, known), /이 보드에 올린 사진만/)
  assert.throws(() => cleanGuestScene({ elements: [], files: { f: { path: `${B}/x.svg`, mimeType: 'image/svg+xml' } } }, B, known), /이 보드에 올린 사진만/)
})

test('한도: 요소 수 · 크기 · 모양', () => {
  assert.throws(() => cleanGuestScene(null, B, new Set()), /올바르지 않습니다/)
  assert.throws(() => cleanGuestScene({ elements: 'x' }, B, new Set()), /올바르지 않습니다/)
  assert.throws(() => cleanGuestScene({ elements: Array.from({ length: GUEST_BOARD_MAX_ELEMENTS + 1 }, (_, i) => el(`e${i}`)) }, B, new Set()), /너무 많습니다/)
  assert.throws(() => cleanGuestScene({ elements: [el('big', { text: 'x'.repeat(4_000_000) })] }, B, new Set()), /너무 큽니다/)
})
