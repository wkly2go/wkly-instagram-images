import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanupExpiredRecordings } from '../supabase/functions/meeting-minutes/cleanup.ts'

const now = Date.parse('2026-11-11T12:00:00Z')
const old = '2026-10-01T00:00:00Z'
const recent = '2026-11-01T00:00:00Z'
const recording = (id, audio_path, extra = {}) => ({ id, audio_path, created_at: old, status: '완료', ...extra })

function setup(initial) {
  const rows = structuredClone(initial)
  const files = new Set(rows.map(row => row.audio_path).filter(Boolean))
  const calls = { remove: [], clear: 0 }
  const store = {
    async expired(before, limit) {
      assert.equal(limit, 50)
      assert.equal(before, '2026-10-12T12:00:00.000Z')
      return { data: structuredClone(rows.filter(row => row.audio_path && row.created_at < before && row.status !== '처리 중').slice(0, limit)), error: null }
    },
    async references(paths) {
      const data = structuredClone(rows.filter(row => paths.includes(row.audio_path)))
      return { data, count: data.length, error: null }
    },
    async remove(paths) {
      calls.remove.push(paths)
      paths.forEach(path => files.delete(path))
      return { error: null }
    },
    async clearReferences(ids, paths, before) {
      calls.clear++
      for (const row of rows) {
        if (ids.includes(row.id) && paths.includes(row.audio_path) && row.created_at < before && row.status !== '처리 중') row.audio_path = null
      }
      return { error: null }
    },
  }
  return { store, rows, files, calls }
}

test('keeps the 30-day cutoff and preserves recent or processing recordings', async () => {
  const { store, rows, files, calls } = setup([
    recording('a', 'user/old.txt'), recording('b', 'user/old.txt'),
    recording('c', 'user/recent.txt', { created_at: recent }),
    recording('d', 'user/processing.txt', { status: '처리 중' }),
  ])
  const result = await cleanupExpiredRecordings(store, now)
  assert.deepEqual(result, { removedPaths: 1, skippedPaths: 0, referencesCleared: true })
  assert.deepEqual(calls.remove, [['user/old.txt']])
  assert.deepEqual(rows.map(row => row.audio_path), [null, null, 'user/recent.txt', 'user/processing.txt'])
  assert.deepEqual([...files].sort(), ['user/processing.txt', 'user/recent.txt'])
})

test('failed storage removal preserves every database reference for retry', async () => {
  const { store, rows, calls } = setup([recording('a', 'user/old.txt')])
  store.remove = async () => ({ error: new Error('Storage unavailable') })
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.failure, 'remove')
  assert.equal(result.referencesCleared, false)
  assert.equal(calls.clear, 0)
  assert.equal(rows[0].audio_path, 'user/old.txt')
})

test('a thrown transport error stays separate from the completed meeting status', async () => {
  const { store, rows, calls } = setup([recording('a', 'user/old.txt')])
  store.remove = async () => { throw new Error('Network failure') }
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.failure, 'remove')
  assert.equal(rows[0].status, '완료')
  assert.equal(calls.clear, 0)
})

test('shared paths are preserved while any newer or processing reference still needs them', async () => {
  const { store, rows, calls } = setup([
    recording('a', 'user/shared.txt'), recording('b', 'user/shared.txt', { created_at: recent }),
    recording('c', 'user/active.txt'), recording('d', 'user/active.txt', { status: '처리 중' }),
    recording('e', 'user/old.txt'),
  ])
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.skippedPaths, 2)
  assert.deepEqual(calls.remove, [['user/old.txt']])
  assert.equal(rows[0].audio_path, 'user/shared.txt')
  assert.equal(rows[2].audio_path, 'user/active.txt')
})

test('reference-query errors and truncated results stop deletion', async () => {
  for (const response of [
    { data: null, count: null, error: new Error('Read failed') },
    { data: [recording('a', 'user/old.txt')], count: 1001, error: null },
    { data: [recording('a', 'user/old.txt')], count: null, error: null },
  ]) {
    const { store, calls, rows } = setup([recording('a', 'user/old.txt')])
    store.references = async () => response
    const result = await cleanupExpiredRecordings(store, now)
    assert.equal(result.failure, 'references')
    assert.equal(calls.remove.length, 0)
    assert.equal(rows[0].audio_path, 'user/old.txt')
  }
})

test('a reference changed during deletion is never cleared to null', async () => {
  const { store, rows } = setup([recording('a', 'user/old.txt')])
  const remove = store.remove
  store.remove = async paths => {
    const result = await remove(paths)
    rows[0].audio_path = 'user/replacement.txt'
    return result
  }
  await cleanupExpiredRecordings(store, now)
  assert.equal(rows[0].audio_path, 'user/replacement.txt')
})

test('a failed database update can retry after the original object is already gone', async () => {
  const { store, rows, files } = setup([recording('a', 'user/old.txt')])
  const clear = store.clearReferences
  store.clearReferences = async () => ({ error: new Error('Database unavailable') })
  const failed = await cleanupExpiredRecordings(store, now)
  assert.equal(failed.failure, 'clear')
  assert.equal(files.size, 0)
  assert.equal(rows[0].audio_path, 'user/old.txt')
  store.clearReferences = clear
  const retried = await cleanupExpiredRecordings(store, now)
  assert.equal(retried.referencesCleared, true)
  assert.equal(rows[0].audio_path, null)
})

test('missing candidates and failed initial reads do not call storage', async () => {
  const { store, calls } = setup([])
  await cleanupExpiredRecordings(store, now)
  store.expired = async () => ({ data: null, error: new Error('Read failed') })
  assert.equal((await cleanupExpiredRecordings(store, now)).failure, 'select')
  assert.equal(calls.remove.length, 0)
  assert.equal(calls.clear, 0)
})
