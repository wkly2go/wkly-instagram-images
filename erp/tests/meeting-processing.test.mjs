import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { buildDashboardSource } from '../scripts/build-meeting-minutes-dashboard.mjs'

const id = '00000000-0000-4000-8000-000000000001'
const owner = '00000000-0000-4000-8000-000000000002'
const migration = await readFile(new URL('../supabase/migrations/0041_meeting_minutes_ai.sql', import.meta.url), 'utf8')
const tableSchema = migration.match(/create table if not exists public\.meeting_recordings \([\s\S]*?\n\);/)[0]
const source = await buildDashboardSource()
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const rowColumns = `*, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`
const reply = { content: [{ type: 'text', text: '{"agenda":["예산 검토"],"decisions":["다음 주 검토"]}' }] }

// Execute the real handler and its conditional UPDATEs against the migration's table
// in PostgreSQL (PGlite). Only auth, storage and the paid provider are mocked.
async function setup(t, options = {}) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select '${owner}'::uuid$$;
    create table public.profiles (id uuid primary key); insert into public.profiles values ('${owner}'); ${tableSchema}`)
  await db.query(`insert into meeting_recordings (id, title, transcript, created_at, updated_at) values ($1, '회의', '실제 회의 텍스트', '2100-01-01', '2026-11-12T00:00:00.123456Z')`, [id])
  if (options.initial) {
    const entries = Object.entries(options.initial)
    await db.query(`update meeting_recordings set ${entries.map(([key], i) => `${key}=$${i + 1}`).join(', ')}`, entries.map(([, value]) => value))
  }
  const effects = { provider: 0, cleanup: 0, storage: 0, downloads: [], removals: [], writes: [], sdkOptions: null }
  const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', ANTHROPIC_API_KEY: 'mock-key', ...options.env }
  let handler
  const createClient = (_url, key) => ({
    auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) },
    from(table) {
      let values = null, single = false, projection = '*', includeCount = false
      const filters = [], args = []
      let limit = ''
      const arg = value => { args.push(value); return `$${args.length}` }
      const query = {
        select(columns = '*', options = {}) { projection = columns; includeCount = options.count === 'exact'; return query },
        update(update) { values = update; return query },
        eq(column, value) { filters.push(`${column}=${arg(value)}`); return query },
        neq(column, value) { filters.push(`${column}<>${arg(value)}`); return query },
        lt(column, value) { filters.push(`${column}<${arg(value)}`); return query },
        in(column, values) { filters.push(`${column} in (${values.map(arg).join(', ')})`); return query },
        not(column, operator, value) { assert.equal(operator, 'is'); assert.equal(value, null); filters.push(`${column} is not null`); return query },
        order() { return query },
        limit(n) { limit = ` limit ${Number(n)}`; return query },
        maybeSingle() { single = true; return execute() },
        then(resolve, reject) { return execute().then(resolve, reject) },
      }
      async function execute() {
        if (table === 'profiles') return { data: [{ name: '담당자' }], error: null }
        assert.equal(table, 'meeting_recordings')
        const kind = values ? values.status === '완료' ? 'complete' : values.status === '실패' ? 'fail' : values.error?.startsWith('MEETING_REVIEW:') ? 'review' : 'claim' : single ? 'read' : 'cleanup'
        if (values) { assert.equal(key, 'service'); effects.writes.push(kind) }
        if (kind === 'cleanup') effects.cleanup++
        const fault = await options.fault?.({ kind, key, values, db, effects })
        if (fault?.skip) {
          if (fault.throw) throw new Error('mock transport error')
          return { data: null, error: { message: 'mock database error' } }
        }
        const where = filters.length ? ` where ${filters.join(' and ')}` : ''
        let sql
        if (values) {
          const set = Object.entries(values).map(([column, value]) => `${column}=${arg(value)}`)
          sql = `update meeting_recordings set ${set.join(', ')}${where} returning ${rowColumns}`
        } else sql = `select ${rowColumns} from meeting_recordings${where}${limit}`
        const result = await db.query(sql, args)
        if (fault?.lose) {
          if (fault.throw) throw new Error('mock lost response')
          return { data: null, error: { message: 'mock lost response' } }
        }
        const projected = projection === '*' ? result.rows : result.rows.map(row => Object.fromEntries(projection.split(',').map(column => column.trim()).map(column => [column, row[column]])))
        let data = single ? projected[0] ?? null : projected
        if (kind === 'read' && key === 'anon' && options.read) data = await options.read(data)
        return { data, error: null, ...(includeCount ? { count: result.rows.length } : {}) }
      }
      return query
    },
    storage: { from(bucket) {
      effects.storage++
      assert.equal(bucket, 'meeting-audio')
      return { download: async path => {
        effects.downloads.push(path)
        if (!options.downloadText) throw new Error('No live storage operations allowed')
        return { data: { text: async () => options.downloadText }, error: null }
      }, remove: async paths => {
        if (!options.allowMockRemoval) throw new Error('No live storage operations allowed')
        effects.removals.push(Array.from(paths))
        return { error: null }
      } }
    } },
  })
  class FakeAnthropic {
    constructor(sdkOptions) { effects.sdkOptions = sdkOptions }
    messages = { create: async () => {
      effects.provider++
      return options.provider ? options.provider({ db, effects }) : structuredClone(reply)
    } }
  }
  vm.runInNewContext(js, {
    exports: {},
    require(specifier) {
      if (specifier === 'npm:@supabase/supabase-js@2.117.3') return { createClient }
      assert.equal(specifier, 'npm:@anthropic-ai/sdk@0.134.0')
      return { default: FakeAnthropic }
    },
    Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback } },
    Request, Response, crypto: webcrypto, console: { warn() {} },
    fetch() { throw new Error('No network calls allowed') },
  })
  const invoke = () => handler(new Request('https://example.test/meeting-minutes', {
    method: 'POST', headers: { Authorization: 'Bearer mock-user' }, body: JSON.stringify({ id }),
  }))
  const row = async () => (await db.query(`select ${rowColumns} from meeting_recordings where id=$1`, [id])).rows[0]
  return { db, effects, invoke, row }
}

test('meeting concurrent calls with the same timestamp acquire only one SQL claim', async t => {
  let count = 0, release
  const barrier = new Promise(resolve => { release = resolve })
  const app = await setup(t, { read: async row => { if (++count === 2) release(); await barrier; return row } })
  const responses = await Promise.all([app.invoke(), app.invoke()])
  assert.ok(responses.every(response => response.ok))
  assert.equal(app.effects.provider, 1)
  assert.equal(app.effects.sdkOptions.maxRetries, 0)
  assert.equal((await app.row()).status, '완료')
  assert.equal(app.effects.writes.filter(kind => kind === 'claim').length, 2)
})

test('meeting completed ID is replayed without any provider or database write', async t => {
  const app = await setup(t, { initial: { status: '완료', minutes: '저장한 회의록' } })
  assert.equal((await app.invoke()).status, 200)
  assert.equal(app.effects.provider, 0)
  assert.deepEqual(app.effects.writes, [])
})

for (const throwError of [false, true]) test(`meeting failed claim (${throwError ? 'thrown' : 'returned'}) never dispatches provider`, async t => {
  const app = await setup(t, { fault: ({ kind }) => kind === 'claim' ? { skip: true, throw: throwError } : null })
  assert.equal((await app.invoke()).status, 503)
  assert.equal(app.effects.provider, 0)
  assert.equal((await app.row()).status, '업로드')
})

test('meeting lost claim response resumes only its exact unique SQL ownership marker', async t => {
  const app = await setup(t, { fault: ({ kind }) => kind === 'claim' ? { lose: true, throw: true } : null })
  // Even if production has an additional timestamp trigger, ownership must not
  // depend on a client timestamp surviving PostgreSQL's timestamp precision.
  await app.db.exec(`create function change_timestamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
    create trigger timestamp_change before update on meeting_recordings for each row execute function change_timestamp()`)
  assert.equal((await app.invoke()).status, 200)
  assert.equal(app.effects.provider, 1)
  assert.equal((await app.row()).status, '완료')
})

test('meeting ambiguous claim with failed verification stays processing without any provider call', async t => {
  const app = await setup(t, { fault: ({ kind, key }) => kind === 'claim' ? { lose: true } : kind === 'read' && key === 'service' ? { skip: true } : null })
  assert.equal((await app.invoke()).status, 503)
  assert.equal((await app.row()).status, '처리 중')
  assert.equal((await app.invoke()).status, 200)
  assert.equal(app.effects.provider, 0)
})

test('meeting a competing claim is not adopted after a failed update', async t => {
  const app = await setup(t, { fault: async ({ kind, db }) => {
    if (kind !== 'claim') return null
    await db.query(`update meeting_recordings set status='처리 중', error='MEETING_CLAIM:other-request'`)
    return { skip: true }
  } })
  assert.equal((await app.invoke()).status, 200)
  assert.equal(app.effects.provider, 0)
  assert.equal((await app.row()).error, 'MEETING_CLAIM:other-request')
})

test('meeting committed final result with lost response is verified without another paid call', async t => {
  const app = await setup(t, { fault: ({ kind }) => kind === 'complete' ? { lose: true, throw: true } : null })
  await app.invoke()
  assert.equal((await app.row()).status, '완료')
  assert.equal(app.effects.writes.includes('review'), false)
  await app.invoke()
  assert.equal(app.effects.provider, 1)
})

test('meeting rejected final save remains non-retryable and exposes review guidance', async t => {
  const app = await setup(t, { fault: ({ kind }) => kind === 'complete' ? { skip: true } : null })
  await app.invoke()
  assert.equal((await app.row()).status, '처리 중')
  assert.match((await app.row()).error, /^MEETING_REVIEW:/)
  assert.equal(app.effects.cleanup, 0)
  const replay = await (await app.invoke()).json()
  assert.equal(replay.needs_review, true)
  assert.match(replay.message, /중복 비용/)
  assert.equal(app.effects.provider, 1)
  assert.equal(app.effects.writes.includes('fail'), false)
})

test('meeting final save and review write outage retain the original claim and prevent re-dispatch', async t => {
  const app = await setup(t, { fault: ({ kind }) => ['complete', 'review'].includes(kind) ? { skip: true, throw: true } : null })
  await app.invoke()
  assert.match((await app.row()).error, /^MEETING_CLAIM:/)
  assert.equal((await app.row()).status, '처리 중')
  await app.invoke()
  assert.equal(app.effects.provider, 1)
  assert.equal(app.effects.cleanup, 0)
})

test('meeting final commit with both response and verification lost cannot be changed back to processing', async t => {
  const app = await setup(t, { fault: ({ kind, key }) => kind === 'complete' ? { lose: true } : kind === 'read' && key === 'service' ? { skip: true } : null })
  await app.invoke()
  assert.equal((await app.row()).status, '완료')
  assert.equal((await app.row()).error, null)
  await app.invoke()
  assert.equal(app.effects.provider, 1)
  assert.equal(app.effects.cleanup, 0)
})

test('meeting stale processor cannot overwrite a newer owner on completion or review', async t => {
  const app = await setup(t, { provider: async ({ db }) => {
    await db.query(`update meeting_recordings set error='MEETING_CLAIM:replacement-owner', minutes='다른 작업의 내용'`)
    return structuredClone(reply)
  } })
  await app.invoke()
  assert.equal((await app.row()).error, 'MEETING_CLAIM:replacement-owner')
  assert.equal((await app.row()).minutes, '다른 작업의 내용')
  assert.equal((await app.row()).status, '처리 중')
  assert.equal(app.effects.cleanup, 0)
})

test('meeting provider response loss prevents subsequent automatic paid retries', async t => {
  const app = await setup(t, { provider: async () => { throw new Error('Provider accepted; response lost') } })
  await app.invoke()
  await app.invoke()
  assert.equal(app.effects.provider, 1)
  assert.equal((await app.row()).status, '처리 중')
  assert.match((await app.row()).error, /^MEETING_REVIEW:/)
})

test('meeting malformed provider response is held for review instead of marked retryable', async t => {
  const app = await setup(t, { provider: async () => ({ content: [{ type: 'text', text: 'invalid json' }] }) })
  await app.invoke()
  await app.invoke()
  assert.equal(app.effects.provider, 1)
  assert.match((await app.row()).error, /^MEETING_REVIEW:/)
})

test('meeting pre-provider configuration failure is safe to retry after configuration is fixed', async t => {
  const app = await setup(t, { env: { ANTHROPIC_API_KEY: '' } })
  await app.invoke()
  assert.equal((await app.row()).status, '실패')
  assert.match((await app.row()).error, /키가 설정되지/)
  await app.invoke()
  assert.equal(app.effects.provider, 0)
  assert.equal(app.effects.cleanup, 0)
})

test('meeting missing version timestamp fails closed without an unconditional update', async t => {
  const app = await setup(t, { read: async row => ({ ...row, updated_at: null }) })
  assert.equal((await app.invoke()).status, 409)
  assert.deepEqual(app.effects.writes, [])
  assert.equal(app.effects.provider, 0)
})

test('meeting a forged or unsafe object key never reaches privileged storage or the provider', async t => {
  const app = await setup(t, { initial: { transcript: null, mime: 'text/plain' } })
  for (const path of [`${id}/foreign.txt`, `${owner}/../foreign.txt`, `${owner}/%2e%2e/foreign.txt`, `${owner}\\foreign.txt`, `${owner}//foreign.txt`, `${owner}/foreign.txt?x=1`]) {
    await app.db.query(`update meeting_recordings set status='업로드', audio_path=$1`, [path])
    await app.invoke()
    assert.equal((await app.row()).status, '실패')
    assert.match((await app.row()).error, /소유 경로/)
  }
  assert.equal(app.effects.storage, 0)
  assert.equal(app.effects.provider, 0)
})

