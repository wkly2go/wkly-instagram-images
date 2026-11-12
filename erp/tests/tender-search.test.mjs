import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'

const here = dirname(fileURLToPath(import.meta.url)), temp = await mkdtemp(join(here, '.tender-search-'))
await build({ entryPoints: ['growthApi', 'tenderSearch'].map(name => join(here, '../src/lib/' + name + '.ts')), outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseGrowthApi, createDemoGrowthApi } = await import(pathToFileURL(join(temp, 'growthApi.mjs')).href)
const { defaultTenderQuery, validateTenderQuery, readTenderSearchResult, tenderCandidateDraft } = await import(pathToFileURL(join(temp, 'tenderSearch.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })
const query = () => ({ category: 'service', startDate: '2026-11-06', endDate: '2026-11-12', keyword: '전시', page: 1 })
const candidate = () => ({ title: '전시 기획', number: 'R26TEST', round: '000', agency: '검증 기관', deadline: '2026-11-20T17:00:00+09:00', amount: 10000, source_url: 'https://www.g2b.go.kr/notice', notice_date: '2026-11-12T09:00:00+09:00', warnings: [] })
const result = () => ({ items: [candidate()], total: 1, page: 1, hasMore: false, limited: false, omitted: 0 })
function fixture(response = Response.json(result())) {
  const calls = []
  const sb = createClient('https://tender.example.test', 'mock-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: 'Bearer mock-session' }, fetch: async (input, init) => { calls.push({ url: String(input), init }); return response } },
  })
  return { api: createSupabaseGrowthApi(sb), calls }
}
test('default tender dates use Korean calendar dates across a UTC day boundary', () => {
  const q = defaultTenderQuery(new Date('2026-11-11T16:00:00Z'))
  assert.equal(q.startDate, '2026-11-06'); assert.equal(q.endDate, '2026-11-12'); assert.equal(q.page, 1)
  assert.equal(validateTenderQuery(q), null)
})
test('tender UI validation stops invalid calendars and over-seven-day ranges before any server query', async () => {
  const { api, calls } = fixture()
  for (const value of [{ ...query(), endDate: '2026-11-13' }, { ...query(), startDate: '2026-02-30', endDate: '2026-03-01' }, { ...query(), page: 21 }, { ...query(), keyword: 'x'.repeat(101) }]) await assert.rejects(api.searchTenders(value))
  assert.equal(calls.length, 0)
})
test('tender SDK invokes only the read-only Edge function and keeps the session header', async () => {
  const { api, calls } = fixture()
  assert.deepEqual(await api.searchTenders(query()), result())
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://tender.example.test/functions/v1/g2b-search')
  assert.deepEqual(JSON.parse(calls[0].init.body), query())
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer mock-session')
  assert.doesNotMatch(calls[0].init.body, /serviceKey|DATA_GO_KR_SERVICE_KEY/)
})
test('tender server setup errors are shown, and malformed result shapes are rejected', async () => {
  const a = fixture(Response.json({ error: '나라장터 API 연결 설정 전입니다.' }, { status: 503 }))
  await assert.rejects(a.api.searchTenders(query()), /연결 설정 전/)
  for (const invalid of [{}, { ...result(), total: 20 }, { ...result(), items: [{ ...candidate(), source_url: 'javascript:alert(1)' }] }, { ...result(), items: [{ ...candidate(), source_url: 'https://g2b.go.kr.attacker.test/' }] }, { ...result(), items: [{ ...candidate(), deadline: '2026-11-20 17:00' }] }, { ...result(), items: [{ ...candidate(), amount: NaN }] }, { ...result(), hasMore: true }]) assert.throws(() => readTenderSearchResult(invalid), /응답/)
})
test('tender selection prepares an unapproved draft without saving, changing ownership or losing metadata', () => {
  const item = candidate(); item.warnings = ['원문 확인 필요']
  const draft = tenderCandidateDraft(item, 'current-member', 'service')
  assert.equal(draft.kind, 'tender'); assert.equal(draft.owner_id, 'current-member'); assert.equal(draft.status, '검토')
  assert.equal(draft.document.number, 'R26TEST'); assert.equal(draft.document.round, '000')
  assert.equal(draft.document.qualification, '추가 확인'); assert.equal(draft.document.evidence, '')
  assert.equal(draft.document.deadline, item.deadline); assert.equal(draft.campaign_id, null)
  assert.equal('id' in draft, false); assert.match(draft.document.note, /추정가격/); assert.match(draft.document.note, /원문 확인 필요/)
})
test('tender demo refuses actual external lookup rather than pretending to connect', async () => {
  const api = createDemoGrowthApi(() => ({ id: 'member', role: 'member', active: true }), {})
  await assert.rejects(api.searchTenders(query()), /체험 모드에서는 실제 나라장터 공고를 조회하지 않습니다/)
})
