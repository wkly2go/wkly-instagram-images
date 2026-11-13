import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Real React components and events in jsdom, with the existing demo API.
// This verifies form/URL state, not browser layout, production roles or RLS.
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
let dom, server, React, act, createRoot, within, user, api, RouterProvider, AppProvider, Sales, Ads, CommandPalette, GrowthWorkspace, MeetingRecorder, MeetingStartUncertainError, root, originals

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/sales', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'StorageEvent', 'PopStateEvent', 'getComputedStyle']) {
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
  ;({ default: Ads } = await server.ssrLoadModule('/src/pages/Ads.tsx'))
  ;({ CommandPalette } = await server.ssrLoadModule('/src/components/CommandPalette.tsx'))
  ;({ GrowthWorkspace } = await server.ssrLoadModule('/src/components/GrowthWorkspace.tsx'))
  ;({ MeetingRecorder } = await server.ssrLoadModule('/src/components/MeetingRecorder.tsx'))
  ;({ MeetingStartUncertainError } = await server.ssrLoadModule('/src/lib/meetingProgress.ts'))
  assert.equal(api.mode, 'demo')
  originals = { saveSales: api.saveSales, saveGrowth: api.saveGrowth, startMeetingMinutes: api.startMeetingMinutes, getMeetingRecording: api.getMeetingRecording, searchTenders: api.searchTenders }
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
      kind === 'ads' ? React.createElement(React.Fragment, null, React.createElement(Ads), React.createElement(CommandPalette)) :
        React.createElement(kind === 'sales' ? Sales : kind === 'meeting' ? MeetingRecorder : GrowthWorkspace, kind === 'sales' ? {} : kind === 'meeting' ? props : { kind })))))
  return within(document.body)
}
async function click(element) { await act(async () => user.click(element)) }
async function type(element, value) { await act(async () => { await user.clear(element); await user.type(element, value) }) }
function panel(name) { return within(within(document.body).getByRole('dialog', { name, exact: true })) }
function query(key) { return new URL(location.href).searchParams.get(key) }
function closeButton(view) { return view.getAllByRole('button', { name: '닫기', exact: true }).at(-1) }

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
    assert.equal(!!screen.queryByRole('dialog', { name: 'DOM 검증 영업 기회', exact: true }), false)
  })

  test(`${role}: actual contact import retains failed IDs and retries only pending candidates`, async () => {
    const screen = await mount(role, 'contact'), calls = []
    let failed = false
    api.saveGrowth = async (id, draft, revision) => {
      calls.push({ id, draft: structuredClone(draft), revision })
      if (draft.document.email === 'beta@brand.example' && !failed) { failed = true; throw new Error('모의 저장 거부') }
      return originals.saveGrowth(id, draft, revision)
    }
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
  await click(screen.getByRole('link', { name: '거래처·담당자', exact: true }))
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
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'테스트 신규 고객 · 팝업·신제품')
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
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'두 번째 후보 · 팝업·신제품');assert.equal(editor.getByRole('button',{name:'저장',exact:true}).disabled,false)
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
 await type(editor.getByLabelText('확인 근거'),'브랜드 공식 공지의 날짜 확인')
 await act(async()=>user.selectOptions(editor.getByLabelText('일정 확인 상태'),'확인'))
 await click(editor.getByRole('button',{name:'발굴 계획을 영업 정보에 적용',exact:true}))
 assert.equal(editor.getByLabelText('영업 건 이름 *').value,'테스트 공간 브랜드 · 2030 플래그십 오픈')
 assert.equal(editor.getByLabelText('수행 회사').value,'AR')
 await click(editor.getByRole('button',{name:'저장',exact:true}))
 const row=await api.getSales(query('id'))
 assert.equal(row.source_url,'https://example.com/opening');assert.equal(row.next_date,'2029-12-01')
 assert.match(row.description,/2030-03-01/);assert.match(row.description,/브랜드 공식 공지의 날짜 확인/)
 const detail=panel(row.title);assert.match(detail.getByText(/\[신규 영업 발굴 계획\]/).textContent,/권장 업무 일정/)
})
