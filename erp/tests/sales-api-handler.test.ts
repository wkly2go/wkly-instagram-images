import assert from 'node:assert/strict'
import test from 'node:test'
import { createSalesLookupHandler } from '../supabase/functions/sales-api/handler.ts'

const request = (body: unknown, auth = true) => new Request('https://example.test/sales-api', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: auth ? { Authorization: 'Bearer mock' } : {},
})
const privateKey = 'test-secret-not-a-real-key'

test('status returns registered names as booleans, never credentials or an upstream request', async () => {
  const handler = createSalesLookupHandler({
    configured: true,
    authenticate: async () => ({ id: 'member', active: true }),
    secret: name => name === 'BIZINFO_API_KEY' ? privateKey : undefined,
    fetch: async () => { throw new Error('unexpected fetch') },
  })
  assert.equal((await handler(request({ action: 'status' }, false))).status, 401)
  const result = await handler(request({ action: 'status' }))
  const raw = await result.text()
  assert.equal(result.status, 200)
  assert(!raw.includes(privateKey))
  assert.equal(JSON.parse(raw).configured.bizinfo, true)
  assert.equal(JSON.parse(raw).configured.kakao, false)
})

test('public sample lookup sends no private credentials, even if configured', async () => {
  const handler = createSalesLookupHandler({
    configured: true,
    authenticate: async () => ({ id: 'member', active: true }),
    secret: () => privateKey,
    fetch: async (input, options) => {
      assert.equal(String(input), 'http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/')
      assert.equal(new Headers(options?.headers).get('Authorization'), null)
      return Response.json({ culturalEventInfo: { RESULT: { CODE: 'INFO-000' }, row: [{ TITLE: '공개 테스트 행사' }] } })
    },
  })
  const result = await handler(request({ action: 'search', source: 'seoulEvents', params: { sample: true } }))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).rows[0].title, '공개 테스트 행사')
})

test('a failed transport does not send the upstream URL or secret to the browser', async () => {
  const handler = createSalesLookupHandler({
    configured: true,
    authenticate: async () => ({ id: 'member', active: true }),
    secret: () => privateKey,
    fetch: async (input, options) => {
      assert.equal(options?.redirect, 'error')
      throw new Error(String(input))
    },
  })
  const result = await handler(request({ action: 'search', source: 'bizinfo', params: {} }))
  assert.equal(result.status, 502)
  assert(!(await result.text()).includes(privateKey))
})
