import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPendingReads } from '../src/lib/pendingReads.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('같은 사용자의 동시에 진행 중인 같은 조회만 공유한다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  const response = deferred<string[]>()
  let calls = 0
  const load = () => { calls++; return response.promise }
  const first = reads.run('projects', load)
  const second = reads.run('projects', load)
  await Promise.resolve()
  assert.equal(calls, 1)
  response.resolve(['shared'])
  assert.deepEqual(await Promise.all([first, second]), [['shared'], ['shared']])
  assert.deepEqual(await reads.run('projects', async () => { calls++; return ['fresh'] }), ['fresh'])
  assert.equal(calls, 2)
})

test('서로 다른 필터와 로그인 전 조회는 합치지 않는다', async () => {
  const reads = createPendingReads()
  let calls = 0
  const load = async () => ++calls
  assert.deepEqual(await Promise.all([reads.run('tasks-a', load), reads.run('tasks-a', load)]), [1, 2])
  reads.setScope('user-a')
  assert.deepEqual(await Promise.all([reads.run('tasks-a', load), reads.run('tasks-b', load)]), [3, 4])
})

test('실패를 공유하되 다음 조회에서 다시 시도한다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  let calls = 0
  const load = async () => { calls++; throw new Error('temporarily offline') }
  const settled = await Promise.allSettled([reads.run('projects', load), reads.run('projects', load)])
  assert.equal(calls, 1)
  assert.ok(settled.every(result => result.status === 'rejected' && result.reason.message === 'temporarily offline'))
  assert.deepEqual(await reads.run('projects', async () => ['recovered']), ['recovered'])
})

test('clear 이후 새 요청을 시작하며 이전 finally는 새 요청을 지우지 않는다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  const oldResponse = deferred<string>()
  const newResponse = deferred<string>()
  const old = reads.run('projects', () => oldResponse.promise)
  reads.clear()
  const current = reads.run('projects', () => newResponse.promise)
  oldResponse.resolve('old')
  assert.equal(await old, 'old')
  const joined = reads.run('projects', async () => { throw new Error('new request was removed') })
  newResponse.resolve('current')
  assert.deepEqual(await Promise.all([current, joined]), ['current', 'current'])
})

test('계정 변경 중 돌아온 이전 응답을 거부하고 새 계정 요청을 유지한다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  const oldResponse = deferred<string[]>()
  const currentResponse = deferred<string[]>()
  const old = reads.run('projects', () => oldResponse.promise)
  const rejected = assert.rejects(old, /로그인 상태가 변경/)
  reads.setScope('user-b')
  const current = reads.run('projects', () => currentResponse.promise)
  oldResponse.resolve(['user-a-private-data'])
  await rejected
  const joined = reads.run('projects', async () => { throw new Error('current user request lost') })
  currentResponse.resolve(['user-b-data'])
  assert.deepEqual(await Promise.all([current, joined]), [['user-b-data'], ['user-b-data']])
})

test('같은 사용자 토큰 갱신은 진행 중 조회를 유지하고 로그아웃은 거부한다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  const response = deferred<string>()
  const first = reads.run('tasks', () => response.promise)
  reads.setScope('user-a')
  const second = reads.run('tasks', async () => { throw new Error('same user refreshed') })
  const settled = Promise.allSettled([first, second])
  reads.setScope(null)
  response.resolve('old')
  assert.ok((await settled).every(result => result.status === 'rejected' && /로그인 상태가 변경/.test(result.reason.message)))
})

test('응답 배열의 정렬과 중첩 편집이 다른 화면이나 원본 응답에 영향을 주지 않는다', async () => {
  const reads = createPendingReads()
  reads.setScope('user-a')
  const source = [{ id: 'b', details: { tags: ['original'] } }, { id: 'a', details: { tags: [] as string[] } }]
  const response = deferred<typeof source>()
  const first = reads.run('projects', () => response.promise)
  const second = reads.run('projects', () => response.promise)
  response.resolve(source)
  const [one, two] = await Promise.all([first, second])
  one.reverse()
  one[1].details.tags.push('local draft')
  assert.deepEqual(two, [{ id: 'b', details: { tags: ['original'] } }, { id: 'a', details: { tags: [] } }])
  assert.deepEqual(source, two)
  assert.notEqual(one, two)
  assert.notEqual(two, source)
  assert.notEqual(two[0].details, source[0].details)
})
