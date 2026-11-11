export interface UploadRecordIssue { message: string; code?: string }
export interface UploadRecordResult<T> { data: T | null; error: UploadRecordIssue | null }

export class UploadRecordResolutionError extends Error {
  readonly code?: string
  constructor(original: UploadRecordIssue | null, guidance: string) {
    super(`${original?.message.trim() || '저장 결과를 확인하지 못했습니다.'} ${guidance}`, { cause: original })
    this.name = 'UploadRecordResolutionError'
    this.code = original?.code
  }
}

function isDefiniteRejection(code?: string): boolean {
  if (!code) return false
  // 연결 예외와 완료 여부 불명은 응답만 유실됐을 수 있으므로 원본을 보존한다.
  if (/^(00|01|02|08)/.test(code) || code === '40003' || /^PGRST0/.test(code)) return false
  // EPIPE 같은 다섯 글자 네트워크 코드를 SQLSTATE로 오인하지 않는다.
  const sqlStateClasses = ['03', '09', '0A', '0B', '0F', '0L', '0P', '0Z', '10', '20', '21', '22', '23', '24', '25', '26', '27', '28', '2B', '2D', '2F', '34', '38', '39', '3B', '3D', '3F', '40', '42', '44', '53', '54', '55', '57', '58', 'F0', 'HV', 'P0', 'XX']
  return (/^[0-9A-Z]{5}$/.test(code) && sqlStateClasses.includes(code.slice(0, 2))) || /^PGRST\d{3}$/.test(code)
}

/** 업로드 직후의 저장 실패를 확인한다. 같은 ID 재조회로 성공을 복구하고, 확정 거부 때만 임시 파일을 정리한다. */
export async function resolveUploadedRecord<T>({ writeResult, reconcile, cleanup }: {
  writeResult: UploadRecordResult<T>
  reconcile: () => Promise<UploadRecordResult<T>>
  cleanup: () => Promise<{ error: UploadRecordIssue | null }>
}): Promise<T> {
  if (!writeResult.error && writeResult.data != null) return writeResult.data

  const preserved = () => new UploadRecordResolutionError(writeResult.error, '저장 여부를 확실히 확인할 수 없어 업로드한 원본을 보존했습니다. 중복 업로드 전에 저장 상태를 확인해 주세요.')
  let checked: UploadRecordResult<T>
  try {
    checked = await reconcile()
  } catch {
    throw preserved()
  }
  if (!checked.error && checked.data != null) return checked.data
  if (checked.error || writeResult.data != null || !isDefiniteRejection(writeResult.error?.code)) throw preserved()

  // 서버가 저장을 거부했고 같은 ID의 기록도 없을 때만 이번 업로드를 정리한다.
  let cleanupFailed = false
  try {
    cleanupFailed = Boolean((await cleanup()).error)
  } catch {
    cleanupFailed = true
  }
  throw new UploadRecordResolutionError(writeResult.error, cleanupFailed
    ? '저장은 완료되지 않았으며 업로드한 임시 파일도 정리하지 못했습니다. 추가 정리가 필요하므로 관리자에게 확인해 주세요.'
    : '저장은 완료되지 않았고 이번에 업로드한 임시 파일은 정리했습니다. 입력 내용을 확인해 다시 시도해 주세요.')
}
