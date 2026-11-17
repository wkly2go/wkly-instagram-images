// 현장 실측 (2026-11-17 대표 지시): 예전 사진의 미리보기 채우기 · 치수 선과 글자 절반 크기
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MARK_TEXT_MIN_PX, MARK_VIEW_WIDTH, OLD_MARK_SIZES, markSizes, markTag, markTagWidth } from '../src/lib/siteMarks.ts'
import { PREVIEW_MAX_BYTES, PREVIEW_MISS_KEY, PREVIEW_MISS_MAX, PREVIEW_MISS_RETRY_MS, PREVIEW_RETRY_KEY, PREVIEW_RETRY_MS, createPreviewMissStore, createSitePreviewBackfill, makeImagePreview, previewFailure, sitePreviewPath } from '../src/lib/imagePreview.ts'
import { createSignedUrlCache } from '../src/lib/signedUrlCache.ts'

const globals = globalThis as Record<string, any>
const originals = { window: globals.window, document: globals.document, Image: globals.Image }
const originalFetch = globalThis.fetch
let bundleFolder: string | null = null
after(async () => {
  Object.assign(globals, originals)
  globalThis.fetch = originalFetch
  if (bundleFolder) await rm(bundleFolder, { recursive: true, force: true })
})
const settle = () => new Promise(resolve => setImmediate(resolve))
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

// ---------------------------------------------------------------- 치수 선 · 글자 크기
const OLD = { text: 36, line: 5, halo: 10, endRadius: 9, endStroke: 4, draftRadius: 14, draftStroke: 5, tagHeight: 48, tagRadius: 6, textDy: 12 }
const oldTagWidth = (label: string) => label.length * 26 + 20

test('치수 크기: 사진이 넓게 보이면(PC) 선 · 점 · 글자 · 이름표가 예전의 정확히 절반이다', () => {
  assert.deepEqual(OLD_MARK_SIZES, { ...OLD, tagChar: 26, tagPad: 20 })
  const half = { text: 18, line: 2.5, halo: 5, endRadius: 4.5, endStroke: 2, draftRadius: 7, draftStroke: 2.5, tagHeight: 24, tagRadius: 3, textDy: 6 }
  for (const width of [1400, 1000, 868, 720]) {
    const { unit, tagChar, tagPad, ...sizes } = markSizes(width)
    assert.deepEqual(sizes, half, `사진 폭 ${width}px`)
    near(unit, MARK_VIEW_WIDTH / width)
    for (const label of ['900', '2100', '#12', '12345.5']) near(markTagWidth(label, { tagChar, tagPad }), oldTagWidth(label) / 2)
  }
  assert.deepEqual(markTag('2100', 500, 300, markSizes(1000)), { x: 500 - 31, y: 300 - 12, width: 62, height: 24, rx: 3, textX: 500, textY: 306 })
})

test('치수 크기: 선 · 흰 테두리 · 끝 점 · 시작점은 휴대폰(366px)과 아주 좁은 미리보기에서도 정확히 절반이다', () => {
  for (const width of [868, 366, 336, 296, 195, 120]) {
    const s = markSizes(width)
    for (const key of ['line', 'halo', 'endRadius', 'endStroke', 'draftRadius', 'draftStroke'] as const) assert.equal(s[key], OLD[key] / 2, `${key} @${width}px`)
  }
})

test('치수 크기: 휴대폰(366px)에서는 글자가 8px 에서 멈추고, 이름표가 가리는 넓이는 예전의 3분의 1 아래다', () => {
  const s = markSizes(366)
  const onScreen = (value: number) => value / s.unit
  near(onScreen(s.text), MARK_TEXT_MIN_PX)
  assert.equal(MARK_TEXT_MIN_PX, 8)
  assert.ok(s.text < OLD.text && s.text > OLD.text / 2)
  // 이름표는 글자를 따라가고 가운데에 맞춤
  near(s.tagRadius, s.text / 6)
  near(s.textDy, s.text / 3)
  const tag = markTag('2100', 500, 300, s)
  near(tag.x + tag.width / 2, 500)
  near(tag.y + tag.height / 2, 300)
  // 글자가 이름표 안에 들어간다 (숫자 한 자 폭은 글자 크기의 0.62배 이하)
  for (const label of ['45', '2100', '12500', '#12']) assert.ok(markTagWidth(label, s) >= label.length * s.text * 0.62, label)
  assert.ok(s.tagHeight >= s.text * 1.15)
  for (const label of ['45', '2100', '12500']) {
    const covered = (markTagWidth(label, s) * s.tagHeight) / (oldTagWidth(label) * OLD.tagHeight)
    assert.ok(covered <= 1 / 3, `${label}: ${covered}`)
  }
  // 갤럭시(사진 폭 336px)도 3분의 1쯤
  const g = markSizes(336)
  near(g.text / g.unit, MARK_TEXT_MIN_PX)
  assert.ok((markTagWidth('2100', g) * g.tagHeight) / (oldTagWidth('2100') * OLD.tagHeight) < 0.35)
})

test('치수 크기: 200 ~ 1400px 어느 폭에서도 예전보다 큰 것이 없고, 글자는 예전이 8px 보다 클 때 8px 아래로 안 내려간다', () => {
  for (let width = 200; width <= 1400; width += 2) {
    const s = markSizes(width)
    for (const key of Object.keys(OLD) as (keyof typeof OLD)[]) assert.ok(s[key] <= OLD[key] + 1e-9, `${key} @${width}px`)
    for (const label of ['7', '45', '2100', '12500', '#12', '12345.5']) assert.ok(markTagWidth(label, s) <= oldTagWidth(label) + 1e-9, `${label} @${width}px`)
    const oldPx = OLD.text / s.unit
    const px = s.text / s.unit
    assert.ok(px >= Math.min(oldPx, MARK_TEXT_MIN_PX) - 1e-9, `글자 @${width}px: ${px}`)
    assert.ok(px <= Math.max(oldPx / 2, MARK_TEXT_MIN_PX) + 1e-9, `글자 @${width}px: ${px}`)
  }
})

