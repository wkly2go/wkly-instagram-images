import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { COMPANY_CONTEXT_PAGES, readSalesCompanyContext } from '../src/lib/salesCompanyContext.ts'

const clientId = '10000000-0000-4000-8000-000000000001'
function remote(options: { missing?: boolean; fail?: string; missingCount?: string } = {}) {
  const calls: { url: URL; headers: Headers }[] = []
  const sb = createClient('https://company.example.test', 'mock-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1)
      calls.push({ url, headers: new Headers(init?.headers) })
      if (table === 'clients') return Response.json(options.missing ? null : { id: clientId, name: '동일 회사', memo: '저장 메모' })
      if (table === options.fail) return Response.json({ code: '42501', message: '자료 조회 권한을 확인해 주세요.' }, { status: 403 })
      return Response.json([{ id: table, client_id: clientId }], { headers: table === options.missingCount ? {} : { 'content-range': '10-10/21' } })
    } },
  })
  return { sb, calls }
}

test('company context uses explicit client links, exact counts and independent stable pagination', async () => {
  const { sb, calls } = remote()
  const result = await readSalesCompanyContext(sb, clientId, { contacts: 1, research: 2, sales: 3, projects: 4 })
  assert.equal(calls.length, 5)
  assert.equal(calls[0].url.searchParams.get('id'), `eq.${clientId}`)
  assert.equal(result?.company.memo, '저장 메모')
  const indexes = { contacts: 1, research_items: 2, sales_opportunities: 3, projects: 4 }
  for (const { url, headers } of calls.slice(1)) {
    const table = url.pathname.split('/').at(-1) as keyof typeof indexes, q = url.searchParams
    assert.equal(q.get('client_id'), `eq.${clientId}`)
    assert.equal(q.get('offset'), String(indexes[table] * 10))
    assert.equal(q.get('limit'), '10')
    assert.equal(q.get('order'), `${table === 'contacts' ? 'is_primary' : 'updated_at'}.desc,id.asc`)
    assert.match(headers.get('prefer') ?? '', /count=exact/)
    assert.ok(!q.get('select')?.includes('*'))
    assert.equal(q.get('or'), null)
  }
  assert.ok(!calls.find(c => c.url.pathname.endsWith('research_items'))?.url.searchParams.get('select')?.includes('body'))
  for (const key of Object.keys(COMPANY_CONTEXT_PAGES) as (keyof typeof COMPANY_CONTEXT_PAGES)[]) {
    assert.equal(result?.[key].total, 21)
    assert.equal(result?.[key].error, null)
  }
})

test('unlinked or inaccessible companies never trigger a broad related-record query', async () => {
  const { sb, calls } = remote({ missing: true })
  for (const value of ['', 'company name', `${clientId},id.not.is.null`]) {
    await assert.rejects(readSalesCompanyContext(sb, value, COMPANY_CONTEXT_PAGES), /연결된 거래처/)
  }
  for (const index of [-1, 0.5, NaN, Infinity, 100001]) {
    await assert.rejects(readSalesCompanyContext(sb, clientId, { ...COMPANY_CONTEXT_PAGES, research: index }), /페이지/)
  }
  assert.equal(calls.length, 0)
  assert.equal(await readSalesCompanyContext(sb, clientId, COMPANY_CONTEXT_PAGES), null)
  assert.equal(calls.length, 1)
})

test('a failed category stays explicit while successfully read company records remain available', async () => {
  const { sb } = remote({ fail: 'research_items', missingCount: 'projects' })
  const result = await readSalesCompanyContext(sb, clientId, COMPANY_CONTEXT_PAGES)
  assert.match(result?.research.error ?? '', /조회 권한/)
  assert.equal(result?.research.total, null)
  assert.match(result?.projects.error ?? '', /자료 건수/)
  assert.equal(result?.projects.total, null)
  assert.equal(result?.contacts.items.length, 1)
  assert.equal(result?.sales.total, 21)
})
