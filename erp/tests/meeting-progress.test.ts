import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchMeetingRecording, startMeetingProcessing, MeetingStartUncertainError, type MeetingProgressResult } from '../src/lib/meetingProgress.ts'
import type { MeetingRecording } from '../src/lib/types.ts'

const record = { id: 'keep-this-record', status: '처리 중', error: null, minutes: 'draft', transcript: 'text' } as MeetingRecording
function clock() {
  let now = 0, id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimer(fn: () => void, delay: number) { const key = ++id; timers.set(key, { at: now + delay, fn }); return key },
    clearTimer(key: unknown) { timers.delete(key as number) },
    async tick(ms: number) {
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at; timers.delete(next[0]); next[1].fn()
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      }
      now = end
    },
    count: () => timers.size,
  }
}
function watch(read: (id: string) => Promise<MeetingRecording | null>) {
  const timer = clock(), results: MeetingProgressResult[] = []
  const stop = watchMeetingRecording({ id: record.id, read, finish: r => results.push(r), intervalMs: 5, timeoutMs: 20, ...timer })
  return { timer, results, stop }
}

test('회의 조회가 계속 실패해도 전체 제한 시간에 중지하며 기존 ID 확인을 안내한다', async () => {
  const a = watch(async id => { assert.equal(id, record.id); throw new Error('offline') })
  await a.timer.tick(20)
  assert.equal(a.results.length, 1)
  const r = a.results[0]; assert.equal(r.kind, 'error')
  if (r.kind === 'error') { assert.equal(r.needsReview, true); assert.match(r.message, /keep-this-record/); assert.match(r.message, /다시 업로드하지 말고/) }
  assert.equal(a.timer.count(), 0)
})
test('진행 조회가 멈춘 경우에도 마감 타이머가 끝내고 늦은 완료 응답을 무시한다', async () => {
  let resolve!: (r: MeetingRecording) => void, calls = 0
  const a = watch(async () => { calls++; return new Promise<MeetingRecording>(r => { resolve = r }) })
  await a.timer.tick(19); assert.equal(calls, 1)
  await a.timer.tick(1); assert.equal(a.results[0]?.kind, 'error')
  resolve({ ...record, status: '완료' }); await Promise.resolve(); await Promise.resolve()
  assert.equal(a.results.length, 1); assert.equal(a.timer.count(), 0)
})
test('확인 필요 표식은 즉시 조회를 멈추고 새 생성 대신 기존 기록 확인을 요구한다', async () => {
  const a = watch(async () => ({ ...record, error: 'MEETING_REVIEW:결과 저장 상태 확인 필요' }))
  await a.timer.tick(5)
  const r = a.results[0]; assert.equal(r?.kind, 'error')
  if (r.kind === 'error') { assert.equal(r.needsReview, true); assert.match(r.message, /결과 저장 상태/); assert.doesNotMatch(r.message, /MEETING_REVIEW:/) }
  assert.equal(a.timer.count(), 0)
})
test('완료·명확한 실패 응답을 한 번만 전달하고 뒤의 타이머를 제거한다', async () => {
  for (const status of ['완료', '실패'] as const) {
    const a = watch(async () => ({ ...record, status, error: 'text required' }))
    await a.timer.tick(30)
    assert.equal(a.results.length, 1); assert.equal(a.results[0].kind, status === '완료' ? 'done' : 'error')
    if (a.results[0].kind === 'error') assert.equal(a.results[0].needsReview, false)
    assert.equal(a.timer.count(), 0)
  }
})
test('화면을 떠난 뒤 이미 진행 중이던 조회가 끝나도 결과를 적용하지 않는다', async () => {
  let resolve!: (r: MeetingRecording) => void
  const a = watch(() => new Promise<MeetingRecording>(r => { resolve = r }))
  await a.timer.tick(5); a.stop(); resolve({ ...record, status: '완료' })
  await a.timer.tick(30); assert.equal(a.results.length, 0); assert.equal(a.timer.count(), 0)
})
test('접수 응답 오류·유실 때 같은 기록을 보존하고 재호출하지 않는다', async () => {
  for (const mode of ['error', 'throw', 'body']) {
    let calls = 0
    await assert.rejects(startMeetingProcessing(record, async () => {
      calls++
      if (mode === 'throw') throw new Error('lost ack')
      return mode === 'body' ? { error: null, data: { error: 'uncertain' } } : { error: new Error('network') }
    }), error => error instanceof MeetingStartUncertainError && error.record === record && error.message.includes(record.id))
    assert.equal(calls, 1)
  }
})
test('접수 성공은 같은 ID의 상태 조회로 이어지며 새 기록을 만들지 않는다', async () => {
  let calls = 0
  const r = await startMeetingProcessing(record, async () => { calls++; return { error: null, data: { ok: true } } })
  assert.equal(r.id, record.id); assert.equal(r.status, '처리 중'); assert.equal(calls, 1)
})

test('접수 응답이 멈춰도 상한 뒤 기존 ID 검토로 전환하며 늦은 오류로 재호출하지 않는다', async () => {
  let reject!: (error: Error) => void, calls = 0
  await assert.rejects(startMeetingProcessing(record, () => {
    calls++; return new Promise((_, r) => { reject = r })
  }, 1), error => error instanceof MeetingStartUncertainError && error.record.id === record.id)
  reject(new Error('late network failure'))
  await Promise.resolve(); assert.equal(calls, 1)
})
