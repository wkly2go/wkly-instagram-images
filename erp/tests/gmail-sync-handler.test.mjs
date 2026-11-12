import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import { syncGmailWindow } from '../supabase/functions/gmail/sync.ts'

const source = await readFile(new URL('../supabase/functions/gmail/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const initialTime = '2026-11-10T00:00:00.000Z'
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const copy = value => JSON.parse(JSON.stringify(value))

function setup({ state, refreshState, records = [], ids = ['fresh'] } = {}) {
  const settings = new Map([['google_oauth_client_id', { key: 'google_oauth_client_id', value: 'mock-client', updated_at: initialTime }]])
  if (state) settings.set('gmail_sync', { key: 'gmail_sync', value: copy(state), updated_at: initialTime })
  if (refreshState) settings.set('gmail_refresh', { key: 'gmail_refresh', value: copy(refreshState), updated_at: initialTime })
  const mails = new Map(records.map(row => [row.id, copy(row)]))
  const calls = []
  const failure = { known: false, checkpointConflict: false }
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', headers = new Headers(init.headers)
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, headers, body })
    if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'mock-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' })
    if (url.hostname === 'gmail.googleapis.com') {
      assert.equal(method, 'GET', 'mailbox calls must remain read-only')
      if (url.pathname.endsWith('/messages')) {
        assert.equal(url.searchParams.get('maxResults'), '500')
        assert.match(url.searchParams.get('q'), /^after:\d+ before:\d+ /)
        return response({ messages: ids.map(id => ({ id })) })
      }
      const id = url.pathname.split('/').at(-1)
      return response({ id, threadId: 'thread-' + id, labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Brand <brand@example.com>' }, { name: 'Subject', value: '문의' }] } })
    }
    assert.equal(url.hostname, 'mock.supabase.test', 'no unmocked external endpoints')
    if (url.pathname.includes('/rpc/')) return response(url.pathname.endsWith('/gdrive_secret_get') ? 'mock-secret' : true)
    const table = url.pathname.split('/').at(-1), q = url.searchParams
    if (table === 'app_settings') {
      const key = q.get('key')?.slice(3) ?? body?.key
      if (method === 'GET') return response(settings.has(key) ? [settings.get(key)] : [])
      assert.ok(['POST', 'PATCH'].includes(method))
      const existing = settings.get(key)
      if (method === 'POST') {
        if (existing) return response({ code: '23505', message: 'duplicate key' }, 409)
        settings.set(key, copy(body))
      } else {
        assert.ok(existing)
        if (failure.checkpointConflict) return response(null)
        if (q.get('value->>checkpoint_id')?.startsWith('eq.')) {
          assert.equal(q.get('value->>checkpoint_id'), 'eq.' + existing.value.checkpoint_id)
        } else {
          assert.equal(q.get('value->>checkpoint_id'), 'is.null')
          assert.equal(existing.value.checkpoint_id, undefined)
          assert.equal(q.get('updated_at'), 'eq.' + existing.updated_at)
        }
        settings.set(key, { ...existing, ...copy(body) })
      }
      return response(headers.get('accept')?.includes('vnd.pgrst.object') ? settings.get(key) : [settings.get(key)])
    }
    assert.equal(table, 'mail_index')
    if (method === 'GET') {
      if (failure.known) return response({ code: '42501', message: 'known read denied' }, 403)
      const requested = q.get('id').slice(4, -1).split(',')
      return response(requested.filter(id => mails.has(id)).map(id => ({ id })))
    }
    assert.equal(method, 'POST')
    assert.match(headers.get('prefer'), /resolution=ignore-duplicates/)
    assert.equal(q.get('on_conflict'), 'id')
    for (const row of body) if (!mails.has(row.id)) mails.set(row.id, copy(row))
    return response(null, 201)
  }
  let handler
  vm.runInNewContext(js, {
    exports: {},
    require(specifier) {
      if (specifier === './sync.ts') return { syncGmailWindow }
      assert.equal(specifier, 'npm:@supabase/supabase-js@2.117.3')
      return { createClient: (url, key, options) => createClient(url, key, { ...options, global: { ...options?.global, fetch: fakeFetch } }) }
    },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://mock.supabase.test', SUPABASE_ANON_KEY: 'mock-anon', SUPABASE_SERVICE_ROLE_KEY: 'mock-service' })[key] }, serve: callback => { handler = callback } },
    fetch: async (input, init) => {
      // The OAuth form body is not JSON; the fake provider does not inspect its values.
      if (String(input).startsWith('https://oauth2.googleapis.com/')) return response({ access_token: 'mock-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' })
      return fakeFetch(input, init)
    },
    Request, Response, URLSearchParams, Headers, console, crypto: globalThis.crypto,
  })
  const request = async action => handler(new Request('https://mock.supabase.test/functions/v1/gmail', { method: 'POST', headers: { Authorization: 'Bearer mock-member', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, days: 90 }) }))
  return { settings, mails, calls, failure, request }
}

