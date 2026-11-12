import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanupExpiredRecordings, isOwnedRecordingPath } from '../supabase/functions/meeting-minutes/cleanup.ts'

const owner = '00000000-0000-4000-8000-000000000001'
const otherOwner = '00000000-0000-4000-8000-000000000002'
const now = Date.parse('2026-11-11T12:00:00Z')
const old = '2026-10-01T00:00:00Z'
const recent = '2026-11-01T00:00:00Z'
const recording = (id, audio_path, extra = {}) => ({ id, created_by: owner, audio_path, created_at: old, status: '완료', ...extra })

function setup(initial) {
  const rows = structuredClone(initial)
  const files = new Set(rows.map(row => row.audio_path).filter(Boolean))
  const calls = { remove: [], clear: 0 }
  const store = {
    async expired(before, limit) {
      assert.equal(limit, 50)
      assert.equal(before, '2026-10-12T12:00:00.000Z')
      return { data: structuredClone(rows.filter(row => row.audio_path && row.created_at < before && row.status === '완료').slice(0, limit)), error: null }
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
    async clearReferences(ids, paths, before, checkedOwner) {
      calls.clear++
      for (const row of rows) {
        if (ids.includes(row.id) && paths.includes(row.audio_path) && row.created_at < before && row.status === '완료' && row.created_by === checkedOwner) row.audio_path = null
      }
      return { error: null }
    },
  }
  return { store, rows, files, calls }
}

test('keeps the 30-day cutoff and preserves recent or processing recordings', async () => {
  const { store, rows, files, calls } = setup([
    recording('a', `${owner}/old.txt`), recording('b', `${owner}/old.txt`),
    recording('c', `${owner}/recent.txt`, { created_at: recent }),
    recording('d', `${owner}/processing.txt`, { status: '처리 중' }),
  ])
  const result = await cleanupExpiredRecordings(store, now)
  assert.deepEqual(result, { removedPaths: 1, skippedPaths: 0, referencesCleared: true })
  assert.deepEqual(calls.remove, [[`${owner}/old.txt`]])
  assert.deepEqual(rows.map(row => row.audio_path), [null, null, `${owner}/recent.txt`, `${owner}/processing.txt`])
  assert.deepEqual([...files].sort(), [`${owner}/processing.txt`, `${owner}/recent.txt`])
})

test('failed storage removal preserves every database reference for retry', async () => {
  const { store, rows, calls } = setup([recording('a', `${owner}/old.txt`)])
  store.remove = async () => ({ error: new Error('Storage unavailable') })
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.failure, 'remove')
  assert.equal(result.referencesCleared, false)
  assert.equal(calls.clear, 0)
  assert.equal(rows[0].audio_path, `${owner}/old.txt`)
})

test('a thrown transport error stays separate from the completed meeting status', async () => {
  const { store, rows, calls } = setup([recording('a', `${owner}/old.txt`)])
  store.remove = async () => { throw new Error('Network failure') }
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.failure, 'remove')
  assert.equal(rows[0].status, '완료')
  assert.equal(calls.clear, 0)
})

test('shared paths are preserved while any newer or processing reference still needs them', async () => {
  const { store, rows, calls } = setup([
    recording('a', `${owner}/shared.txt`), recording('b', `${owner}/shared.txt`, { created_at: recent }),
    recording('c', `${owner}/active.txt`), recording('d', `${owner}/active.txt`, { status: '처리 중' }),
    recording('e', `${owner}/old.txt`),
  ])
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.skippedPaths, 2)
  assert.deepEqual(calls.remove, [[`${owner}/old.txt`]])
  assert.equal(rows[0].audio_path, `${owner}/shared.txt`)
  assert.equal(rows[2].audio_path, `${owner}/active.txt`)
})

test('reference-query errors and truncated results stop deletion', async () => {
  for (const response of [
    { data: null, count: null, error: new Error('Read failed') },
    { data: [recording('a', `${owner}/old.txt`)], count: 1001, error: null },
    { data: [recording('a', `${owner}/old.txt`)], count: null, error: null },
  ]) {
    const { store, calls, rows } = setup([recording('a', `${owner}/old.txt`)])
    store.references = async () => response
    const result = await cleanupExpiredRecordings(store, now)
    assert.equal(result.failure, 'references')
    assert.equal(calls.remove.length, 0)
    assert.equal(rows[0].audio_path, `${owner}/old.txt`)
  }
})

test('a reference changed during deletion is never cleared to null', async () => {
  const { store, rows } = setup([recording('a', `${owner}/old.txt`)])
  const remove = store.remove
  store.remove = async paths => {
    const result = await remove(paths)
    rows[0].audio_path = `${owner}/replacement.txt`
    return result
  }
  await cleanupExpiredRecordings(store, now)
  assert.equal(rows[0].audio_path, `${owner}/replacement.txt`)
})

