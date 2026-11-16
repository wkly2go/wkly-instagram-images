import type { SalesActivity } from './sales'

export type SalesActivityKind = '메모' | '전화' | '메일' | '미팅'
export interface SalesActivityRequest {
  id: string
  opportunityId: string
  kind: SalesActivityKind
  body: string
  actorId: string
}
export interface SalesActivityResponse {
  error: { message: string; code?: string } | null
  status?: number
}
export interface SalesActivityStore {
  read: (id: string) => Promise<SalesActivity | null>
  confirmActor: () => Promise<string | null>
}
export class SalesActivityUnconfirmedError extends Error {
  constructor() {
    super('활동 저장 결과를 확인하지 못했습니다. 입력 내용과 요청 ID를 유지합니다. 저장 상태를 확인하거나 같은 내용으로 다시 시도해 주세요.')
    this.name = 'SalesActivityUnconfirmedError'
  }
}
export function isSalesActivityUnconfirmed(error: unknown): boolean {
  return error instanceof Error && error.name === 'SalesActivityUnconfirmedError'
}
/** Match PostgreSQL btrim(text): tabs and newlines are part of the saved content. */
export const normalizeSalesActivityBody = (body: string): string => body.replace(/^ +| +$/g, '')

function matches(row: SalesActivity, request: SalesActivityRequest): boolean {
  return row.id === request.id && row.opportunity_id === request.opportunityId && row.kind === request.kind &&
    row.body === normalizeSalesActivityBody(request.body) && row.created_by === request.actorId
}
function transportFailure(error: unknown, status?: number): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; message?: string; code?: string }
  if (e.code || (status !== undefined && status !== 0 && ![502, 503, 504].includes(status))) return false
  return [502, 503, 504].includes(status ?? 0) || e.name === 'AbortError' || e.name === 'TimeoutError' ||
    /failed to fetch|fetch failed|networkerror|network request failed|network connection was lost|load failed|aborted|timed? out/i.test(e.message ?? '')
}

/** A missing row is not proof of failure: an earlier request may still be in flight. */
export async function checkSalesActivity(store: SalesActivityStore, request: SalesActivityRequest): Promise<boolean> {
  const expected = { ...request }
  if (!expected.actorId || await store.confirmActor() !== expected.actorId) throw new SalesActivityUnconfirmedError()
  const row = await store.read(expected.id)
  if (!row) return false
  if (!matches(row, expected)) throw new SalesActivityUnconfirmedError()
  return true
}

/** SQL returns void. Only a successful HTTP response or a full same-ID readback confirms it. */
export async function saveSalesActivityWithRecovery(
  store: SalesActivityStore & { write: (request: SalesActivityRequest) => Promise<SalesActivityResponse> },
  request: SalesActivityRequest,
): Promise<void> {
  const expected = { ...request }
  if (!expected.actorId) throw new Error('로그인이 필요합니다.')
  let response: SalesActivityResponse | undefined
  try { response = await store.write({ ...expected }) } catch (error) {
    if (!transportFailure(error)) throw error
  }
  if (response?.error && !transportFailure(response.error, response.status)) throw response.error
  if (response?.status && response.status >= 400 && ![502, 503, 504].includes(response.status)) throw new Error('활동 저장 요청이 거부되었습니다. 권한과 입력값을 확인해 주세요.')
  if (response && !response.error && response.status && response.status >= 200 && response.status < 300) return
  try { if (await checkSalesActivity(store, expected)) return } catch { /* Do not turn failed confirmation into a second write. */ }
  throw new SalesActivityUnconfirmedError()
}
