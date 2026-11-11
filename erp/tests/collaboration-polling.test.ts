import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVisiblePoller } from '../src/lib/visiblePolling.ts'
import { createSlackSnapshotLoader, slackContentVersion } from '../src/lib/slackSnapshot.ts'
import type { SlackLink, SlackMessage } from '../src/lib/types.ts'

const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function timers() {
  let id = 0
  const pending = new Map<number, { fn: () => void; ms: number }>()
  return {
    pending,
    setTimer(fn: () => void, ms: number) { pending.set(++id, { fn, ms }); return id },
    clearTimer(key: number) { pending.delete(key) },
    fire() {
      const first = pending.entries().next().value
      assert.ok(first, '예약된 갱신이 있어야 한다')
      pending.delete(first[0])
      first[1].fn()
    },
  }
}

test('접힘·미연결 또는 숨긴 화면에서는 조회하지 않고 펼침·복귀 시 갱신한다', async () => {
  const clock = timers()
  let visible = true
  let calls = 0
  const received: number[] = []
  const poller = createVisiblePoller({
    load: async () => ++calls, onValue: value => received.push(value), onError: assert.fail,
    isVisible: () => visible, intervalMs: 60_000, ...clock,
  })
  await poller.refresh()
  assert.equal(calls, 0)
  visible = false
  poller.setEnabled(true)
  await settle()
  assert.equal(calls, 0)
  assert.equal(clock.pending.size, 0)
  visible = true
  poller.visibilityChanged()
  await settle()
  assert.deepEqual(received, [1])
  assert.equal([...clock.pending.values()][0].ms, 60_000)
  poller.setEnabled(false)
  assert.equal(clock.pending.size, 0)
  await poller.refresh(true)
  assert.equal(calls, 1)
  poller.setEnabled(true)
  await settle()
  assert.deepEqual(received, [1, 2])
  visible = false
  poller.visibilityChanged()
  assert.equal(clock.pending.size, 0)
  poller.stop()
})

test('느린 조회 중 중복 포커스는 합치고 저장 신호가 몰려도 후속 조회 한 번만 실행한다', async () => {
  const clock = timers()
  const requests = [deferred<number>(), deferred<number>()]
  let calls = 0
  const received: number[] = []
  const poller = createVisiblePoller({
    load: () => requests[calls++].promise, onValue: value => received.push(value), onError: assert.fail,
    isVisible: () => true, intervalMs: 60_000, ...clock,
  })
  poller.setEnabled(true)
  poller.visibilityChanged()
  poller.visibilityChanged()
  await poller.refresh(true)
  await poller.refresh(true)
  assert.equal(calls, 1)
  assert.equal(clock.pending.size, 0)
  requests[0].resolve(1)
  await settle()
  assert.equal(calls, 2)
  assert.equal(clock.pending.size, 0)
  requests[1].resolve(2)
  await settle()
  assert.deepEqual(received, [1, 2])
  assert.equal(clock.pending.size, 1)
  poller.stop()
})

test('프로젝트를 떠난 뒤 늦게 온 결과는 새 화면에 전달하지 않는다', async () => {
  const clock = timers()
  const request = deferred<string>()
  const received: string[] = []
  const old = createVisiblePoller({
    load: () => request.promise, onValue: value => received.push(value), onError: assert.fail,
    isVisible: () => true, intervalMs: 60_000, ...clock,
  })
  old.setEnabled(true)
  old.stop()
  const next = createVisiblePoller({
    load: async () => '새 프로젝트', onValue: value => received.push(value), onError: assert.fail,
    isVisible: () => true, intervalMs: 60_000, ...clock,
  })
  next.setEnabled(true)
  request.resolve('이전 프로젝트')
  await settle()
  assert.deepEqual(received, ['새 프로젝트'])
  assert.equal(clock.pending.size, 1)
  next.stop()
  assert.equal(clock.pending.size, 0)
})

test('일시 오류는 기존 결과를 비우지 않고 다음 주기에 재시도한다', async () => {
  const clock = timers()
  const errors: unknown[] = []
  const received: number[] = []
  let calls = 0
  const poller = createVisiblePoller({
    load: async () => { if (++calls === 2) throw new Error('일시 오류'); return calls },
    onValue: value => received.push(value), onError: error => errors.push(error),
    isVisible: () => true, intervalMs: 60_000, ...clock,
  })
  poller.setEnabled(true)
  await settle()
  clock.fire()
  await settle()
  assert.deepEqual(received, [1])
  assert.equal(errors.length, 1)
  clock.fire()
  await settle()
  assert.deepEqual(received, [1, 3])
  poller.stop()
})

