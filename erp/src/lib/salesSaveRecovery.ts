import type { SalesDraft, SalesOpportunity } from './sales'

export interface SalesWriteResponse {
  data: unknown
  error: { message: string; code?: string } | null
  status?: number
}
export interface SalesSaveStore {
  write: (draft: SalesDraft) => Promise<SalesWriteResponse>
  read: (id: string) => Promise<SalesOpportunity | null>
  confirmActor: () => Promise<string | null>
}

const fields = ['title', 'division', 'client_id', 'contact_id', 'owner_id', 'stage', 'source', 'source_url', 'expected_amount', 'next_action', 'next_date', 'description', 'result_note', 'project_id'] as const

/** 0113 normalizes only title with PostgreSQL btrim, which removes ASCII spaces. */
function matches(row: unknown, id: string, draft: SalesDraft, revision: number, actor: string): row is SalesOpportunity {
  if (!row || typeof row !== 'object') return false
  const r = row as SalesOpportunity
  return r.id === id && r.revision === revision + 1 && r.updated_by === actor && fields.every(key =>
    r[key] === (key === 'title' ? draft.title.replace(/^ +| +$/g, '') : draft[key]))
}

/** Explicit Postgres/PostgREST and authentication errors must never become a success. */
function transportFailure(error: unknown, status?: number): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; message?: string; code?: string }
  if (e.code || (status !== undefined && status !== 0 && ![502, 503, 504].includes(status))) return false
  return [502, 503, 504].includes(status ?? 0) || e.name === 'AbortError' || e.name === 'TimeoutError' ||
    /failed to fetch|fetch failed|networkerror|network request failed|network connection was lost|load failed|aborted|timed? out/i.test(e.message ?? '')
}

/** One write and at most one same-ID read. A failed confirmation never resends the write. */
export async function saveSalesWithRecovery(store: SalesSaveStore, id: string, draft: SalesDraft, revision: number, actor: string): Promise<SalesOpportunity> {
  if (!actor) throw new Error('로그인이 필요합니다.')
  const expected = structuredClone(draft)
  let response: SalesWriteResponse | undefined
  try {
    response = await store.write(structuredClone(expected))
  } catch (error) {
    if (!transportFailure(error)) throw error
  }
  if (response?.error && !transportFailure(response.error, response.status)) throw response.error
  if (response?.status && response.status >= 400 && ![502, 503, 504].includes(response.status)) throw new Error('저장 요청이 거부되었습니다. 권한과 입력값을 확인해 주세요.')
  if (response && !response.error && matches(response.data, id, expected, revision, actor)) return response.data
  try {
    if (await store.confirmActor() === actor) {
      const row = await store.read(id)
      if (matches(row, id, expected, revision, actor)) return row
    }
  } catch { /* A read or authentication failure cannot prove the original write. */ }
  throw new Error('저장 결과를 확인하지 못했습니다. 입력 내용과 같은 ID를 유지하고 있습니다. 목록에서 저장 여부를 확인한 뒤 다시 열어 주세요.');
}
