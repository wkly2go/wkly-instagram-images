import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGrowthAiHandler, type GrowthAiDependencies } from '../supabase/functions/growth-ai/handler.ts'

const body = () => ({ id: crypto.randomUUID(), task: 'write', model: 'standard', prompt: '확인된 사실로 초안 작성' })
const request = (data: unknown = body(), authorization = 'Bearer test-token') => new Request('https://example.test/growth-ai', { method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(data) })
function setup(overrides: Partial<GrowthAiDependencies> = {}) {
  const calls = { reserve: [] as Record<string, unknown>[], finish: [] as Record<string, unknown>[], fetch: [] as RequestInit[] }
  const deps: GrowthAiDependencies = {
    configured: true, apiKey: 'test-only-key', authenticate: async () => ({ id: 'member' }),
    reserve: async args => { calls.reserve.push(args); return { data: { execute: true, model_id: 'configured-model', input_rate: 2, output_rate: 10 }, error: null } },
    finish: async args => { calls.finish.push(args); return { error: null } },
    fetch: async (_url, init) => { calls.fetch.push(init!); return Response.json({ content: [{ type: 'text', text: '검수할 초안' }], usage: { input_tokens: 100, output_tokens: 20 } }) },
    ...overrides,
  }
  return { handler: createGrowthAiHandler(deps), calls }
}
test('unauthenticated or expired sessions cannot reserve money or call provider', async () => {
  const a = setup()
  assert.equal((await a.handler(request(body(), ''))).status, 401)
  assert.equal(a.calls.reserve.length, 0); assert.equal(a.calls.fetch.length, 0)
  const b = setup({ authenticate: async () => null })
  assert.equal((await b.handler(request())).status, 401); assert.equal(b.calls.reserve.length, 0)
})
test('missing configuration and authentication outages return controlled errors before any charge', async () => {
  for (const overrides of [{ configured: false }, { apiKey: undefined }, { authenticate: async () => { throw new Error('private backend details') } }]) {
    const { handler, calls } = setup(overrides)
    const r = await handler(request()); assert.equal(r.status, 503)
    assert.equal((await r.text()).includes('private backend'), false); assert.equal(calls.reserve.length, 0)
  }
})
test('invalid and excessive requests stop before reservation', async () => {
  const { handler, calls } = setup()
  for (const data of [{ ...body(), prompt: 'x'.repeat(6001) }, { ...body(), model: 'unauthorized' }, { ...body(), max_tokens: 99999 }]) assert.equal((await handler(request(data))).status, 400)
  assert.equal(calls.reserve.length, 0); assert.equal(calls.fetch.length, 0)
})
test('budget rejection returns its actionable message without provider call', async () => {
  const { handler, calls } = setup({ reserve: async () => ({ data: null, error: { message: 'AI 한도에 도달했습니다.' } }) })
  const r = await handler(request()); assert.equal(r.status, 400); assert.match((await r.json()).error, /한도/)
  assert.equal(calls.fetch.length, 0); assert.equal(calls.finish.length, 0)
})
test('successful request uses reserved model and rates, token cap, and settles actual usage once', async () => {
  const { handler, calls } = setup(), data = body(), r = await handler(request(data))
  assert.deepEqual(await r.json(), { text: '검수할 초안', cost: .0004, status: 'completed' })
  assert.equal(calls.reserve.length, 1); assert.equal(calls.reserve[0].p_user, 'member'); assert.match(String(calls.reserve[0].p_signature), /^[0-9a-f]{64}$/)
  assert.equal(calls.fetch.length, 1)
  const sent = JSON.parse(String(calls.fetch[0].body)); assert.equal(sent.model, 'configured-model'); assert.equal(sent.max_tokens, 1600); assert.equal(sent.tools, undefined)
  assert.deepEqual(calls.finish, [{ p_id: data.id, p_actual: .0004, p_output: '검수할 초안', p_uncertain: false }])
})
test('trusted planner output cap changes the request signature but cannot be overridden by the client', async () => {
  const data = body(), normal = setup(), planner = setup({ maxOutputTokens: 4096 })
  await normal.handler(request(data)); await planner.handler(request(data))
  assert.equal(JSON.parse(String(planner.calls.fetch[0].body)).max_tokens, 4096)
  assert.notEqual(normal.calls.reserve[0].p_signature, planner.calls.reserve[0].p_signature)
  assert.equal((await planner.handler(request({ ...data, maxOutputTokens: 99999 }))).status, 400)
  assert.equal(planner.calls.fetch.length, 1)
  assert.throws(() => setup({ maxOutputTokens: 12001 }), /output cap/)
})
test('incomplete structured output settles known usage once, reports failure and never retries', async () => {
  for (const stop_reason of ['max_tokens', 'model_context_window_exceeded', 'refusal', undefined]) {
    let fetched = 0
    const { handler, calls } = setup({ requireComplete: true, maxOutputTokens: 4096, fetch: async () => {
      fetched++
      return Response.json({ stop_reason, content: [{ type: 'text', text: '{"title":"partial' }], usage: { input_tokens: 100, output_tokens: 20 } })
    } })
    const response = await handler(request()), result = await response.json()
    assert.equal(response.status, 422); assert.match(result.error, /끝까지/); assert.equal(result.status, undefined)
    assert.equal(result.cost, .0004); assert.equal(fetched, 1); assert.equal(calls.finish.length, 1)
    assert.equal(calls.finish[0].p_uncertain, false)
  }
  const { handler } = setup({ requireComplete: true, fetch: async () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }) })
  assert.equal((await (await handler(request())).json()).status, 'completed')
})
test('completed and uncertain request IDs return stored status without another provider call', async () => {
  for (const status of ['completed', 'running', 'unknown', 'reconciled']) {
    const { handler, calls } = setup({ reserve: async () => ({ data: { execute: false, status, text: status === 'completed' ? '기존 결과' : '', cost: .01 }, error: null }) })
    assert.equal((await (await handler(request())).json()).status, status)
    assert.equal(calls.fetch.length, 0); assert.equal(calls.finish.length, 0)
  }
})
test('provider errors preserve reservation, never retry, and never expose provider body or key', async () => {
  let fetched = 0
  const { handler, calls } = setup({ fetch: async () => { fetched++; return new Response('private provider details', { status: 500 }) } })
  const r = await handler(request()), text = await r.text()
  assert.equal(r.status, 400); assert.equal(fetched, 1); assert.match(text, /예약 비용/); assert.doesNotMatch(text, /private provider|test-only-key/)
  assert.equal(calls.finish.length, 1); assert.equal(calls.finish[0].p_uncertain, true)
})
test('missing or invalid usage is never settled as zero', async () => {
  for (const usage of [undefined, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 3, output_tokens: 1.5 }]) {
    const { handler, calls } = setup({ fetch: async () => Response.json({ content: [], usage }) })
    assert.equal((await handler(request())).status, 400)
    assert.equal(calls.finish[0].p_actual, null); assert.equal(calls.finish[0].p_uncertain, true)
  }
})
test('settlement outage preserves request identity and attempts uncertainty recording without retrying AI', async () => {
  const finished: Record<string, unknown>[] = [], data = body()
  const { handler, calls } = setup({ finish: async args => { finished.push(args); throw new Error('database unavailable') } })
  assert.equal((await handler(request(data))).status, 400)
  assert.equal(calls.fetch.length, 1); assert.equal(finished.length, 2)
  assert.equal(finished[1].p_id, data.id); assert.equal(finished[1].p_uncertain, true)
})
test('reasoning effort is a trusted server setting sent with every request', async () => {
  const data = body(), normal = setup(), planner = setup({ maxOutputTokens: 12000, effort: 'medium' })
  await normal.handler(request(data)); await planner.handler(request(data))
  assert.deepEqual(JSON.parse(String(normal.calls.fetch[0].body)).output_config, { effort: 'low' })
  const sent = JSON.parse(String(planner.calls.fetch[0].body)); assert.deepEqual(sent.output_config, { effort: 'medium' }); assert.equal(sent.max_tokens, 12000)
  assert.throws(() => setup({ effort: 'max' as 'high' }), /effort/)
})
test('a longer request is accepted only where the server allows it', async () => {
  const long = { ...body(), prompt: '가'.repeat(8000) }, normal = setup(), planner = setup({ maxPromptChars: 9000 })
  assert.equal((await normal.handler(request(long))).status, 400); assert.equal(normal.calls.fetch.length, 0)
  assert.equal((await planner.handler(request(long))).status, 200); assert.equal(planner.calls.fetch.length, 1)
  assert.equal((await planner.handler(request({ ...body(), prompt: '가'.repeat(9001) }))).status, 400)
  assert.throws(() => setup({ maxPromptChars: 9001 }), /prompt cap/)
})
