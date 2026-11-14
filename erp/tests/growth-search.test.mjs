import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const temp = await mkdtemp(join(here, '.growth-search-'))
await build({ entryPoints: ['growthApi', 'growthSearch'].map(name => join(here, '../src/lib/' + name + '.ts')), outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseGrowthApi, createDemoGrowthApi } = await import(pathToFileURL(join(temp, 'growthApi.mjs')).href)
const { growthSearchFilter, matchesGrowthSearch } = await import(pathToFileURL(join(temp, 'growthSearch.mjs')).href)
const db = new PGlite()
await db.exec('create table search_items(id integer primary key,title text,document jsonb)')
const originalStorage = globalThis.localStorage
after(async () => { globalThis.localStorage = originalStorage; await db.close(); await rm(temp, { recursive: true, force: true }) })

function fixture(response = []) {
  const calls = []
  const client = createClient('https://search.example.test', 'mock-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET' })
      return response instanceof Response ? response : new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } })
    } },
  })
  return { calls, api: createSupabaseGrowthApi(client) }
}

// Parse only the documented quoted OR form emitted by this feature. Actual
// Supabase SDK request construction is tested below; SQL matching uses PGlite.
// This is not a deployed PostgREST integration test.
function predicates(filter) {
  let rest = filter
  const parts = []
  while (rest) {
    const match = /^(title|document->>(?:email|instagram|brand|name|number|agency))\.imatch\.("((?:[^"\\]|\\.)*)")(,|$)/s.exec(rest)
    assert.ok(match, 'A search value must remain inside one quoted predicate: ' + rest)
    parts.push({ field: match[1], pattern: match[3].replace(/\\(.)/gs, '$1') })
    rest = rest.slice(match[0].length)
  }
  return parts
}

test('contact search keeps summary-only paging, kind/status filters and searches sender identifiers', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: String(i), title: '담당자 ' + i }))
  const f = fixture(rows)
  const result = await f.api.listGrowth({ kind: 'contact', page: 2, search: '  Brand@Example.COM  ', status: '제외' })
  assert.equal(result.items.length, 30)
  assert.equal(result.hasMore, true)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].method, 'GET')
  const q = f.calls[0].url.searchParams
  assert.equal(q.get('kind'), 'eq.contact')
  assert.equal(q.get('status'), 'eq.제외')
  assert.equal(q.get('offset'), '60')
  assert.equal(q.get('limit'), '31')
  assert.equal(q.get('order'), 'updated_at.desc,id.asc')
  assert.equal(q.get('select'), 'id,kind,title,owner_id,status,campaign_id,linked_sales_id,revision,created_at,updated_at,created_by,review_source:document->>source,review_segment:document->>segment')
  // Identifier fields may be searched on the server without downloading them.
  for (const field of ['email', 'instagram', 'brand', 'name', 'note', 'evidence', 'original', 'versions']) assert.ok(!q.get('select').includes('document->>' + field))
  assert.ok(!q.get('select').split(',').includes('document'))
  const parts = predicates(q.get('or').slice(1, -1))
  assert.deepEqual(parts.map(p => p.field), ['title', 'document->>email', 'document->>instagram', 'document->>brand', 'document->>name'])
  assert.ok(parts.every(p => p.pattern === 'Brand@Example\\.COM'))
})

test('tender search includes notice number and agency; content retains title search', async () => {
  const f = fixture()
  await f.api.listGrowth({ kind: 'tender', page: 0, search: 'R26-123', status: '' })
  await f.api.listGrowth({ kind: 'content', page: 0, search: '기획', status: '' })
  assert.deepEqual(predicates(f.calls[0].url.searchParams.get('or').slice(1, -1)).map(p => p.field), ['title', 'document->>number', 'document->>agency'])
  assert.deepEqual(predicates(f.calls[1].url.searchParams.get('or').slice(1, -1)).map(p => p.field), ['title'])
  assert.ok(f.calls.every(call => !call.url.searchParams.has('status')))
  const base = 'id,kind,title,owner_id,status,campaign_id,linked_sales_id,revision,created_at,updated_at,created_by'
  assert.equal(f.calls[0].url.searchParams.get('select'), base + ',review_deadline:document->>deadline,review_qualification:document->>qualification')
  assert.equal(f.calls[1].url.searchParams.get('select'), base)
})

test('PostgreSQL review projections extract only the selected JSON scalars and preserve missing values', async () => {
  await db.exec('truncate search_items')
  await db.query('insert into search_items values(1,$1,$2),(2,$3,$4)', ['테스트', JSON.stringify({ source: '받은 메일', segment: '미분류', deadline: '2026-11-20T18:00:00+09:00', qualification: '추가 확인', email: 'private@example.test', note: 'private evidence', evidence: 'private proof' }), '미확인', '{}'])
  const f = fixture()
  for (const kind of ['contact', 'tender']) {
    await f.api.listGrowth({ kind, page: 0, search: '', status: '' })
    const selected = f.calls.at(-1).url.searchParams.get('select').split(',').filter(field => field.startsWith('review_'))
    const projections = selected.map(field => {
      const match = /^(review_(?:source|segment|deadline|qualification)):document->>(source|segment|deadline|qualification)$/.exec(field)
      assert.ok(match, 'Only the fixed allowlisted JSON projection is translated to SQL')
      assert.equal(match[1], 'review_' + match[2])
      return `document->>'${match[2]}' as ${match[1]}`
    })
    assert.equal(projections.length, 2)
    const result = await db.query('select id,' + projections.join(',') + ' from search_items order by id')
    assert.deepEqual(result.rows[0], kind === 'contact' ? { id: 1, review_source: '받은 메일', review_segment: '미분류' } : { id: 1, review_deadline: '2026-11-20T18:00:00+09:00', review_qualification: '추가 확인' })
    assert.deepEqual(Object.values(result.rows[1]).slice(1), [null, null])
    assert.ok(!JSON.stringify(result.rows).includes('private'))
  }
})

