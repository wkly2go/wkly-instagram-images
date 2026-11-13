import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { newSalesDraft, type SalesDraft, type SalesOpportunity } from '../src/lib/sales.ts'
import { saveSalesWithRecovery } from '../src/lib/salesSaveRecovery.ts'

const here = dirname(fileURLToPath(import.meta.url)), temp = await mkdtemp(join(here, '.sales-recovery-'))
await build({ entryPoints: [join(here, '../src/lib/salesApi.ts')], outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseSalesApi } = await import(pathToFileURL(join(temp, 'salesApi.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })

const actor = '10000000-0000-4000-8000-000000000001', id = '20000000-0000-4000-8000-000000000001'
const draft = (): SalesDraft => ({ ...newSalesDraft(actor), title: '  인테리어 제안  ', next_action: '담당자 확인', next_date: '2026-11-16' })
function saved(document: SalesDraft, revision = 1): SalesOpportunity {
  return { ...structuredClone(document), title: document.title.replace(/^ +| +$/g, ''), id, revision, updated_by: actor, created_by: actor, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T01:00:00Z' }
}
function network(options: { mode?: 'success' | 'lost' | 'empty' | 'reject' | 'gateway'; patch?: Partial<SalesOpportunity>; auth?: string | null; missing?: boolean; readFailure?: boolean; code?: string; status?: number } = {}) {
  let writes = 0, reads = 0, confirmations = 0, stored = saved(draft())
  const requests: { url: URL; body: Record<string, unknown> | null }[] = []
  const sb = createClient('https://sales-recovery.example.test', 'mock-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ url, body })
      if (url.pathname.endsWith('/rpc/sales_save_opportunity')) {
        writes++
        if (options.mode === 'reject') return Response.json({ code: options.code ?? '40001', message: '다른 작업에서 변경되었습니다.' }, { status: options.status ?? 409 })
        stored = { ...saved(body.p_document, body.p_expected_revision + 1), ...options.patch }
        if (options.mode === 'success') return Response.json(stored)
        if (options.mode === 'empty') return Response.json(null)
        if (options.mode === 'gateway') return new Response('Bad Gateway', { status: 502 })
        throw new TypeError('Failed to fetch')
      }
      assert.equal(url.pathname, '/rest/v1/sales_opportunities')
      reads++; assert.equal(url.searchParams.get('id'), `eq.${id}`)
      assert.equal(url.searchParams.get('select'), '*')
      if (options.readFailure) throw new TypeError('Failed to fetch')
      return Response.json(options.missing ? null : stored)
    } },
  })
  sb.auth.getSession = async () => ({ data: { session: { user: { id: actor }, access_token: 'mock-session-token' } }, error: null }) as Awaited<ReturnType<typeof sb.auth.getSession>>
  sb.auth.getUser = async () => {
    confirmations++
    return { data: { user: options.auth === null ? null : { id: options.auth ?? actor } }, error: null } as Awaited<ReturnType<typeof sb.auth.getUser>>
  }
  return { api: createSupabaseSalesApi(sb), requests, counts: () => ({ writes, reads, confirmations }), row: () => stored }
}

test('a lost committed sales response is recovered through one same-ID read and no second write', async () => {
  const s = network()
  const result = await s.api.saveSales(id, draft(), 0)
  assert.deepEqual(result, s.row())
  assert.deepEqual(s.counts(), { writes: 1, reads: 1, confirmations: 1 })
  assert.equal(result.title, '인테리어 제안')
  assert.equal(s.requests[0].body?.p_id, id)
  assert.equal(s.requests[0].body?.p_expected_revision, 0)
})
test('an empty successful response and a gateway timeout require the same readback proof', async () => {
  for (const mode of ['empty', 'gateway'] as const) {
    const s = network({ mode })
    assert.equal((await s.api.saveSales(id, draft(), 3)).revision, 4)
    assert.deepEqual(s.counts(), { writes: 1, reads: 1, confirmations: 1 })
  }
})
test('a confirmed normal response adds no recovery or authentication lookup', async () => {
  const s = network({ mode: 'success' })
  assert.equal((await s.api.saveSales(id, draft(), 0)).id, id)
  assert.deepEqual(s.counts(), { writes: 1, reads: 0, confirmations: 0 })
})
test('explicit conflict, permission, validation and missing-function errors never query recovery', async () => {
  for (const [code, status] of [['40001', 409], ['42501', 403], ['PGRST301', 401], ['23514', 400], ['42883', 404], ['P0001', 500]] as const) {
    const s = network({ mode: 'reject', code, status })
    await assert.rejects(s.api.saveSales(id, draft(), 0))
    assert.deepEqual(s.counts(), { writes: 1, reads: 0, confirmations: 0 })
  }
})
test('readback must match the entire document, ID, next revision and authenticated editor', async () => {
  const mutations: Partial<SalesOpportunity>[] = [
    { id: 'different' }, { revision: 0 }, { revision: 2 }, { updated_by: 'someone-else' },
    { title: '다른 건' }, { division: 'AR' }, { client_id: 'client' }, { contact_id: 'contact' }, { owner_id: 'other-owner' },
    { stage: '접촉' }, { source: '소개' }, { source_url: 'https://example.com/other' }, { expected_amount: 0 },
    { next_action: '다른 행동' }, { next_date: '2026-11-17' }, { description: '다른 메모' }, { result_note: '다른 결과' }, { project_id: 'project' },
  ]
  for (const patch of mutations) {
    const s = network({ patch })
    await assert.rejects(s.api.saveSales(id, draft(), 0), /저장 결과를 확인하지 못했습니다/)
    assert.deepEqual(s.counts(), { writes: 1, reads: 1, confirmations: 1 })
  }
})
test('a changed or signed-out account cannot confirm a previously submitted write', async () => {
  for (const auth of ['other-account', null]) {
    const s = network({ auth })
    await assert.rejects(s.api.saveSales(id, draft(), 0), /저장 결과를 확인하지 못했습니다/)
    assert.deepEqual(s.counts(), { writes: 1, reads: 0, confirmations: 1 })
  }
})
test('failed and missing readback preserve an uncertain result and never resend the mutation', async () => {
  for (const options of [{ missing: true }, { readFailure: true }]) {
    const s = network(options)
    await assert.rejects(s.api.saveSales(id, draft(), 0), /저장 결과를 확인하지 못했습니다/)
    assert.equal(s.counts().writes, 1)
  }
})
test('SQL title normalization preserves tabs and newlines, and the submitted snapshot is isolated', async () => {
  const d = { ...draft(), title: '  \t인테리어 제안\n  ', description: '첫 메모' }, row = saved(d)
  const original = structuredClone(d)
  const result = await saveSalesWithRecovery({
    async write(copy) { copy.description = 'transport mutation'; d.description = 'later edit'; throw new TypeError('fetch failed') },
    async read() { return row }, async confirmActor() { return actor },
  }, id, d, 0, actor)
  assert.equal(result.title, '\t인테리어 제안\n')
  assert.equal(result.description, original.description)
  await assert.rejects(saveSalesWithRecovery({
    async write() { throw new TypeError('fetch failed') }, async read() { return { ...row, title: row.title.trim() } }, async confirmActor() { return actor },
  }, id, original, 0, actor), /저장 결과를 확인하지 못했습니다/)
})
test('an ordinary programming exception does not trigger a speculative read', async () => {
  let reads = 0
  const failure = new TypeError('Cannot read properties of undefined')
  await assert.rejects(saveSalesWithRecovery({
    async write() { throw failure }, async read() { reads++; return saved(draft()) }, async confirmActor() { return actor },
  }, id, draft(), 0, actor), e => e === failure)
  assert.equal(reads, 0)
})
