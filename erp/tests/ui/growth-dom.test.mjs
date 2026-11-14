import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Real React components and events in jsdom, with the existing demo API.
// This verifies form/URL state, not browser layout, production roles or RLS.
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
let dom, server, React, act, createRoot, within, user, api, RouterProvider, AppProvider, Sales, Ads, Agents, normalizePath, CommandPalette, GrowthWorkspace, MeetingRecorder, MeetingStartUncertainError, root, originals

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/sales', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'Node', 'NodeFilter', 'EventTarget', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'StorageEvent', 'PopStateEvent', 'getComputedStyle']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof dom.window[key] === 'function' && key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key] })
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
  window.confirm = () => false
  window.scrollTo = () => {}
  HTMLElement.prototype.scrollTo = () => {}
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => { throw new Error('Microphone access disabled in DOM tests') },
    getDisplayMedia: async () => { throw new Error('Screen capture disabled in DOM tests') },
  } })
  globalThis.fetch = async () => { throw new Error('Network disabled in DOM integration tests') }
  process.env.VITE_SUPABASE_URL = ''
  process.env.VITE_SUPABASE_ANON_KEY = ''
  // Keep one module graph for a test run; background edits must not replace a
  // Context provider halfway through importing its consumers.
  server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), server: { middlewareMode: true, watch: null }, logLevel: 'error', define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' } })
  React = require('react')
  act = React.act
  ;({ createRoot } = require('react-dom/client'))
  ;({ within } = require('@testing-library/dom'))
  user = require('@testing-library/user-event').default.setup({ document })
  ;({ api, AppProvider } = await server.ssrLoadModule('/src/lib/app.tsx'))
  ;({ RouterProvider } = await server.ssrLoadModule('/src/lib/router.tsx'))
  ;({ default: Sales } = await server.ssrLoadModule('/src/pages/Sales.tsx'))
  ;({ default: Agents } = await server.ssrLoadModule('/src/pages/Agents.tsx'))
  ;({ normalizePath } = await server.ssrLoadModule('/src/lib/router.tsx'))
  ;({ default: Ads } = await server.ssrLoadModule('/src/pages/Ads.tsx'))
  ;({ CommandPalette } = await server.ssrLoadModule('/src/components/CommandPalette.tsx'))
  ;({ GrowthWorkspace } = await server.ssrLoadModule('/src/components/GrowthWorkspace.tsx'))
  ;({ MeetingRecorder } = await server.ssrLoadModule('/src/components/MeetingRecorder.tsx'))
  ;({ MeetingStartUncertainError } = await server.ssrLoadModule('/src/lib/meetingProgress.ts'))
  assert.equal(api.mode, 'demo')
  originals = { getGrowth: api.getGrowth, linkGrowthSales: api.linkGrowthSales, getSales: api.getSales, listSalesActivities: api.listSalesActivities, addSalesActivity: api.addSalesActivity, checkSalesActivity: api.checkSalesActivity, listProjects: api.listProjects, listSalesOrigins: api.listSalesOrigins, instagramContacts: api.instagramContacts, getAiState: api.getAiState, runGrowthAi: api.runGrowthAi, configureAi: api.configureAi, reconcileAi: api.reconcileAi, mode: api.mode, listAgentJobs: api.listAgentJobs, saveSales: api.saveSales, saveGrowth: api.saveGrowth, startMeetingMinutes: api.startMeetingMinutes, getMeetingRecording: api.getMeetingRecording, searchTenders: api.searchTenders }
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  if (api) Object.assign(api, originals)
  window.confirm = () => false
})
after(async () => { await server?.close(); dom?.window.close() })

async function mount(role, kind = 'sales', props = {}, initialUrl) {
  localStorage.removeItem('wkly-sales-demo-v1')
  localStorage.removeItem('wkly-growth-demo-v1')
  window.history.replaceState(null, '', initialUrl ?? (kind === 'sales' ? '/sales?campaign=retained' : kind === 'tender' ? '/tenders' : kind === 'ads' ? '/ads' : '/leads'))
  await api.signIn(role === 'admin' ? 'admin@thewklyn.com' : 'haneul@thewklyn.com', '')
  if (props.seedItems) localStorage.setItem('wkly-growth-demo-v1', JSON.stringify(props.seedItems))
  const profiles = await api.listProfiles(), me = profiles.find(p => p.id === (role === 'admin' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002'))
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RouterProvider, null,
    React.createElement(AppProvider, { me, profiles, version: 0, bump() {}, toast() {}, openQuick() {} },
      (kind === 'ads' || kind === 'agents') ? React.createElement(React.Fragment, null, React.createElement(kind === 'agents' ? Agents : Ads), React.createElement(CommandPalette)) :
        React.createElement(kind === 'sales' ? Sales : kind === 'meeting' ? MeetingRecorder : GrowthWorkspace, kind === 'sales' ? {} : kind === 'meeting' ? props : { kind })))))
  return within(document.body)
}
async function click(element) { await act(async () => user.click(element)) }
async function type(element, value) { await act(async () => { await user.clear(element); await user.type(element, value) }) }
function panel(name) {
  const screen = within(document.body)
  const label = { name, exact: true }
  return within(screen.queryByRole('dialog', label) ?? screen.getByRole('region', label))
}
function query(key) { return new URL(location.href).searchParams.get(key) }
function closeButton(view) { return view.getAllByRole('button', { name: '닫기', exact: true }).at(-1) }
async function openContactIntake(screen) { await click(screen.getByText('가져오기·수집 설정', { exact: true })) }

test('unified ads menu reaches every existing screen and preserves performance filters', async () => {
  const screen = await mount('member', 'ads', {}, '/ads?tab=overseas&period=30&platform=Meta&campaign=retained')
  const menu = within(screen.getByRole('navigation', { name: '광고 업무', exact: true }))
  assert.equal(menu.getByRole('button', { name: '리서치·검색', exact: true }).getAttribute('aria-current'), 'page')
  assert.equal(screen.getByRole('region', { name: '해외 사례', exact: true }) != null, true)
  const groups = [
    ['콘텐츠·배포', [['content', '콘텐츠·배포']]],
    ['캠페인 준비', [['studio', '캠페인 준비']]],
    ['소재 관리', [['creatives', '우리 소재']]],
    ['성과·보고서', [[null, '대시보드'], ['platform', '매체별 성과'], ['charts', '추이 그래프'], ['daily-table', '일별 수치'], ['daily', '일일 보고']]],
    ['리서치·검색', [['competitors', '경쟁사 분석'], ['overseas', '해외 사례'], ['seo', '검색 노출 (SEO · AEO · GEO)']]],
  ]
  for (const [name, tabs] of groups) {
    await click(menu.getByRole('button', { name, exact: true }))
    for (const [tab, label] of tabs) {
      if (tabs.length > 1) await click(within(screen.getByRole('navigation', { name: `${name} 상세 메뉴`, exact: true })).getByRole('button', { name: label, exact: true }))
      assert.equal(query('tab'), tab)
      assert.equal(query('period'), '30')
      assert.equal(query('platform'), 'Meta')
      assert.equal(query('campaign'), 'retained')
      assert.equal(screen.getByRole('region', { name: label, exact: true }) != null, true)
    }
  }
})

test('unified ads menu keeps unsaved content when a tab change is declined', async () => {
  const screen = await mount('admin', 'ads', {}, '/ads?tab=content&period=7&platform=Meta')
  await click(screen.getByRole('button', { name: '+ 콘텐츠 만들기', exact: true }))
  const editor = panel('새 콘텐츠·배포')
  await type(editor.getByLabelText('제목 *'), '보존할 인스타그램 초안')
  let confirmations = 0
  window.confirm = () => { confirmations++; return false }
  // The modal obscures the menu for pointer input; dispatching the navigation
  // event also verifies keyboard/programmatic tab changes respect the guard.
  const target = within(screen.getByRole('navigation', { name: '광고 업무', exact: true })).getByRole('button', { name: '성과·보고서', exact: true })
  await act(async () => target.click())
  assert.equal(confirmations, 1)
  assert.equal(query('tab'), 'content')
  assert.equal(editor.getByLabelText('제목 *').value, '보존할 인스타그램 초안')
  window.confirm = () => true
  await act(async () => target.click())
  assert.equal(query('tab'), null)
  assert.equal(query('period'), '7')
  assert.equal(query('platform'), 'Meta')
  assert.equal(screen.queryByRole('dialog', { name: '새 콘텐츠·배포', exact: true }), null)
})

test('channel names in global search lead to the same advertising workspace', async () => {
  const screen = await mount('member', 'ads', {}, '/ads?tab=content')
  await act(async () => user.keyboard('{Control>}k{/Control}'))
  const search = panel('전체 검색 · 빠른 이동')
  for (const channel of ['인스타그램', '블로그', '유튜브', '캠페인', '소재']) {
    await type(search.getByRole('textbox', { name: '전체 검색', exact: true }), channel)
    assert.equal(search.getAllByRole('option', { name: '광고·콘텐츠 메뉴', exact: true }).length, 1)
  }
  await click(search.getByRole('option', { name: '광고·콘텐츠 메뉴', exact: true }))
  assert.equal(location.pathname, '/ads')
  assert.equal(query('tab'), null)
  assert.equal(screen.queryByRole('dialog', { name: '전체 검색 · 빠른 이동', exact: true }), null)
})

