import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Bundle the real API factory; every HTTP request below goes to an in-memory fixture.
const here = dirname(fileURLToPath(import.meta.url))
const temp = await mkdtemp(join(here, '.storage-flow-'))
const bundle = join(temp, 'api.mjs')
await build({ entryPoints: [join(here, '../src/lib/supabaseApi.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
const { createSupabaseApi } = await import(pathToFileURL(bundle).href)
const originalFetch = globalThis.fetch
after(async () => { globalThis.fetch = originalFetch; await rm(temp, { recursive: true, force: true }) })

let instance = 0
const respond = (data, status = 200, headers = {}) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
async function setup(options = {}) {
  const state = {
    row: { id: 'record-1', storage_path: 'folder/file.pdf', created_by: 'owner' },
    exists: true, shared: 0, admin: false, storageFailure: false, dbFailure: false, infoFailure: false,
    writeError: null, committedWrite: false, writes: new Map(), calls: [], ...options,
  }
  const host = `storage-flow-${++instance}.example.invalid`
  const user = { id: 'owner', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid' }
  globalThis.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert.equal(url.hostname, host, '운영 네트워크 요청은 허용하지 않는다')
    const method = request.method
    const pathname = decodeURIComponent(url.pathname)
    const text = request.headers.get('content-type')?.includes('application/json') ? await request.text() : ''
    const body = text ? JSON.parse(text) : null
    state.calls.push({ method, pathname, query: url.searchParams, body })
    if (pathname === '/auth/v1/token') return respond({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'bearer', user })
    if (pathname === '/auth/v1/user') return respond(user)
    if (pathname === '/auth/v1/logout') return respond({})
    if (pathname === '/rest/v1/rpc/is_admin') return respond(state.admin)
    if (pathname === '/rest/v1/exchange_files' && method === 'HEAD') return respond(undefined, 200, { 'Content-Range': `0-0/${state.shared}` })
    if (pathname === '/rest/v1/exchange_files' && method === 'DELETE') {
      if (state.dbFailure) return respond({ code: '42501', message: 'fixture database refusal' }, 403)
      assert.equal(url.searchParams.get('storage_path'), state.row.storage_path ? `eq.${state.row.storage_path}` : 'is.null')
      const id = state.row.id
      state.row = null
      return respond([{ id }])
    }
    if (pathname.startsWith('/rest/v1/') && method === 'POST') {
      if (!state.writeError || state.committedWrite) state.writes.set(pathname, body)
      if (state.writeError) return respond(state.writeError, 400)
      return respond(body)
    }
    if (pathname.startsWith('/rest/v1/') && method === 'GET') {
      if (state.writes.has(pathname)) return respond([state.writes.get(pathname)])
      if (state.writeError) return respond([])
      if (pathname === '/rest/v1/exchange_files') return respond(state.row)
    }
    if (pathname.startsWith('/storage/v1/object/info/') && method === 'GET') {
      if (state.infoFailure) return respond({ statusCode: '403', message: 'fixture forbidden', error: 'Forbidden' }, 403)
      return state.exists ? respond({ name: 'folder/file.pdf', size: 10 }) : respond({ statusCode: '404', message: 'Object not found', error: 'NotFound' }, 404)
    }
    if (pathname.startsWith('/storage/v1/object/') && method === 'DELETE') {
      if (state.storageFailure) return respond({ statusCode: '500', message: 'fixture storage failure', error: 'Failure' }, 500)
      const hadFile = state.exists
      state.exists = false
      return respond(hadFile ? body.prefixes.map(name => ({ name })) : [])
    }
    if (pathname.startsWith('/storage/v1/object/') && method === 'POST') { state.exists = true; return respond({ Key: pathname.slice('/storage/v1/object/'.length) }) }
    if (pathname === '/functions/v1/meeting-minutes') return respond({ ok: true })
    throw new Error(`Unhandled fixture request: ${method} ${pathname}`)
  }
  const api = createSupabaseApi(`https://${host}`, 'fixture-anon-key')
  await api.signIn('fixture@example.invalid', 'fixture-password')
  return { api, state, storageDeletes: () => state.calls.filter(c => c.method === 'DELETE' && c.pathname.startsWith('/storage/')), rowDeletes: () => state.calls.filter(c => c.method === 'DELETE' && c.pathname.startsWith('/rest/')) }
}

test('실제 API: 소유자·관리자가 아닌 경우 파일과 기록을 모두 보존한다', async () => {
  const f = await setup({ row: { id: 'record-1', storage_path: 'folder/file.pdf', created_by: 'other' } })
  await assert.rejects(f.api.deleteExchangeFile('record-1'), /지울 수 없습니다/)
  assert.equal(f.storageDeletes().length, 0)
  assert.equal(f.rowDeletes().length, 0)
})

test('실제 API: Storage 실패 시 DB 삭제를 호출하지 않는다', async () => {
  const f = await setup({ storageFailure: true })
  await assert.rejects(f.api.deleteExchangeFile('record-1'), /자료 기록을 남겼습니다/)
  assert.equal(f.storageDeletes().length, 1)
  assert.equal(f.rowDeletes().length, 0)
  assert.equal(f.state.row.storage_path, 'folder/file.pdf')
})

test('실제 API: 다른 자료에서 참조하는 파일은 보존하고 요청한 기록만 지운다', async () => {
  const f = await setup({ shared: 1 })
  await f.api.deleteExchangeFile('record-1')
  assert.equal(f.storageDeletes().length, 0)
  assert.equal(f.rowDeletes().length, 1)
  assert.equal(f.state.exists, true)
})

test('실제 API: 이미 삭제된 파일은 부재를 확인한 뒤 남은 기록 정리를 재시도한다', async () => {
  const f = await setup({ exists: false })
  await f.api.deleteExchangeFile('record-1')
  assert.equal(f.state.row, null)
  assert.ok(f.state.calls.some(c => c.pathname.startsWith('/storage/v1/object/info/')))
})

test('실제 API: 파일 부재를 권한 오류로 확인하지 못하면 기록을 보존한다', async () => {
  const f = await setup({ exists: false, infoFailure: true })
  await assert.rejects(f.api.deleteExchangeFile('record-1'), /자료 기록을 남겼습니다/)
  assert.equal(f.rowDeletes().length, 0)
})

test('실제 API: 파일 삭제 뒤 DB 실패 시 경로가 남고 같은 요청으로 복구한다', async () => {
  const f = await setup({ dbFailure: true })
  await assert.rejects(f.api.deleteExchangeFile('record-1'), /database refusal/)
  assert.equal(f.state.exists, false)
  assert.equal(f.state.row.storage_path, 'folder/file.pdf')
  f.state.dbFailure = false
  await f.api.deleteExchangeFile('record-1')
  assert.equal(f.state.row, null)
})

for (const kind of ['chat', 'meeting', 'exchange']) test(`실제 API: ${kind} 업로드 후 확정된 기록 저장 거부는 이번 파일만 정리한다`, async () => {
  const f = await setup({ writeError: { code: '23514', message: 'fixture constraint refusal' } })
  const file = new File(['fixture contents'], 'fixture.txt', { type: 'text/plain' })
  const operation = kind === 'chat' ? () => f.api.sendFile('room-1', file)
    : kind === 'meeting' ? () => f.api.startMeetingMinutes(file, { filename: file.name, title: '테스트 회의' })
    : () => f.api.addExchangeFile({ client_id: 'client-1', direction: '받음', file })
  await assert.rejects(operation(), /임시 파일은 정리했습니다/)
  assert.equal(f.storageDeletes().length, 1)
  assert.equal(f.state.exists, false)
  assert.equal(f.state.calls.filter(c => c.pathname.startsWith('/functions/')).length, 0)
})

test('실제 API: 회의 기록 응답만 유실되면 기록을 찾아 원본을 보존하고 처리한다', async () => {
  const f = await setup({ writeError: { code: '08006', message: 'fixture lost response' }, committedWrite: true })
  const file = new File(['fixture transcript'], 'fixture.txt', { type: 'text/plain' })
  const result = await f.api.startMeetingMinutes(file, { filename: file.name, title: '테스트 회의' })
  assert.ok(result.id)
  assert.equal(result.status, '처리 중')
  assert.equal(f.storageDeletes().length, 0)
  assert.equal(f.state.calls.filter(c => c.pathname === '/functions/v1/meeting-minutes').length, 1)
})
