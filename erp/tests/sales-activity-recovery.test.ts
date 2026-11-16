import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import type { SalesActivity } from '../src/lib/sales.ts'
import { validateSalesProject } from '../src/lib/sales.ts'
import { checkSalesActivity, saveSalesActivityWithRecovery, type SalesActivityRequest } from '../src/lib/salesActivityRecovery.ts'

const here = dirname(fileURLToPath(import.meta.url)), temp = await mkdtemp(join(here, '.activity-recovery-'))
await build({ entryPoints: [join(here, '../src/lib/salesApi.ts')], outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseSalesApi, createDemoSalesApi } = await import(pathToFileURL(join(temp, 'salesApi.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })
const actor = '10000000-0000-4000-8000-000000000001', id = '20000000-0000-4000-8000-000000000001', opportunityId = '30000000-0000-4000-8000-000000000001'
const request = (): SalesActivityRequest => ({ id, opportunityId, kind: '전화', body: '  \t미팅 제안\n  ', actorId: actor })
const activity = (r = request()): SalesActivity => ({ id: r.id, opportunity_id: r.opportunityId, kind: r.kind, body: r.body.replace(/^ +| +$/g, ''), created_by: r.actorId, created_at: '2026-11-13T00:00:00Z' })
function network(options: { mode?: 'success' | 'lost' | 'gateway' | 'reject'; status?: number; code?: string; patch?: Partial<SalesActivity>; auth?: string | null; sessionActor?: string; missing?: boolean; readFailure?: boolean } = {}) {
  let writes = 0, reads = 0, confirmations = 0, row = activity()
  const sb = createClient('https://sales-activity.example.test', 'mock-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/rpc/sales_add_activity')) {
        writes++
        const body = JSON.parse(String(init?.body))
        assert.equal(body.p_id, id); assert.equal(body.p_opportunity_id, opportunityId)
        row = { ...activity({ ...request(), body: body.p_body, kind: body.p_kind }), ...options.patch }
        if (options.mode === 'reject') return Response.json({ code: options.code ?? '42501', message: '명시적으로 거부했습니다.' }, { status: options.status ?? 403 })
        if (options.mode === 'success') return new Response(null, { status: 204 })
        if (options.mode === 'gateway') return new Response('Bad Gateway', { status: 502 })
        throw new TypeError('Failed to fetch')
      }
      assert.equal(url.pathname, '/rest/v1/sales_activities')
      assert.equal(url.searchParams.get('id'), `eq.${id}`)
      assert.equal(url.searchParams.get('select'), '*')
      reads++
      if (options.readFailure) throw new TypeError('Failed to fetch')
      return Response.json(options.missing ? null : row)
    } },
  })
  sb.auth.getSession = async () => ({ data: { session: { user: { id: options.sessionActor ?? actor }, access_token: 'mock-session-token' } }, error: null }) as Awaited<ReturnType<typeof sb.auth.getSession>>
  sb.auth.getUser = async () => {
    confirmations++
    return { data: { user: options.auth === null ? null : { id: options.auth ?? actor } }, error: null } as Awaited<ReturnType<typeof sb.auth.getUser>>
  }
  const api = createSupabaseSalesApi(sb)
  return { api, counts: () => ({ writes, reads, confirmations }), save: () => api.addSalesActivity(id, opportunityId, '전화', request().body, actor) }
}

