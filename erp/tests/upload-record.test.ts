import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveUploadedRecord, UploadRecordResolutionError, type UploadRecordResult } from '../src/lib/uploadRecord.ts'

const record = { id: 'same-client-generated-id', audio_path: 'owner/unique-upload.txt' }
const absent: UploadRecordResult<typeof record> = { data: null, error: null }
const success: UploadRecordResult<typeof record> = { data: record, error: null }

test('정상 저장 결과는 추가 조회나 삭제 없이 반환한다', async () => {
  const result = await resolveUploadedRecord({
    writeResult: success,
    reconcile: async () => { throw new Error('조회하면 안 됨') },
    cleanup: async () => { throw new Error('삭제하면 안 됨') },
  })
  assert.equal(result, record)
})

test('저장 응답만 유실됐어도 같은 ID를 찾으면 성공으로 복구한다', async () => {
  for (const error of [{ message: 'Failed to fetch' }, { message: '결과를 읽지 못함', code: 'PGRST116' }]) {
    const result = await resolveUploadedRecord({
      writeResult: { data: null, error },
      reconcile: async () => success,
      cleanup: async () => { throw new Error('참조가 있는 파일을 삭제하면 안 됨') },
    })
    assert.equal(result, record)
  }
})

test('확정 거부와 기록 없음이 함께 확인될 때만 임시 파일을 정리한다', async () => {
  for (const code of ['23514', '42P01', 'PGRST204']) {
    let cleaned = 0
    const original = { message: '저장 조건을 만족하지 않습니다.', code }
    await assert.rejects(resolveUploadedRecord({
      writeResult: { data: null, error: original },
      reconcile: async () => absent,
      cleanup: async () => { cleaned++; return { error: null } },
    }), error => {
      assert.ok(error instanceof UploadRecordResolutionError)
      assert.match(error.message, /저장 조건을 만족하지 않습니다/)
      assert.match(error.message, /임시 파일은 정리했습니다/)
      assert.equal(error.cause, original)
      return true
    })
    assert.equal(cleaned, 1)
  }
})

test('네트워크 오류 또는 완료 여부 불명은 조회에서 없다고 나와도 원본을 보존한다', async () => {
  for (const code of [undefined, '', 'NETWORK_ERROR', 'EPIPE', 'ERROR', '08006', '08007', '40003', 'PGRST001', '00000']) {
    let cleaned = 0
    await assert.rejects(resolveUploadedRecord({
      writeResult: { data: null, error: { message: '전송 결과 불명', code } },
      reconcile: async () => absent,
      cleanup: async () => { cleaned++; return { error: null } },
    }), /원본을 보존했습니다/)
    assert.equal(cleaned, 0)
  }
})

test('재조회가 실패하거나 예외를 던지면 확정 DB 오류가 있어도 삭제하지 않는다', async () => {
  for (const reconcile of [
    async () => ({ data: null, error: { message: '조회 권한 없음', code: '42501' } }),
    async () => { throw new Error('연결 끊김') },
  ]) {
    let cleaned = 0
    await assert.rejects(resolveUploadedRecord({
      writeResult: { data: null, error: { message: '처리 거부', code: '23514' } },
      reconcile,
      cleanup: async () => { cleaned++; return { error: null } },
    }), /원본을 보존했습니다/)
    assert.equal(cleaned, 0)
  }
})

test('오류 없이 data만 빠진 응답도 성공으로 오인하거나 삭제하지 않는다', async () => {
  let cleaned = 0
  await assert.rejects(resolveUploadedRecord({
    writeResult: absent,
    reconcile: async () => absent,
    cleanup: async () => { cleaned++; return { error: null } },
  }), /저장 결과를 확인하지 못했습니다/)
  assert.equal(cleaned, 0)
})

test('오류와 data가 함께 있는 모순된 응답에서는 원본을 보존한다', async () => {
  let cleaned = 0
  await assert.rejects(resolveUploadedRecord({
    writeResult: { data: record, error: { message: '응답 오류', code: 'PGRST116' } },
    reconcile: async () => absent,
    cleanup: async () => { cleaned++; return { error: null } },
  }), /원본을 보존했습니다/)
  assert.equal(cleaned, 0)
})

test('정리 실패와 예외는 원래 저장 오류와 추가 정리 안내를 함께 전달한다', async () => {
  for (const cleanup of [
    async () => ({ error: { message: 'Storage unavailable' } }),
    async () => { throw new Error('네트워크 끊김') },
  ]) {
    await assert.rejects(resolveUploadedRecord({
      writeResult: { data: null, error: { message: '원래 저장 오류', code: '23514' } },
      reconcile: async () => absent,
      cleanup,
    }), error => {
      assert.ok(error instanceof UploadRecordResolutionError)
      assert.match(error.message, /원래 저장 오류/)
      assert.match(error.message, /추가 정리가 필요/)
      return true
    })
  }
})
