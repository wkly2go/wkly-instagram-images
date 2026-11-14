import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<main id="root"></main>', { url: 'http://localhost/sales?tab=seoul', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], writable: true, configurable: true })
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const { createRoot } = require('react-dom/client')
const { within } = require('@testing-library/dom')
const user = require('@testing-library/user-event').default.setup({ document })
const { act, createElement: el } = React
let server, Component, root
const originalFetch = globalThis.fetch
const screen = within(document.body)
const calls = []
const pending = []
const choice = []
const event = (title = '테스트 축제', district = '중구') => ({
  id: '101', title, district, category: '축제', organization: '주최기관', venue: '공연장',
  start: '2099-01-01', end: '2099-01-10', url: 'https://culture.seoul.go.kr/culture/cultureEvent/view.do?cultcode=101',
})
const snapshot = (events = [event()]) => ({ events, fetchedAt: '2026-11-14T00:00:00Z', total: 19747, scanned: 1000, limited: true })
const respond = async (value, status = 200) => act(async () => pending.shift()(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })))
const click = async button => act(async () => user.click(button))

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), server: { middlewareMode: true, watch: null, hmr: false }, logLevel: 'error' })
  ;({ SeoulEventDiscovery: Component } = await server.ssrLoadModule('/src/components/SeoulEventDiscovery.tsx'))
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  calls.length = pending.length = choice.length = 0
  globalThis.fetch = originalFetch
})
after(async () => { await server.close(); dom.window.close() })
async function mount() {
  globalThis.fetch = (url, init) => {
    assert.equal(url, '/api/seoul-events', 'no external network is permitted')
    calls.push({ url, init })
    return new Promise(resolve => pending.push(resolve))
  }
  window.confirm = () => false
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(el(Component, { onEvent: item => choice.push(item) })))
}

test('mount loads once; explicit refresh keeps filters and chosen draft and retains previous data on failure', async () => {
  await mount()
  assert.equal(calls.length, 1)
  assert.equal(screen.getByRole('button', { name: '최신 행사 다시 불러오기' }).disabled, true)
  await respond(snapshot())
  assert.ok(screen.getByText('테스트 축제'))
  assert.match(screen.getByText(/원본 19,747건 중/).textContent, /1,000건 확인.*일부 범위/)
  await act(async () => user.type(screen.getByLabelText('행사·주최기관 검색'), '테스트'))
  await act(async () => user.selectOptions(screen.getByLabelText('자치구 필터'), '중구'))
  await click(screen.getByRole('button', { name: '협업 후보로 검토' }))
  assert.equal(choice.length, 1)
  await click(screen.getByRole('button', { name: '최신 행사 다시 불러오기' }))
  assert.equal(calls.length, 2)
  assert.ok(screen.getByText('테스트 축제'))
  await respond({ error: 'upstream failed' }, 502)
  assert.match(screen.getByRole('alert').textContent, /CSV/)
  assert.ok(screen.getByText('테스트 축제'))
  assert.equal(screen.getByLabelText('행사·주최기관 검색').value, '테스트')
  await click(screen.getByRole('button', { name: '최신 행사 다시 불러오기' }))
  await respond(snapshot([event('새 행사', '성동구')]))
  assert.equal(screen.getByLabelText('자치구 필터').value, '중구')
  assert.equal(screen.getByLabelText('행사·주최기관 검색').value, '테스트')
  assert.ok(screen.getByText(/조건에 맞는 행사가 없습니다/))
  assert.equal(choice.length, 1, 'refresh never replaces or resubmits a chosen sales draft')
  assert.equal(choice[0].title, '테스트 축제')
})

test('manual CSV cancels automatic lookup; its late response cannot overwrite the file or filters', async () => {
  await mount()
  const signal = calls[0].init.signal
  const csv = '공연/행사명,자치구,기관명,장소,시작일,종료일\n수동 후보,중구,기관,장소,2099-01-01,2099-01-10'
  const file = new window.File([csv], '수동.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(csv).buffer })
  await act(async () => user.upload(screen.getByLabelText('서울시 문화행사 CSV'), file))
  assert.equal(signal.aborted, true)
  assert.ok(screen.getByText('수동 후보'))
  await respond(snapshot())
  assert.ok(screen.getByText('수동 후보'))
  assert.equal(screen.queryByText('테스트 축제'), null)
  await click(screen.getByRole('button', { name: '최신 행사 다시 불러오기' }))
  assert.equal(calls.length, 1, 'declined replacement must not fetch')
  window.confirm = () => true
  await click(screen.getByRole('button', { name: '최신 행사 다시 불러오기' }))
  await respond(snapshot())
  assert.ok(screen.getByText('테스트 축제'))
  assert.equal(screen.queryByText('수동 후보'), null)
})

test('unmount aborts automatic fetch and ignores a server response arriving afterwards', async () => {
  await mount()
  const signal = calls[0].init.signal
  await act(async () => root.unmount())
  root = null
  assert.equal(signal.aborted, true)
  await respond(snapshot())
  assert.equal(document.getElementById('root').textContent, '')
  assert.equal(choice.length, 0)
})
