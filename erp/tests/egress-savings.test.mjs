import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const temp = await mkdtemp(join(here, '.egress-'))
await build({ entryPoints: ['sharedFeed', 'tabTask', 'reportReads', 'imagePreview', 'supabaseApi'].map(n => join(here, `../src/lib/${n}.ts`)), outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
const load = name => import(pathToFileURL(join(temp, `${name}.mjs`)).href)
const { createSharedFeed } = await load('sharedFeed')
const { createTabTaskGate } = await load('tabTask')
const { approvalSummary, researchSummary, bodySearchPattern } = await load('reportReads')
const { previewSize, makeImagePreview, sitePreviewPath, PREVIEW_MAX_BYTES } = await load('imagePreview')
const { createSupabaseApi } = await load('supabaseApi')
const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, Image: globalThis.Image }
after(async () => { Object.assign(globalThis, originals); await rm(temp, { recursive: true, force: true }) })
const settle = () => new Promise(resolve => setImmediate(resolve))

function feedFixture() {
  let calls = 0, subscriptions = 0, visible = true, onVisible, changed, disconnected = 0
  const timers = new Map()
  let n = 0
  globalThis.window = { setTimeout: fn => { timers.set(++n, fn); return n }, clearTimeout: id => timers.delete(id) }
  const feed = createSharedFeed({ initial: [], load: async () => [{ id: ++calls }],
    connect: fn => { subscriptions++; changed = fn; return () => { disconnected++ } },
    isVisible: () => visible, onVisibility: fn => { onVisible = fn; return () => {} },
  })
  return { feed, timers, changed: () => changed(), visibility: v => { visible = v; onVisible() }, stats: () => ({ calls, subscriptions, disconnected }) }
}
test('여러 근태 화면은 한 조회·한 구독을 공유하고 마지막 화면이 닫히면 정리한다', async () => {
  const f = feedFixture()
  const a = f.feed.subscribe(() => {}), b = f.feed.subscribe(() => {})
  await settle()
  assert.deepEqual(f.stats(), { calls: 1, subscriptions: 1, disconnected: 0 })
  f.changed(); await settle()
  assert.equal(f.stats().calls, 2)
  a(); assert.equal(f.stats().disconnected, 0)
  b(); assert.equal(f.stats().disconnected, 1)
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.feed.getSnapshot(), [])
})
test('숨긴 근태 화면은 변경 이벤트에도 조회하지 않고 복귀하면 최신값을 받는다', async () => {
  const f = feedFixture(), off = f.feed.subscribe(() => {})
  await settle(); f.visibility(false); f.changed(); f.changed(); await settle()
  assert.equal(f.stats().calls, 1); assert.equal(f.timers.size, 0)
  f.visibility(true); await settle(); assert.equal(f.stats().calls, 2)
  off()
})
test('구독 해제 전에 시작한 늦은 결과는 재구독한 새 화면을 덮지 않는다', async () => {
  let resolve, calls = 0
  const feed = createSharedFeed({ initial: [], load: () => ++calls === 1 ? new Promise(r => { resolve = r }) : Promise.resolve(['new']), connect: () => () => {}, isVisible: () => true, onVisibility: () => () => {} })
  const old = feed.subscribe(() => {}); old()
  const next = feed.subscribe(() => {}); await settle()
  resolve(['old']); await settle(); assert.deepEqual(feed.getSnapshot(), ['new']); next()
})
function gateFixture() {
  const timestamps = new Map(), locks = new Set()
  let clock = 100_000
  const options = { now: () => clock, read: key => timestamps.get(key) || 0, write: (key, at) => timestamps.set(key, at), lock: async (key, work) => { if (locks.has(key)) return undefined; locks.add(key); try { return await work() } finally { locks.delete(key) } } }
  return { tabA: createTabTaskGate(options), tabB: createTabTaskGate(options), advance: ms => { clock += ms } }
}
test('동시 탭과 같은 주기의 알람은 한 번만 실행하며 다른 사용자는 별도 실행한다', async () => {
  const f = gateFixture(); let calls = 0
  const work = async () => { calls++; await settle(); return calls }
  await Promise.all([f.tabA('reminders:a', 60_000, work), f.tabB('reminders:a', 60_000, work)])
  assert.equal(calls, 1)
  await f.tabB('reminders:a', 60_000, work); assert.equal(calls, 1)
  await f.tabB('reminders:b', 60_000, work); assert.equal(calls, 2)
  f.advance(60_001); await f.tabB('reminders:a', 60_000, work); assert.equal(calls, 3)
})
test('실패한 알람 확인은 성공으로 기록하지 않아 재시도할 수 있다', async () => {
  const f = gateFixture()
  await assert.rejects(f.tabA('a', 60_000, async () => { throw new Error('temporary') }))
  assert.equal(await f.tabB('a', 60_000, async () => 7), 7)
})
test('목록에서 긴 본문은 제외하고 업무 날짜·프로젝트 연결은 보존한다', () => {
  const original = { id: 'a', content: '본문'.repeat(10000), decision_comment: 'comment', payload: { body: '메일'.repeat(10000), date: '2026-11-12', project_id: 'p' } }
  const list = approvalSummary(original)
  assert.equal(list.report_date, '2026-11-12'); assert.equal(list.project_id, 'p')
  for (const field of ['content', 'payload', 'decision_comment']) assert.equal(field in list, false)
  assert.ok(original.content.length > 10000)
  assert.deepEqual(researchSummary({ id: 'r', title: '제목', body: '원본' }), { id: 'r', title: '제목' })
  assert.equal(bodySearchPattern('50%_\\'), '%50\\%\\_\\\\%')
})
test('썸네일은 비율을 유지하며 작은 사진을 확대하지 않고 원본 경로와 구분한다', () => {
  assert.deepEqual(previewSize(4000, 3000), { width: 640, height: 480 })
  assert.deepEqual(previewSize(100, 200), { width: 100, height: 200 })
  assert.throws(() => previewSize(0, 500))
  assert.equal(sitePreviewPath('project/legacy.jpg'), null)
  assert.equal(sitePreviewPath('project/preview-v1-test.jpg'), 'project/preview-v1-test.jpg.preview.webp')
})
test('사진 미리보기 생성은 원본 파일을 바꾸지 않고 최대 크기 이하로 재시도한다', async () => {
  globalThis.window = { setTimeout, clearTimeout }
  const sizes = [PREVIEW_MAX_BYTES + 1, 1400], dimensions = []
  globalThis.Image = class { naturalWidth = 4000; naturalHeight = 3000; set src(_) { queueMicrotask(() => this.onload()) } }
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(cb) { dimensions.push([this.width, this.height]); cb(new Blob([new Uint8Array(sizes.shift())], { type: 'image/webp' })) } }) }
  const original = new File(['unchanged-original'], 'photo.png', { type: 'image/png' })
  const preview = await makeImagePreview(original)
  assert.equal(await original.text(), 'unchanged-original')
  assert.equal(preview.size, 1400); assert.deepEqual(dimensions, [[640, 480], [480, 360]])
  Object.assign(globalThis, { document: originals.document, Image: originals.Image })
})
test('미리보기를 만들 수 없는 파일은 원본 업로드 경로를 계속 사용할 수 있다', async () => {
  assert.equal(await makeImagePreview(new File(['pdf'], 'file.pdf', { type: 'application/pdf' })), null)
})

