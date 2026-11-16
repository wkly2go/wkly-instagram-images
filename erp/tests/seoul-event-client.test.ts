import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSeoulEvents, parseSeoulEventSnapshot } from '../src/lib/seoulEventClient.ts'

const event = {
  id: 'not-authoritative', title: '문화행사', district: '중구', category: '전시', organization: '공식 기관',
  venue: '공연장', start: '2026-11-15', end: '2026-11-20',
  url: 'http://culture.seoul.go.kr/culture/cultureEvent/view.do?cultcode=123',
}
const snapshot = () => ({ events: [event], fetchedAt: '2026-11-14T02:00:00Z', total: 1000, scanned: 1, limited: true })

test('client normalizes official source links and makes incomplete coverage explicit', () => {
  const result = parseSeoulEventSnapshot({ ...snapshot(), limited: false })
  assert.equal(result.limited, true)
  assert.equal(result.events[0].id, '123')
  assert.match(result.events[0].url, /^https:\/\/culture\.seoul\.go\.kr\//)
  const untrusted = parseSeoulEventSnapshot({ ...snapshot(), events: [{ ...event, url: 'https://example.test/view', start: '2026-02-31' }] })
  assert.equal(untrusted.events[0].url, '')
  assert.equal(untrusted.events[0].start, '')
})

test('empty valid snapshot works; malformed event or inconsistent metadata is rejected', () => {
  assert.deepEqual(parseSeoulEventSnapshot({ events: [], fetchedAt: '2026-11-14T00:00:00Z', total: 0, scanned: 0, limited: false }).events, [])
  for (const bad of [null, {}, { ...snapshot(), total: 0 }, { ...snapshot(), scanned: -1 }, { ...snapshot(), fetchedAt: '' },
    { ...snapshot(), events: [{ ...event, title: '' }] }, { ...snapshot(), events: [{ ...event, url: { malicious: true } }] }]) {
    assert.throws(() => parseSeoulEventSnapshot(bad), /응답을 확인하지 못했습니다/)
  }
})

test('client fetches same-origin endpoint with the caller abort signal and exposes no raw error', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  const calls: [unknown, unknown][] = []
  try {
    globalThis.fetch = async (url, init) => {
      calls.push([url, init])
      return new Response(JSON.stringify(snapshot()), { headers: { 'Content-Type': 'application/json' } })
    }
    await fetchSeoulEvents(controller.signal)
    assert.equal(calls[0][0], '/api/seoul-events')
    assert.equal((calls[0][1] as RequestInit).signal, controller.signal)
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'raw upstream secret' }), { status: 502 })
    await assert.rejects(fetchSeoulEvents(controller.signal), error => error instanceof Error && /CSV/.test(error.message) && !error.message.includes('secret'))
    globalThis.fetch = async () => new Response('<html>Vite fallback</html>')
    await assert.rejects(fetchSeoulEvents(controller.signal), /응답을 확인하지 못했습니다/)
  } finally { globalThis.fetch = original }
})