test('empty search leaves the original list query unfiltered', async () => {
  const f = fixture()
  await f.api.listGrowth({ kind: 'contact', page: 0, search: ' \n ', status: '' })
  assert.equal(f.calls[0].url.searchParams.has('or'), false)
  assert.equal(growthSearchFilter('contact', ' \n '), null)
})

test('SDK encoding keeps comma, quote, slash and logic-looking text inside each search value', async () => {
  const term = 'a"),status.eq.확인,or(title.is.null)\\example+tag@example.com'
  const f = fixture()
  await f.api.listGrowth({ kind: 'contact', page: 0, search: term, status: '제외' })
  const q = f.calls[0].url.searchParams
  assert.equal(q.get('status'), 'eq.제외')
  assert.equal(q.get('kind'), 'eq.contact')
  assert.deepEqual([...q.keys()].sort(), ['kind', 'limit', 'offset', 'or', 'order', 'select', 'status'])
  const parts = predicates(q.get('or').slice(1, -1))
  assert.equal(parts.length, 5)
  assert.equal(new Set(parts.map(p => p.pattern)).size, 1)
})

test('PostgreSQL matching treats regex characters, percent, underscore and asterisks literally', async () => {
  const terms = ['50%_', '*', 'a.b+tag@example.com', '브랜드(서울)', '"one",two', 'a\\b', '[a-z]|.*', '^start$', '{1,3}?', 'line\nbreak', 'a"),status.eq.확인']
  for (const term of terms) {
    await db.exec('truncate search_items')
    await db.query('insert into search_items values(1,$1,$2),(2,$3,$4)', ['앞 ' + term + ' 뒤', '{}', 'unrelated 50xx abtag@examplexcom 서울 start', '{}'])
    const parts = predicates(growthSearchFilter('content', term))
    const result = await db.query('select id from search_items where title ~* $1 order by id', [parts[0].pattern])
    assert.deepEqual(result.rows.map(r => r.id), [1], term)
  }
})

test('PostgreSQL JSON fields find sender email or brand and notice number when title does not match', async () => {
  await db.exec('truncate search_items')
  await db.query('insert into search_items values(1,$1,$2),(2,$3,$4),(3,$5,$6)', [
    '김담당', JSON.stringify({ email: 'brand@example.com', instagram: 'brand_kr', brand: '서울 브랜드', name: '김정연' }),
    '행사 운영 대행', JSON.stringify({ number: 'R26BK00123-000', agency: '서울 문화재단' }),
    '제외 대상', '{}',
  ])
  for (const [kind, term, expected] of [['contact', 'BRAND@EXAMPLE', 1], ['contact', 'brand_kr', 1], ['contact', '서울 브랜드', 1], ['contact', '김정연', 1], ['tender', 'bk00123', 2], ['tender', '문화재단', 2]]) {
    const parts = predicates(growthSearchFilter(kind, term))
    const clauses = parts.map((part, i) => (part.field === 'title' ? 'title' : "document->>'" + part.field.split('->>')[1] + "'") + ' ~* $' + (i + 1))
    const result = await db.query('select id from search_items where ' + clauses.join(' or ') + ' order by id', parts.map(p => p.pattern))
    assert.deepEqual(result.rows.map(r => r.id), [expected], kind + ': ' + term)
  }
})

test('demo search uses the same fields and literal substring semantics, preserving status filtering', async () => {
  const items = [
    { id: 'a', kind: 'contact', title: '김담당', document: { email: 'Brand+tag@Example.com', instagram: 'brand_kr', brand: '서울 브랜드', name: '김정연' }, status: '제외', updated_at: '2026-11-12T00:00:00Z' },
    { id: 'b', kind: 'tender', title: '행사 운영', document: { number: 'R26-123', agency: '문화재단' }, status: '검토', updated_at: '2026-11-12T00:00:00Z' },
  ]
  globalThis.localStorage = { getItem: () => JSON.stringify(items) }
  const api = createDemoGrowthApi(() => ({ id: 'admin', active: true, role: 'admin' }), {})
  for (const term of ['brand+TAG', 'brand_kr', '서울 브랜드', '김정연', '김담당']) {
    const r = await api.listGrowth({ kind: 'contact', page: 0, search: term, status: '제외' })
    assert.deepEqual(r.items.map(x => x.id), ['a'])
    assert.equal('document' in r.items[0], false)
  }
  assert.equal((await api.listGrowth({ kind: 'contact', page: 0, search: 'brand', status: '확인' })).items.length, 0)
  assert.equal((await api.listGrowth({ kind: 'tender', page: 0, search: 'r26', status: '' })).items[0].id, 'b')
  assert.equal(matchesGrowthSearch(items[0], '.*'), false)
  assert.equal(matchesGrowthSearch(items[0], '%'), false)
})

test('permission and request errors remain visible rather than becoming an empty search', async () => {
  const f = fixture(new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
  await assert.rejects(f.api.listGrowth({ kind: 'contact', page: 0, search: 'brand', status: '' }), /permission denied/)
})
