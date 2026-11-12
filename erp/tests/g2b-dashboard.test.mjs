import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { buildDashboardSource, dashboardFile } from '../scripts/build-g2b-dashboard.mjs'

test('G2B dashboard artifact matches the canonical authenticated handler and fixed SDK import', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  assert.equal(source, await buildDashboardSource())
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  assert.equal(parsed.parseDiagnostics.length, 0)
  assert.deepEqual(parsed.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text), ['npm:@supabase/supabase-js@2.117.3'])
  execFileSync(process.execPath, ['scripts/build-g2b-dashboard.mjs', '--check'], { cwd: new URL('../', import.meta.url) })
})
async function fixture(active, profileError = null) {
  const source = ts.transpileModule(await readFile(dashboardFile, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const calls = { auth: 0, profile: 0, fetch: 0 }, env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'mock-anon', DATA_GO_KR_SERVICE_KEY: 'mock-g2b' }
  let handler
  const createClient = (url, key, options) => {
    assert.equal(url, env.SUPABASE_URL); assert.equal(key, 'mock-anon'); assert.equal(options.global.headers.Authorization, 'Bearer user-token')
    return {
      auth: { async getUser() { calls.auth++; return { data: { user: { id: 'user-id' } }, error: null } } },
      from(table) {
        assert.equal(table, 'profiles')
        const query = { select(value) { assert.equal(value, 'active'); return query }, eq(column, value) { assert.equal(column, 'id'); assert.equal(value, 'user-id'); return query }, async maybeSingle() { calls.profile++; return { data: active === null ? null : { active }, error: profileError } } }
        return query
      },
    }
  }
  vm.runInNewContext(source, {
    exports: {}, require(specifier) { assert.equal(specifier, 'npm:@supabase/supabase-js@2.117.3'); return { createClient } },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } }, Request, Response, URL, URLSearchParams, TextDecoder, AbortSignal,
    fetch: async () => { calls.fetch++; return Response.json({ response: { header: { resultCode: '00' }, body: { totalCount: 0, items: [], pageNo: 1, numOfRows: 30 } } }) },
  })
  return { calls, handler }
}
const request = () => new Request('https://example.test/g2b-search', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify({ category: 'service', keyword: '', startDate: '2026-11-12', endDate: '2026-11-12', page: 1 }) })
test('G2B deployed entrypoint checks the authenticated user own active profile before querying', async () => {
  for (const active of [false, null]) {
    const { calls, handler } = await fixture(active)
    assert.equal((await handler(request())).status, 403)
    assert.deepEqual(calls, { auth: 1, profile: 1, fetch: 0 })
  }
  const { calls, handler } = await fixture(true)
  assert.equal((await handler(request())).status, 200)
  assert.deepEqual(calls, { auth: 1, profile: 1, fetch: 1 })
})
test('G2B deployed entrypoint does not proceed after a profile read error or expose its details', async () => {
  const { calls, handler } = await fixture(true, { message: 'private database details' })
  const response = await handler(request())
  assert.equal(response.status, 503); assert.equal(calls.fetch, 0)
  assert.doesNotMatch(await response.text(), /private database/)
})
