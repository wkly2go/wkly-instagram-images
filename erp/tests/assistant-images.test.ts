import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentNote, imageSource, pickImages, MAX_IMAGES } from '../supabase/functions/agent-chat/images.ts'

const me = 'u1'
const at = '2026-11-28T12:10:33Z'
const img = (path: string, extra = {}) => ({ path, name: `${path}.png`, type: 'image/png', size: 1_200_000, preview_path: `${path}.preview.webp`, ...extra })

test('uses the small preview when it exists', () => {
  assert.deepEqual(imageSource(img('a')), { path: 'a.preview.webp', mediaType: 'image/webp' })
})

test('skips big originals without preview and non-images', () => {
  assert.equal(imageSource({ path: 'b', type: 'image/png', size: 9_000_000 }), null)
  assert.deepEqual(imageSource({ path: 'c', type: 'image/jpeg', size: 100 }), { path: 'c', mediaType: 'image/jpeg' })
  assert.equal(imageSource({ path: 'd.pdf', type: 'application/pdf', size: 100 }), null)
})

test('picks only the requester recent photos, newest last, capped', () => {
  const rows = [
    { user_id: me, created_at: '2026-11-28T12:10:33Z', attachment: img('p1') },
    { user_id: 'other', created_at: '2026-11-28T12:10:00Z', attachment: img('x') },
    { user_id: me, created_at: '2026-11-28T11:00:00Z', attachment: img('old') },
    ...[1, 2, 3, 4, 5].map(i => ({ user_id: me, created_at: `2026-11-28T12:0${i}:00Z`, attachment: img(`m${i}`) })),
  ]
  const got = pickImages(rows, me, at)
  assert.equal(got.length, MAX_IMAGES)
  assert.equal(got.at(-1)!.path, 'p1.preview.webp')
  assert.ok(!got.some(g => g.path.startsWith('x') || g.path.startsWith('old')))
})

test('transcript note marks photos and files', () => {
  assert.equal(attachmentNote(img('a')), ' [사진: a.png]')
  assert.equal(attachmentNote({ path: 'f', name: '견적.pdf', type: 'application/pdf' }), ' [파일: 견적.pdf]')
  assert.equal(attachmentNote(null), '')
})
