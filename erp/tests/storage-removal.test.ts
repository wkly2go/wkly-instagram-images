import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { removeStoredObject } from '../src/lib/storageRemoval.ts'

const bucket = 'private-files'
const path = 'owner/unique-file.txt'
type Reply = { data: unknown; error: { message: string; status?: number; statusCode?: string; code?: string } | null }
function setup(remove: () => Promise<Reply>, info: () => Promise<Reply>) {
  const calls = { remove: 0, info: 0 }
  const sb = { storage: { from(name: string) {
    assert.equal(name, bucket)
    return {
      async remove(paths: string[]) { assert.deepEqual(paths, [path]); calls.remove++; return remove() },
      async info(name: string) { assert.equal(name, path); calls.info++; return info() },
    }
  } } } as unknown as SupabaseClient
  return { sb, calls }
}
const empty = async (): Promise<Reply> => ({ data: [], error: null })
const missing = async (): Promise<Reply> => ({ data: null, error: { message: 'Object not found', status: 404 } })

test('삭제 응답에 대상 경로가 있으면 추가 info 조회 없이 완료한다', async () => {
  const { sb, calls } = setup(async () => ({ data: [{ name: path }], error: null }), missing)
  assert.deepEqual(await removeStoredObject(sb, bucket, path), { error: null })
  assert.equal(calls.remove, 1)
  assert.equal(calls.info, 0)
})

test('삭제 요청 오류는 그대로 반환하고 성공으로 바꾸지 않는다', async () => {
  const original = { message: '권한이 없습니다.', status: 403 }
  const { sb, calls } = setup(async () => ({ data: null, error: original }), missing)
  assert.equal((await removeStoredObject(sb, bucket, path)).error, original)
  assert.equal(calls.info, 0)
})

test('삭제 0건인데 파일이 남아 있으면 실패한다', async () => {
  const { sb, calls } = setup(empty, async () => ({ data: { name: path, size: 100 }, error: null }))
  assert.match((await removeStoredObject(sb, bucket, path)).error!.message, /저장소에 남아/)
  assert.equal(calls.info, 1)
})

test('이미 없어진 파일의 재시도는 명확한 not-found 응답만 성공으로 처리한다', async () => {
  for (const error of [
    { message: 'missing', status: 404 },
    { message: 'missing', statusCode: '404' },
    { message: 'missing', code: 'NoSuchKey' },
    { message: 'missing', code: 'NoSuchObject' },
    { message: 'missing', code: 'not_found' },
    { message: 'Object not found' },
  ]) {
    const { sb, calls } = setup(empty, async () => ({ data: null, error }))
    assert.deepEqual(await removeStoredObject(sb, bucket, path), { error: null })
    assert.equal(calls.info, 1)
  }
})

test('권한·서버 오류나 유사한 문구를 파일 없음으로 오인하지 않는다', async () => {
  for (const error of [
    { message: 'Permission denied', status: 403 },
    { message: 'Service unavailable', statusCode: '500' },
    { message: 'Object not found due to permission check', status: 400 },
    { message: 'not found' },
  ]) {
    const { sb } = setup(empty, async () => ({ data: null, error }))
    assert.equal((await removeStoredObject(sb, bucket, path)).error, error)
  }
})

test('info가 data와 error 없이 끝나도 삭제 성공으로 간주하지 않는다', async () => {
  const { sb } = setup(empty, async () => ({ data: null, error: null }))
  assert.match((await removeStoredObject(sb, bucket, path)).error!.message, /확인하지 못했습니다/)
})

test('다른 파일 이름만 반환된 경우 대상 파일을 별도로 확인한다', async () => {
  const { sb, calls } = setup(async () => ({ data: [{ name: 'another-file.txt' }], error: null }), missing)
  assert.deepEqual(await removeStoredObject(sb, bucket, path), { error: null })
  assert.equal(calls.info, 1)
})

test('삭제·확인 단계의 네트워크 예외도 실패 결과로 반환한다', async () => {
  const fail = async (): Promise<Reply> => { throw new Error('Network unavailable') }
  for (const [remove, info] of [[fail, missing], [empty, fail]]) {
    const { sb } = setup(remove, info)
    assert.equal((await removeStoredObject(sb, bucket, path)).error!.message, 'Network unavailable')
  }
})

test('빈 파일 경로는 Storage 호출 전에 거부한다', async () => {
  const { sb, calls } = setup(empty, missing)
  assert.ok((await removeStoredObject(sb, bucket, '')).error)
  assert.equal(calls.remove, 0)
  assert.equal(calls.info, 0)
})
