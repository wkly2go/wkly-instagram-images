import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readNavigationCounts } from '../src/lib/navigationCounts.ts'

const viewerId = '11d37f2b-a93c-4bf1-bd10-41e721b469a0'
type Call = { table: string; method: string; url: URL; headers: Headers }

function clientWith(response?: (call: Call) => Response) {
  const calls: Call[] = []
  const client = createClient('https://example.supabase.co', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const call = { table: url.pathname.split('/').at(-1)!, method: init?.method ?? 'GET', url, headers: new Headers(init?.headers) }
        calls.push(call)
        if (response) return response(call)
        const counts: Record<string, number> = { tasks: 1_205, approvals: 407, saved_items: 3 }
        return new Response(null, { status: 200, headers: { 'content-range': `*/${counts[call.table]}` } })
      },
    },
  })
  return { client, calls }
}

test('메뉴 건수는 본문 없는 정확한 HEAD 세 건으로 조회하고 1,000개 이상도 유지한다', async () => {
  const { client, calls } = clientWith()
  assert.deepEqual(await readNavigationCounts(client, { id: viewerId, role: 'member' }), { myOpenTasks: 1_205, pendingToDecide: 407, saved: 3 })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(c => c.table).sort(), ['approvals', 'saved_items', 'tasks'])
  for (const call of calls) {
    assert.equal(call.method, 'HEAD')
    assert.match(call.headers.get('prefer') ?? '', /count=exact/)
    assert.equal(call.url.searchParams.get('select'), 'id')
    assert.equal(call.url.searchParams.has('limit'), false)
  }
  const tasks = calls.find(c => c.table === 'tasks')!.url.searchParams
  assert.equal(tasks.get('assignee_id'), `eq.${viewerId}`)
  assert.equal(tasks.get('status'), 'neq.완료')
  const saved = calls.find(c => c.table === 'saved_items')!.url.searchParams
  assert.equal(saved.get('user_id'), `eq.${viewerId}`)
  assert.equal(saved.get('done_at'), 'is.null')
})

test('일반 팀원은 자신이 결정 가능한 대기 건 중 본인 요청만 제외하며 null 작성자는 포함한다', async () => {
  const { client, calls } = clientWith()
  await readNavigationCounts(client, { id: viewerId, role: 'member' })
  const params = calls.find(c => c.table === 'approvals')!.url.searchParams
  assert.equal(params.get('status'), 'eq.대기')
  assert.equal(params.get('can_decide'), 'eq.true')
  assert.equal(params.get('or'), `(requested_by.is.null,requested_by.neq.${viewerId})`)
  assert.equal(params.has('requested_by'), false)
})

test('관리자도 서버 can_decide를 유지하면서 자신의 대기 요청을 포함한다', async () => {
  const { client, calls } = clientWith()
  await readNavigationCounts(client, { id: viewerId, role: 'admin' })
  const params = calls.find(c => c.table === 'approvals')!.url.searchParams
  assert.equal(params.get('status'), 'eq.대기')
  assert.equal(params.get('can_decide'), 'eq.true')
  assert.equal(params.has('requested_by'), false)
  assert.equal(params.has('or'), false)
})

test('서버가 정확히 0개를 응답한 경우만 빈 건수로 표시한다', async () => {
  const { client } = clientWith(() => new Response(null, { status: 200, headers: { 'content-range': '*/0' } }))
  assert.deepEqual(await readNavigationCounts(client, { id: viewerId, role: 'member' }), { myOpenTasks: 0, pendingToDecide: 0, saved: 0 })
})

test('권한 오류를 0건으로 바꾸지 않는다', async () => {
  for (const table of ['tasks', 'approvals', 'saved_items']) {
    const { client } = clientWith(call => call.table === table
      ? new Response(JSON.stringify({ code: '42501', message: `permission denied: ${table}` }), { status: 403 })
      : new Response(null, { status: 200, headers: { 'content-range': '*/0' } }))
    await assert.rejects(readNavigationCounts(client, { id: viewerId, role: 'member' }), new RegExp(`permission denied: ${table}`))
  }
})

test('본문 없는 HEAD 오류도 읽을 수 있는 실패 메시지를 남긴다', async () => {
  const { client } = clientWith(call => call.table === 'tasks'
    ? new Response(null, { status: 403 })
    : new Response(null, { status: 200, headers: { 'content-range': '*/0' } }))
  await assert.rejects(readNavigationCounts(client, { id: viewerId, role: 'member' }), /내 할 일 건수를 불러오지 못했습니다/)
})

test('정확한 건수 헤더가 없거나 잘못된 응답은 0건으로 간주하지 않는다', async () => {
  for (const count of [null, '*', '-1']) {
    const { client } = clientWith(call => new Response(null, {
      status: 200,
      headers: call.table !== 'tasks' ? { 'content-range': '*/0' } : count === null ? {} : { 'content-range': `*/${count}` },
    }))
    await assert.rejects(readNavigationCounts(client, { id: viewerId, role: 'member' }), /내 할 일 건수를 확인하지 못했습니다/)
  }
})

test('확인된 구버전 saved_items 부재만 호환 처리한다', async () => {
  const { client } = clientWith(call => call.table === 'saved_items'
    ? new Response(JSON.stringify({ code: 'PGRST205', message: 'table missing from schema cache' }), { status: 404 })
    : new Response(null, { status: 200, headers: { 'content-range': '*/7' } }))
  assert.deepEqual(await readNavigationCounts(client, { id: viewerId, role: 'member' }), { myOpenTasks: 7, pendingToDecide: 7, saved: 0 })
})
