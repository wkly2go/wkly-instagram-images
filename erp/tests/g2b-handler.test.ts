import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createG2bHandler, g2bRequestUrl, parseG2bResult, validateG2bQuery, type G2bDependencies, type G2bQuery } from '../supabase/functions/g2b-search/handler.ts'

const query = (patch: Partial<G2bQuery> = {}): G2bQuery => ({ category: 'service', startDate: '2026-11-06', endDate: '2026-11-12', keyword: '전시 기획', page: 1, ...patch })
const row = (patch = {}) => ({ bidNtceNo: 'R26TEST001', bidNtceOrd: '000', bidNtceNm: '전시 기획 공고', dminsttNm: '검증 기관', ntceInsttNm: '공고 기관', bidClseDt: '2026-11-20 17:00:00', presmptPrce: '12340000.00', bidNtceDtlUrl: 'https://www.g2b.go.kr/test?bid=R26TEST001', bidNtceDt: '2026-11-12 09:00:00', ...patch })
const payload = (items: unknown = [row()], total = 1, page = 1) => ({ response: { header: { resultCode: '00', resultMsg: '정상' }, body: { items, totalCount: total, pageNo: page, numOfRows: 30 } } })
const request = (body: unknown = query(), authorization = 'Bearer mock-token') => new Request('https://example.test/g2b-search', { method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(body) })
function setup(overrides: Partial<G2bDependencies> = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const handler = createG2bHandler({
    configured: true, serviceKey: 'test-only-key+/=', authenticate: async () => ({ id: 'active-member', active: true }),
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return Response.json(payload()) },
    ...overrides,
  })
  return { handler, calls }
}
test('G2B preflight and unsupported method do not authenticate or contact the provider', async () => {
  const { handler, calls } = setup({ authenticate: async () => { throw new Error('must not run') } })
  for (const [method, status] of [['OPTIONS', 200], ['GET', 405]] as const) assert.equal((await handler(new Request('https://example.test', { method }))).status, status)
  assert.equal(calls.length, 0)
})
test('G2B rejects missing sessions and inactive or missing profiles before the external call', async () => {
  const a = setup(); assert.equal((await a.handler(request(query(), ''))).status, 401); assert.equal(a.calls.length, 0)
  for (const user of [null, { id: 'former-member', active: false }]) {
    const { handler, calls } = setup({ authenticate: async () => user })
    assert.equal((await handler(request())).status, user ? 403 : 401); assert.equal(calls.length, 0)
  }
})
test('G2B missing server configuration and auth outages return controlled errors without secrets', async () => {
  for (const overrides of [{ configured: false }, { serviceKey: '' }, { authenticate: async () => { throw new Error('private credential') } }]) {
    const { handler, calls } = setup(overrides)
    const response = await handler(request())
    assert.equal(response.status, 503); assert.equal(calls.length, 0)
    assert.doesNotMatch(await response.text(), /private credential|mock-token|test-only-key/)
  }
})
test('G2B validates inclusive seven-day ranges, calendar dates, bounded pages and the allowed query keys', async () => {
  const invalid = [query({ endDate: '2026-11-13' }), query({ startDate: '2026-11-13' }), query({ startDate: '2026-02-30', endDate: '2026-03-01' }), query({ page: 0 }), query({ page: 21 }), query({ keyword: 'x'.repeat(101) }), query({ keyword: 'test\nquery' }), { ...query(), category: 'http://internal.test' }, { ...query(), serviceKey: 'client-key' }, { ...query(), url: 'https://attacker.test' }, null]
  for (const value of invalid) {
    const { handler, calls } = setup()
    assert.equal((await handler(request(value))).status, 400); assert.equal(calls.length, 0)
  }
  assert.equal(validateG2bQuery(query()).endDate, '2026-11-12')
})
test('G2B rejects invalid JSON and oversized input before contacting the provider', async () => {
  for (const raw of ['{', 'x'.repeat(5000)]) {
    const { handler, calls } = setup()
    assert.equal((await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer mock' }, body: raw }))).status, 400)
    assert.equal(calls.length, 0)
  }
})
test('G2B uses the verified v02 operation and encodes the server key exactly once with fixed limits', async () => {
  const { handler, calls } = setup(), response = await handler(request())
  assert.equal(response.status, 200); assert.equal(calls.length, 1)
  const sent = new URL(calls[0].url)
  assert.equal(sent.origin, 'https://apis.data.go.kr')
  assert.equal(sent.pathname, '/1230000/ad/BidPublicInfoService02/getBidPblancListInfoServcPPSSrch02')
  assert.equal(sent.searchParams.get('serviceKey'), 'test-only-key+/=')
  assert.equal(sent.searchParams.get('numOfRows'), '30'); assert.equal(sent.searchParams.get('inqryDiv'), '1')
  assert.equal(sent.searchParams.get('inqryBgnDt'), '202611060000'); assert.equal(sent.searchParams.get('inqryEndDt'), '202611122359')
  assert.equal(sent.searchParams.get('bidNtceNm'), '전시 기획'); assert.equal(sent.searchParams.get('type'), 'json')
  assert.equal(calls[0].init?.redirect, 'error'); assert.equal(calls[0].init?.method, 'GET')
  assert.ok(calls[0].init?.signal)
  assert.match(g2bRequestUrl(query({ category: 'construction' }), 'test').pathname, /CnstwkPPSSrch02$/)
})
test('G2B maps identifiers without losing leading zeros, Korean deadline and integer estimated price', () => {
  const result = parseG2bResult(payload(), query())
  assert.deepEqual(result.items, [{ title: '전시 기획 공고', number: 'R26TEST001', round: '000', agency: '검증 기관', deadline: '2026-11-20T17:00:00+09:00', amount: 12340000, source_url: 'https://www.g2b.go.kr/test?bid=R26TEST001', notice_date: '2026-11-12T09:00:00+09:00', warnings: [] }])
  assert.equal(result.total, 1); assert.equal(result.hasMore, false); assert.equal(result.omitted, 0)
})
test('G2B handles supported empty result envelopes and bounded pagination without claiming full collection', () => {
  for (const items of ['', [], { item: [] }]) assert.equal(parseG2bResult(payload(items, 0), query()).items.length, 0)
  const rows = Array.from({ length: 30 }, (_, i) => row({ bidNtceNo: `R26TEST${i}` }))
  const nested = parseG2bResult(payload({ item: rows }, 35), query())
  assert.equal(nested.items.length, 30); assert.equal(nested.hasMore, true)
  const limited = parseG2bResult(payload(rows, 1000, 20), query({ page: 20 }))
  assert.equal(limited.limited, true); assert.equal(limited.hasMore, false)
})
test('G2B omits incompatible and duplicate rows, warns on uncertain values and does not invent metadata', () => {
  const result = parseG2bResult(payload([row(), row(), { bidNtceNm: 'missing id' }, row({ bidNtceNo: 'R26TEST002', bidClseDt: '2026-02-30 17:00:00', presmptPrce: 'not-price', bidNtceDtlUrl: 'https://g2b.go.kr.attacker.test/' })], 4), query())
  assert.equal(result.omitted, 2); assert.equal(result.items.length, 2)
  assert.equal(result.items[1].deadline, ''); assert.equal(result.items[1].amount, null); assert.equal(result.items[1].source_url, '')
  assert.equal(result.items[1].warnings.length, 3)
  assert.throws(() => parseG2bResult(payload([{ title: 'changed upstream schema' }]), query()), /공고 필드/)
  assert.throws(() => parseG2bResult(payload([row()], 1, 2), query()), /페이지/)
  assert.throws(() => parseG2bResult(payload(Array.from({ length: 31 }, () => row()), 31), query()), /크기/)
})
test('G2B rejects response paging contradictions instead of hiding remaining tenders', () => {
  const mismatched = payload(Array.from({ length: 10 }, () => row()), 20)
  mismatched.response.body.numOfRows = 10
  assert.throws(() => parseG2bResult(mismatched, query()), /페이지/)
  assert.throws(() => parseG2bResult(payload([], 20), query()), /크기/)
  assert.throws(() => parseG2bResult(payload([row()], 20), query()), /크기/)
  assert.throws(() => parseG2bResult(payload([row()], 0), query()), /크기/)
})
test('G2B rows match the saved agency length and reject control characters in source links', () => {
  assert.throws(() => parseG2bResult(payload([row({ dminsttNm: '가'.repeat(201) })]), query()), /공고 필드/)
  for (const url of ['https://www.g2b.go.kr/a\nb', ' https://www.g2b.go.kr/', 'https://www.g2b.go.kr/a b', 'https://www.g2b.go.kr/?serviceKey=secret']) {
    const result = parseG2bResult(payload([row({ bidNtceDtlUrl: url })]), query())
    assert.equal(result.items[0].source_url, ''); assert.equal(result.items[0].warnings.length, 1)
  }
})
test('G2B provider permission and quota failures never echo provider messages or retry', async () => {
  for (const [code, status] of [['20', 503], ['30', 503], ['31', 503], ['22', 429], ['23', 429], ['99', 502]] as const) {
    let count = 0
    const { handler } = setup({ fetch: async () => { count++; return Response.json({ response: { header: { resultCode: code, resultMsg: 'test-only-key private details' } } }) } })
    const response = await handler(request()); assert.equal(response.status, status); assert.equal(count, 1)
    assert.doesNotMatch(await response.text(), /test-only-key|private details/)
  }
  const { handler } = setup({ fetch: async () => new Response('<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode><returnAuthMsg>secret</returnAuthMsg></OpenAPI_ServiceResponse>') })
  const response = await handler(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret/)
})
test('G2B rejects oversized or malformed provider bodies and never exposes a URL-bearing fetch error', async () => {
  for (const fetch of [async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)), async () => new Response('not-json'), async () => { throw new Error('https://apis.data.go.kr/?serviceKey=private-value') }]) {
    const { handler } = setup({ fetch })
    const response = await handler(request()); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /private-value|serviceKey/)
  }
})
test('G2B slows repeated per-user requests while allowing a later deliberate lookup', async () => {
  let time = 1000
  const { handler, calls } = setup({ now: () => time })
  assert.equal((await handler(request())).status, 200)
  assert.equal((await handler(request())).status, 429); assert.equal(calls.length, 1)
  time += 2000
  assert.equal((await handler(request())).status, 200); assert.equal(calls.length, 2)
})
