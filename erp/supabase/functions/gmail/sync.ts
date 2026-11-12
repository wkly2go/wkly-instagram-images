export interface GmailSyncCursor {
  version: 1
  since: number
  until: number
  pageToken: string | null
  pendingIds: string[] | null
  nextPageToken: string | null
}
export interface GmailSyncSnapshot {
  exists: boolean
  value: Record<string, unknown>
  updatedAt: string | null
}
export interface GmailSyncPage { messages?: { id: string }[]; nextPageToken?: string }
export interface GmailSyncRow { id: string; [key: string]: unknown }
export interface GmailSyncStore {
  readState(): Promise<GmailSyncSnapshot>
  saveState(expected: GmailSyncSnapshot, value: Record<string, unknown>): Promise<GmailSyncSnapshot>
  list(input: { since: number; until: number; pageToken: string | null; maxResults: 500 }): Promise<GmailSyncPage>
  existing(ids: string[]): Promise<string[]>
  message(id: string): Promise<GmailSyncRow>
  saveRows(rows: GmailSyncRow[]): Promise<void>
}
export interface GmailSyncResult {
  fetched: number
  saved: number
  failed: number
  pending: boolean
}
const DAY = 86400
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Math.floor(Date.parse(value) / 1000) : null
const token = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 8192)
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value)

function resumeCursor(value: unknown): GmailSyncCursor | null {
  if (value == null) return null
  const c = value as GmailSyncCursor
  if (typeof c !== 'object' || c.version !== 1 || !Number.isSafeInteger(c.since) || !Number.isSafeInteger(c.until) || c.since < 0 || c.until <= c.since
    || !token(c.pageToken) || !token(c.nextPageToken)
    || !(c.pendingIds === null || (Array.isArray(c.pendingIds) && c.pendingIds.length <= 500 && c.pendingIds.every(validId)))) {
    throw new Error('메일 동기화 체크포인트 형식을 확인해 주세요. 기존 진행 기록은 유지합니다.')
  }
  return structuredClone(c)
}

/** Fixed query bounds and one durable page prevent capped/failed runs from skipping mail. */
export async function syncGmailWindow(store: GmailSyncStore, days: number, now = Date.now()): Promise<GmailSyncResult> {
  if (!Number.isFinite(days) || days < 0 || days > 365 || !Number.isFinite(now)) throw new Error('메일 조회 기간을 확인해 주세요.')
  let snapshot = await store.readState()
  let state = snapshot.value
  let cursor = resumeCursor(state.cursor)
  if (!cursor) {
    const until = Math.floor(now / 1000) + 1
    const carry = typeof state.backfill_days === 'number' && state.backfill_days > 0 ? Math.min(365, state.backfill_days) : 0
    const last = timestamp(state.synced_at)
    const complete = typeof state.completed_until === 'number' && Number.isSafeInteger(state.completed_until) ? state.completed_until : last
    // Anchor a legacy backlog to its saved time; repeated runs must not move the lower bound.
    const since = carry ? (last ?? until) - Math.max(carry, days) * DAY
      : days > 0 || complete === null ? until - Math.max(1, days || 90) * DAY : complete - DAY
    cursor = { version: 1, since: Math.max(0, Math.floor(since)), until, pageToken: null, pendingIds: null, nextPageToken: null }
  }
  const result: GmailSyncResult = { fetched: 0, saved: 0, failed: 0, pending: true }
  let pages = 0, attempted = 0
  const checkpoint = async () => {
    const next = {
      ...state, cursor: cursor ? structuredClone(cursor) : null,
      synced_at: new Date(now).toISOString(), fetched: result.fetched, saved: result.saved,
      failed: result.failed, pending: cursor !== null,
      // left is only the current page, not a guessed total across unlisted pages.
      left: cursor?.pendingIds?.length ?? 0,
      backfill_days: cursor ? Math.max(1, Math.ceil((cursor.until - cursor.since) / DAY)) : 0,
    }
    snapshot = await store.saveState(snapshot, next)
    state = snapshot.value
  }
  // Establish the fixed window before listing; a failed request cannot move it tomorrow.
  await checkpoint()
  while (cursor && pages < 20 && attempted < 400) {
    if (cursor.pendingIds === null) {
      const page = await store.list({ since: cursor.since, until: cursor.until, pageToken: cursor.pageToken, maxResults: 500 })
      if ((page.messages !== undefined && !Array.isArray(page.messages)) || (page.messages?.length ?? 0) > 500
        || (page.messages ?? []).some(m => !m || !validId(m.id))
        || (page.nextPageToken !== undefined && (!token(page.nextPageToken) || page.nextPageToken === cursor.pageToken))) {
        throw new Error('메일 목록 응답을 확인하지 못했습니다. 기존 진행 기록은 유지합니다.')
      }
      pages++
      cursor.pendingIds = [...new Set((page.messages ?? []).map(m => m.id))]
      cursor.nextPageToken = page.nextPageToken ?? null
      // Do not advance the page until every ID is saved or confirmed already present.
      await checkpoint()
    }
    const ids = cursor.pendingIds
    result.fetched += ids.length
    const known = new Set(ids.length ? await store.existing(ids) : [])
    if ([...known].some(id => !ids.includes(id))) throw new Error('저장된 메일 조회 결과를 확인해 주세요.')
    const todo = ids.filter(id => !known.has(id)).slice(0, 400 - attempted)
    const rows: GmailSyncRow[] = []
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20)
      const responses = await Promise.allSettled(batch.map(id => store.message(id)))
      attempted += batch.length
      for (let j = 0; j < responses.length; j++) {
        const response = responses[j]
        if (response.status === 'fulfilled' && response.value?.id === batch[j]) rows.push(response.value)
        else result.failed++
      }
      // Keep failed and unattempted IDs on this page, without repeatedly hammering a broken API.
      if (result.failed) break
    }
    for (let i = 0; i < rows.length; i += 200) await store.saveRows(rows.slice(i, i + 200))
    result.saved += rows.length
    const saved = new Set(rows.map(row => row.id))
    cursor.pendingIds = ids.filter(id => !known.has(id) && !saved.has(id))
    if (cursor.pendingIds.length) {
      await checkpoint()
      break
    }
    if (cursor.nextPageToken) {
      cursor.pageToken = cursor.nextPageToken
      cursor.nextPageToken = null
      cursor.pendingIds = null
    } else {
      state = { ...state, completed_until: cursor.until }
      cursor = null
    }
    await checkpoint()
  }
  result.pending = cursor !== null
  return result
}
