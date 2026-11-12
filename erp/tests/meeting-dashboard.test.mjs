import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { buildDashboardSource, dashboardFile } from '../scripts/build-meeting-minutes-dashboard.mjs'

const id = '00000000-0000-4000-8000-000000000001'

test('meeting dashboard artifact matches both canonical sources and retains only pinned npm imports', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  assert.equal(source, await buildDashboardSource())
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  assert.equal(parsed.parseDiagnostics.length, 0)
  assert.deepEqual(parsed.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text), [
    'npm:@anthropic-ai/sdk@0.134.0', 'npm:@supabase/supabase-js@2.117.3',
  ])
  execFileSync(process.execPath, ['scripts/build-meeting-minutes-dashboard.mjs', '--check'], { cwd: new URL('../', import.meta.url) })
})

async function setup({ signedIn = true, record = null } = {}) {
  const source = await readFile(dashboardFile, 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const effects = { auth: 0, lookup: 0, write: 0, storage: 0, provider: 0, background: 0 }
  const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'mock-anon', SUPABASE_SERVICE_ROLE_KEY: 'mock-service', ANTHROPIC_API_KEY: 'mock-provider' }
  let handler
  const createClient = (_url, key, options) => {
    const denied = type => { effects[type]++; throw new Error(`Unexpected ${type} in a no-side-effect check`) }
    return {
      auth: { getUser: async () => {
        effects.auth++
        assert.equal(key, 'mock-anon')
        assert.equal(options.global.headers.Authorization, 'Bearer mock-user')
        return { data: { user: signedIn ? { id: 'member' } : null }, error: null }
      } },
      from(table) {
        if (key !== 'mock-anon') return denied('write')
        assert.equal(table, 'meeting_recordings')
        const query = {
          select() { return query },
          eq(column, value) { assert.equal(column, 'id'); assert.equal(value, id); return query },
          async maybeSingle() { effects.lookup++; return { data: record, error: null } },
        }
        return query
      },
      storage: { from() { return denied('storage') } },
    }
  }
  class FakeAnthropic { constructor() { effects.provider++; throw new Error('No paid calls allowed') } }
  vm.runInNewContext(js, {
    exports: {},
    require(specifier) {
      if (specifier === 'npm:@supabase/supabase-js@2.117.3') return { createClient }
      assert.equal(specifier, 'npm:@anthropic-ai/sdk@0.134.0')
      return { default: FakeAnthropic }
    },
    Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback } },
    EdgeRuntime: { waitUntil() { effects.background++; throw new Error('Unexpected background job') } },
    Request, Response, console,
    fetch() { throw new Error('No network calls allowed') },
  })
  assert.equal(typeof handler, 'function')
  return { handler, effects }
}

const cases = [
  { name: 'OPTIONS', method: 'OPTIONS', status: 200, auth: false, authCalls: 0 },
  { name: 'GET', method: 'GET', status: 405, auth: false, authCalls: 0 },
  { name: 'POST without login', status: 401, auth: false, authCalls: 0 },
  { name: 'POST with rejected session', status: 401, auth: true, authCalls: 1, signedIn: false },
  { name: 'POST with invalid JSON', status: 400, auth: true, authCalls: 1, body: '{' },
  { name: 'POST with missing ID', status: 400, auth: true, authCalls: 1, body: '{}' },
  { name: 'POST with malformed ID', status: 400, auth: true, authCalls: 1, body: '{"id":"not-a-recording"}' },
]
for (const item of cases) test(`meeting dashboard ${item.name} does not invoke AI, storage or writes`, async () => {
  const { handler, effects } = await setup({ signedIn: item.signedIn ?? true })
  const method = item.method ?? 'POST'
  const response = await handler(new Request('https://example.test/meeting-minutes', {
    method, headers: item.auth ? { Authorization: 'Bearer mock-user' } : {},
    ...(method === 'POST' ? { body: item.body ?? '{}' } : {}),
  }))
  assert.equal(response.status, item.status)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual(effects, { auth: item.authCalls, lookup: 0, write: 0, storage: 0, provider: 0, background: 0 })
})

test('meeting dashboard missing record does not start processing or cleanup', async () => {
  const { handler, effects } = await setup()
  const response = await handler(new Request('https://example.test/meeting-minutes', { method: 'POST', headers: { Authorization: 'Bearer mock-user' }, body: JSON.stringify({ id }) }))
  assert.equal(response.status, 404)
  assert.deepEqual(effects, { auth: 1, lookup: 1, write: 0, storage: 0, provider: 0, background: 0 })
})

test('meeting dashboard already-processing record does not duplicate the job or run cleanup', async () => {
  const { handler, effects } = await setup({ record: { id, status: '처리 중' } })
  const response = await handler(new Request('https://example.test/meeting-minutes', { method: 'POST', headers: { Authorization: 'Bearer mock-user' }, body: JSON.stringify({ id }) }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: '처리 중' })
  assert.deepEqual(effects, { auth: 1, lookup: 1, write: 0, storage: 0, provider: 0, background: 0 })
})