test('a failed database update can retry after the original object is already gone', async () => {
  const { store, rows, files } = setup([recording('a', `${owner}/old.txt`)])
  const clear = store.clearReferences
  store.clearReferences = async () => ({ error: new Error('Database unavailable') })
  const failed = await cleanupExpiredRecordings(store, now)
  assert.equal(failed.failure, 'clear')
  assert.equal(files.size, 0)
  assert.equal(rows[0].audio_path, `${owner}/old.txt`)
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

test('meeting object keys must have an exact owner folder and no traversal or URL encoding', () => {
  assert.equal(isOwnedRecordingPath(`${owner}/notes.txt`, owner), true)
  assert.equal(isOwnedRecordingPath(`${owner}/folder/회의 메모.txt`, owner), true)
  for (const path of [null, '', `${otherOwner}/notes.txt`, `${owner}/../notes.txt`, `${owner}/./notes.txt`, `${owner}//notes.txt`, `${owner}/`, `${owner}/%2e%2e/notes.txt`, `${owner}\\notes.txt`, `${owner}/notes.txt?x=1`, `${owner}/notes.txt#x`, `${owner}/notes\u0000.txt`]) {
    assert.equal(isOwnedRecordingPath(path, owner), false, String(path))
  }
  for (const missingOwner of [undefined, null, '', 'not-an-owner']) assert.equal(isOwnedRecordingPath(`${owner}/notes.txt`, missingOwner), false)
})

test('cleanup rejects uploaded, failed, unknown-status and foreign-owner candidates even from an unfiltered store', async () => {
  const initial = [
    recording('a', `${owner}/uploaded.txt`, { status: '업로드' }),
    recording('b', `${owner}/failed.txt`, { status: '실패' }),
    recording('c', `${owner}/unknown.txt`, { status: undefined }),
    recording('d', `${otherOwner}/forged.txt`),
    recording('e', `${owner}/missing-owner.txt`, { created_by: undefined }),
  ]
  const { store, calls, files } = setup(initial)
  store.expired = async () => ({ data: initial, error: null })
  await cleanupExpiredRecordings(store, now)
  assert.deepEqual(calls.remove, [])
  assert.equal(files.size, 5)
})

test('cleanup preserves a shared failed or uploaded source when processing claims it after reference inspection', async () => {
  for (const status of ['업로드', '실패']) {
    const { store, rows, files, calls } = setup([
      recording('complete', `${owner}/shared.txt`),
      recording('retryable', `${owner}/shared.txt`, { status }),
    ])
    const references = store.references
    store.references = async paths => {
      const snapshot = await references(paths)
      rows[1].status = '처리 중' // Another request's CAS succeeds after this snapshot.
      return snapshot
    }
    const result = await cleanupExpiredRecordings(store, now)
    assert.equal(result.skippedPaths, 1)
    assert.deepEqual(calls.remove, [])
    assert.equal(files.has(`${owner}/shared.txt`), true)
    assert.equal(rows[1].audio_path, `${owner}/shared.txt`)
  }
})

test('cleanup retains files when any reference has unknown status, missing owner or a foreign owner', async () => {
  for (const extra of [{ status: undefined }, { created_by: undefined }, { created_by: otherOwner }]) {
    const { store, files, calls } = setup([
      recording('a', `${owner}/shared.txt`), recording('b', `${owner}/shared.txt`, extra),
    ])
    assert.equal((await cleanupExpiredRecordings(store, now)).skippedPaths, 1)
    assert.equal(files.has(`${owner}/shared.txt`), true)
    assert.deepEqual(calls.remove, [])
  }
})

test('cleanup reference clearing retains rows whose owner or completion state changed', async () => {
  for (const change of [{ created_by: otherOwner }, { status: '처리 중' }, { status: '실패' }]) {
    const { store, rows } = setup([recording('a', `${owner}/old.txt`)])
    const remove = store.remove
    store.remove = async paths => {
      const result = await remove(paths)
      Object.assign(rows[0], change)
      return result
    }
    await cleanupExpiredRecordings(store, now)
    assert.equal(rows[0].audio_path, `${owner}/old.txt`)
  }
})

test('cleanup clears references in separate owner-scoped groups', async () => {
  const { store, rows, calls } = setup([
    recording('a', `${owner}/old.txt`), recording('b', `${otherOwner}/old.txt`, { created_by: otherOwner }),
  ])
  const result = await cleanupExpiredRecordings(store, now)
  assert.equal(result.removedPaths, 2)
  assert.equal(calls.clear, 2)
  assert.deepEqual(rows.map(row => row.audio_path), [null, null])
})