test('a member can read every channel of another owner’s content without editing or saving', async () => {
  const { newGrowth } = await server.ssrLoadModule('/src/lib/growth.ts')
  const draft = newGrowth('content', '00000000-0000-4000-8000-000000000001')
  draft.title = '팀 공유 콘텐츠'; draft.document.original = '공유 원본 사실'
  draft.document.versions.forEach(v => { v.title = `${v.channel} 제목`; v.body = `${v.channel} 본문` })
  const row = { ...draft, id: crypto.randomUUID(), revision: 1, linked_sales_id: null, created_by: draft.owner_id, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z' }
  const screen = await mount('member', 'content', { seedItems: [row] })
  let writes = 0
  api.saveGrowth = async () => { writes++; throw new Error('읽기 전용 자료 저장 금지') }
  await click(screen.getByRole('button', { name: /팀 공유 콘텐츠/ }))
  const editor = panel('팀 공유 콘텐츠')
  for (const channel of ['네이버 블로그', '인스타그램', '유튜브']) {
    await click(editor.getByRole('tab', { name: channel, exact: true }))
    assert.equal(editor.getByRole('tab', { name: channel, exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(editor.getByLabelText('채널 본문').value, `${channel} 본문`)
    assert.equal(editor.getByLabelText('채널 본문').matches(':disabled'), true)
  }
  assert.equal(editor.queryByRole('button', { name: '저장', exact: true }), null)
  await act(async () => user.keyboard('{Home}{ArrowRight}'))
  assert.equal(document.activeElement, editor.getByRole('tab', { name: '인스타그램', exact: true }))
  assert.equal(editor.getByLabelText('채널 본문').value, '인스타그램 본문')
  assert.equal(editor.getByRole('tabpanel', { name: '인스타그램', exact: true }) != null, true)
  assert.equal(writes, 0)
  assert.deepEqual(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')), [row])
})

test('saving new and existing content keeps the selected channel and its approval context', async () => {
  const screen = await mount('admin', 'content')
  await click(screen.getByRole('button', { name: '+ 콘텐츠 만들기', exact: true }))
  let editor = panel('새 콘텐츠·배포')
  await type(editor.getByLabelText('제목 *'), '인스타 검수 흐름')
  await type(editor.getByLabelText('원본 사실·출처 요약 *'), '공식 확인한 행사 정보')
  await click(editor.getByRole('tab', { name: '인스타그램', exact: true }))
  await type(editor.getByLabelText('채널 제목'), '인스타 제목')
  await type(editor.getByLabelText('채널 본문'), '인스타 본문')
  await click(editor.getByLabelText('이미지·영상·문구 사용 권리 확인'))
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel('인스타 검수 흐름')
  assert.equal(editor.getByRole('tab', { name: '인스타그램', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(editor.getByLabelText('채널 본문').value, '인스타 본문')
  await act(async () => user.selectOptions(editor.getByLabelText('채널 상태'), '승인'))
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel('인스타 검수 흐름')
  assert.equal(editor.getByRole('tab', { name: '인스타그램', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(editor.getByLabelText('채널 상태').value, '승인')
  const versions = JSON.parse(localStorage.getItem('wkly-growth-demo-v1'))[0].document.versions
  assert.deepEqual(versions.map(v => v.status), ['초안', '승인', '초안'])
  await type(editor.getByLabelText('채널 본문'), '승인 후 수정한 본문')
  assert.equal(editor.getByLabelText('채널 상태').value, '초안')
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel('인스타 검수 흐름')
  assert.equal(editor.getByLabelText('채널 본문').value, '승인 후 수정한 본문')
  assert.equal(editor.getByRole('tab', { name: '인스타그램', exact: true }).getAttribute('aria-selected'), 'true')
  assert.deepEqual(JSON.parse(localStorage.getItem('wkly-growth-demo-v1'))[0].document.versions.map(v => v.status), ['초안', '초안', '초안'])
})

test('content saving disables channel changes and keeps the selected channel after completion', async () => {
  const screen = await mount('member', 'content')
  await click(screen.getByRole('button', { name: '+ 콘텐츠 만들기', exact: true }))
  let editor = panel('새 콘텐츠·배포')
  await type(editor.getByLabelText('제목 *'), '저장 중 채널 보호')
  await type(editor.getByLabelText('원본 사실·출처 요약 *'), '저장할 원본')
  await click(editor.getByRole('tab', { name: '유튜브', exact: true }))
  await type(editor.getByLabelText('채널 본문'), '보존할 유튜브 본문')
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  api.saveGrowth = async (...args) => { await pending; return originals.saveGrowth(...args) }
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  for (const tab of editor.getAllByRole('tab')) assert.equal(tab.disabled, true)
  await click(editor.getByRole('tab', { name: '네이버 블로그', exact: true }))
  await act(async () => user.keyboard('{Escape}'))
  assert.equal(editor.getByLabelText('채널 본문').value, '보존할 유튜브 본문')
  assert.equal(screen.queryByRole('dialog', { name: '새 콘텐츠·배포', exact: true }) != null, true)
  await act(async () => finish())
  editor = panel('저장 중 채널 보호')
  assert.equal(editor.getByRole('tab', { name: '유튜브', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(editor.getByRole('option', { name: '승인', exact: true }).disabled, true)
  assert.equal(editor.getByLabelText('채널 본문').value, '보존할 유튜브 본문')
})

test('failed content save and declined close keep channel drafts; opening a new item resets selection', async () => {
  const screen = await mount('admin', 'content')
  await click(screen.getByRole('button', { name: '+ 콘텐츠 만들기', exact: true }))
  let editor = panel('새 콘텐츠·배포')
  await type(editor.getByLabelText('제목 *'), '저장 실패 초안')
  await type(editor.getByLabelText('원본 사실·출처 요약 *'), '확인한 원본')
  await click(editor.getByRole('tab', { name: '인스타그램', exact: true }))
  await type(editor.getByLabelText('채널 본문'), '실패해도 유지할 내용')
  api.saveGrowth = async () => { throw new Error('모의 저장 실패') }
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  assert.equal(editor.getAllByRole('alert').length > 0, true)
  await click(closeButton(editor))
  assert.equal(editor.getByRole('tab', { name: '인스타그램', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(editor.getByLabelText('채널 본문').value, '실패해도 유지할 내용')
  window.confirm = () => true
  await click(closeButton(editor))
  await click(screen.getByRole('button', { name: '+ 콘텐츠 만들기', exact: true }))
  editor = panel('새 콘텐츠·배포')
  assert.equal(editor.getByRole('tab', { name: '네이버 블로그', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(editor.getByLabelText('채널 본문').value, '')
})

for (const role of ['admin', 'member']) {
  test(`${role}: actual sales form keeps URL parameters and guards unsaved close`, async () => {
    const screen = await mount(role)
    await click(screen.getByRole('button', { name: '+ 영업 기회', exact: true }))
    assert.equal(query('new'), '1')
    assert.equal(query('campaign'), 'retained')
    const editor = panel('새 영업 기회')
    await type(editor.getByLabelText('영업 건 이름 *'), 'DOM 검증 영업 기회')
    assert.equal(editor.getByLabelText('담당자').disabled, role === 'member')
    let confirmations = 0
    window.confirm = () => { confirmations++; return false }
    await click(editor.getByRole('button', { name: '취소', exact: true }))
    assert.equal(confirmations, 1)
    assert.equal(editor.getByLabelText('영업 건 이름 *').value, 'DOM 검증 영업 기회')
    assert.equal(query('new'), '1')
    await click(editor.getByRole('button', { name: '저장', exact: true }))
    const detail = panel('DOM 검증 영업 기회')
    const saved = JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items
    assert.equal(saved.length, 1)
    assert.equal(query('id'), saved[0].id)
    assert.equal(query('new'), null)
    assert.equal(query('campaign'), 'retained')
    await type(detail.getByLabelText('활동 내용'), '미저장 연락 기록')
    await click(closeButton(detail))
    assert.equal(confirmations, 2)
    assert.equal(detail.getByLabelText('활동 내용').value, '미저장 연락 기록')
    window.confirm = () => true
    await click(closeButton(detail))
    assert.equal(query('id'), null)
    assert.equal(query('campaign'), 'retained')
    assert.equal(screen.queryByRole('region', { name: 'DOM 검증 영업 기회', exact: true }), null)
  })

  test(`${role}: actual contact import retains failed IDs and retries only pending candidates`, async () => {
    const screen = await mount(role, 'contact'), calls = []
    let failed = false
    api.saveGrowth = async (id, draft, revision) => {
      calls.push({ id, draft: structuredClone(draft), revision })
      if (draft.document.email === 'beta@brand.example' && !failed) { failed = true; throw new Error('모의 저장 거부') }
      return originals.saveGrowth(id, draft, revision)
    }
    await openContactIntake(screen)
    await click(screen.getByRole('button', { name: '메일·인스타 자료에서 추출', exact: true }))
    const form = panel('연락처 자료 가져오기')
    await type(form.getByLabelText('가져온 텍스트'), 'alpha@brand.example\nbeta@brand.example')
    await click(form.getByRole('button', { name: '추출 미리보기', exact: true }))
    assert.equal(form.getAllByRole('listitem').length, 2)
    await click(form.getByRole('button', { name: '후보를 검토함에 저장', exact: true }))
    assert.match(form.getByRole('status').textContent, /1개 저장 확인, 1개 확인 필요/)
    assert.equal(form.getAllByRole('listitem').length, 1)
    assert.match(form.getByRole('listitem').textContent, /beta@brand\.example/)
    await click(form.getByRole('button', { name: '추출 미리보기', exact: true }))
    assert.equal(form.getAllByRole('listitem').length, 1)
    let confirmation = ''
    window.confirm = message => { confirmation = message; return false }
    await act(async () => user.selectOptions(form.getByLabelText('자료 종류'), '인스타그램'))
    assert.match(confirmation, /확인이 필요한 후보 1개/)
    assert.equal(form.getByLabelText('자료 종류').value, '받은 메일')
    await click(form.getByRole('button', { name: '남은 후보만 다시 확인·저장', exact: true }))
    assert.match(form.getByRole('status').textContent, /1개 저장 확인, 0개 확인 필요/)
    assert.deepEqual(calls.map(call => call.draft.document.email), ['alpha@brand.example', 'beta@brand.example', 'beta@brand.example'])
    assert.equal(calls[1].id, calls[2].id)
    assert.deepEqual(calls[1].draft, calls[2].draft)
    assert.equal(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')).length, 2)
    await click(closeButton(form))
    assert.equal(!!screen.queryByRole('dialog', { name: '연락처 자료 가져오기', exact: true }), false)
  })
}

test('sales saving through a vetoed route keeps confirmed ID and latest revision', async () => {
  const screen = await mount('admin'), calls = []
  api.saveSales = async (id, draft, revision) => { calls.push({ id, revision }); return originals.saveSales(id, draft, revision) }
  await click(screen.getByRole('button', { name: '+ 영업 기회', exact: true }))
  let editor = panel('새 영업 기회')
  await type(editor.getByLabelText('영업 건 이름 *'), '이동 차단 뒤 다시 저장')
  const block = event => { if (event.detail?.to?.includes('id=')) event.preventDefault() }
  window.addEventListener('wkly:before-navigate', block)
  try { await click(editor.getByRole('button', { name: '저장', exact: true })) }
  finally { window.removeEventListener('wkly:before-navigate', block) }
  editor = panel('영업 정보 수정')
  assert.equal(query('new'), '1')
  await type(editor.getByLabelText('다음 행동'), '확정된 자료에 추가 입력')
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  panel('이동 차단 뒤 다시 저장')
  assert.deepEqual(calls.map(c => c.revision), [0, 1])
  assert.equal(calls[0].id, calls[1].id)
  assert.equal(JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items.length, 1)
})

test('sales in-flight save prevents Escape and URL transitions', async () => {
  const screen = await mount('admin')
  let release, calls = 0
  api.saveSales = async (...args) => { calls++; await new Promise(resolve => { release = resolve }); return originals.saveSales(...args) }
  await click(screen.getByRole('button', { name: '+ 영업 기회', exact: true }))
  const editor = panel('새 영업 기회')
  await type(editor.getByLabelText('영업 건 이름 *'), '저장 중 보호')
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  assert.equal(editor.getByRole('button', { name: '저장 중…', exact: true }).disabled, true)
  await click(screen.getByRole('link', { name: 'WKLY', exact: true }))
  assert.equal(location.pathname, '/sales')
  assert.equal(query('new'), '1')
  await act(async () => user.keyboard('{Escape}'))
  panel('새 영업 기회')
  assert.equal(calls, 1)
  await act(async () => release())
  panel('저장 중 보호')
})

test('lost contact save response is recovered without a second create', async () => {
  const screen = await mount('admin', 'contact')
  let saves = 0
  api.saveGrowth = async (...args) => { saves++; await originals.saveGrowth(...args); throw new Error('모의 응답 유실') }
  await openContactIntake(screen)
  await click(screen.getByRole('button', { name: '메일·인스타 자료에서 추출', exact: true }))
  const form = panel('연락처 자료 가져오기')
  await type(form.getByLabelText('가져온 텍스트'), 'recovered@brand.example')
  await click(form.getByRole('button', { name: '추출 미리보기', exact: true }))
  await click(form.getByRole('button', { name: '후보를 검토함에 저장', exact: true }))
  assert.match(form.getByRole('status').textContent, /1개 저장 확인 \(응답 재확인 1개 포함\), 0개 확인 필요/)
  assert.equal(form.queryAllByRole('listitem').length, 0)
  assert.equal(saves, 1)
  await click(form.getByRole('button', { name: '추출 미리보기', exact: true }))
  assert.equal(form.queryAllByRole('listitem').length, 0)
  assert.equal(saves, 1)
})

test('member sees another owner’s sales detail without edit or activity controls', async () => {
  await mount('member')
  const { newSalesDraft } = await server.ssrLoadModule('/src/lib/sales.ts')
  await api.signIn('admin@thewklyn.com', '')
  const row = await originals.saveSales(crypto.randomUUID(), {
    ...newSalesDraft('00000000-0000-4000-8000-000000000001'), title: '다른 담당자의 영업 기회',
  }, 0)
  await api.signIn('haneul@thewklyn.com', '')
  await act(async () => {
    window.history.pushState(null, '', `/sales?campaign=retained&id=${row.id}`)
    window.dispatchEvent(new window.PopStateEvent('popstate'))
  })
  const detail = panel('다른 담당자의 영업 기회')
  assert.equal(!!detail.queryByRole('button', { name: '영업 정보 수정', exact: true }), false)
  assert.equal(!!detail.queryByLabelText('활동 내용'), false)
  assert.equal(query('id'), row.id)
})

test('a concurrent sales revision conflict keeps the user draft and preserves the other writer', async () => {
  const screen = await mount('admin')
  await click(screen.getByRole('button', { name: '+ 영업 기회', exact: true }))
  let editor = panel('새 영업 기회')
  await type(editor.getByLabelText('영업 건 이름 *'), '동시 수정 검증')
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  await click(panel('동시 수정 검증').getByRole('button', { name: '영업 정보 수정', exact: true }))
  editor = panel('영업 정보 수정')
  await type(editor.getByLabelText('영업 건 이름 *'), '보존해야 할 내 초안')
  api.saveSales = async (id, draft, revision) => {
    await originals.saveSales(id, { ...draft, title: '먼저 저장한 다른 작업' }, revision)
    return originals.saveSales(id, draft, revision)
  }
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  assert.match(editor.getByRole('alert').textContent, /다른 작업에서 변경/)
  assert.equal(editor.getByLabelText('영업 건 이름 *').value, '보존해야 할 내 초안')
  const stored = JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items
  assert.equal(stored.length, 1)
  assert.equal(stored[0].title, '먼저 저장한 다른 작업')
  assert.equal(stored[0].revision, 2)
  assert.equal(query('id'), stored[0].id)
})

test('uncertain meeting start hides new uploads and checks only the preserved record ID before applying the result', async () => {
  const delivered = [], starts = [], reads = []
  const recording = {
    id: '00000000-0000-4000-8000-000000000099', created_by: '00000000-0000-4000-8000-000000000001',
    title: '상태 확인 회의', attendees: '담당자', audio_path: 'mock/meeting.txt', mime: 'text/plain', duration_sec: null,
    status: '업로드', transcript: null, minutes: null, error: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
  }
  api.startMeetingMinutes = async (file, options) => {
    starts.push({ name: file.name, mime: file.type, options })
    throw new MeetingStartUncertainError(recording)
  }
  api.getMeetingRecording = async id => {
    reads.push(id)
    return { ...recording, status: '완료', minutes: '검증한 회의록 초안', transcript: '합성 받아쓰기 원문' }
  }
  const screen = await mount('admin', 'meeting', { title: recording.title, onResult: (...args) => delivered.push(args) })
  await type(screen.getByLabelText('참석자'), '담당자')
  const fileInput = document.querySelector('input[type="file"]')
  assert.ok(fileInput, 'initial upload input is available')
  await act(async () => user.upload(fileInput, new window.File(['합성 받아쓰기'], '회의.txt', { type: 'text/plain' })))
  assert.equal(starts.length, 1)
  assert.equal(starts[0].name, '회의.txt')
  assert.equal(starts[0].options.title, recording.title)
  assert.equal(starts[0].options.attendees, '담당자')
  assert.equal(reads.length, 0)
  assert.equal(delivered.length, 0)
  assert.match(screen.getByText(/회의록 요청의 접수 여부를 확인하지 못했습니다/).textContent, new RegExp(recording.id))
  assert.equal(!!screen.queryByRole('button', { name: '녹음 시작', exact: true }), false)
  assert.equal(!!screen.queryByRole('button', { name: '받아쓰기(.txt) · 녹음 파일 올리기', exact: true }), false)
  assert.equal(!!document.querySelector('input[type="file"]'), false)
  await click(screen.getByRole('button', { name: '같은 기록의 상태만 다시 확인', exact: true }))
  assert.equal(!!screen.queryByRole('button', { name: '같은 기록의 상태만 다시 확인', exact: true }), false)
  assert.equal(!!document.querySelector('input[type="file"]'), false)
  // Exercise the component's default read-only polling interval, not a mocked
  // replacement for its watcher. No provider or upload callback is retried.
  await act(async () => new Promise(resolve => setTimeout(resolve, 5100)))
  assert.deepEqual(reads, [recording.id])
  assert.equal(starts.length, 1)
  assert.deepEqual(delivered, [['검증한 회의록 초안', '합성 받아쓰기 원문']])
  assert.ok(screen.getByText(/회의록 초안을 아래 내용 칸에 채웠습니다/))
  await click(screen.getByRole('button', { name: '받아쓰기 원문 보기', exact: true }))
  assert.equal(screen.getByText('합성 받아쓰기 원문', { exact: true }).textContent, '합성 받아쓰기 원문')
  assert.equal(starts.length, 1)
  assert.deepEqual(reads, [recording.id])
})

const tenderCandidate = {
  title: '전시 공간 운영 용역', number: 'R26BK00000001', round: '000', agency: '합성 발주기관',
  deadline: '2026-11-19T18:00:00+09:00', amount: 12000000, source_url: 'https://www.g2b.go.kr/example-notice',
  notice_date: '2026-11-12', warnings: ['참가 조건을 원문에서 확인하세요.'],
}
const tenderResult = () => ({ items: [structuredClone(tenderCandidate)], total: 1, page: 1, hasMore: false, limited: false, omitted: 0 })

test('official tender selection prefills an unsaved draft and writes only after explicit save', async () => {
  const screen = await mount('member', 'tender'), requests = [], saves = []
  api.searchTenders = async query => { requests.push(structuredClone(query)); return tenderResult() }
  api.saveGrowth = async (...args) => { saves.push(args); return originals.saveGrowth(...args) }
  await click(screen.getByRole('button', { name: '나라장터 공식 공고 조회', exact: true }))
  const search = panel('나라장터 공식 공고 조회')
  await type(search.getByLabelText('공고명 검색어'), '전시')
  await click(search.getByRole('button', { name: '공식 공고 조회', exact: true }))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].keyword, '전시')
  assert.equal(saves.length, 0)
  await click(search.getByRole('button', { name: '검토해 등록', exact: true }))
  const editor = panel('새 나라장터')
  assert.equal(editor.getByLabelText('제목 *').value, tenderCandidate.title)
  assert.equal(editor.getByLabelText('공고번호 *').value, tenderCandidate.number)
  assert.equal(editor.getByLabelText('공고 차수 *').value, tenderCandidate.round)
  assert.equal(editor.getByLabelText('발주처 *').value, tenderCandidate.agency)
  assert.equal(editor.getByLabelText('마감 시각 (한국시간)').value, '2026-11-19T18:00')
  assert.equal(editor.getByLabelText('공고 금액 (원 · 미확인 빈칸)').value, '12000000')
  assert.equal(editor.getByLabelText('원문·출처 주소').value, tenderCandidate.source_url)
  assert.equal(editor.getByLabelText('참가 조건').value, '추가 확인')
  assert.equal(saves.length, 0)
  let confirms = 0
  window.confirm = () => { confirms++; return false }
  await click(closeButton(editor))
  assert.equal(confirms, 1)
  panel('새 나라장터')
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  panel(tenderCandidate.title)
  assert.equal(saves.length, 1)
  const stored = JSON.parse(localStorage.getItem('wkly-growth-demo-v1'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].document.number, tenderCandidate.number)
  assert.equal(stored[0].owner_id, '00000000-0000-4000-8000-000000000002')
  assert.equal(stored[0].linked_sales_id, null)
})

test('pending tender lookup blocks close and navigation, and changed filters discard stale candidates', async () => {
  const screen = await mount('admin', 'tender'), requests = []
  let release
  api.searchTenders = async query => { requests.push(structuredClone(query)); return new Promise(resolve => { release = resolve }) }
  await click(screen.getByRole('button', { name: '나라장터 공식 공고 조회', exact: true }))
  const search = panel('나라장터 공식 공고 조회')
  await click(search.getByRole('button', { name: '공식 공고 조회', exact: true }))
  assert.equal(search.getByRole('button', { name: '공고 조회 중…', exact: true }).disabled, true)
  assert.equal(closeButton(search).disabled, true)
  assert.equal(search.getByLabelText('공고명 검색어').matches(':disabled'), true)
  await click(search.getAllByRole('button', { name: '닫기', exact: true })[0])
  await act(async () => user.keyboard('{Escape}'))
  await click(screen.getByRole('button', { name: '+ 공고 등록', exact: true }))
  panel('나라장터 공식 공고 조회')
  assert.equal(!!screen.queryByRole('dialog', { name: '새 나라장터', exact: true }), false)
  assert.equal(requests.length, 1)
  await act(async () => release(tenderResult()))
  assert.ok(search.getByRole('button', { name: '검토해 등록', exact: true }))
  await type(search.getByLabelText('공고명 검색어'), '새 조건')
  assert.equal(!!search.queryByRole('region', { name: '공식 공고 조회 결과', exact: true }), false)
  assert.equal(!!search.queryByRole('button', { name: '검토해 등록', exact: true }), false)
  assert.equal(requests.length, 1, 'changing criteria must not perform an automatic lookup')
  assert.equal(localStorage.getItem('wkly-growth-demo-v1'), null)
})

test('a separate draft guard can veto tender prefill without losing lookup results', async () => {
  const screen = await mount('admin', 'tender')
  api.searchTenders = async () => tenderResult()
  await click(screen.getByRole('button', { name: '나라장터 공식 공고 조회', exact: true }))
  const search = panel('나라장터 공식 공고 조회')
  await type(search.getByLabelText('공고명 검색어'), '보존할 조회 조건')
  await click(search.getByRole('button', { name: '공식 공고 조회', exact: true }))
  const veto = event => { if (event.detail?.to === 'growth:tender:prefill') event.preventDefault() }
  window.addEventListener('wkly:before-navigate', veto)
  try { await click(search.getByRole('button', { name: '검토해 등록', exact: true })) }
  finally { window.removeEventListener('wkly:before-navigate', veto) }
  panel('나라장터 공식 공고 조회')
  assert.equal(search.getByLabelText('공고명 검색어').value, '보존할 조회 조건')
  assert.ok(search.getByRole('button', { name: '검토해 등록', exact: true }))
  assert.equal(localStorage.getItem('wkly-growth-demo-v1'), null)
  await click(search.getByRole('button', { name: '검토해 등록', exact: true }))
  panel('새 나라장터')
  assert.equal(localStorage.getItem('wkly-growth-demo-v1'), null)
})

test('failed tender pagination preserves the previous page and explicitly retries the exact failed query', async () => {
  const screen = await mount('admin', 'tender'), requests = []
  const firstPage = {
    items: Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(tenderCandidate), title: `첫 페이지 공고 ${index + 1}`, number: `R26BK${String(index + 1).padStart(8, '0')}` })),
    total: 31, page: 1, hasMore: true, limited: false, omitted: 0,
  }
  const secondPage = { items: [{ ...structuredClone(tenderCandidate), title: '둘째 페이지 공고', number: 'R26BK00000031' }], total: 31, page: 2, hasMore: false, limited: false, omitted: 0 }
  let pageTwoAttempts = 0, release
  api.searchTenders = async requested => {
    requests.push(structuredClone(requested))
    if (requested.page === 1) return structuredClone(firstPage)
    pageTwoAttempts++
    if (pageTwoAttempts !== 2) throw new Error('429 모의 조회 제한')
    return new Promise(resolve => { release = resolve })
  }
  await click(screen.getByRole('button', { name: '나라장터 공식 공고 조회', exact: true }))
  const search = panel('나라장터 공식 공고 조회')
  await type(search.getByLabelText('공고명 검색어'), '  전시 계획  ')
  await act(async () => user.selectOptions(search.getByLabelText('조회 업무'), 'construction'))
  await click(search.getByRole('button', { name: '공식 공고 조회', exact: true }))
  assert.equal(search.getAllByRole('button', { name: '검토해 등록', exact: true }).length, 30)
  await click(search.getByRole('button', { name: '다음 공고 페이지', exact: true }))
  assert.match(search.getByRole('alert').textContent, /429/)
  assert.match(search.getByRole('status').textContent, /전체 31건 중 1페이지/)
  assert.equal(search.getAllByRole('button', { name: '검토해 등록', exact: true }).length, 30)
  assert.equal(search.getByRole('button', { name: '다음 공고 페이지', exact: true }).disabled, false)
  assert.equal(search.getByRole('button', { name: '이전 공고 페이지', exact: true }).disabled, true)
  assert.deepEqual(requests.map(value => value.page), [1, 2])
  await click(search.getByRole('button', { name: '실패한 공고 페이지 다시 조회', exact: true }))
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[2], requests[1])
  assert.equal(requests[2].category, 'construction')
  assert.equal(requests[2].keyword, '전시 계획')
  assert.equal(search.getByLabelText('공고명 검색어').matches(':disabled'), true)
  assert.equal(closeButton(search).disabled, true)
  assert.equal(search.getAllByRole('button', { name: '검토해 등록', exact: true }).every(button => button.disabled), true)
  await click(search.getAllByRole('button', { name: '닫기', exact: true })[0])
  panel('나라장터 공식 공고 조회')
  assert.match(search.getByRole('status').textContent, /전체 31건 중 1페이지/)
  await act(async () => release(structuredClone(secondPage)))
  assert.match(search.getByRole('status').textContent, /전체 31건 중 2페이지/)
  assert.equal(search.getAllByRole('button', { name: '검토해 등록', exact: true }).length, 1)
  assert.ok(search.getByText('둘째 페이지 공고', { exact: true }))
  assert.equal(search.getByRole('button', { name: '다음 공고 페이지', exact: true }).disabled, true)
  assert.equal(!!search.queryByRole('button', { name: '실패한 공고 페이지 다시 조회', exact: true }), false)
  assert.equal(requests.length, 3, 'one explicit retry must cause exactly one additional request')
  await click(search.getByRole('button', { name: '이전 공고 페이지', exact: true }))
  await click(search.getByRole('button', { name: '다음 공고 페이지', exact: true }))
  assert.ok(search.getByRole('button', { name: '실패한 공고 페이지 다시 조회', exact: true }))
  assert.equal(requests.length, 5)
  await type(search.getByLabelText('공고명 검색어'), '새 조회 조건')
  assert.equal(!!search.queryByRole('button', { name: '실패한 공고 페이지 다시 조회', exact: true }), false)
  assert.equal(!!search.queryByRole('region', { name: '공식 공고 조회 결과', exact: true }), false)
  assert.equal(requests.length, 5, 'changing criteria must remove the stale retry without automatic lookup')
  assert.equal(localStorage.getItem('wkly-growth-demo-v1'), null)
})

test('company and source changes revoke approvals across channels and preserve copy', async () => {
  const { newGrowth } = await server.ssrLoadModule('/src/lib/growth.ts')
  const draft = newGrowth('content', '00000000-0000-4000-8000-000000000001')
  draft.title = '승인한 회사와 출처'; draft.document.original = '확인한 원본'
  draft.document.source_url = 'https://example.com/original'
  draft.document.versions.forEach(v => { v.title = '검수 제목'; v.body = '보존할 원고'; v.rights = true; v.status = '승인' })
  const row = { ...draft, id: crypto.randomUUID(), revision: 1, linked_sales_id: null, created_by: draft.owner_id, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z' }
  const screen = await mount('admin', 'content', { seedItems: [row] })
  await click(screen.getByRole('button', { name: /승인한 회사와 출처/ }))
  let editor = panel(draft.title)
  await type(editor.getByLabelText('원문·출처 주소'), 'https://example.com/new-source')
  for (const channel of ['네이버 블로그', '인스타그램', '유튜브']) {
    await click(editor.getByRole('tab', { name: channel, exact: true }))
    assert.equal(editor.getByLabelText('채널 상태').value, '초안')
    assert.equal(editor.getByLabelText('채널 본문').value, '보존할 원고')
  }
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel(draft.title)
  await act(async () => user.selectOptions(editor.getByLabelText('채널 상태'), '승인'))
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel(draft.title)
  await act(async () => user.selectOptions(editor.getByLabelText('수행 회사'), 'AR'))
  assert.equal(editor.getByLabelText('채널 상태').value, '초안')
})
for (const kind of ['contact', 'tender']) test(kind + ' creates one sales opportunity with its source', async () => {
  const screen = await mount('admin', kind)
  await click(screen.getByRole('button', { name: kind === 'contact' ? '+ 연락처 등록' : '+ 공고 등록', exact: true }))
  let editor = panel(kind === 'contact' ? '새 연락처 검토함' : '새 나라장터')
  const title = kind === 'contact' ? '검토한 브랜드 담당자' : '검토한 공고'
  await type(editor.getByLabelText('제목 *'), title)
  await type(editor.getByLabelText('원문·출처 주소'), 'https://example.com/qa/' + kind)
  if (kind === 'contact') {
    await type(editor.getByLabelText('이메일'), 'sales-qa@example.com')
    await act(async () => user.selectOptions(editor.getByLabelText('관리 상태'), '확인'))
  } else {
    await type(editor.getByLabelText('공고번호 *'), 'QA-TENDER-001')
    await type(editor.getByLabelText('발주처 *'), '테스트 발주처')
    await act(async () => user.selectOptions(editor.getByLabelText('참가 조건'), '충족'))
    await type(editor.getByLabelText('검토 근거·필요 서류'), '공고 원문에서 참가 조건 확인')
  }
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel(title)
  await click(editor.getByRole('button', { name: '영업 기회로 연결', exact: true }))
  editor = panel(title)
  const id = new URL(editor.getByRole('link', { name: '연결 영업 기회 보기', exact: true }).href).searchParams.get('id')
  const saved = await api.getSales(id)
  assert.equal(saved.title, title); assert.equal(saved.stage, '발굴')
  assert.equal(saved.source_url, 'https://example.com/qa/' + kind)
  assert.equal(editor.queryByRole('button', { name: '영업 기회로 연결', exact: true }) === null, true)
  assert.equal((await api.listSales({ page: 0 })).items.length, 1)
})

test('contact checks require a saved review and open only the confirmed sales plan', async () => {
  const { newGrowth } = await server.ssrLoadModule('/src/lib/growth.ts')
  const owner = '00000000-0000-4000-8000-000000000001'
  const draft = newGrowth('contact', owner)
  draft.title = '검토할 행사 후보'
  Object.assign(draft.document, { email: 'no-reply@brand.example', source: '받은 메일' })
  const candidate = { ...draft, id: crypto.randomUUID(), revision: 1, linked_sales_id: null, created_by: owner, created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }
  const screen = await mount('admin', 'sales', { seedItems: [candidate] }, '/sales?tab=contacts&campaign=retained')
  let links = 0
  api.linkGrowthSales = async (...args) => { links++; return originals.linkGrowthSales(...args) }

  await click(screen.getByRole('button', { name: /검토할 행사 후보/ }))
  let editor = panel(draft.title)
  assert.ok(editor.getByText('브랜드나 소속을 확인해 주세요.'))
  assert.ok(editor.getByText(/자동 알림에 쓰이는 주소 형식/))
  assert.equal(editor.getByRole('button', { name: '영업 기회로 연결' }).disabled, true)
  await act(async () => user.selectOptions(editor.getByLabelText('관리 상태'), '확인'))
  assert.equal(editor.getByRole('button', { name: '영업 기회로 연결' }).disabled, true)
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  editor = panel(draft.title)
  await click(editor.getByRole('button', { name: '영업 기회로 연결' }))
  editor = panel(draft.title)
  assert.equal(query('tab'), 'contacts')
  assert.equal(query('id'), null)
  const [saved] = (await api.listSales({ page: 0 })).items
  assert.equal((await api.getGrowth(candidate.id)).linked_sales_id, saved.id)

  await type(editor.getByLabelText('브랜드'), '수정 중인 브랜드')
  assert.equal(editor.getByRole('button', { name: '영업 계획 열기' }).disabled, true)
  await click(editor.getByRole('button', { name: '저장', exact: true }))
  await click(panel(draft.title).getByRole('button', { name: '영업 계획 열기' }))
  assert.equal(query('tab'), null)
  assert.equal(query('id'), saved.id)
  assert.equal(query('campaign'), 'retained')
  assert.equal(panel('영업 정보 수정').getByLabelText('영업 건 이름 *').value, draft.title)
  assert.equal(links, 1)
})

test('tender candidate rows show local review priorities and keep nearest ready deadline first', async () => {
  const { newGrowth } = await server.ssrLoadModule('/src/lib/growth.ts')
  const owner = '00000000-0000-4000-8000-000000000001'
  const cases = [
    ['마감 공고', '2020-01-01T18:00:00+09:00', '충족'],
    ['확인할 공고', '2099-01-01T18:00:00+09:00', '추가 확인'],
    ['나중 마감 공고', '2099-02-01T17:00:00+09:00', '충족'],
    ['우선 마감 공고', '2099-02-01T11:00:00+09:00', '충족'],
  ]
  const items = cases.map(([title, deadline, qualification], index) => {
    const draft = newGrowth('tender', owner)
    Object.assign(draft.document, { deadline, qualification })
    const updatedAt = `2026-11-${14 - index}T00:00:00Z`
    return { ...draft, title, id: crypto.randomUUID(), revision: 1, linked_sales_id: null, created_by: owner, created_at: updatedAt, updated_at: updatedAt }
  })
  const screen = await mount('admin', 'sales', { seedItems: items }, '/sales?tab=tenders')
  const rows = screen.getAllByRole('button', { name: /공고 .* (담당자 검토 우선|추가 확인|마감 경과)/ })
  assert.deepEqual(rows.map(row => row.querySelector('strong').textContent), ['우선 마감 공고', '나중 마감 공고', '확인할 공고', '마감 공고'])
  assert.match(rows[0].textContent, /참여 여부·제출 준비 결정/)
  assert.match(rows[3].textContent, /정정·재공고 확인/)
  assert.equal(localStorage.getItem('wkly-sales-demo-v1'), null)
})

test('missing linked campaign stays missing on retry even with another accessible campaign', async () => {
  const { defaultMarketingCampaign } = await server.ssrLoadModule('/src/lib/marketing.ts')
  const previous = api.listMarketingCampaigns
  api.listMarketingCampaigns = async () => [{ ...defaultMarketingCampaign(), revision: 1 }]
  try {
    const screen = await mount('admin', 'ads', {}, '/ads?tab=studio&id=' + crypto.randomUUID())
    const view = within(screen.getByRole('region', { name: '마케팅 데스크', exact: true }))
    assert.match(view.getByRole('alert').textContent, /연결된 캠페인을 찾을 수 없습니다/)
    await click(view.getByRole('button', { name: '다시 불러오기', exact: true }))
    assert.equal(view.queryByRole('alert') !== null, true)
    assert.equal(view.queryByLabelText('캠페인 이름') === null, true)
  } finally { api.listMarketingCampaigns = previous }
})
test('campaign editor recovers an acknowledged stored write without a second save', async () => {
  const previous = { listMarketingCampaigns: api.listMarketingCampaigns, saveMarketingCampaign: api.saveMarketingCampaign, listMarketingAssets: api.listMarketingAssets }
  let rows = [], writes = 0
  api.listMarketingCampaigns = async () => rows
  api.listMarketingAssets = async () => []
  api.saveMarketingCampaign = async draft => {
    writes++
    rows = [{ ...structuredClone(draft), revision: draft.revision + 1, updatedBy: '00000000-0000-4000-8000-000000000001' }]
    throw new Error('response lost')
  }
  try {
    const screen = await mount('admin', 'ads', {}, '/ads?tab=studio')
    const view = within(screen.getByRole('region', { name: '마케팅 데스크', exact: true }))
    await click(view.getByRole('button', { name: '새 캠페인', exact: true }))
    await type(view.getByLabelText('캠페인 이름'), '응답 유실 복구 검사')
    await click(view.getByRole('button', { name: '저장', exact: true }))
    assert.equal(view.queryByRole('alert') === null, true)
    assert.equal(view.getByRole('button', { name: '저장', exact: true }).disabled, true)
    assert.equal(writes, 1); assert.equal(rows.length, 1); assert.equal(rows[0].revision, 1)
  } finally { Object.assign(api, previous) }
})

for(const role of ['admin','member']) test(role + ': research plan becomes a saved sales opportunity with source and next action', async () => {
 const screen=await mount(role)
 await click(screen.getByRole('button',{name:'신규 대상 발굴',exact:true}))
 assert.equal(query('campaign'),'retained');assert.equal(query('research'),'1')
 const editor=panel('새 영업 기회')
 assert.equal(document.activeElement,editor.getByLabelText('발굴 경로'))
 await type(editor.getByLabelText('대상 브랜드·기관 *'),'테스트 신규 고객')
 await type(editor.getByLabelText('업종·제품'),'뷰티')
 await type(editor.getByLabelText('관심 지역'),'성수')
 await type(editor.getByLabelText('수요·접근 계기'),'신제품 방문 유도 콘텐츠 필요')
 assert.equal(editor.getByRole('button',{name:'저장',exact:true}).disabled,true)
 assert.equal((await api.listSales({page:0})).items.length,0)
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'테스트 신규 고객 · 팝업스토어 대행 수주')
 assert.match(editor.getByLabelText('요청 내용·메모').value,/신제품 방문 유도 콘텐츠 필요/)
 await click(editor.getByRole('button',{name:'저장',exact:true}))
 const row=await api.getSales(query('id'))
 assert.equal(row.stage,'발굴');assert.match(row.next_action,/공식 일정/);assert.match(row.description,/일정 미정/)
 assert.equal(row.owner_id,role==='admin'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002')
 assert.equal((await api.listSales({page:0})).items.length,1)
})
test('research requires evidence for confirmed dates and preserves un-applied edits on declined close',async()=>{
 const screen=await mount('admin');await click(screen.getByRole('button',{name:'신규 대상 발굴',exact:true}))
 const editor=panel('새 영업 기회');await type(editor.getByLabelText('대상 브랜드·기관 *'),'공식 확인 전 후보')
 await act(async()=>user.selectOptions(editor.getByLabelText('일정 확인 상태'),'확인'))
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.match(editor.getByRole('alert').textContent,/확인한 일정/)
 await click(editor.getByRole('button',{name:'취소',exact:true}))
 assert.equal(editor.getByLabelText('대상 브랜드·기관 *').value,'공식 확인 전 후보')
 assert.equal(query('new'),'1');assert.equal((await api.listSales({page:0})).items.length,0)
})
test('changing research after applying blocks stale save and declined replacement preserves the sales draft',async()=>{
 const screen=await mount('admin');await click(screen.getByRole('button',{name:'신규 대상 발굴',exact:true}))
 const editor=panel('새 영업 기회');await type(editor.getByLabelText('대상 브랜드·기관 *'),'첫 후보')
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 await type(editor.getByLabelText('영업 건 이름 *'),'수정한 제목')
 await type(editor.getByLabelText('대상 브랜드·기관 *'),'두 번째 후보')
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'수정한 제목');assert.equal(editor.getByRole('button',{name:'저장',exact:true}).disabled,true)
 window.confirm=()=>true
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'두 번째 후보 · 팝업스토어 대행 수주');assert.equal(editor.getByRole('button',{name:'저장',exact:true}).disabled,false)
})

test('confirmed event date, proof and space strategy persist through sales save and reopening',async()=>{
 const {todayKey}=await server.ssrLoadModule('/src/lib/date.ts')
 const screen=await mount('admin');await click(screen.getByRole('button',{name:'신규 대상 발굴',exact:true}))
 const editor=panel('새 영업 기회')
 await act(async()=>user.selectOptions(editor.getByLabelText('발굴 경로'),'space'))
 await type(editor.getByLabelText('대상 브랜드·기관 *'),'테스트 공간 브랜드')
 await type(editor.getByLabelText('행사·사업명'),'2030 플래그십 오픈')
 await type(editor.getByLabelText('행사·사업 시작일'),'2030-03-01')
 await type(editor.getByLabelText('공식 출처 주소'),'https://example.com/opening')
 await type(editor.getByLabelText('출처 확인일'),todayKey())
 await type(within(editor.getByRole('region', { name: '신규 대상 발굴 계획' })).getByLabelText('확인 근거'),'브랜드 공식 공지의 날짜 확인')
 await act(async()=>user.selectOptions(editor.getByLabelText('일정 확인 상태'),'확인'))
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'테스트 공간 브랜드 · 2030 플래그십 오픈')
 assert.equal(editor.getByLabelText('수행 회사').value,'AR')
 await click(editor.getByRole('button',{name:'저장',exact:true}))
 const row=await api.getSales(query('id'))
 assert.equal(row.source_url,'https://example.com/opening');assert.equal(row.next_date,'2029-12-01')
 assert.match(row.description,/2030-03-01/);assert.match(row.description,/브랜드 공식 공지의 날짜 확인/)
 const detail=panel(row.title)
 assert.match(detail.getByText(/\[신규 영업 발굴 계획\]/, { selector: 'p' }).textContent,/권장 업무 일정/)
})


test('AI menu combines team and costs for members without exposing admin tools or running AI', async () => {
  let reads = 0, writes = 0, adminReads = 0
  api.getAiState = async () => { reads++; return { models: [], budgets: [], usage: [] } }
  api.runGrowthAi = async () => { writes++; throw new Error('Unexpected AI call') }
  api.listAgentJobs = async () => { adminReads++; return [] }
  const screen = await mount('member', 'agents', {}, '/agents?campaign=keep')
  const nav = within(screen.getByRole('navigation', { name: 'AI 팀·비용 메뉴' }))
  assert.deepEqual(nav.getAllByRole('button').map(b => b.textContent), ['팀원·지시·예약', '사용·비용'])
  assert.equal(reads, 0)
  await click(nav.getByRole('button', { name: '사용·비용', exact: true }))
  assert.equal(location.pathname, '/agents')
  assert.equal(query('tab'), 'usage')
  assert.equal(query('campaign'), 'keep')
  assert.equal(screen.getByRole('heading', { name: 'AI 사용·비용 관리' }) != null, true)
  assert.match(screen.getByText(/아래 금액은 영업/).textContent, /회의록.*포함되지 않습니다/)
  assert.equal(screen.queryByRole('button', { name: '모델·기간 한도 설정' }), null)
  assert.equal(reads, 1)
  await click(nav.getByRole('button', { name: '팀원·지시·예약', exact: true }))
  assert.equal(query('tab'), 'team')
  assert.equal(writes, 0)
  assert.equal(adminReads, 0)
})

test('AI admin navigation preserves date and selected team context, including explicit return to team', async () => {
  const screen = await mount('admin', 'agents', {}, '/agents?date=2026-11-12&campaign=keep')
  const nav = within(screen.getByRole('navigation', { name: 'AI 팀·비용 메뉴' }))
  assert.equal(nav.getByRole('button', { name: '일일 보고' }).getAttribute('aria-current'), 'page')
  for (const [name, key] of [['예약 작업 점검', 'jobs'], ['조직도·관리자', 'org'], ['관리 요청', 'requests'], ['AI 처리 기록', 'actions'], ['사용·비용', 'usage'], ['팀원·지시·예약', 'team']]) {
    await click(nav.getByRole('button', { name, exact: true }))
    assert.equal(query('tab'), key)
    assert.equal(query('date'), '2026-11-12')
    assert.equal(query('campaign'), 'keep')
    assert.equal(screen.getByRole('region', { name, exact: true }) != null, true)
  }
})

test('old AI cost links resolve to the combined usage tab and retain other parameters', async () => {
  const alias = normalizePath('/ai-usage?tab=jobs&date=2026-11-12&campaign=keep')
  assert.equal(alias, '/agents?tab=usage&date=2026-11-12&campaign=keep')
  assert.equal(normalizePath(alias), alias)
  const screen = await mount('member', 'agents', {}, alias)
  assert.equal(screen.getByRole('region', { name: '사용·비용', exact: true }) != null, true)
  assert.equal(query('date'), '2026-11-12')
})

test('member admin links and unknown AI tabs fall back to team without loading admin jobs', async () => {
  let calls = 0
  api.listAgentJobs = async () => { calls++; return [] }
  const screen = await mount('member', 'agents', {}, '/agents?tab=jobs')
  assert.equal(screen.getByRole('region', { name: '팀원·지시·예약', exact: true }) != null, true)
  assert.equal(calls, 0)
  await act(async () => { window.history.pushState(null, '', '/agents?tab=unknown'); window.dispatchEvent(new PopStateEvent('popstate')) })
  assert.equal(screen.getByRole('region', { name: '팀원·지시·예약', exact: true }) != null, true)
})

test('AI tabs retain an unsaved request on declined navigation and block switching while it runs', async () => {
  api.getAiState = async () => ({ models: [{ key: 'standard', label: '작성', enabled: true, model_id: 'test', input_rate: 1, output_rate: 1 }], budgets: [], usage: [] })
  let finish, calls = 0
  api.runGrowthAi = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const screen = await mount('member', 'agents', {}, '/agents?tab=usage&date=2026-11-12')
  await click(screen.getByText('필요할 때 AI 도움 받기', { exact: true }))
  await type(screen.getByLabelText('요청문 · 최대 6,000자'), '보존할 요청문')
  let confirmations = 0
  window.confirm = () => { confirmations++; return false }
  const team = within(screen.getByRole('navigation', { name: 'AI 팀·비용 메뉴' })).getByRole('button', { name: '팀원·지시·예약', exact: true })
  await click(team)
  assert.equal(query('tab'), 'usage')
  assert.equal(screen.getByLabelText('요청문 · 최대 6,000자').value, '보존할 요청문')
  assert.equal(confirmations, 1)
  await click(screen.getByRole('button', { name: 'API 실행·결과 확인', exact: true }))
  window.confirm = () => true
  await click(team)
  assert.equal(query('tab'), 'usage')
  assert.equal(calls, 1)
  await act(async () => finish({ text: '테스트 전용 결과', cost: 0.002, status: 'completed' }))
  await click(team)
  assert.equal(query('tab'), 'team')
  assert.equal(query('date'), '2026-11-12')
})

test('AI team instructions stay intact when switching to costs is declined', async () => {
  const screen = await mount('admin', 'agents', {}, '/agents')
  await type(screen.getByRole('textbox', { name: '업무 지시', exact: true }), '아직 보내지 않은 업무')
  window.confirm = () => false
  await click(within(screen.getByRole('navigation', { name: 'AI 팀·비용 메뉴' })).getByRole('button', { name: '사용·비용', exact: true }))
  assert.equal(query('tab'), null)
  assert.equal(screen.getByRole('textbox', { name: '업무 지시', exact: true }).value, '아직 보내지 않은 업무')
})

test('AI search aliases show one combined menu destination', async () => {
  const screen = await mount('member', 'agents', {}, '/agents')
  await act(async () => user.keyboard('{Control>}k{/Control}'))
  const search = panel('전체 검색 · 빠른 이동')
  for (const keyword of ['AI팀', 'AI 사용', '비용', '예산']) {
    await type(search.getByRole('textbox', { name: '전체 검색', exact: true }), keyword)
    assert.equal(search.getAllByRole('option', { name: 'AI 팀·비용 메뉴', exact: true }).length, 1)
    assert.equal(search.queryByRole('option', { name: 'AI 사용·비용 메뉴', exact: true }), null)
  }
})


test('AI cost configuration keeps drafts and blocks navigation until a simulated save settles', async () => {
  api.mode = 'supabase'
  api.getAiState = async () => ({ models: [], budgets: [], usage: [] })
  let finish, saves = 0
  api.configureAi = () => { saves++; return new Promise(resolve => { finish = resolve }) }
  const screen = await mount('admin', 'agents', {}, '/agents?tab=usage')
  await click(screen.getByRole('button', { name: '모델·기간 한도 설정', exact: true }))
  await type(screen.getByLabelText('이 도구에 배정할 달러 한도'), '2')
  const nav = within(screen.getByRole('navigation', { name: 'AI 팀·비용 메뉴' }))
  window.confirm = () => false
  await click(nav.getByRole('button', { name: '팀원·지시·예약', exact: true }))
  await click(screen.getByRole('button', { name: '설정 닫기', exact: true }))
  assert.equal(query('tab'), 'usage')
  assert.equal(screen.getByLabelText('이 도구에 배정할 달러 한도').value, '2')
  assert.equal(saves, 0)
  await click(screen.getByRole('button', { name: '설정 저장', exact: true }))
  window.confirm = () => true
  await click(nav.getByRole('button', { name: '팀원·지시·예약', exact: true }))
  assert.equal(query('tab'), 'usage')
  assert.equal(saves, 1)
  await act(async () => finish())
  await click(nav.getByRole('button', { name: '팀원·지시·예약', exact: true }))
  assert.equal(query('tab'), 'team')
})

test('a newly created demo AI teammate is selected after its draft guard is released', async () => {
  const screen = await mount('admin', 'agents', {}, '/agents')
  await click(screen.getByRole('button', { name: '새 AI 팀원', exact: true }))
  const form = panel('새 AI 팀원')
  await type(form.getByLabelText('이름 (채팅에서 @이름 으로 부름)'), '메뉴 통합 테스트 담당')
  let confirmations = 0
  window.confirm = () => { confirmations++; return false }
  await click(form.getByRole('button', { name: '만들기', exact: true }))
  assert.equal(screen.queryByRole('dialog', { name: '새 AI 팀원', exact: true }) === null, true)
  assert.ok(query('ai'))
  assert.equal(confirmations, 0)
})


test('Instagram capture checks status on opening and hides admin controls from members', async () => {
  let calls=[]
  api.instagramContacts=async action=>{calls.push(action);return {configured:false,hasMore:false}}
  let screen=await mount('member','contact')
  assert.equal(screen.queryByText('인스타그램 담당자 후보 연결'),null)
  assert.deepEqual(calls,[])
  await act(async()=>root.unmount());root=null
  screen=await mount('admin','contact')
  assert.deepEqual(calls,[])
  await openContactIntake(screen)
  assert.deepEqual(calls,[])
  await click(screen.getByText('인스타그램 담당자 후보 연결'))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  assert.deepEqual(calls,['status'])
  assert.equal(screen.getByRole('button',{name:'대화 후보 가져오기',exact:true}).disabled,true)
})
test('Instagram capture preserves a retryable checkpoint and blocks duplicate submissions',async()=>{
  let syncs=0,finish
  api.instagramContacts=async action=>action==='status'?{configured:true,hasMore:true}:new Promise(resolve=>{syncs++;finish=resolve})
  const screen=await mount('admin','contact')
  api.mode='supabase'
  await openContactIntake(screen)
  await click(screen.getByText('인스타그램 담당자 후보 연결'))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  await click(screen.getByRole('button',{name:'다음 대화 후보 가져오기',exact:true}))
  assert.equal(screen.getByRole('button',{name:'후보 확인·저장 중…',exact:true}).disabled,true)
  assert.equal(syncs,1)
  await act(async()=>finish({inserted:2,kept:3,hasMore:true}))
  assert.ok(screen.getByText(/새 후보 2건 · 기존 후보 3건 유지/))
  api.instagramContacts=async action=>{if(action==='sync')throw new Error('저장 확인 실패');return {configured:true,hasMore:true}}
  await click(screen.getByRole('button',{name:'다음 대화 후보 가져오기',exact:true}))
  assert.ok(screen.getByText('저장 확인 실패'))
  assert.equal(screen.getByRole('button',{name:'다음 대화 후보 가져오기',exact:true}).disabled,false)
})


test('sales hub preserves URL context and guards unsaved tender across tabs',async()=>{
 const s=await mount('admin','sales',{},'/sales?tab=tenders&campaign=retained'),nav=within(s.getByRole('navigation',{name:'영업 업무'}))
 await click(s.getByRole('button',{name:'+ 공고 등록'}));await type(panel('새 나라장터').getByLabelText('제목 *'),'미저장 공고')
 await click(nav.getByRole('button',{name:'민간 영업 후보'}));assert.equal(query('tab'),'tenders');assert.equal(panel('새 나라장터').getByLabelText('제목 *').value,'미저장 공고')
 window.confirm=()=>true;await click(nav.getByRole('button',{name:'민간 영업 후보'}));assert.equal(query('tab'),'contacts');assert.equal(query('campaign'),'retained');assert.ok(s.getByRole('button',{name:'+ 연락처 등록'}))
})
const discoveryTender=()=>({kind:'tender',title:'테스트용 행사 공고',target:'예시 기관',source_url:'https://example.com/tender',verified_on:'2026-01-01',evidence:'테스트용 원문 검토',need:'행사 수요',offer:'현장 운영',next_action:'자격 증빙 확인',number:'TEST-ONLY',round:'000',deadline:'2099-11-23T11:00:00+09:00',deadlines:'방문제출11:00 / 전자가격14:00 KST',amount:46500000,qualification:'충족'})
test('research file is reviewed then linked once with provenance and no contract amount',async()=>{
 const s=await mount('admin','sales',{},'/sales?tab=tenders');await click(s.getByRole('button',{name:'발굴 보고서 가져오기'}));const imp=panel('발굴 결과 가져오기')
 const f=new window.File(['{}'],'candidate.json',{type:'application/json'});Object.defineProperty(f,'text',{value:async()=>JSON.stringify(discoveryTender())});await act(async()=>user.upload(imp.getByLabelText('발굴 보고서 파일'),f))
 assert.equal(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')??'[]').length,0);await click(imp.getByRole('button',{name:'이 후보 검토해 등록'}))
 let ed=panel('새 나라장터');assert.equal(ed.getByLabelText('참가 조건').value,'추가 확인');assert.match(ed.getByLabelText('메모·체크리스트').value,/방문제출11:00/)
 await click(ed.getByRole('button',{name:'저장',exact:true}));ed=panel('테스트용 행사 공고');await click(ed.getByRole('button',{name:'영업 기회로 연결'}))
 const a=JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items;assert.equal(a.length,1);assert.equal(a[0].source,'나라장터');assert.equal(a[0].expected_amount,null);assert.equal(a[0].stage,'발굴');assert.match(a[0].description,/방문제출11:00/);assert.match(a[0].description,/자격 증빙 확인/)
 assert.equal(query('tab'), 'tenders');assert.equal(query('id'), null)
 await click(panel('테스트용 행사 공고').getByRole('button',{name:'영업 계획 열기'}));assert.equal(query('id'),a[0].id)
 const plan = panel('영업 정보 수정')
 assert.equal(plan.getByLabelText('영업 건 이름 *').value, '테스트용 행사 공고')
 assert.equal(plan.getByLabelText('브랜드·발주기관').value, '예시 기관')
 await click(plan.getByText('출처와 단계 안내', { exact: true }))
 assert.ok(plan.getByText('TEST-ONLY / 000'));assert.ok(plan.getByText('추가 확인', { selector: 'dd' }))
})
test('pending research file read blocks tab navigation and closing',async()=>{
 const s=await mount('member','sales',{},'/sales?tab=tenders');await click(s.getByRole('button',{name:'발굴 보고서 가져오기'}));const imp=panel('발굴 결과 가져오기');let finish
 const f=new window.File(['{}'],'candidate.json',{type:'application/json'});Object.defineProperty(f,'text',{value:()=>new Promise(resolve=>{finish=resolve})});await act(async()=>user.upload(imp.getByLabelText('발굴 보고서 파일'),f))
 window.confirm=()=>true;await click(within(s.getByRole('navigation',{name:'영업 업무'})).getByRole('button',{name:'수주 파이프라인'}));assert.equal(query('tab'),'tenders');assert.equal(closeButton(imp).disabled,true);await click(imp.getAllByRole('button',{name:'닫기',exact:true})[0]);assert.ok(panel('발굴 결과 가져오기'))
 await act(async()=>finish(JSON.stringify(discoveryTender())));assert.ok(imp.getByRole('button',{name:'이 후보 검토해 등록'}))
})
test('sales source filter shows public leads without changing other records',async()=>{
 const s=await mount('admin'),{newSalesDraft}=await server.ssrLoadModule('/src/lib/sales.ts'),owner='00000000-0000-4000-8000-000000000001'
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'민간 테스트',source:'직접 발굴'},0);await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'공공 테스트',source:'나라장터'},0)
 await act(async()=>user.selectOptions(s.getByLabelText('유입 경로 필터'),'나라장터'));assert.ok(s.getByRole('button',{name:/공공 테스트/}));assert.equal(s.queryByRole('button',{name:/민간 테스트/}),null)
 await act(async()=>user.selectOptions(s.getByLabelText('유입 경로 필터'),''));assert.ok(s.getByRole('button',{name:/민간 테스트/}));assert.equal(JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items.length,2)
})


test('sales execution queues find unscheduled leads, assigned work and won handoffs', async()=>{
 const s=await mount('admin'),{newSalesDraft}=await server.ssrLoadModule('/src/lib/sales.ts'),owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'연락일 없는 신규 후보'},0)
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(other),title:'다른 담당 후보'},0)
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'계약 확인 후 인계',stage:'수주',result_note:'테스트용 계약 근거'},0)
 await click(s.getByRole('button',{name:'연락일 미정',exact:true}));assert.ok(s.getByRole('button',{name:/연락일 없는 신규 후보/}));assert.ok(s.getByRole('button',{name:/다른 담당 후보/}));assert.equal(s.queryByRole('button',{name:/계약 확인 후 인계/}),null)
 await click(s.getByLabelText('내 담당만'));assert.equal(s.queryByRole('button',{name:/다른 담당 후보/}),null)
 await click(s.getByRole('button',{name:'수주 후 프로젝트 연결 대기',exact:true}));assert.ok(s.getByRole('button',{name:/계약 확인 후 인계/}));assert.equal(s.queryByRole('button',{name:/연락일 없는 신규 후보/}),null)
 await click(s.getByRole('button',{name:'전체 기회',exact:true}));assert.ok(s.getByRole('button',{name:/연락일 없는 신규 후보/}));assert.ok(s.getByRole('button',{name:/계약 확인 후 인계/}));assert.equal(JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items.length,3)
})
test('origin load failure leaves the sales detail editable and can retry independently',async()=>{
 const s=await mount('admin'),{newSalesDraft}=await server.ssrLoadModule('/src/lib/sales.ts'),owner='00000000-0000-4000-8000-000000000001'
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'발굴 자료 오류 검사'},0)
 api.listSalesOrigins=async()=>{throw new Error('원문 조회 일시 오류')}
 await click(s.getByRole('button',{name:'연락일 미정',exact:true}));await click(s.getByRole('button',{name:/발굴 자료 오류 검사/}));let d=panel('발굴 자료 오류 검사')
 assert.ok(d.getByText('원문 조회 일시 오류'));assert.equal(d.getByRole('button',{name:'영업 정보 수정'}).disabled,false)
 api.listSalesOrigins=async()=>[{id:'origin',kind:'tender',title:'보존된 공고',status:'검토',updated_at:'2026-11-13',document:{division:'AR',source_url:'https://example.com/notice',note:'방문 제출 11시 / 가격 제출 14시',number:'TEST-26',round:'001',agency:'테스트 기관',deadline:'2026-11-20T11:00:00+09:00',qualification:'추가 확인'}}]
 await click(d.getByRole('button',{name:'발굴 자료 다시 확인'}));assert.ok(d.getByText('TEST-26 / 001'));assert.ok(d.getByText('테스트 기관'));assert.equal(d.getByRole('link',{name:'발굴 자료 출처 열기'}).getAttribute('href'),'https://example.com/notice');assert.ok(d.getByText('방문 제출 11시 / 가격 제출 14시'))
})


test('interior tender presets only prepare construction queries and preserve explicit review',async()=>{
 const s=await mount('admin','sales',{},'/sales?tab=tenders'),calls=[]
 api.searchTenders=async q=>{calls.push(structuredClone(q));return tenderResult()}
 await click(s.getByRole('button',{name:'나라장터 공식 공고 조회',exact:true}));const form=panel('나라장터 공식 공고 조회')
 await click(form.getByRole('button',{name:'실내건축',exact:true}));assert.equal(form.getByLabelText('조회 업무').value,'construction');assert.equal(form.getByLabelText('공고명 검색어').value,'실내건축');assert.equal(calls.length,0)
 await click(form.getByRole('button',{name:'공간 설계',exact:true}));assert.equal(form.getByLabelText('조회 업무').value,'service');assert.equal(calls.length,0)
 await click(form.getByRole('button',{name:'리모델링',exact:true}));await click(form.getByRole('button',{name:'공식 공고 조회',exact:true}));assert.equal(calls.length,1);assert.equal(calls[0].category,'construction')
 await click(form.getByRole('button',{name:'검토해 등록',exact:true}));const ed=panel('새 나라장터');assert.equal(ed.getByLabelText('수행 회사').value,'AR');assert.equal(ed.getByLabelText('참가 조건').value,'추가 확인');assert.equal(localStorage.getItem('wkly-growth-demo-v1'),null)
})


test('confirmed candidate-to-sales link survives a failed detail refresh without linking twice',async()=>{
 const s=await mount('admin','tender');await click(s.getByRole('button',{name:'+ 공고 등록'}));let ed=panel('새 나라장터')
 await type(ed.getByLabelText('제목 *'),'연결 응답 보존');await type(ed.getByLabelText('공고번호 *'),'TEST-LINK');await type(ed.getByLabelText('발주처 *'),'테스트 기관')
 await click(ed.getByRole('button',{name:'저장',exact:true}));ed=panel('연결 응답 보존')
 let links=0;api.linkGrowthSales=async(...args)=>{links++;return originals.linkGrowthSales(...args)};api.getGrowth=async()=>{throw new Error('갱신 통신 오류')}
 await click(ed.getByRole('button',{name:'영업 기회로 연결'}))
 const rows=JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).items;assert.equal(rows.length,1);assert.equal(links,1)
 assert.equal(ed.getByRole('link',{name:'연결 영업 기회 보기'}).getAttribute('href'),'/sales?id='+rows[0].id)
 assert.ok(ed.getByText(/영업 연결은 완료됐습니다/));assert.equal(ed.getByRole('button',{name:'저장',exact:true}).disabled,true);assert.equal(ed.getByLabelText('제목 *').matches(':disabled'),true)
 api.getGrowth=originals.getGrowth;await click(ed.getByRole('button',{name:'연결 자료 다시 확인'}));ed=panel('연결 응답 보존')
 assert.equal(ed.getByRole('button',{name:'저장',exact:true}).disabled,false);assert.equal(ed.queryByRole('button',{name:'영업 기회로 연결'}),null);assert.equal(links,1)
})

test('activity history failure leaves opportunity details and editing available with independent retry',async()=>{
 const s=await mount('admin'),{newSalesDraft}=await server.ssrLoadModule('/src/lib/sales.ts'),owner='00000000-0000-4000-8000-000000000001'
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'활동 조회 분리 검사',description:'보존할 요청'},0)
 let reads=0;api.getSales=async id=>{reads++;return originals.getSales(id)};api.listSalesActivities=async()=>{throw new Error('활동 목록 일시 오류')}
 await click(s.getByRole('button',{name:'연락일 미정',exact:true}));await click(s.getByRole('button',{name:/활동 조회 분리 검사/}));const d=panel('활동 조회 분리 검사')
 assert.ok(d.getByText('보존할 요청'));assert.equal(d.getByRole('button',{name:'영업 정보 수정'}).disabled,false);assert.ok(d.getByText(/활동 목록 일시 오류/))
 api.listSalesActivities=originals.listSalesActivities;await click(d.getByRole('button',{name:'활동 이력 다시 확인'}));assert.equal(reads,1);assert.ok(d.getByText('영업 건 등록 · 발굴'))
})

