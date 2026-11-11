import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSignedUrlCache } from '../src/lib/signedUrlCache.ts'

const photo = { bucket: 'site-photos', path: 'project/photo.png' }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('동시에 열거나 다시 여는 같은 파일은 한 번만 서명한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  const response = deferred<string>()
  let calls = 0
  const load = () => { calls++; return response.promise }
  const first = cache.get(photo, load)
  const second = cache.get(photo, load)
  await Promise.resolve()
  assert.equal(calls, 1)
  response.resolve('signed-preview')
  assert.deepEqual(await Promise.all([first, second]), ['signed-preview', 'signed-preview'])
  assert.equal(await cache.get(photo, load), 'signed-preview')
  assert.equal(calls, 1)
})

test('만료 1분 전부터 갱신하고 사용만으로 유효 시간을 연장하지 않는다', async () => {
  let time = 0
  let calls = 0
  const cache = createSignedUrlCache({ now: () => time })
  cache.setScope('user-a')
  const load = async () => `url-${++calls}`
  assert.equal(await cache.get(photo, load), 'url-1')
  time = 3_539_999
  assert.equal(await cache.get(photo, load), 'url-1')
  time = 3_540_000
  assert.equal(await cache.get(photo, load), 'url-2')
  assert.equal(calls, 2)
})

test('짧은 링크도 만료 전에 갱신한다', async () => {
  let time = 0
  let calls = 0
  const cache = createSignedUrlCache({ now: () => time })
  cache.setScope('user-a')
  const load = async () => `url-${++calls}`
  await cache.get(photo, load, 10)
  time = 4_999
  assert.equal(await cache.get(photo, load, 10), 'url-1')
  time = 5_000
  assert.equal(await cache.get(photo, load, 10), 'url-2')
})

test('미리보기·다운로드 이름·버킷을 구분한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  let calls = 0
  const load = async () => `url-${++calls}`
  const requests = [photo, { ...photo, download: 'a.png' }, { ...photo, download: 'b.png' }, { ...photo, bucket: 'chat-files' }]
  assert.deepEqual(await Promise.all(requests.map(r => cache.get(r, load))), ['url-1', 'url-2', 'url-3', 'url-4'])
  assert.equal(await cache.get(photo, load), 'url-1')
})

test('실패한 서명 요청을 캐시하지 않아 다음 시도에서 복구한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await assert.rejects(cache.get(photo, async () => { throw new Error('network') }), /network/)
  assert.equal(await cache.get(photo, async () => 'recovered'), 'recovered')
})

test('세션을 모를 때 URL을 저장하지 않는다', async () => {
  const cache = createSignedUrlCache()
  let calls = 0
  const load = async () => `url-${++calls}`
  assert.equal(await cache.get(photo, load), 'url-1')
  assert.equal(await cache.get(photo, load), 'url-2')
})

test('동일 사용자 토큰 갱신은 URL을 유지하고 로그아웃은 폐기한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await cache.get(photo, async () => 'a-old')
  cache.setScope('user-a')
  assert.equal(await cache.get(photo, async () => 'unused'), 'a-old')
  cache.setScope(null)
  cache.setScope('user-a')
  assert.equal(await cache.get(photo, async () => 'a-new'), 'a-new')
})

test('계정 전환 중 도착한 이전 사용자의 URL은 반환하거나 새 캐시에 넣지 않는다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  const response = deferred<string>()
  const old = cache.get(photo, () => response.promise)
  const rejected = assert.rejects(old, /접근 상태가 변경/)
  await Promise.resolve()
  cache.setScope('user-b')
  assert.equal(await cache.get(photo, async () => 'b-url'), 'b-url')
  response.resolve('a-url')
  await rejected
  assert.equal(await cache.get(photo, async () => 'unused'), 'b-url')
})

test('삭제 무효화는 같은 파일의 모든 다운로드 형식을 제거한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await cache.get(photo, async () => 'old-preview')
  await cache.get({ ...photo, download: 'x.png' }, async () => 'old-download')
  const other = { ...photo, path: 'other.png' }
  await cache.get(other, async () => 'other')
  cache.invalidate(photo.bucket, photo.path)
  assert.equal(await cache.get(photo, async () => 'new-preview'), 'new-preview')
  assert.equal(await cache.get({ ...photo, download: 'x.png' }, async () => 'new-download'), 'new-download')
  assert.equal(await cache.get(other, async () => 'unused'), 'other')
})

test('삭제 중 도착한 링크가 무효화된 파일을 다시 캐시에 넣지 않는다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  const response = deferred<string>()
  const old = cache.get(photo, () => response.promise)
  const rejected = assert.rejects(old, /접근 상태가 변경/)
  await Promise.resolve()
  cache.invalidate(photo.bucket, photo.path)
  response.resolve('deleted-file-url')
  await rejected
  assert.equal(await cache.get(photo, async () => 'replacement-url'), 'replacement-url')
})

test('같은 사진을 여러 화면에서 동시에 재시도해도 진행 중 재서명을 취소하지 않는다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await cache.get(photo, async () => 'old-preview')
  const response = deferred<string>()
  cache.invalidate(photo.bucket, photo.path, { keepPending: true })
  const first = cache.get(photo, () => response.promise)
  cache.invalidate(photo.bucket, photo.path, { keepPending: true })
  const second = cache.get(photo, async () => { throw new Error('duplicate renewal') })
  response.resolve('renewed-preview')
  assert.deepEqual(await Promise.all([first, second]), ['renewed-preview', 'renewed-preview'])
})

test('배치에서 이미 있는 URL과 중복 경로를 제외하고 입력 순서를 유지한다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await cache.get(photo, async () => 'existing')
  const second = { ...photo, path: 'second.png' }
  const third = { ...photo, path: 'third.png' }
  const received: string[][] = []
  const urls = await cache.getMany([second, photo, third, second], async missing => {
    received.push(missing.map(r => r.path))
    return missing.map(r => `url:${r.path}`)
  })
  assert.deepEqual(received, [['second.png', 'third.png']])
  assert.deepEqual(urls, ['url:second.png', 'existing', 'url:third.png', 'url:second.png'])
})

test('진행 중 배치와 단일 조회가 같은 파일을 중복 서명하지 않는다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  const response = deferred<string[]>()
  const batch = cache.getMany([photo], () => response.promise)
  const single = cache.get(photo, async () => { throw new Error('must not load') })
  response.resolve(['shared'])
  assert.deepEqual(await batch, ['shared'])
  assert.equal(await single, 'shared')
})

test('잘못된 배치 응답을 저장하지 않고 재시도할 수 있다', async () => {
  const cache = createSignedUrlCache()
  cache.setScope('user-a')
  await assert.rejects(cache.getMany([photo], async () => []), /파일 링크를 확인하지/)
  assert.deepEqual(await cache.getMany([photo], async () => ['retry']), ['retry'])
})

test('캐시가 커지면 최근에 보지 않은 URL부터 제거한다', async () => {
  const cache = createSignedUrlCache({ maxEntries: 2 })
  cache.setScope('user-a')
  const b = { ...photo, path: 'b.png' }
  const c = { ...photo, path: 'c.png' }
  await cache.get(photo, async () => 'a')
  await cache.get(b, async () => 'b')
  await cache.get(photo, async () => 'unused')
  await cache.get(c, async () => 'c')
  assert.equal(await cache.get(photo, async () => 'unused'), 'a')
  assert.equal(await cache.get(b, async () => 'b-new'), 'b-new')
})