test('치수 크기: 폭을 아직 모르면 넓은 화면 기준이고, 폭이 좁아질수록 칸 단위 글자는 줄지 않는다', () => {
  for (const unknown of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(markSizes(unknown), markSizes(MARK_VIEW_WIDTH))
  let last = markSizes(1400)
  for (const width of [1000, 868, 700, 600, 500, 444, 390, 366, 336, 320, 296, 250, 200]) {
    const next = markSizes(width)
    assert.ok(next.text >= last.text, `text @${width}`)
    last = next
  }
})

// ---------------------------------------------------------------- 미리보기 자리
test('미리보기 자리: 예전 사진도 새 사진도 "<원본>.preview.webp" 이고 저장소 경로가 아닌 것은 없다', () => {
  assert.equal(sitePreviewPath('8f0c2a52/3a1b9c77.jpg'), '8f0c2a52/3a1b9c77.jpg.preview.webp')
  assert.equal(sitePreviewPath('project/preview-v1-test.jpg'), 'project/preview-v1-test.jpg.preview.webp')
  assert.equal(sitePreviewPath('project/photo.HEIC'), 'project/photo.HEIC.preview.webp')
  // 미리보기의 미리보기는 만들지 않는다
  assert.equal(sitePreviewPath('project/a.jpg.preview.webp'), null)
  // 체험 모드의 사진 주소 · 바깥 주소 · 빈 값
  for (const other of ['data:image/jpeg;base64,AAAA', 'blob:https://example.invalid/1', 'https://example.invalid/a.jpg', '']) assert.equal(sitePreviewPath(other), null)
})

// ---------------------------------------------------------------- 미리보기 만들기 (브라우저 흉내)
function fakeBrowser(options: { webp?: boolean; decodes?: boolean; sizes?: number[] } = {}) {
  const log = { encoded: [] as [string, number, number][], filled: 0, drawn: 0, canvases: [] as { width: number; height: number }[], decoded: 0 }
  const sizes = [...(options.sizes ?? [])]
  globals.window = { setTimeout, clearTimeout }
  globals.Image = class {
    naturalWidth = 4000
    naturalHeight = 3000
    onload!: () => void
    onerror!: () => void
    set src(_: string) { log.decoded++; queueMicrotask(() => (options.decodes === false ? this.onerror() : this.onload())) }
  }
  globals.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() { log.drawn++ }, fillRect() { log.filled++ }, fillStyle: '', globalCompositeOperation: 'source-over' }),
        toBlob(done: (blob: Blob) => void, type: string) {
          log.encoded.push([type, canvas.width, canvas.height])
          // WebP 로 저장하지 못하는 브라우저(사파리)는 PNG 를 돌려준다
          const actual = type === 'image/webp' && options.webp === false ? 'image/png' : type
          done(new Blob([new Uint8Array(sizes.shift() ?? (actual === 'image/png' ? 400_000 : 40_000))], { type: actual }))
        },
      }
      log.canvases.push(canvas)
      return canvas
    },
  }
  return log
}
const restoreBrowser = () => Object.assign(globals, originals)

test('미리보기 만들기: 파일이 아니라 내려받은 사진(Blob)으로도 만들고 캔버스를 비운다', async () => {
  const log = fakeBrowser()
  const original = new Blob([new Uint8Array(3_000_000)], { type: 'image/jpeg' })
  const preview = await makeImagePreview(original)
  assert.equal(preview?.type, 'image/webp')
  assert.ok(preview!.size <= PREVIEW_MAX_BYTES)
  assert.deepEqual(log.encoded, [['image/webp', 640, 480]])
  assert.deepEqual(log.canvases.map(c => [c.width, c.height]), [[0, 0]], '다 쓴 캔버스는 비운다')
  assert.equal(original.size, 3_000_000, '원본은 그대로')
  restoreBrowser()
})

test('미리보기 만들기: WebP 로 저장하지 못하는 브라우저는 현장 사진만 JPEG 로 만든다', async () => {
  const jpeg = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })
  let log = fakeBrowser({ webp: false })
  const preview = await makeImagePreview(jpeg, { compatible: true })
  assert.equal(preview?.type, 'image/jpeg')
  assert.deepEqual(log.encoded, [['image/webp', 640, 480], ['image/jpeg', 640, 480]])
  assert.equal(log.filled, 1, '투명한 곳은 흰색으로 채운다')
  // 다른 화면(채팅 · 설계)은 예전 그대로: PNG 가 크면 미리보기 없이 원본만
  log = fakeBrowser({ webp: false })
  assert.equal(await makeImagePreview(jpeg), null)
  assert.deepEqual(log.encoded.map(e => e[0]), ['image/webp', 'image/webp', 'image/webp'])
  assert.equal(log.filled, 0)
  // JPEG 도 크면 더 작게 다시
  log = fakeBrowser({ webp: false, sizes: [400_000, PREVIEW_MAX_BYTES + 1, 400_000, 30_000] })
  assert.equal((await makeImagePreview(jpeg, { compatible: true }))?.size, 30_000)
  assert.deepEqual(log.encoded.map(e => e.slice(1)), [[640, 480], [640, 480], [480, 360], [480, 360]])
  restoreBrowser()
})