for(const kind of ['contact','tender']) test(kind+' research batch keeps unselected and failed candidates and retries stable IDs only',async()=>{
 const s=await mount('admin','sales',{},'/sales?tab='+ (kind==='tender'?'tenders':'contacts'))
 if (kind === 'contact') await openContactIntake(s)
 await click(s.getByRole('button',{name:'발굴 보고서 가져오기'}));let imp=panel('발굴 결과 가져오기')
 const rows=[1,2,3].map(i=>({...discoveryTender(),kind,title:'배치 후보 '+i,number:'BATCH-'+i,email:'batch'+i+'@example.test'}))
 const f=new window.File(['{}'],'batch.json',{type:'application/json'});Object.defineProperty(f,'text',{value:async()=>JSON.stringify(rows)});await act(async()=>user.upload(imp.getByLabelText('발굴 보고서 파일'),f))
 assert.equal(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')??'[]').length,0)
 await click(imp.getByLabelText('1번 후보 저장 선택'));await click(imp.getByLabelText('2번 후보 저장 선택'))
 const writes=[];let reject=true;api.saveGrowth=async(id,draft,revision)=>{writes.push({id,title:draft.title});if(draft.title==='배치 후보 2'&&reject)throw Object.assign(new Error('중복 검토 필요'),{code:'23505'});return originals.saveGrowth(id,draft,revision)}
 await click(imp.getByRole('button',{name:'선택한 후보 검토함에 저장'}))
 assert.equal(writes.length,2);assert.equal(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')).length,1);assert.equal(imp.queryByLabelText('1번 후보 저장 선택'),null);assert.ok(imp.getByLabelText('2번 후보 저장 선택'));assert.ok(imp.getByLabelText('3번 후보 저장 선택'))
 await click(imp.getByRole('button',{name:'발굴 후보 미리보기'}));assert.equal(imp.queryByLabelText('1번 후보 저장 선택'),null)
 reject=false;await click(imp.getByRole('button',{name:'남은 선택 후보 다시 저장'}))
 assert.equal(writes.length,3);assert.equal(writes[1].id,writes[2].id)
 const saved=JSON.parse(localStorage.getItem('wkly-growth-demo-v1'));assert.equal(saved.length,2);assert.ok(saved.every(r=>r.status==='검토'&&!r.linked_sales_id));if(kind==='tender')assert.ok(saved.every(r=>r.document.qualification==='추가 확인'))
 assert.ok(imp.getByLabelText('3번 후보 저장 선택'));assert.equal(localStorage.getItem('wkly-sales-demo-v1'),null)
})

test('research batch saving blocks tab changes and preserves remaining inputs',async()=>{
 const s=await mount('member','sales',{},'/sales?tab=tenders');await click(s.getByRole('button',{name:'발굴 보고서 가져오기'}));const imp=panel('발굴 결과 가져오기')
 const f=new window.File(['{}'],'batch.json',{type:'application/json'});Object.defineProperty(f,'text',{value:async()=>JSON.stringify(discoveryTender())});await act(async()=>user.upload(imp.getByLabelText('발굴 보고서 파일'),f));await click(imp.getByLabelText('1번 후보 저장 선택'))
 let finish;api.saveGrowth=(...args)=>new Promise(resolve=>{finish=async()=>resolve(await originals.saveGrowth(...args))})
 await click(imp.getByRole('button',{name:'선택한 후보 검토함에 저장'}));window.confirm=()=>true
 await click(within(s.getByRole('navigation',{name:'영업 업무'})).getByRole('button',{name:'수주 파이프라인'}));assert.equal(query('tab'),'tenders');assert.equal(closeButton(imp).disabled,true);assert.equal(imp.getByLabelText('발굴 보고서 JSON').disabled,true)
 await act(async()=>finish());assert.equal(JSON.parse(localStorage.getItem('wkly-growth-demo-v1')).length,1)
})


test('confirmed growth save and sales link use the returned record without a second detail request',async()=>{
 const s=await mount('admin','tender');await click(s.getByRole('button',{name:'+ 공고 등록'}));let ed=panel('새 나라장터')
 await type(ed.getByLabelText('제목 *'),'확정된 자료 유지');await type(ed.getByLabelText('공고번호 *'),'TEST-LINK-SECOND');await type(ed.getByLabelText('발주처 *'),'테스트 기관')
 await click(ed.getByRole('button',{name:'저장',exact:true}));ed=panel('확정된 자료 유지')
 let reads=0;api.getGrowth=async id=>{reads++;if(reads>1)throw new Error('불필요한 두 번째 상세조회');return originals.getGrowth(id)}
 await click(ed.getByRole('button',{name:'영업 기회로 연결'}));ed=panel('확정된 자료 유지');assert.equal(reads,1);assert.ok(ed.getByRole('link',{name:'연결 영업 기회 보기'}))
 await type(ed.getByLabelText('메모·체크리스트'),'연결 이후 기록');await click(ed.getByRole('button',{name:'저장',exact:true}));ed=panel('확정된 자료 유지')
 assert.equal(reads,1);assert.equal(ed.getByLabelText('메모·체크리스트').value,'연결 이후 기록');assert.ok(ed.getByRole('link',{name:'연결 영업 기회 보기'}))
})

test('stage playbook applies only next action after confirmation and keeps date, stage and original notes',async()=>{
 const s=await mount('admin');await click(s.getByRole('button',{name:'+ 영업 기회',exact:true}));const ed=panel('새 영업 기회')
 await type(ed.getByLabelText('영업 건 이름 *'),'공공 공간 제안');await act(async()=>user.selectOptions(ed.getByLabelText('수행 회사'),'AR'));await act(async()=>user.selectOptions(ed.getByLabelText('유입 경로'),'나라장터'));await act(async()=>user.selectOptions(ed.getByLabelText('진행 단계'),'제안'))
 await type(ed.getByLabelText('다음 행동'),'이미 합의한 업무');await type(ed.getByLabelText('다음 연락일'),'2026-11-20');await type(ed.getByLabelText('요청 내용·메모'),'보존할 공고 원문 요약')
 const guide=within(ed.getByRole('region',{name:'단계별 영업 실행 안내'}));await click(guide.getByRole('button',{name:'다음 행동 예시 적용'}));assert.equal(ed.getByLabelText('다음 행동').value,'이미 합의한 업무')
 window.confirm=()=>true;await click(guide.getByRole('button',{name:'다음 행동 예시 적용'}));assert.notEqual(ed.getByLabelText('다음 행동').value,'이미 합의한 업무');assert.equal(ed.getByLabelText('진행 단계').value,'제안');assert.equal(ed.getByLabelText('다음 연락일').value,'2026-11-20');assert.equal(ed.getByLabelText('요청 내용·메모').value,'보존할 공고 원문 요약');assert.equal(localStorage.getItem('wkly-sales-demo-v1'),null)
})

test('uncertain activity freezes original input and confirms the same request without a duplicate write',async()=>{
 const s=await mount('admin'),{newSalesDraft}=await server.ssrLoadModule('/src/lib/sales.ts'),{SalesActivityUnconfirmedError}=await server.ssrLoadModule('/src/lib/salesActivityRecovery.ts'),owner='00000000-0000-4000-8000-000000000001'
 await api.saveSales(crypto.randomUUID(),{...newSalesDraft(owner),title:'활동 응답 보존 검사'},0);await click(s.getByRole('button',{name:'연락일 미정',exact:true}));await click(s.getByRole('button',{name:/활동 응답 보존 검사/}));const d=panel('활동 응답 보존 검사')
 const writes=[];api.addSalesActivity=async(...args)=>{writes.push(args);await originals.addSalesActivity(...args);throw new SalesActivityUnconfirmedError()}
 await type(d.getByLabelText('활동 내용'),'  확인한 미팅 내용  ');await click(d.getByRole('button',{name:'활동 저장'}));assert.equal(d.getByLabelText('활동 내용').disabled,true);assert.equal(d.getByLabelText('활동 종류').disabled,true);assert.ok(d.getByRole('button',{name:'동일 내용으로 재시도'}))
 await click(d.getByRole('button',{name:'저장 상태 확인'}));assert.equal(writes.length,1);assert.equal(d.getByLabelText('활동 내용').value,'');assert.equal(d.getByLabelText('활동 내용').disabled,false);assert.ok(d.getByText('확인한 미팅 내용'))
 assert.equal(JSON.parse(localStorage.getItem('wkly-sales-demo-v1')).activities.filter(a=>a.kind==='메모').length,1)
})

test('won opportunity refreshes eligible projects while keeping its unsaved handoff draft',async()=>{
 const s=await mount('admin');api.listProjects=async()=>[];await click(s.getByRole('button',{name:'+ 영업 기회',exact:true}));const ed=panel('새 영업 기회')
 await type(ed.getByLabelText('영업 건 이름 *'),'수주 인계 보존');await act(async()=>user.selectOptions(ed.getByLabelText('수행 회사'),'AR'));await act(async()=>user.selectOptions(ed.getByLabelText('진행 단계'),'수주'));await type(ed.getByLabelText('결과·사유 (수주·실주·보류 필수)'),'계약 범위 확인');await type(ed.getByLabelText('요청 내용·메모'),'인계 자료')
 const link=ed.getByRole('link',{name:'새 프로젝트 만들기'});assert.equal(link.getAttribute('href'),'/projects?new=1');assert.equal(link.getAttribute('target'),'_blank')
 api.listProjects=async()=>[{id:'same',name:'같은 회사의 신규 프로젝트',division:'AR',client_id:null},{id:'other-company',name:'다른 회사 프로젝트',division:'TW',client_id:null},{id:'other-client',name:'다른 거래처 프로젝트',division:'AR',client_id:'client'}]
 await click(ed.getByRole('button',{name:'프로젝트 목록 새로고침'}));assert.ok(ed.getByRole('option',{name:'같은 회사의 신규 프로젝트'}));assert.equal(ed.queryByRole('option',{name:'다른 회사 프로젝트'}),null);assert.equal(ed.queryByRole('option',{name:'다른 거래처 프로젝트'}),null)
 await act(async()=>user.selectOptions(ed.getByLabelText('수주 프로젝트 연결'),'same'));await click(ed.getByRole('button',{name:'프로젝트 목록 새로고침'}));assert.equal(ed.getByLabelText('수주 프로젝트 연결').value,'same');assert.equal(ed.getByLabelText('요청 내용·메모').value,'인계 자료');assert.equal(ed.getByLabelText('결과·사유 (수주·실주·보류 필수)').value,'계약 범위 확인')
 api.listProjects=async()=>[];await click(ed.getByRole('button',{name:'프로젝트 목록 새로고침'}));await click(ed.getByRole('button',{name:'저장',exact:true}));assert.equal(localStorage.getItem('wkly-sales-demo-v1'),null);assert.equal(ed.getByLabelText('영업 건 이름 *').value,'수주 인계 보존')
})

test('Seoul files create an event draft and same-basis comparison for review before saving', async () => {
  const screen = await mount('admin', 'sales', {}, '/sales?tab=seoul')
  const csv = async (field, filename, text) => {
    const file = new window.File([text], filename, { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
    await act(async () => user.upload(screen.getByLabelText(field), file))
  }
  await csv('서울시 문화행사 CSV', '문화행사.csv', '공연/행사명,기관명,장소,시작일,종료일\n팝업 협력 행사,공식 주최사,DDP,2099-11-27,2099-11-29')
  await click(screen.getByRole('button', { name: '협업 후보로 검토' }))
  let editor = panel('새 영업 기회')
  assert.equal(editor.getByLabelText('브랜드·발주기관').value, '공식 주최사')
  assert.equal(editor.getByLabelText('오픈·행사 예정일').value, '2099-11-27')
  assert.match(editor.getByLabelText('요청 내용·메모').value, /DDP/)
  assert.equal(localStorage.getItem('wkly-sales-demo-v1'), null)
  await click(editor.getByRole('button', { name: '취소', exact: true }))
  await csv('서울시 상권 생활인구 CSV', '상권.csv',
    '기준_년분기_코드,상권_구분_코드_명,상권_코드,상권_코드_명,총_유동인구_수\n20262,발달상권,3120052,성수역,100\n20262,발달상권,3120103,홍대입구역,200')
  await click(screen.getByRole('button', { name: '성수역 3120052 비교에 추가' }))
  assert.equal(screen.queryByRole('button', { name: '비교 근거로 영업 기회 작성' }), null)
  await click(screen.getByRole('button', { name: '홍대입구역 3120103 비교에 추가' }))
  await click(screen.getByRole('button', { name: '비교 근거로 영업 기회 작성' }))
  editor = panel('새 영업 기회')
  assert.match(editor.getByLabelText('요청 내용·메모').value, /홍대입구역 \(3120103\)/)
  assert.equal(localStorage.getItem('wkly-sales-demo-v1'), null)
})
