export const MEETING_AUDIO_KEEP_DAYS = 30
export const MEETING_CLEANUP_BATCH = 50

export interface RecordingReference {
  id: string
  audio_path: string | null
  created_at: string
  status: string
}

interface Result<T> { data: T | null; error: unknown }
export interface MeetingCleanupStore {
  expired(before: string, limit: number): Promise<Result<RecordingReference[]>>
  references(paths: string[]): Promise<Result<RecordingReference[]> & { count: number | null }>
  remove(paths: string[]): Promise<{ error: unknown }>
  clearReferences(ids: string[], paths: string[], before: string): Promise<{ error: unknown }>
}

export interface MeetingCleanupReport {
  removedPaths: number
  skippedPaths: number
  referencesCleared: boolean
  failure?: 'select' | 'references' | 'remove' | 'clear'
}

/** 기존 30일 보관 기준. 정리 실패는 회의록 생성 결과와 분리하고 다음 호출에서 다시 시도한다. */
export async function cleanupExpiredRecordings(store: MeetingCleanupStore, now = Date.now()): Promise<MeetingCleanupReport> {
  const report: MeetingCleanupReport = { removedPaths: 0, skippedPaths: 0, referencesCleared: false }
  const cutoff = now - MEETING_AUDIO_KEEP_DAYS * 86400_000
  const before = new Date(cutoff).toISOString()
  let phase: NonNullable<MeetingCleanupReport['failure']> = 'select'
  try {
    const selected = await store.expired(before, MEETING_CLEANUP_BATCH)
    if (selected.error) throw selected.error
    const candidates = (selected.data ?? []).filter(row => row.audio_path && Date.parse(row.created_at) < cutoff && row.status !== '처리 중')
    const paths = [...new Set(candidates.map(row => row.audio_path!))]
    if (!paths.length) return report

    // 같은 파일을 가리키는 새 기록·처리 중 기록이 있으면 보관한다. 조회가 잘리면 삭제하지 않는다.
    phase = 'references'
    const refs = await store.references(paths)
    if (refs.error) throw refs.error
    if (!refs.data || refs.count === null || refs.count !== refs.data.length) throw new Error('Incomplete reference check')
    const removable = paths.filter(path => {
      const matches = refs.data!.filter(row => row.audio_path === path)
      return matches.length > 0 && matches.every(row => Date.parse(row.created_at) < cutoff && row.status !== '처리 중')
    })
    report.skippedPaths = paths.length - removable.length
    if (!removable.length) return report

    phase = 'remove'
    const removed = await store.remove(removable)
    if (removed.error) throw removed.error
    report.removedPaths = removable.length

    // 삭제가 확인된 경로만 해제한다. 그 사이 다른 경로로 바뀐 기록은 건드리지 않는다.
    phase = 'clear'
    const ids = candidates.filter(row => removable.includes(row.audio_path!)).map(row => row.id)
    const cleared = await store.clearReferences(ids, removable, before)
    if (cleared.error) throw cleared.error
    report.referencesCleared = true
  } catch {
    report.failure = phase
  }
  return report
}
