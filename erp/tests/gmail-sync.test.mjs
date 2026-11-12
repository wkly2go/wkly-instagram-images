import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncGmailWindow } from '../supabase/functions/gmail/sync.ts'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const ids = (n, offset = 0) => Array.from({ length: n }, (_, i) => 'mail' + (i + offset))
function fixture({ pages = [ids(1)], known = [], value = null } = {}) {
  let state = value === null ? null : { value: structuredClone(value), updatedAt: '2026-11-10T00:00:00Z' }
  let version = 0
  const mails = new Map(known.map(id => [id, { id, marker: 'existing' }]))
  const calls = { list: [], existing: [], message: [], saves: [], checkpoints: [] }
  const failures = { read: false, list: false, existing: false, message: new Set(), save: 0, checkpoint: 0 }
  const store = {
    async readState() {
      if (failures.read) throw new Error('read unavailable')
      return state ? { exists: true, ...structuredClone(state) } : { exists: false, value: {}, updatedAt: null }
    },
    async saveState(expected, next) {
      calls.checkpoints.push(structuredClone(next))
      if (calls.checkpoints.length === failures.checkpoint) throw new Error('checkpoint unavailable')
      assert.equal(expected.exists, state !== null, 'checkpoint existence CAS')
      assert.deepEqual(expected.value, state?.value ?? {}, 'stale checkpoint must not overwrite a newer cursor')
      state = { value: { ...structuredClone(next), checkpoint_id: String(++version) }, updatedAt: 'version' + version }
      return { exists: true, ...structuredClone(state) }
    },
    async list(input) {
      calls.list.push(structuredClone(input))
      if (failures.list) throw new Error('list unavailable')
      assert.equal(input.maxResults, 500)
      const p = input.pageToken === null ? 0 : Number(input.pageToken)
      assert.ok(p < pages.length)
      return { messages: pages[p].map(id => ({ id })), ...(p + 1 < pages.length ? { nextPageToken: String(p + 1) } : {}) }
    },
    async existing(list) {
      calls.existing.push([...list])
      assert.ok(list.length <= 500)
      if (failures.existing) throw new Error('known lookup unavailable')
      return list.filter(id => mails.has(id))
    },
    async message(id) {
      calls.message.push(id)
      if (failures.message.has(id)) throw new Error('message unavailable')
      return { id, marker: 'new' }
    },
    async saveRows(rows) {
      calls.saves.push(rows.map(row => row.id))
      assert.ok(rows.length <= 200)
      if (calls.saves.length === failures.save) throw new Error('mail save unavailable')
      for (const row of rows) if (!mails.has(row.id)) mails.set(row.id, row)
    },
  }
  return { store, mails, calls, failures, state: () => structuredClone(state?.value ?? {}), forceState: value => { state = { value, updatedAt: 'concurrent' } } }
}

test('Gmail 400-message cap preserves the rest of a 500-ID page before moving to its next token', async () => {
  const f = fixture({ pages: [ids(500), ids(3, 500)] })
  const first = await syncGmailWindow(f.store, 90, NOW)
  assert.deepEqual(first, { fetched: 500, saved: 400, failed: 0, pending: true })
  assert.equal(f.calls.list.length, 1)
  assert.equal(f.calls.message.length, 400)
  assert.deepEqual(f.state().cursor.pendingIds, ids(100, 400))
  assert.equal(f.state().cursor.nextPageToken, '1')
  const bounds = { since: f.state().cursor.since, until: f.state().cursor.until }
  const second = await syncGmailWindow(f.store, 90, NOW + 2 * 86400000)
  assert.deepEqual(second, { fetched: 103, saved: 103, failed: 0, pending: false })
  assert.equal(f.mails.size, 503)
  assert.equal(f.calls.list.length, 2, 'resume the saved page without listing it again')
  assert.deepEqual(f.calls.list[1], { ...bounds, pageToken: '1', maxResults: 500 })
  assert.equal(new Set(f.calls.message).size, 503)
  assert.equal(f.state().cursor, null)
  assert.equal(f.state().completed_until, bounds.until)
  assert.equal(f.state().backfill_days, 0)
})

test('Gmail twenty-page cap is pending rather than complete and resumes at page twenty-one', async () => {
  const pages = Array.from({ length: 21 }, (_, i) => ids(500, i * 500))
  const f = fixture({ pages, known: pages.flat() })
  const first = await syncGmailWindow(f.store, 90, NOW)
  assert.equal(first.pending, true)
  assert.equal(first.fetched, 10000)
  assert.equal(f.calls.list.length, 20)
  assert.equal(f.state().cursor.pageToken, '20')
  assert.equal(f.state().cursor.pendingIds, null)
  assert.equal(f.state().completed_until, undefined)
  const second = await syncGmailWindow(f.store, 0, NOW + 86400000)
  assert.equal(second.pending, false)
  assert.equal(second.fetched, 500)
  assert.equal(f.calls.list.length, 21)
  assert.equal(f.calls.message.length, 0)
  assert.equal(f.mails.get('mail1').marker, 'existing')
})