test('미리보기 만들기: HEIC 는 현장 사진에서만 시도하고 브라우저가 읽지 못하면 null', async () => {
  const heic = new Blob([new Uint8Array(1000)], { type: 'image/heic' })
  let log = fakeBrowser({ decodes: false })
  assert.equal(await makeImagePreview(heic, { compatible: true }), null)
  assert.equal(log.decoded, 1)
  log = fakeBrowser({ decodes: false })
  assert.equal(await makeImagePreview(heic), null)
  assert.equal(log.decoded, 0, '다른 화면은 읽어 보지도 않는다 (예전 그대로)')
  log = fakeBrowser()
  assert.equal((await makeImagePreview(heic, { compatible: true }))?.type, 'image/webp', '읽을 수 있는 브라우저에서는 만든다')
  assert.equal(await makeImagePreview(new Blob(['%PDF'], { type: 'application/pdf' }), { compatible: true }), null)
  restoreBrowser()
})

// ---------------------------------------------------------------- 만들 수 없던 사진 기억
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}

test('만들 수 없던 사진은 7일 동안 기억하고 그 뒤에 다시 시도한다', () => {
  let time = 1_000_000_000_000
  const storage = memoryStorage()
  const misses = createPreviewMissStore({ storage, now: () => time })
  assert.equal(misses.has('p/a.heic'), false)
  misses.add('p/a.heic')
  assert.deepEqual(JSON.parse(storage.data.get(PREVIEW_MISS_KEY)!), { 'p/a.heic': time })
  // 창을 새로 열어도 (새 저장소 객체) 기억한다
  const reopened = createPreviewMissStore({ storage, now: () => time })
  assert.equal(reopened.has('p/a.heic'), true)
  assert.equal(reopened.has('p/b.jpg'), false)
  time += PREVIEW_MISS_RETRY_MS - 1
  assert.equal(reopened.has('p/a.heic'), true)
  time += 1
  assert.equal(reopened.has('p/a.heic'), false, '7일 뒤에는 다시 시도')
  assert.equal(misses.has('p/a.heic'), false)
  misses.add('p/c.heic')
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get(PREVIEW_MISS_KEY)!)), ['p/c.heic'], '지난 기록은 지운다')
  misses.remove('p/c.heic')
  assert.equal(misses.has('p/c.heic'), false)
  assert.equal(storage.data.get(PREVIEW_MISS_KEY), '{}')
})

test('기억은 최대 300개이고 저장소가 깨졌거나 쓸 수 없어도 화면을 멈추지 않는다', () => {
  let time = 2_000_000_000_000
  const storage = memoryStorage()
  const misses = createPreviewMissStore({ storage, now: () => time })
  for (let i = 0; i < PREVIEW_MISS_MAX + 20; i++) { time += 1000; misses.add(`p/${i}.heic`) }
  const saved = JSON.parse(storage.data.get(PREVIEW_MISS_KEY)!)
  assert.equal(Object.keys(saved).length, PREVIEW_MISS_MAX)
  assert.equal(`p/${PREVIEW_MISS_MAX + 19}.heic` in saved, true, '최근 것을 남긴다')
  assert.equal('p/0.heic' in saved, false)
  // 깨진 값 · 엉뚱한 값 · 앞날의 시각
  for (const broken of ['{not json', '[1,2]', '"text"', 'null', JSON.stringify({ 'p/x.jpg': 'yesterday', 'p/y.jpg': time + 86_400_000 })]) {
    const store = createPreviewMissStore({ storage: memoryStorage({ [PREVIEW_MISS_KEY]: broken }), now: () => time })
    assert.equal(store.has('p/x.jpg'), false)
    assert.equal(store.has('p/y.jpg'), false)
    store.add('p/x.jpg')
    assert.equal(store.has('p/x.jpg'), true)
  }
  // 저장소가 막힌 브라우저(사생활 보호 모드): 이 창 동안만 기억
  const blocked = createPreviewMissStore({ storage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }, now: () => time })
  blocked.add('p/z.heic')
  assert.equal(blocked.has('p/z.heic'), true)
  const none = createPreviewMissStore({ storage: null, now: () => time })
  none.add('p/z.heic')
  assert.equal(none.has('p/z.heic'), true)
  none.remove('p/z.heic')
  assert.equal(none.has('p/z.heic'), false)
})

// ---------------------------------------------------------------- 예전 사진의 미리보기 채우기 (가짜 저장소)
const legacy = 'project-1/11111111-aaaa.jpg'
const legacyPreview = `${legacy}.preview.webp`
const signedUrlOf = (path: string) => `https://files.example.invalid/storage/v1/object/sign/site-photos/${path}?token=fixture`
const pathOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/site-photos/')[1])