test('meeting an owned text object can be read and summarized without weakening its path checks', async t => {
  const path = `${owner}/notes.txt`
  const app = await setup(t, { initial: { transcript: null, audio_path: path, mime: 'text/plain' }, downloadText: '소유자가 업로드한 회의 텍스트' })
  await app.invoke()
  assert.deepEqual(app.effects.downloads, [path])
  assert.equal(app.effects.provider, 1)
  assert.equal((await app.row()).status, '완료')
  assert.equal((await app.row()).transcript, '소유자가 업로드한 회의 텍스트')
})

test('meeting canonical cleanup SQL only clears expired completed owner-scoped references', async t => {
  const app = await setup(t, { allowMockRemoval: true })
  const old = '2020-01-01T00:00:00Z'
  const statuses = ['완료', '업로드', '실패', '처리 중', '완료']
  for (let i = 0; i < statuses.length; i++) {
    const path = `${i === 4 ? id : owner}/old-${i}.txt`
    await app.db.query(`insert into meeting_recordings (id, status, audio_path, created_at) values ($1,$2,$3,$4)`, [`00000000-0000-4000-8000-00000000001${i}`, statuses[i], path, old])
  }
  await app.invoke()
  assert.deepEqual(app.effects.removals, [[`${owner}/old-0.txt`]])
  const oldRows = (await app.db.query(`select status, audio_path from meeting_recordings where created_at=$1 order by id`, [old])).rows
  assert.equal(oldRows[0].audio_path, null)
  assert.equal(oldRows.slice(1).every(row => row.audio_path !== null), true)
})
