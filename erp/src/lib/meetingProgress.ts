import type { MeetingRecording } from './types.ts'

export type MeetingProgressResult =
  | { kind: 'done'; record: MeetingRecording }
  | { kind: 'error'; record: MeetingRecording | null; message: string; needsReview: boolean }

export class MeetingStartUncertainError extends Error {
  readonly record: MeetingRecording
  constructor(record: MeetingRecording) {
    super(`회의록 요청의 접수 여부를 확인하지 못했습니다. 새로 업로드하지 말고 같은 기록의 상태를 확인해 주세요. 기록 ID: ${record.id}`)
    this.name = 'MeetingStartUncertainError'
    this.record = record
  }
}

/** An invocation error may be a lost acknowledgement after a paid job started. Preserve the ID. */
export async function startMeetingProcessing(record: MeetingRecording, invoke: () => Promise<{ error: unknown; data?: unknown }>, timeoutMs = 30000): Promise<MeetingRecording> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([invoke(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ack timeout')), timeoutMs)
    })])
    if (result.error || (result.data && typeof result.data === 'object' && 'error' in result.data)) throw new Error('uncertain')
    return { ...record, status: '처리 중' }
  } catch { throw new MeetingStartUncertainError(record) }
  finally { clearTimeout(timer) }
}

/** Reads only. A separate deadline also stops a hung read; cancelled/late responses cannot update the UI. */
export function watchMeetingRecording(options: {
  id: string
  read: (id: string) => Promise<MeetingRecording | null>
  finish: (result: MeetingProgressResult) => void
  intervalMs?: number
  timeoutMs?: number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (handle: unknown) => void
}) {
  const set = options.setTimer ?? ((fn, delay) => setTimeout(fn, delay))
  const clear = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let active = true, next: unknown
  const stop = () => { active = false; clear(next); clear(deadline) }
  const finish = (result: MeetingProgressResult) => { if (!active) return; stop(); options.finish(result) }
  const deadline = set(() => finish({ kind: 'error', record: null, needsReview: true,
    message: `처리 결과를 아직 확인하지 못했습니다. 중복 비용을 피하려 다시 업로드하지 말고, 관리자에게 기록 ID ${options.id}의 상태를 확인해 주세요. 아래에서 같은 기록의 상태만 다시 확인할 수 있습니다.` }), options.timeoutMs ?? 20 * 60 * 1000)
  const poll = async () => {
    let record: MeetingRecording | null = null
    try { record = await options.read(options.id) } catch { /* Keep the original record; never restart generation. */ }
    if (!active) return
    if (record?.status === '완료') return finish({ kind: 'done', record })
    if (record?.status === '실패') return finish({ kind: 'error', record, needsReview: false, message: record.error || 'AI 정리에 실패했습니다.' })
    if (record?.status === '처리 중' && record.error?.startsWith('MEETING_REVIEW:')) {
      return finish({ kind: 'error', record, needsReview: true, message: `${record.error.slice('MEETING_REVIEW:'.length).trim()} 기록 ID: ${options.id}` })
    }
    next = set(() => { void poll() }, options.intervalMs ?? 5000)
  }
  next = set(() => { void poll() }, options.intervalMs ?? 5000)
  return stop
}