test('Gmail partial detail failures retain failed and unattempted IDs and do not advance the page', async () => {
  const f = fixture({ pages: [ids(25), ids(2, 25)] })
  f.failures.message.add('mail3')
  const first = await syncGmailWindow(f.store, 90, NOW)
  assert.deepEqual(first, { fetched: 25, saved: 19, failed: 1, pending: true })
  assert.deepEqual(f.state().cursor.pendingIds, ['mail3', ...ids(5, 20)])
  assert.equal(f.calls.list.length, 1)
  assert.equal(f.calls.message.length, 20)
  f.failures.message.clear()
  const second = await syncGmailWindow(f.store, 0, NOW + 600000)
  assert.deepEqual(second, { fetched: 8, saved: 8, failed: 0, pending: false })
  assert.equal(f.mails.size, 27)
  assert.equal(f.calls.message.filter(id => id === 'mail0').length, 1)
  assert.equal(f.calls.message.filter(id => id === 'mail3').length, 2)
})

test('Gmail stored-ID lookup errors stop before message reads or writes and preserve the full page', async () => {
  const f = fixture({ pages: [ids(8)] })
  f.failures.existing = true
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /known lookup unavailable/)
  assert.equal(f.calls.message.length, 0)
  assert.equal(f.calls.saves.length, 0)
  assert.deepEqual(f.state().cursor.pendingIds, ids(8))
  f.failures.existing = false
  await syncGmailWindow(f.store, 0, NOW + 86400000)
  assert.equal(f.calls.list.length, 1)
  assert.equal(f.mails.size, 8)
})

test('Gmail listing failure keeps a fixed window for the next run instead of moving the lower date', async () => {
  const f = fixture()
  f.failures.list = true
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /list unavailable/)
  const initial = f.state().cursor
  f.failures.list = false
  await syncGmailWindow(f.store, 0, NOW + 3 * 86400000)
  assert.equal(f.calls.list[1].since, initial.since)
  assert.equal(f.calls.list[1].until, initial.until)
})

test('Gmail a later mail-save failure keeps the page and resumes without overwriting committed earlier batches', async () => {
  const f = fixture({ pages: [ids(400)] })
  f.failures.save = 2
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /mail save unavailable/)
  assert.equal(f.mails.size, 200)
  assert.deepEqual(f.state().cursor.pendingIds, ids(400))
  f.mails.get('mail1').marker = 'preserve this'
  f.failures.save = 0
  const second = await syncGmailWindow(f.store, 0, NOW + 600000)
  assert.equal(second.saved, 200)
  assert.equal(second.pending, false)
  assert.equal(f.mails.size, 400)
  assert.equal(f.mails.get('mail1').marker, 'preserve this')
  assert.equal(f.calls.message.filter(id => id === 'mail1').length, 1)
})

test('Gmail checkpoint failure after rows commit is recovered by known-ID reads without fetching those messages again', async () => {
  const f = fixture({ pages: [ids(4)] })
  f.failures.checkpoint = 3
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /checkpoint unavailable/)
  assert.equal(f.mails.size, 4)
  assert.deepEqual(f.state().cursor.pendingIds, ids(4))
  f.failures.checkpoint = 0
  const second = await syncGmailWindow(f.store, 0, NOW + 600000)
  assert.deepEqual(second, { fetched: 4, saved: 0, failed: 0, pending: false })
  assert.equal(f.calls.message.length, 4)
})

test('Gmail a saved legacy backlog anchors its oldest date to the earlier saved sync time', async () => {
  const old = '2026-11-10T12:00:00Z'
  const f = fixture({ value: { synced_at: old, backfill_days: 90 } })
  await syncGmailWindow(f.store, 0, NOW)
  assert.equal(f.calls.list[0].since, Date.parse(old) / 1000 - 90 * 86400)
})

test('Gmail invalid checkpoint or failed state read is not replaced with a fresh completed scan', async () => {
  const broken = { cursor: { version: 1, since: 99, until: 1 } }
  const f = fixture({ value: broken })
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /체크포인트/)
  assert.deepEqual(f.state(), broken)
  assert.equal(f.calls.checkpoints.length, 0)
  f.failures.read = true
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /read unavailable/)
  assert.equal(f.calls.list.length, 0)
})

test('Gmail stale concurrent checkpoints fail instead of replacing a newer scan position', async () => {
  const f = fixture()
  const list = f.store.list
  f.store.list = async input => {
    const result = await list(input)
    f.forceState({ checkpoint_id: 'another-run', cursor: { version: 1, since: 1, until: 5, pageToken: 'later', pendingIds: null, nextPageToken: null } })
    return result
  }
  await assert.rejects(syncGmailWindow(f.store, 90, NOW), /stale checkpoint/)
  assert.equal(f.state().checkpoint_id, 'another-run')
  assert.equal(f.state().cursor.pageToken, 'later')
  assert.equal(f.calls.message.length, 0)
})
