import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { searchDemoProspectingClients, searchSupabaseProspectingClients } from '../src/lib/prospectingClientSearch.ts'
import type { Client, Contact } from '../src/lib/types.ts'

const company = {
  id: 'company-1', name: '브랜드(서울) %_*', category: '클라이언트', website: 'https://example.com/',
  email: 'private-client@example.com', phone: '12345678', memo: 'private memo',
} as Client
const contact = {
  id: 'contact-1', client_id: company.id, name: '김담당', title: '제휴·VMD',
  email: 'private-contact@example.com', phone: '12345678', memo: 'private memo',
} as Contact

test('demo search matches literal company and contact name or role and projects only the bounded result', () => {
  const companies = [company, { ...company, id: 'company-2', name: '다른 브랜드', website: 'javascript:alert(1)' }]
  const people = [contact, { ...contact, id: 'contact-2', client_id: 'outside' }]
  assert.deepEqual(searchDemoProspectingClients(companies, people, ' (서울) %_* '), [
    { clientId: company.id, clientName: company.name, category: company.category, website: company.website },
  ])
  const expected = [{ clientId: company.id, clientName: company.name, category: company.category, website: company.website, contactId: contact.id, contactName: contact.name, contactTitle: contact.title }]
  assert.deepEqual(searchDemoProspectingClients(companies, people, 'vmd'), expected)
  assert.deepEqual(searchDemoProspectingClients(companies, people, '김담당'), expected)
  assert.deepEqual(searchDemoProspectingClients(companies, people, '다른 브랜드'), [
    { clientId: 'company-2', clientName: '다른 브랜드', category: company.category },
  ])
  assert.deepEqual(searchDemoProspectingClients(companies, people, '.*'), [])
  assert.deepEqual(searchDemoProspectingClients(companies, people, 'private-contact'), [])
  assert.throws(() => searchDemoProspectingClients(companies, people, ' \n '), /1~100자/)
})

test('Supabase transport makes exactly two read-only bounded requests with allowlisted columns and literal search', async () => {
  const requests: { url: URL; method: string | undefined }[] = []
  const client = createClient('https://prospects.example.test', 'mock-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      requests.push({ url, method: init?.method })
      const rows = url.pathname.endsWith('/clients') ? [company] : [{ ...contact, client: company }]
      return Response.json(Array.from({ length: 9 }, () => rows[0]))
    } },
  })
  const term = '서울(팝업) %, "용역" \\ .*'
  const results = await searchSupabaseProspectingClients(client, term)
  assert.equal(requests.length, 2)
  assert.equal(results.length, 16)
  assert.equal(results.at(-1)?.contactTitle, '제휴·VMD')
  assert.doesNotMatch(JSON.stringify(results), /private-|12345678|private memo/)

  for (const { url, method } of requests) {
    assert.equal(method, 'GET')
    const clients = url.pathname.endsWith('/clients')
    assert.equal(url.searchParams.get('select'), clients ? 'id,name,category,website' : 'id,name,title,client:clients!inner(id,name,category,website)')
    assert.equal(url.searchParams.get('limit'), '8')
    assert.equal(url.searchParams.get('order'), 'name.asc,id.asc')
    const filter = url.searchParams.get('or')!
    const clauses = [...filter.matchAll(/(name|title)\.imatch\."((?:[^"\\]|\\.)*)"/g)]
    assert.deepEqual(clauses.map(([, field]) => field), clients ? ['name'] : ['name', 'title'])
    assert.equal(filter, '(' + clauses.map(match => match[0]).join(',') + ')')
    for (const [, , encoded] of clauses) {
      const pattern = encoded.replace(/\\(.)/g, '$1')
      assert.ok(new RegExp(pattern, 'i').test(term))
      assert.ok(!new RegExp(pattern, 'i').test('서울 팝업 용역'))
    }
  }
  await assert.rejects(searchSupabaseProspectingClients(client, 'x'.repeat(101)), /1~100자/)
  assert.equal(requests.length, 2)
})

test('a failed internal response rejects the source without returning a misleading empty search', async () => {
  const client = createClient('https://prospects.example.test', 'mock-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => String(input).includes('/contacts?')
      ? Response.json({ message: 'production diagnostic from backend' }, { status: 403 }) : Response.json([company]) },
  })
  await assert.rejects(searchSupabaseProspectingClients(client, '브랜드'), {
    message: '기존 거래처·담당자를 조회하지 못했습니다. 다시 조회해 주세요.',
  })
})
