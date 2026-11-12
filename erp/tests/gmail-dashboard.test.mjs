import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { buildDashboardSource, dashboardFile } from '../scripts/build-gmail-dashboard.mjs'

test('Gmail dashboard artifact matches both sources and has no unresolved local import', async () => {
  const source = await readFile(dashboardFile, 'utf8')
  assert.equal(source, await buildDashboardSource())
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  assert.equal(parsed.parseDiagnostics.length, 0)
  assert.deepEqual(parsed.statements.filter(ts.isImportDeclaration).map(s => s.moduleSpecifier.text), ['npm:@supabase/supabase-js@2.117.3'])
  execFileSync(process.execPath, ['scripts/build-gmail-dashboard.mjs', '--check'], { cwd: new URL('../', import.meta.url) })
})

for (const [method, status] of [['OPTIONS', 200], ['GET', 405], ['POST', 401]]) {
  test('Gmail dashboard ' + method + ' without authorization cannot sync mail or copy attachments', async () => {
    const source = await readFile(dashboardFile, 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    let handler, dbCalls = 0, networkCalls = 0
    vm.runInNewContext(js, {
      exports: {},
      require(specifier) {
        assert.equal(specifier, 'npm:@supabase/supabase-js@2.117.3')
        return { createClient: () => ({
          from() { dbCalls++; throw new Error('No DB calls allowed') },
          rpc() { dbCalls++; throw new Error('No RPC calls allowed') },
        }) }
      },
      Deno: { env: { get: () => 'mock' }, serve: callback => { handler = callback } },
      fetch() { networkCalls++; throw new Error('No provider calls allowed') },
      Request, Response,
    })
    const r = await handler(new Request('https://example.test/gmail', { method, ...(method === 'POST' ? { body: '{}' } : {}) }))
    assert.equal(r.status, status)
    assert.equal(dbCalls, 0)
    assert.equal(networkCalls, 0)
  })
}