test('Gmail refresh uses its own checkpoint key and preserves an older main backfill byte-for-byte', async () => {
  const state = { checkpoint_id: 'main-version', synced_at: initialTime, backfill_days: 90, cursor: { version: 1, since: 1, until: 2, pageToken: 'older', pendingIds: ['older-mail'], nextPageToken: 'more' } }
  const f = setup({ state })
  const before = copy(f.settings.get('gmail_sync'))
  const r = await f.request('refresh')
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { fetched: 1, saved: 1, failed: 0, pending: false })
  assert.deepEqual(f.settings.get('gmail_sync'), before)
  assert.equal(f.settings.get('gmail_refresh').value.cursor, null)
  assert.equal(f.mails.size, 1)
  const writes = f.calls.filter(c => c.url.pathname.endsWith('/app_settings') && c.method !== 'GET')
  assert.ok(writes.every(c => (c.url.searchParams.get('key')?.slice(3) ?? c.body.key) === 'gmail_refresh'))
})

test('Gmail handler checkpoints use compact UUID conditions and do not replace already stored mail', async () => {
  const f = setup({ state: { checkpoint_id: 'existing-version', synced_at: initialTime }, records: [{ id: 'existing', marker: 'preserve' }], ids: ['existing', 'fresh'] })
  const r = await f.request('sync')
  assert.equal(r.status, 200)
  assert.equal((await r.json()).saved, 1)
  assert.equal(f.mails.get('existing').marker, 'preserve')
  const changes = f.calls.filter(c => c.method === 'PATCH')
  assert.ok(changes.length >= 3)
  assert.equal(changes[0].url.searchParams.get('value->>checkpoint_id'), 'eq.existing-version')
  assert.ok(changes.every(c => !c.url.searchParams.has('value') && c.url.href.length < 400))
})

test('Gmail handler known-ID errors stop before message reads and preserve the listed page', async () => {
  const f = setup()
  f.failure.known = true
  const r = await f.request('sync')
  assert.equal(r.status, 500)
  assert.match((await r.json()).error, /저장된 메일 조회 실패/)
  assert.equal(f.mails.size, 0)
  assert.deepEqual(f.settings.get('gmail_sync').value.cursor.pendingIds, ['fresh'])
  assert.equal(f.calls.filter(c => c.url.hostname === 'gmail.googleapis.com' && !c.url.pathname.endsWith('/messages')).length, 0)
})

test('Gmail handler failed checkpoint CAS stops before listing instead of resetting another worker state', async () => {
  const initial = { checkpoint_id: 'another-worker', synced_at: initialTime }
  const f = setup({ state: initial })
  f.failure.checkpointConflict = true
  const r = await f.request('sync')
  assert.equal(r.status, 500)
  assert.match((await r.json()).error, /다른 메일 동기화/)
  assert.deepEqual(f.settings.get('gmail_sync').value, initial)
  assert.equal(f.calls.filter(c => c.url.hostname === 'gmail.googleapis.com').length, 0)
})

test('Gmail public status reports pending work without exposing page tokens or message IDs', async () => {
  const state = { synced_at: initialTime, fetched: 500, saved: 400, failed: 1, backfill_days: 90, checkpoint_id: 'private-checkpoint', cursor: { version: 1, since: 1, until: 2, pageToken: 'opaque-token', pendingIds: ['private-id'], nextPageToken: null } }
  const f = setup({ state })
  const r = await f.request('status'), body = await r.json()
  assert.equal(r.status, 200)
  assert.equal(body.connected, true)
  assert.equal(body.pending, true)
  assert.equal(body.backfill_pending, true)
  assert.equal(body.failed, 1)
  assert.equal('cursor' in body, false)
  assert.equal('checkpoint_id' in body, false)
  assert.ok(!JSON.stringify(body).includes('opaque-token'))
  assert.ok(!JSON.stringify(body).includes('private-id'))
  assert.equal(f.calls.filter(c => c.method === 'PATCH').length, 0)
})
