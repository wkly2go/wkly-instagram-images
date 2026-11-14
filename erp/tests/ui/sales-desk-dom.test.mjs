import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

test('a saved sales plan reopens with its assessment and read-only output for another team member', async () => {
  const dom = new JSDOM('<main id="test-root"></main>', { url: 'http://localhost/sales?new=1', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'Node', 'NodeFilter', 'EventTarget', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'StorageEvent', 'PopStateEvent', 'getComputedStyle']) {
    const value = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
  window.confirm = () => false
  window.scrollTo = () => {}
  HTMLElement.prototype.scrollTo = () => {}
  globalThis.fetch = async () => { throw new Error('Network disabled in sales DOM tests') }

  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false },
    logLevel: 'error',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  })
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { fireEvent, within } = require('@testing-library/dom')
  const user = require('@testing-library/user-event').default.setup({ document })
  const { act, createElement: el } = React
  const mountNode = document.getElementById('test-root')
  let root = createRoot(mountNode)
  try {
    const { api, AppProvider } = await server.ssrLoadModule('/src/lib/app.tsx')
    const { RouterProvider } = await server.ssrLoadModule('/src/lib/router.tsx')
    const { todayKey, addDays } = await server.ssrLoadModule('/src/lib/date.ts')
    const { readSalesPlan } = await server.ssrLoadModule('/src/lib/salesPlan.ts')
    const { default: Sales } = await server.ssrLoadModule('/src/pages/Sales.tsx')
    assert.equal(api.mode, 'demo')
    const screen = within(document.body)
    const click = button => act(async () => user.click(button))
    const type = (input, value) => act(async () => user.type(input, value))
    const render = async (email, profileId) => {
      await api.signIn(email, '')
      const profiles = await api.listProfiles()
      const me = profiles.find(profile => profile.id === profileId)
      assert.ok(me)
      await act(async () => root.render(el(RouterProvider, null, el(AppProvider, { me, profiles, version: 0, bump() {}, toast() {}, openQuick() {} }, el(Sales)))))
    }

    await render('admin@thewklyn.com', '00000000-0000-4000-8000-000000000001')
    const editor = within(screen.getByRole('region', { name: '새 영업 기회', exact: true }))
    const sheet = within(editor.getByRole('region', { name: '수주 검토와 실행 계획', exact: true }))
    const today = todayKey()
    const launch = addDays(today, 20)
    const decision = addDays(today, 7)
    assert.ok(sheet.getByText('팝업 오픈 목표일이 미정입니다.'))
    await type(editor.getByLabelText('영업 건 이름 *'), '수주 실행 검증')
    await type(sheet.getByLabelText('브랜드·발주기관'), '테스트 브랜드')
    await click(sheet.getByRole('button', { name: '설계·시공', exact: true }))
    await type(sheet.getByLabelText('문의처·결정권자'), '공식 제휴 문의')
    await type(sheet.getByLabelText('영업 계기·고객 요구'), '팝업 출시')
    await type(sheet.getByLabelText('확인 근거'), '브랜드 공개 일정 확인')
    await act(async () => user.selectOptions(sheet.getByLabelText('대행 발주 상태'), '일부 미발주'))
    await act(async () => fireEvent.change(sheet.getByLabelText('오픈·행사 예정일'), { target: { value: launch } }))
    await act(async () => fireEvent.change(sheet.getByLabelText('대행사 선정 예정일'), { target: { value: addDays(launch, 1) } }))
    assert.match(sheet.getByRole('alert').textContent, /오픈 목표일 이후/)
    assert.equal(sheet.getByLabelText('브랜드·발주기관').value, '테스트 브랜드')
    await act(async () => fireEvent.change(sheet.getByLabelText('대행사 선정 예정일'), { target: { value: decision } }))
    assert.equal(sheet.getByRole('status').textContent, '검토 우선')
    assert.equal(editor.getByLabelText('다음 행동').value, '')
    await click(sheet.getByRole('button', { name: '권장 행동·연락일 적용', exact: true }))
    assert.equal(editor.getByLabelText('다음 연락일').value, today)
    await click(editor.getByRole('button', { name: '저장', exact: true }))

    const id = new URL(location.href).searchParams.get('id')
    assert.ok(id)
    const saved = await api.getSales(id)
    assert.equal(readSalesPlan(saved.description).plan.decisionDate, decision)
    assert.equal(readSalesPlan(saved.description).plan.scope, '설계·시공')
    assert.equal(saved.next_date, today)

    await act(async () => root.unmount())
    root = createRoot(mountNode)
    await render('haneul@thewklyn.com', '00000000-0000-4000-8000-000000000002')
    const detail = within(screen.getByRole('region', { name: '수주 실행 검증', exact: true }))
    const plan = within(detail.getByRole('region', { name: '실행 계획', exact: true }))
    const preview = plan.getByLabelText('영업 실행 계획')
    assert.equal(preview.readOnly, true)
    assert.equal(preview.closest('details').open, true)
    assert.match(preview.value, /수행 범위 · 설계·시공/)
    assert.ok(preview.value.includes(decision))
    assert.equal(detail.queryByRole('button', { name: '영업 정보 수정' }), null)
    assert.equal(plan.queryByRole('button', { name: /권장 행동.*적용/ }), null)
    await click(plan.getByRole('button', { name: '계획 복사', exact: true }))
    assert.equal(await navigator.clipboard.readText(), preview.value)
    const salesUrl = location.href
    let openCalls = 0
    window.open = () => { openCalls++; return null }
    window.print = () => { throw new Error('Print unavailable') }
    await click(plan.getByRole('button', { name: '인쇄·PDF 저장', exact: true }))
    assert.equal(document.activeElement, preview)
    assert.equal(preview.selectionStart, 0)
    assert.equal(preview.selectionEnd, preview.value.length)
    assert.equal(document.body.querySelector(':scope > pre.sales-plan-print'), null)
    assert.ok(!document.body.classList.contains('sales-plan-printing'))

    let printCalls = 0
    let printedText
    let printingClass
    window.print = () => {
      printCalls++
      printedText = document.body.querySelector(':scope > pre.sales-plan-print')?.textContent
      printingClass = document.body.classList.contains('sales-plan-printing')
      window.dispatchEvent(new Event('afterprint'))
    }
    await click(plan.getByRole('button', { name: '인쇄·PDF 저장', exact: true }))
    assert.equal(printCalls, 1)
    assert.equal(openCalls, 0)
    assert.equal(printingClass, true)
    assert.equal(printedText, preview.value)
    assert.equal(location.href, salesUrl)
    assert.equal(document.body.querySelector(':scope > pre.sales-plan-print'), null)
    assert.ok(!document.body.classList.contains('sales-plan-printing'))

    await click(detail.getByRole('button', { name: '닫기', exact: true }))
    assert.equal(document.activeElement, screen.getByRole('button', { name: '+ 영업 기회', exact: true }))
    const row = screen.getByRole('button', { name: /수주 실행 검증/ })
    await click(row)
    const reopened = screen.getByRole('region', { name: '수주 실행 검증', exact: true })
    assert.equal(document.activeElement, reopened)
    await click(within(reopened).getByRole('button', { name: '닫기', exact: true }))
    assert.equal(document.activeElement, row)
  } finally {
    await act(async () => root.unmount())
    await server.close()
    dom.window.close()
  }
})