function setup(options: { objects?: Record<string, Blob>; concurrency?: number; retryStorage?: ReturnType<typeof memoryStorage>; makePreview?: (original: Blob) => Promise<Blob | null> } = {}) {
  const objects = new Map<string, Blob>(Object.entries(options.objects ?? { [legacy]: new Blob([new Uint8Array(2_500_000)], { type: 'image/jpeg' }) }))
  type Failure = { message: string; status?: number; statusCode?: string }
  const state = { time: 1_800_000_000_000, signFailure: false, signError: null as null | Failure, missingAsError: false, uploadFailure: null as null | Failure, downloadFailure: false, user: 'user-a' as string | null }
  const calls = { signMany: [] as string[], signOne: [] as string[], downloads: [] as string[], uploads: [] as { path: string; type: string; size: number; options: unknown }[], made: 0, active: 0, mostActive: 0 }
  const gate = { hold: false, waiting: [] as (() => void)[] }
  const bucket = {
    async createSignedUrls(paths: string[], expiresIn: number) {
      assert.equal(expiresIn, 3600)
      calls.signMany.push(...paths)
      if (state.signFailure) return { data: null, error: { message: 'Failed to fetch' } }
      if (state.signError) return { data: null, error: state.signError }
      // 없는 파일이 섞이면 요청 전체를 "없음"으로 답하는 서버
      if (state.missingAsError && paths.some(path => !objects.has(path))) return { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
      return { data: paths.map(path => (objects.has(path) ? { path, signedUrl: signedUrlOf(path), error: null } : { path, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' })), error: null }
    },
    async createSignedUrl(path: string) {
      calls.signOne.push(path)
      if (state.signFailure || !objects.has(path)) return { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
      return { data: { signedUrl: signedUrlOf(path) }, error: null }
    },
    async upload(path: string, body: Blob, uploadOptions: { contentType: string; upsert: boolean }) {
      calls.uploads.push({ path, type: body.type, size: body.size, options: uploadOptions })
      if (state.uploadFailure) return { data: null, error: state.uploadFailure }
      // 수정 권한이 없는 저장소: 같은 이름이 있으면 거절한다
      if (objects.has(path)) return { data: null, error: { message: 'The resource already exists', status: 400, statusCode: '409' } }
      objects.set(path, body)
      return { data: { path }, error: null }
    },
  }
  const cache = createSignedUrlCache({ now: () => state.time })
  cache.setScope(state.user)
  const storage = memoryStorage()
  const retryStorage = options.retryStorage ?? memoryStorage()
  const backfill = createSitePreviewBackfill({
    bucket: () => bucket,
    signed: (path, load) => cache.get({ bucket: 'site-photos', path }, load),
    invalidate: path => cache.invalidate('site-photos', path, { keepPending: true }),
    scope: () => state.user,
    now: () => state.time,
    misses: createPreviewMissStore({ storage, now: () => state.time }),
    retries: createPreviewMissStore({ storage: retryStorage, kind: 'session', key: PREVIEW_RETRY_KEY, retryMs: PREVIEW_RETRY_MS, now: () => state.time }),
    concurrency: options.concurrency,
    async fetchBlob(url) {
      calls.downloads.push(pathOf(url))
      calls.mostActive = Math.max(calls.mostActive, ++calls.active)
      try {
        if (gate.hold) await new Promise<void>(resolve => gate.waiting.push(resolve))
        if (state.downloadFailure) throw new Error('Failed to fetch')
        return objects.get(pathOf(url))!
      } finally { calls.active-- }
    },
    async makePreview(original) {
      calls.made++
      if (options.makePreview) return options.makePreview(original)
      // 이 브라우저가 읽지 못하는 형식
      return original.type === 'image/heic' ? null : new Blob([new Uint8Array(48_000)], { type: 'image/webp' })
    },
  })
  return { backfill, objects, state, calls, gate, storage, retryStorage, cache }
}

test('미리보기 주소: 아직 없는 예전 사진은 조용히 null 이고 원본은 건드리지 않는다', async () => {
  const f = setup()
  assert.equal(await f.backfill.previewUrl(legacy), null)
  assert.deepEqual(f.calls.signMany, [legacyPreview])
  assert.deepEqual([f.calls.signOne, f.calls.downloads, f.calls.uploads], [[], [], []], '미리보기 확인만으로는 원본을 서명하거나 받지 않는다')
  // 없다는 결과는 캐시에 남지 않는다: 다른 사람이 만들어 넣으면 바로 보인다
  f.objects.set(legacyPreview, new Blob(['preview'], { type: 'image/webp' }))
  assert.equal(await f.backfill.previewUrl(legacy), signedUrlOf(legacyPreview))
  assert.equal(await f.backfill.previewUrl(legacy), signedUrlOf(legacyPreview))
  assert.equal(f.calls.signMany.length, 2, '있는 미리보기 주소는 다시 서명하지 않는다')
  assert.equal(await f.backfill.previewUrl('data:image/jpeg;base64,AAAA'), null)
  assert.equal(f.calls.signMany.length, 2)
})

test('미리보기 주소: 확인하지 못한 것(연결 오류)은 "없음"으로 바꾸지 않는다', async () => {
  const f = setup()
  f.state.signFailure = true
  await assert.rejects(f.backfill.previewUrl(legacy), /미리보기를 열 수 없습니다/)
  // 그 상태에서 만들기를 불러도 원본을 받지 않고, 오류를 던지지도 기억하지도 않는다
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.deepEqual([f.calls.signOne, f.calls.downloads, f.calls.uploads], [[], [], []])
  f.state.signFailure = false
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview), '연결이 돌아오면 바로 만든다')
})

test('미리보기 주소: 서버가 요청 전체를 "없음"으로 답해도 없는 것으로 보고, 로그인 만료 · 서버 오류는 확인하지 못한 것으로 본다', async () => {
  const f = setup()
  f.state.missingAsError = true
  assert.equal(await f.backfill.previewUrl(legacy), null)
  for (const failure of [{ message: 'jwt expired', status: 400, statusCode: '403' }, { message: 'Internal Server Error', status: 500, statusCode: '500' }, { message: 'Too many requests', status: 429 }]) {
    f.state.signError = failure
    await assert.rejects(f.backfill.previewUrl(legacy), /미리보기를 열 수 없습니다/)
    assert.equal(await f.backfill.ensure(legacy), null)
  }
  assert.deepEqual([f.calls.signOne, f.calls.downloads, f.calls.uploads], [[], [], []], '확인하지 못한 동안에는 원본을 받지 않는다')
  f.state.signError = null
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.deepEqual([f.calls.downloads, f.calls.uploads.length], [[legacy], 1])
})

test('미리보기 만들기: 원본을 한 번 받아 만들어 넣고 주소를 돌려준다. 두 번째부터는 받지 않는다', async () => {
  const f = setup()
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.deepEqual(f.calls.downloads, [legacy])
  assert.deepEqual(f.calls.signOne, [legacy])
  assert.deepEqual(f.calls.uploads, [{ path: legacyPreview, type: 'image/webp', size: 48_000, options: { contentType: 'image/webp', upsert: false } }])
  assert.equal(f.objects.get(legacy)!.size, 2_500_000, '원본은 그대로')
  assert.equal(f.objects.get(legacyPreview)!.size, 48_000)
  // 다시 불러도 · 목록을 다시 열어도 원본을 받지 않는다
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.equal(await f.backfill.previewUrl(legacy), signedUrlOf(legacyPreview))
  assert.deepEqual([f.calls.downloads.length, f.calls.uploads.length, f.calls.made], [1, 1, 1])
  // 서명 주소가 만료된 뒤에도 미리보기만 다시 서명한다
  f.state.time += 2 * 3600_000
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.deepEqual([f.calls.downloads.length, f.calls.uploads.length], [1, 1])
})

test('미리보기 만들기: 같은 사진의 썸네일이 둘이어도 한 작업을 같이 쓴다', async () => {
  const f = setup()
  f.gate.hold = true
  const first = f.backfill.ensure(legacy)
  const second = f.backfill.ensure(legacy)
  assert.equal(first, second)
  await settle()
  assert.deepEqual(f.calls.downloads, [legacy])
  f.gate.hold = false
  f.gate.waiting.splice(0).forEach(go => go())
  assert.deepEqual(await Promise.all([first, second]), [signedUrlOf(legacyPreview), signedUrlOf(legacyPreview)])
  assert.deepEqual([f.calls.downloads.length, f.calls.uploads.length, f.calls.made], [1, 1, 1])
})

test('미리보기 만들기: 사진이 많아도 원본은 한 번에 2장씩만 받는다', async () => {
  const paths = Array.from({ length: 23 }, (_, i) => `project-2/photo-${i}.jpg`)
  const f = setup({ objects: Object.fromEntries(paths.map(path => [path, new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })])) })
  f.gate.hold = true
  const all = paths.map(path => f.backfill.ensure(path))
  await settle()
  assert.equal(f.calls.downloads.length, 2, '나머지는 차례를 기다린다')
  while (f.calls.uploads.length < paths.length) {
    f.gate.waiting.splice(0).forEach(go => go())
    await settle()
  }
  assert.deepEqual(await Promise.all(all), paths.map(path => signedUrlOf(`${path}.preview.webp`)))
  assert.equal(f.calls.mostActive, 2)
  assert.deepEqual(f.calls.downloads, paths, '먼저 보인 사진부터')
})

test('미리보기 만들기: 다른 사람이 먼저 넣었으면(이미 있음) 덮어쓰지 않고 그것을 쓴다', async () => {
  const f = setup()
  f.gate.hold = true
  const mine = f.backfill.ensure(legacy)
  await settle()
  // 내가 원본을 받는 동안 다른 사람이 같은 미리보기를 넣었다
  const theirs = new Blob([new Uint8Array(51_000)], { type: 'image/webp' })
  f.objects.set(legacyPreview, theirs)
  f.gate.hold = false
  f.gate.waiting.splice(0).forEach(go => go())
  assert.equal(await mine, signedUrlOf(legacyPreview))
  assert.equal(f.calls.uploads.length, 1)
  assert.equal(f.objects.get(legacyPreview), theirs, '먼저 들어간 것을 그대로 둔다')
  // 이미 있는 것을 알면 원본도 받지 않는다
  const g = setup()
  g.objects.set(legacyPreview, theirs)
  assert.equal(await g.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.deepEqual([g.calls.downloads, g.calls.uploads], [[], []])
})

test('미리보기 만들기: 브라우저가 읽지 못하는 사진은 null 이고 7일 동안 원본을 다시 받지 않는다', async () => {
  const heic = 'project-1/22222222-bbbb.heic'
  const f = setup({ objects: { [heic]: new Blob([new Uint8Array(3_000_000)], { type: 'image/heic' }) } })
  assert.equal(await f.backfill.ensure(heic), null)
  assert.deepEqual([f.calls.downloads, f.calls.uploads], [[heic], []])
  assert.deepEqual(Object.keys(JSON.parse(f.storage.data.get(PREVIEW_MISS_KEY)!)), [heic])
  assert.equal(await f.backfill.ensure(heic), null)
  f.state.time += 6 * 24 * 3600_000
  assert.equal(await f.backfill.ensure(heic), null)
  assert.equal(f.calls.downloads.length, 1, '기억하는 동안에는 받지 않는다')
  // 그사이 읽을 수 있는 다른 브라우저가 만들어 넣으면 바로 쓴다
  f.objects.set(`${heic}.preview.webp`, new Blob(['preview'], { type: 'image/jpeg' }))
  assert.equal(await f.backfill.ensure(heic), signedUrlOf(`${heic}.preview.webp`))
  assert.equal(f.calls.downloads.length, 1)
  // 아무도 못 만들었으면 7일 뒤 한 번 더
  const g = setup({ objects: { [heic]: new Blob([new Uint8Array(3_000_000)], { type: 'image/heic' }) } })
  assert.equal(await g.backfill.ensure(heic), null)
  g.state.time += PREVIEW_MISS_RETRY_MS
  assert.equal(await g.backfill.ensure(heic), null)
  assert.equal(g.calls.downloads.length, 2)
  // 올릴 때 이미 못 만든 사진은 처음부터 받지 않는다
  const h = setup({ objects: { [heic]: new Blob([new Uint8Array(3_000_000)], { type: 'image/heic' }) } })
  h.backfill.remember(heic)
  assert.equal(await h.backfill.ensure(heic), null)
  assert.deepEqual(h.calls.downloads, [])
})

test('미리보기 만들기: 저장 · 내려받기 실패는 오류 없이 null, 10분 동안 그 사진을 다시 받지 않는다', async () => {
  const f = setup()
  f.state.uploadFailure = { message: 'new row violates row-level security policy', status: 400, statusCode: '403' }
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.equal(f.objects.has(legacyPreview), false)
  assert.equal(f.storage.data.has(PREVIEW_MISS_KEY), false, '잠깐의 실패를 7일 기억에 넣지 않는다')
  f.state.uploadFailure = null
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.equal(f.calls.downloads.length, 1, '바로 다시 받지 않는다')
  f.state.time += 10 * 60_000
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.equal(f.calls.downloads.length, 2)
  // 내려받기 실패 · 원본이 없는 사진
  const g = setup()
  g.state.downloadFailure = true
  assert.equal(await g.backfill.ensure(legacy), null)
  assert.deepEqual(g.calls.uploads, [])
  assert.equal(await g.backfill.ensure('project-1/deleted.jpg'), null)
  assert.deepEqual(g.calls.downloads, [legacy], '원본 주소를 받지 못하면 내려받지 않는다')
})

test('미리보기 만들기: 3장 연속 실패하면 10분 동안 쉬어 원본을 계속 받지 않는다', async () => {
  const paths = Array.from({ length: 8 }, (_, i) => `project-3/photo-${i}.jpg`)
  const f = setup({ concurrency: 1, objects: Object.fromEntries(paths.map(path => [path, new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })])) })
  f.state.uploadFailure = { message: 'Bucket not found', status: 400, statusCode: '404' }
  assert.deepEqual(await Promise.all(paths.map(path => f.backfill.ensure(path))), paths.map(() => null))
  assert.equal(f.calls.downloads.length, 3, '줄 서 있던 나머지도 받지 않는다')
  assert.equal(await f.backfill.ensure(paths[7]), null)
  assert.equal(f.calls.downloads.length, 3)
  f.state.uploadFailure = null
  f.state.time += 10 * 60_000
  assert.equal(await f.backfill.ensure(paths[7]), signedUrlOf(`${paths[7]}.preview.webp`))
  // 성공하면 다시 센다
  f.state.uploadFailure = { message: 'Bucket not found', status: 400, statusCode: '404' }
  assert.equal(await f.backfill.ensure(paths[6]), null)
  assert.equal(await f.backfill.ensure(paths[5]), null)
  f.state.uploadFailure = null
  assert.equal(await f.backfill.ensure(paths[4]), signedUrlOf(`${paths[4]}.preview.webp`), '2장 실패로는 쉬지 않는다')
})

test('미리보기 만들기: 계정이 바뀌면 앞 사람의 진행 중 작업을 같이 쓰지 않는다', async () => {
  const f = setup()
  f.gate.hold = true
  const first = f.backfill.ensure(legacy)
  await settle()
  f.state.user = 'user-b'
  f.cache.setScope('user-b')
  const second = f.backfill.ensure(legacy)
  assert.notEqual(first, second, '새로 로그인한 사람은 자기 작업을 따로 시작한다')
  await settle()
  f.gate.hold = false
  f.gate.waiting.splice(0).forEach(go => go())
  assert.equal(await second, signedUrlOf(legacyPreview))
  await first // 앞 사람의 작업도 오류 없이 끝난다
  assert.equal(f.calls.uploads.length, 2)
  assert.equal(f.objects.get(legacyPreview)!.size, 48_000, '늦게 올린 쪽은 "이미 있음"으로 끝나 하나만 남는다')
})

// ---------------------------------------------------------------- 실제 API 묶음 + 가짜 서버 (요청 모양 확인)
test('실제 API: 예전 사진은 원본을 한 번만 받아 미리보기를 site-photos 에 넣고, 새 사진은 올릴 때 같이 넣는다', async () => {
  const here = dirname(fileURLToPath(import.meta.url))
  bundleFolder = await mkdtemp(join(here, '.site-preview-'))
  const bundle = join(bundleFolder, 'api.mjs')
  await build({ entryPoints: [join(here, '../src/lib/supabaseApi.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
  const { createSupabaseApi } = await import(pathToFileURL(bundle).href)

  const host = 'site-preview-fixture.example.invalid'
  const objects = new Map<string, { bytes: Uint8Array; type: string }>()
  type Call = { method: string; path: string; upsert?: string | null; type?: string; size?: number; paths?: string[] }
  const calls: Call[] = []
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const signRoot = '/storage/v1/object/sign/site-photos'
  const objectRoot = '/storage/v1/object/site-photos/'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, host, '운영 서버에는 요청하지 않는다')
    const path = decodeURIComponent(url.pathname)
    if (path === '/auth/v1/token') return respond({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'fixture-user', aud: 'authenticated', role: 'authenticated' } })
    if (path === '/auth/v1/logout') return respond({})
    const call: Call = { method: request.method, path }
    calls.push(call)
    if (path === signRoot && request.method === 'POST') {
      const { paths, expiresIn } = await request.json() as { paths: string[]; expiresIn: number }
      assert.equal(expiresIn, 3600)
      call.paths = paths
      return respond(paths.map(name => (objects.has(name) ? { path: name, signedURL: `/object/sign/site-photos/${name}?token=fake`, error: null } : { path: name, signedURL: null, error: 'Either the object does not exist or you do not have access to it' })))
    }
    if (path.startsWith(`${signRoot}/`)) {
      const name = path.slice(signRoot.length + 1)
      const object = objects.get(name)
      if (!object) return respond({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400)
      if (request.method === 'POST') return respond({ signedURL: `/object/sign/site-photos/${name}?token=fake` })
      assert.equal(url.searchParams.get('token'), 'fake')
      return new Response(object.bytes, { headers: { 'Content-Type': object.type } })
    }
    if (path.startsWith(objectRoot) && request.method === 'POST') {
      const name = path.slice(objectRoot.length)
      const file = (await request.formData()).get('') as File
      Object.assign(call, { upsert: request.headers.get('x-upsert'), type: file.type, size: file.size })
      // 수정 정책이 없는 저장소: 같은 이름은 거절
      if (objects.has(name)) return respond({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400)
      objects.set(name, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type })
      return respond({ Key: `site-photos/${name}`, Id: 'fixture-id' })
    }
    throw new Error(`Unexpected fixture request ${request.method} ${path}`)
  }) as typeof fetch
  const signed = (name: string) => `https://${host}${signRoot}/${name}?token=fake`
  const recent = (from: number) => calls.slice(from).map(c => `${c.method} ${c.path}`)

  const api = createSupabaseApi(`https://${host}`, 'fixture-key')
  await api.signIn('fixture@example.invalid', 'fixture-password')
  await api.getSessionUserId()

  // 1) 예전 사진 (미리보기 없이 올린 것)
  const legacyPhoto = 'project/legacy.jpg'
  objects.set(legacyPhoto, { bytes: new Uint8Array(2_000_000), type: 'image/jpeg' })
  assert.equal(await api.sitePhotoPreviewUrl(legacyPhoto), null)
  assert.deepEqual(recent(0), [`POST ${signRoot}`], '미리보기가 있는지만 묻는다')
  let mark = calls.length
  let log = fakeBrowser()
  assert.equal(await api.ensureSitePhotoPreview(legacyPhoto), signed(`${legacyPhoto}.preview.webp`))
  assert.deepEqual(recent(mark), [
    `POST ${signRoot}`, // 그사이 생겼는지 확인
    `POST ${signRoot}/${legacyPhoto}`, // 원본 주소
    `GET ${signRoot}/${legacyPhoto}`, // 원본 1회 내려받기
    `POST ${objectRoot}${legacyPhoto}.preview.webp`, // 미리보기 저장
    `POST ${signRoot}`, // 미리보기 주소
  ])
  const stored = calls.find(c => c.path === `${objectRoot}${legacyPhoto}.preview.webp`)!
  assert.deepEqual([stored.upsert, stored.type], ['false', 'image/webp'], '덮어쓰지 않고 WebP 로 넣는다')
  assert.ok(stored.size! <= PREVIEW_MAX_BYTES)
  assert.deepEqual(log.encoded, [['image/webp', 640, 480]])
  assert.equal(objects.get(legacyPhoto)!.bytes.length, 2_000_000, '원본은 그대로')
  // 다시 열어도 · 편집 창에서 원본을 열어도 새 요청이 없다 (서명 주소 캐시 공유)
  mark = calls.length
  assert.equal(await api.sitePhotoPreviewUrl(legacyPhoto), signed(`${legacyPhoto}.preview.webp`))
  assert.equal(await api.ensureSitePhotoPreview(legacyPhoto), signed(`${legacyPhoto}.preview.webp`))
  assert.equal(await api.sitePhotoUrl(legacyPhoto), signed(legacyPhoto))
  assert.deepEqual(recent(mark), [])

  // 2) WebP 로 저장하지 못하는 브라우저(아이폰 · 사파리)는 JPEG 미리보기를 같은 자리에 넣는다
  const iphonePhoto = 'project/iphone.jpg'
  objects.set(iphonePhoto, { bytes: new Uint8Array(1_500_000), type: 'image/jpeg' })
  log = fakeBrowser({ webp: false })
  assert.equal(await api.ensureSitePhotoPreview(iphonePhoto), signed(`${iphonePhoto}.preview.webp`))
  assert.equal(objects.get(`${iphonePhoto}.preview.webp`)!.type, 'image/jpeg')

  // 3) 새로 올리는 사진은 올릴 때 미리보기를 먼저 넣는다 (목록에서 원본을 다시 받을 일이 없다)
  mark = calls.length
  const uploaded = await api.uploadSitePhoto('project', new File([new Uint8Array(900_000)], 'IMG_0001.JPG', { type: 'image/jpeg' }))
  assert.match(uploaded.path, /^project\/preview-v1-[0-9a-f-]{36}\.jpg$/)
  assert.deepEqual(recent(mark), [`POST ${objectRoot}${uploaded.path}.preview.webp`, `POST ${objectRoot}${uploaded.path}`, `POST ${signRoot}/${uploaded.path}`])
  assert.equal(objects.get(`${uploaded.path}.preview.webp`)!.type, 'image/jpeg', '아이폰에서도 올릴 때 미리보기가 생긴다')
  assert.equal(await api.sitePhotoPreviewUrl(uploaded.path), signed(`${uploaded.path}.preview.webp`))

  // 4) 이 브라우저가 읽지 못하는 사진: 올릴 때 못 만들었으면 목록에서 원본을 다시 받지 않는다
  fakeBrowser({ decodes: false })
  const heic = await api.uploadSitePhoto('project', new File([new Uint8Array(700_000)], 'IMG_0002.HEIC', { type: 'image/heic' }))
  assert.match(heic.path, /^project\/[0-9a-f-]{36}\.heic$/)
  mark = calls.length
  assert.equal(await api.sitePhotoPreviewUrl(heic.path), null)
  assert.equal(await api.ensureSitePhotoPreview(heic.path), null)
  assert.deepEqual(recent(mark), [`POST ${signRoot}`, `POST ${signRoot}`], '원본을 서명하거나 내려받지 않는다')

  restoreBrowser()
  await api.signOut()
})

// ---------------------------------------------------------------- 실패를 나눠 세기 (2026-11-17 점검 뒤 보강)
const jpegOf = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

test('미리보기 만들기: 원본이 없는 사진 · 내려받다 끊긴 사진은 그 사진만 건너뛰고 다른 사진은 계속 만든다', async () => {
  const good = Array.from({ length: 5 }, (_, i) => `project-4/good-${i}.jpg`)
  const gone = Array.from({ length: 3 }, (_, i) => `project-4/gone-${i}.jpg`)
  const f = setup({ concurrency: 1, objects: Object.fromEntries(good.map(path => [path, jpegOf()])) })
  const shown = await Promise.all([...gone, ...good].map(path => f.backfill.ensure(path)))
  assert.deepEqual(shown, [...gone.map(() => null), ...good.map(path => signedUrlOf(`${path}.preview.webp`))], '맨 위의 없는 사진 3장 때문에 쉬지 않는다')
  assert.deepEqual(f.calls.downloads, good)
  // 약한 연결에서 내려받다 3번 끊겨도 쉬지 않는다
  const more = Array.from({ length: 4 }, (_, i) => `project-4/more-${i}.jpg`)
  for (const path of more) f.objects.set(path, jpegOf())
  f.state.downloadFailure = true
  assert.deepEqual(await Promise.all(more.slice(0, 3).map(path => f.backfill.ensure(path))), [null, null, null])
  f.state.downloadFailure = false
  assert.equal(await f.backfill.ensure(more[3]), signedUrlOf(`${more[3]}.preview.webp`))
  // 끊긴 사진은 10분 뒤에 다시
  assert.equal(await f.backfill.ensure(more[0]), null)
  f.state.time += PREVIEW_RETRY_MS
  assert.equal(await f.backfill.ensure(more[0]), signedUrlOf(`${more[0]}.preview.webp`))
})

test('미리보기 만들기: 잠깐의 실패(시간 초과 · 캔버스)는 7일 기억에 넣지 않고 이 창에 10분만 기억한다', async () => {
  let broken = true
  const f = setup({ makePreview: async () => { if (broken) throw new Error('캔버스를 만들지 못했습니다.'); return new Blob([new Uint8Array(48_000)], { type: 'image/webp' }) } })
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.equal(f.storage.data.has(PREVIEW_MISS_KEY), false, '7일 기억에는 없다')
  assert.ok(f.retryStorage.data.has(PREVIEW_RETRY_KEY), '이 창의 짧은 기억에 있다')
  broken = false
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.equal(f.calls.downloads.length, 1, '10분 안에는 다시 받지 않는다')
  f.state.time += PREVIEW_RETRY_MS
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  assert.equal(f.calls.downloads.length, 2)
})

test('미리보기 만들기: 읽지 못하는 사진과 잠깐의 실패를 구분해 알려 준다', async () => {
  const jpeg = jpegOf()
  fakeBrowser({ decodes: false })
  assert.equal(await makeImagePreview(jpeg, { compatible: true }), null)
  assert.equal(previewFailure(jpeg), 'unsupported')
  const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
  assert.equal(await makeImagePreview(pdf, { compatible: true }), null)
  assert.equal(previewFailure(pdf), 'unsupported')
  // 캔버스를 쓰지 못함 (휴대폰 메모리 부족 등)
  fakeBrowser()
  const make = globals.document.createElement
  globals.document.createElement = () => ({ ...make(), getContext: () => null })
  const second = jpegOf(2000)
  assert.equal(await makeImagePreview(second, { compatible: true }), null)
  assert.equal(previewFailure(second), 'transient')
  assert.equal(previewFailure(), 'transient', '파일을 주지 않으면 마지막 까닭')
  fakeBrowser()
  const third = jpegOf(3000)
  assert.ok(await makeImagePreview(third, { compatible: true }))
  assert.equal(previewFailure(third), null)
  assert.equal(previewFailure(), null)
  restoreBrowser()
  // 올릴 때의 실패도 같은 규칙: 잠깐의 실패는 10분, 읽지 못하는 사진은 7일
  const f = setup()
  f.backfill.remember(legacy, second)
  assert.equal(f.storage.data.has(PREVIEW_MISS_KEY), false)
  assert.equal(await f.backfill.ensure(legacy), null)
  assert.deepEqual(f.calls.downloads, [])
  f.state.time += PREVIEW_RETRY_MS
  assert.equal(await f.backfill.ensure(legacy), signedUrlOf(legacyPreview))
  const g = setup()
  g.backfill.remember(legacy, jpeg)
  assert.ok(g.storage.data.has(PREVIEW_MISS_KEY))
  g.state.time += PREVIEW_RETRY_MS
  assert.equal(await g.backfill.ensure(legacy), null)
  assert.deepEqual(g.calls.downloads, [])
})

test('미리보기 만들기: 쉬는 중은 새로 고쳐도(같은 창) 10분 동안 이어진다', async () => {
  const paths = Array.from({ length: 4 }, (_, i) => `project-5/photo-${i}.jpg`)
  const objects = Object.fromEntries(paths.map(path => [path, jpegOf()]))
  const f = setup({ concurrency: 1, objects })
  f.state.uploadFailure = { message: 'Bucket not found', status: 400, statusCode: '404' }
  assert.deepEqual(await Promise.all(paths.slice(0, 3).map(path => f.backfill.ensure(path))), [null, null, null])
  // 새로 고침: 새 작업기 · 같은 창의 기억
  const g = setup({ concurrency: 1, objects, retryStorage: f.retryStorage })
  assert.equal(await g.backfill.ensure(paths[3]), null)
  assert.deepEqual(g.calls.downloads, [], '쉬는 중에는 원본을 받지 않는다')
  g.state.time += PREVIEW_RETRY_MS
  assert.equal(await g.backfill.ensure(paths[3]), signedUrlOf(`${paths[3]}.preview.webp`))
})