test('실제 API는 목록 본문을 요청하지 않고 상세 ID·본문 검색·비공개 썸네일을 분리한다', async () => {
  const calls = [], host = 'egress-fixture.example.invalid'
  const respond = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, host, '운영 API에는 요청하지 않는다')
    calls.push({ path: url.pathname, query: url.searchParams, method: request.method })
    if (url.pathname === '/auth/v1/token') return respond({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'fixture-user', aud: 'authenticated', role: 'authenticated' } })
    if (url.pathname === '/auth/v1/logout') return respond({})
    if (url.pathname.startsWith('/storage/v1/object/sign/')) return respond({ signedURL: '/object/sign/fixture?token=fake' })
    if (url.pathname.endsWith('/approvals')) return respond(url.searchParams.has('id') ? { id: 'a', content: 'detail', payload: {} } : [{ id: 'a', approval_activity: [{ count: 2 }] }])
    if (url.pathname.endsWith('/research_items')) return respond(url.searchParams.has('body') ? [{ id: 'r', client_id: 'c' }] : url.searchParams.has('id') ? { id: 'r', body: 'detail' } : [{ id: 'r', title: 'summary' }])
    throw new Error('Unexpected fixture request '+url.pathname)
  }
  const api = createSupabaseApi(`https://${host}`, 'fixture-key')
  await api.signIn('fixture@example.invalid', 'fixture-password')
  await api.getSessionUserId()
  await Promise.all([api.listApprovals(), api.listApprovals()])
  const approvals = calls.filter(c => c.path.endsWith('/approvals'))
  assert.equal(approvals.length, 1, '같은 시점의 목록 조회도 공유')
  const columns = approvals[0].query.get('select')
  assert.ok(!columns.includes('*') && !columns.includes('content') && !columns.includes('payload,'))
  assert.equal((await api.getApproval('a')).content, 'detail')
  await api.listResearch()
  assert.ok(!calls.at(-1).query.get('select').split(',').includes('body'))
  assert.equal((await api.getResearch('r')).body, 'detail')
  assert.deepEqual(await api.findResearchBodies(['본문', '본문']), [{ word: '본문', id: 'r', client_id: 'c' }])
  assert.equal(calls.at(-1).query.get('select'), 'id,client_id')
  const before = calls.length, att = { path: 'room/file.png', name: 'photo.png', type: 'image/png', size: 1000 }
  assert.equal(await api.filePreviewUrl(att), null)
  assert.equal(await api.filePreviewUrl({ ...att, preview_path: 'another/private.png' }), null)
  assert.equal(await api.sitePhotoPreviewUrl('project/legacy.jpg'), null)
  assert.equal(calls.length, before, '기존 원본은 미리보기 때문에 자동 다운로드하지 않는다')
  await api.filePreviewUrl({ ...att, preview_path: att.path+'.preview.webp' })
  assert.ok(calls.at(-1).path.endsWith('/room/file.png.preview.webp'))
  await api.fileUrl(att)
  assert.ok(calls.at(-1).path.endsWith('/room/file.png'))
  await api.signOut()
  globalThis.fetch = originals.fetch
})
