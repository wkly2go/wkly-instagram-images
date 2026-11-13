import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { newSalesDraft, type SalesOpportunity } from '../src/lib/sales.ts'

const here = dirname(fileURLToPath(import.meta.url))
const temp = await mkdtemp(join(here, '.sales-filter-'))
await build({ entryPoints: [join(here, '../src/lib/salesApi.ts')], outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseSalesApi, createDemoSalesApi } = await import(pathToFileURL(join(temp, 'salesApi.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })

function remote() {
  const calls: URL[] = []
  const sb = createClient('https://sales.example.test', 'mock-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => { calls.push(new URL(String(input))); return Response.json([]) } },
  })
  return { api: createSupabaseSalesApi(sb), calls }
}
function row(index: number, source: SalesOpportunity['source']): SalesOpportunity {
  return { ...newSalesDraft('member'), title: '행사 홍보', id: String(index).padStart(3, '0'), source, stage: '제안', next_action: '원문 확인', next_date: '2026-11-14', revision: 1, created_by: 'member', updated_by: 'member', created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z' }
}
function demo(items: SalesOpportunity[]) {
  const stored = JSON.stringify({ items, activities: [] })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored } })
  return createDemoSalesApi(() => ({ id: 'member', role: 'member', active: true }))
}

test('public procurement source is sent to PostgREST together with other filters and pagination', async () => {
  const { api, calls } = remote()
  await api.listSales({ page: 1, source: '나라장터', stage: '제안', division: 'TW', search: '홍보', dueBefore: '2026-11-14' })
  const q = calls[0].searchParams
  assert.equal(q.get('source'), 'eq.나라장터')
  assert.equal(q.get('division'), 'eq.TW')
  assert.deepEqual(q.getAll('stage'), ['eq.제안', 'not.in.(수주,실주,보류)'])
  assert.equal(q.get('title'), 'ilike.%홍보%')
  assert.equal(q.get('next_date'), 'lte.2026-11-14')
  assert.equal(q.get('offset'), '30')
  assert.equal(q.get('limit'), '31')
})
test('demo filters source before slicing pages and preserves private opportunities', async () => {
  const rows = Array.from({ length: 70 }, (_, i) => row(i, i % 2 ? '나라장터' : '직접 발굴'))
  const snapshot = JSON.stringify(rows)
  const api = demo(rows)
  const first = await api.listSales({ page: 0, source: '나라장터' })
  const second = await api.listSales({ page: 1, source: '나라장터' })
  assert.equal(first.items.length, 30); assert.equal(first.hasMore, true)
  assert.equal(second.items.length, 5); assert.equal(second.hasMore, false)
  assert.ok([...first.items, ...second.items].every((x: SalesOpportunity) => x.source === '나라장터'))
  assert.equal(new Set([...first.items, ...second.items].map((x: SalesOpportunity) => x.id)).size, 35)
  assert.equal((await api.listSales({ page: 0, source: '직접 발굴' })).items.length, 30)
  assert.equal(JSON.stringify(rows), snapshot)
})
test('empty source keeps all sources while source still combines with other demo filters', async () => {
  const api = demo([row(1, '나라장터'), { ...row(2, '나라장터'), division: 'AR' }, { ...row(3, '나라장터'), stage: '수주' }, row(4, '광고')])
  assert.equal((await api.listSales({ page: 0, source: '' })).items.length, 4)
  assert.deepEqual((await api.listSales({ page: 0, source: '나라장터', division: 'TW', stage: '제안', dueBefore: '2026-11-14', search: '홍보' })).items.map((x: SalesOpportunity) => x.id), ['001'])
})
test('unknown sources fail visibly before querying instead of showing unfiltered results', async () => {
  const { api, calls } = remote()
  const local = demo([row(1, '나라장터')])
  for (const source of ['잘못된 경로', null, false]) {
    await assert.rejects(api.listSales({ page: 0, source }), /유입 경로 검색 조건/)
    await assert.rejects(local.listSales({ page: 0, source }), /유입 경로 검색 조건/)
  }
  assert.equal(calls.length, 0)
})
