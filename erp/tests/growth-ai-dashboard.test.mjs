import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto, randomUUID } from 'node:crypto'
import ts from 'typescript'
import { buildDashboardSource, dashboardFile } from '../scripts/build-growth-ai-dashboard.mjs'

test('dashboard deployment file contains the current canonical sources without local imports', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  assert.equal(source, await buildDashboardSource())
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  const imports = parsed.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text)
  assert.deepEqual(imports, ['npm:@supabase/supabase-js@2.45.4'])
})

test('dashboard entrypoint enforces login and budget checks and returns cached results without provider calls', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service', ANTHROPIC_API_KEY: 'test-provider' }
  let handler, providerCalls = 0, mode = 'deny'
  const authHeaders = [], calls = []
  const createClient = (_url, key, options) => ({
    auth: { getUser: async () => { authHeaders.push(options.global.headers.Authorization); return { data: { user: { id: 'member' } }, error: null } } },
    rpc: async (name, args) => {
      calls.push({ key, name, args })
      return mode === 'deny' ? { data: null, error: { message: '사용 가능한 예산 기간이 없습니다.' } } : { data: { execute: false, status: 'completed', text: '기존 결과', cost: .01 }, error: null }
    },
  })
  vm.runInNewContext(js, {
    exports: {}, require: specifier => { assert.equal(specifier, 'npm:@supabase/supabase-js@2.45.4'); return { createClient } },
    Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback } },
    Request, Response, TextEncoder, AbortSignal, crypto: webcrypto,
    fetch: async () => { providerCalls++; throw new Error('Provider calls must not occur in these scenarios.') },
  })
  assert.equal(typeof handler, 'function')
  const request = auth => new Request('https://example.test/growth-ai', { method: 'POST', headers: auth ? { Authorization: 'Bearer test-user' } : {}, body: JSON.stringify({ id: randomUUID(), task: 'write', model: 'standard', prompt: '초안 작성' }) })
  assert.equal((await handler(request(false))).status, 401); assert.equal(calls.length, 0)
  const denied = await handler(request(true)); assert.equal(denied.status, 400); assert.match((await denied.json()).error, /예산/)
  assert.equal(calls[0].key, 'test-service'); assert.equal(calls[0].name, 'growth_ai_reserve'); assert.equal(calls[0].args.p_user, 'member')
  assert.match(calls[0].args.p_signature, /^[0-9a-f]{64}$/); assert.deepEqual(authHeaders, ['Bearer test-user'])
  mode = 'cached'
  const cached = await handler(request(true)); assert.equal(cached.status, 200); assert.equal((await cached.json()).text, '기존 결과')
  assert.equal(providerCalls, 0)
})