const link: SlackLink = {
  id: 'link-a', project_id: 'project-a', channel_id: 'channel-a', channel_name: '테스트',
  last_ts: '100', imported_count: 1, file_count: 0, last_imported_at: '2026-11-11T00:00:00Z',
}
const message = (id: string): SlackMessage => ({
  id, project_id: 'project-a', channel_id: 'channel-a', channel_name: '테스트', ts: id,
  thread_ts: null, user_name: '테스트 팀원', text: '테스트 대화', files: [], posted_at: '2026-11-11T00:00:00Z',
})

test('가져오기 확인 시각·오류만 달라지면 연결 상태만 갱신하고 대화 500개는 다시 받지 않는다', async () => {
  let current = { ...link }
  let messageCalls = 0
  const loader = createSlackSnapshotLoader({
    listSlackLinks: async project => { assert.equal(project, 'project-a'); return [current] },
    listSlackMessages: async (project, limit) => {
      assert.equal(project, 'project-a')
      assert.equal(limit, 500)
      messageCalls++
      return [message(String(messageCalls))]
    },
  }, 'project-a')
  const first = await loader.load()
  current = { ...current, last_imported_at: '2026-11-11T00:02:00Z', last_error: '다음 실행에 재시도' }
  const second = await loader.load()
  assert.equal(messageCalls, 1)
  assert.equal(second.links[0].last_imported_at, current.last_imported_at)
  assert.deepEqual(second.messages, first.messages)
  current = { ...current, last_ts: '101', imported_count: 2 }
  const third = await loader.load()
  assert.equal(messageCalls, 2)
  assert.equal(third.messages[0].id, '2')
})

test('연결 해제 뒤 남은 대화를 유지하고 채널 순서만 바뀌면 본문 갱신이 필요 없다', async () => {
  const other = { ...link, id: 'link-b', channel_id: 'channel-b' }
  const links = [link, other]
  assert.equal(slackContentVersion(links), slackContentVersion([other, link]))
  assert.deepEqual(links, [link, other])
  const loader = createSlackSnapshotLoader({ listSlackLinks: async () => [], listSlackMessages: async () => [message('보존됨')] }, 'project-a')
  assert.equal((await loader.load()).messages[0].id, '보존됨')
})

test('본문 조회가 실패하면 버전을 저장하지 않아 다음 확인에서 다시 본문을 읽는다', async () => {
  let calls = 0
  const loader = createSlackSnapshotLoader({
    listSlackLinks: async () => [link],
    listSlackMessages: async () => { if (++calls === 1) throw new Error('일시 오류'); return [message('복구')] },
  }, 'project-a')
  await assert.rejects(loader.load(), /일시 오류/)
  assert.equal((await loader.load()).messages[0].id, '복구')
  assert.equal(calls, 2)
})

test('수집 정보가 그대로여도 5분 뒤에는 정정·삭제된 대화까지 재확인한다', async () => {
  let time = 0
  let calls = 0
  const loader = createSlackSnapshotLoader({
    listSlackLinks: async () => [link],
    listSlackMessages: async () => { calls++; return calls === 1 ? [message('수정 전')] : [] },
  }, 'project-a', () => time)
  await loader.load()
  time = 299_999
  assert.equal((await loader.load()).messages.length, 1)
  assert.equal(calls, 1)
  time = 300_000
  assert.equal((await loader.load()).messages.length, 0)
  assert.equal(calls, 2)
})

test('진행 중 조회와 수동 갱신이 겹쳐도 수동 갱신 요구를 잃지 않는다', async () => {
  const pending = deferred<SlackMessage[]>()
  let calls = 0
  const loader = createSlackSnapshotLoader({
    listSlackLinks: async () => [link],
    listSlackMessages: async () => ++calls === 1 ? pending.promise : [message('갱신')],
  }, 'project-a')
  const first = loader.load()
  await settle()
  loader.forceMessages()
  pending.resolve([message('기존')])
  await first
  assert.equal((await loader.load()).messages[0].id, '갱신')
  assert.equal(calls, 2)
})