test('lost activity response confirms one same-ID read without sending another write', async () => {
  const s = network()
  await s.save()
  assert.deepEqual(s.counts(), { writes: 1, reads: 1, confirmations: 1 })
})
test('void success is confirmed directly; gateway failure requires readback', async () => {
  const success = network({ mode: 'success' })
  await success.save(); assert.deepEqual(success.counts(), { writes: 1, reads: 0, confirmations: 0 })
  const gateway = network({ mode: 'gateway' })
  await gateway.save(); assert.deepEqual(gateway.counts(), { writes: 1, reads: 1, confirmations: 1 })
})
test('explicit database, auth and validation rejection cannot be recovered as success', async () => {
  for (const [code, status] of [['42501', 403], ['PGRST301', 401], ['40001', 409], ['23514', 400], ['42883', 404], ['P0001', 500]] as const) {
    const s = network({ mode: 'reject', code, status })
    await assert.rejects(s.save(), /거부|준비/)
    assert.deepEqual(s.counts(), { writes: 1, reads: 0, confirmations: 0 })
  }
})
test('every activity identity field and normalized full content must match', async () => {
  for (const patch of [{ id: 'other' }, { opportunity_id: 'other' }, { kind: '메일' as const }, { body: '미팅 제안' }, { created_by: 'other' }]) {
    const s = network({ patch })
    await assert.rejects(s.save(), { name: 'SalesActivityUnconfirmedError' })
    assert.deepEqual(s.counts(), { writes: 1, reads: 1, confirmations: 1 })
  }
})
test('failed and missing readback remain uncertain and cannot resend automatically', async () => {
  for (const options of [{ missing: true }, { readFailure: true }]) {
    const s = network(options)
    await assert.rejects(s.save(), { name: 'SalesActivityUnconfirmedError' })
    assert.equal(s.counts().writes, 1)
    assert.equal(s.counts().reads, 1)
  }
})
test('a changed account cannot confirm or retry an earlier actor request', async () => {
  for (const auth of ['different', null]) {
    const s = network({ auth })
    await assert.rejects(s.save(), { name: 'SalesActivityUnconfirmedError' })
    assert.deepEqual(s.counts(), { writes: 1, reads: 0, confirmations: 1 })
  }
  const s = network({ sessionActor: 'different' })
  await assert.rejects(s.save(), /입력한 계정/)
  assert.deepEqual(s.counts(), { writes: 0, reads: 0, confirmations: 0 })
})
test('explicit status check performs only an authenticated same-ID read', async () => {
  for (const missing of [false, true]) {
    const s = network({ missing })
    assert.equal(await s.api.checkSalesActivity(id, opportunityId, '전화', request().body, actor), !missing)
    assert.deepEqual(s.counts(), { writes: 0, reads: 1, confirmations: 1 })
  }
})
test('status checks cannot turn a different activity into confirmation', async () => {
  await assert.rejects(checkSalesActivity({ read: async () => ({ ...activity(), body: '다른 내용' }), confirmActor: async () => actor }, request()), { name: 'SalesActivityUnconfirmedError' })
})
test('snapshot preserves SQL whitespace and is isolated from transport and caller edits', async () => {
  const r = request(), row = activity(r)
  await saveSalesActivityWithRecovery({
    async write(copy) { copy.body = '전송 코드 변경'; r.body = '나중 변경'; throw new TypeError('Failed to fetch') },
    async read() { return row }, async confirmActor() { return actor },
  }, r)
  assert.equal(row.body, '\t미팅 제안\n')
})
test('ordinary programming exceptions never cause speculative recovery reads', async () => {
  let reads = 0
  const error = new TypeError('Cannot read properties of undefined')
  await assert.rejects(saveSalesActivityWithRecovery({
    async write() { throw error }, async read() { reads++; return activity() }, async confirmActor() { return actor },
  }, request()), e => e === error)
  assert.equal(reads, 0)
})
test('project selection requires a currently returned matching division and client including null', () => {
  const projects = [{ id: 'ar', division: 'AR', client_id: 'client' }, { id: 'tw', division: 'TW', client_id: 'client' }, { id: 'self', division: 'AR', client_id: null }]
  assert.equal(validateSalesProject({ project_id: null, division: 'AR', client_id: null }, []), null)
  assert.equal(validateSalesProject({ project_id: 'ar', division: 'AR', client_id: 'client' }, projects), null)
  assert.equal(validateSalesProject({ project_id: 'self', division: 'AR', client_id: null }, projects), null)
  for (const project_id of ['tw', 'self']) assert.match(validateSalesProject({ project_id, division: 'AR', client_id: 'client' }, projects)!, /회사·거래처/)
  assert.match(validateSalesProject({ project_id: 'deleted', division: 'AR', client_id: 'client' }, projects)!, /확인하지 못했습니다/)
})
test('demo preserves SQL activity normalization and exact-ID retry identity', async () => {
  const values = new Map<string, string>()
  globalThis.localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as Storage
  values.set('wkly-sales-demo-v1', JSON.stringify({ items: [{ id: opportunityId, owner_id: actor }], activities: [] }))
  const api = createDemoSalesApi(() => ({ id: actor, role: 'member', active: true }))
  await api.addSalesActivity(id, opportunityId, '전화', request().body, actor)
  await api.addSalesActivity(id, opportunityId, '전화', request().body, actor)
  assert.equal((await api.listSalesActivities(opportunityId)).length, 1)
  assert.equal(await api.checkSalesActivity(id, opportunityId, '전화', request().body, actor), true)
  await assert.rejects(api.addSalesActivity(id, opportunityId, '전화', '다른 내용', actor), /다른 내용/)
})
