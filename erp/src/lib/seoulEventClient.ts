import { parseSeoulEvents, type SeoulEvent } from './seoulSales.ts'

export interface SeoulEventSnapshot {
  events: SeoulEvent[]
  fetchedAt: string
  total: number
  scanned: number
  limited: boolean
  sourceKind?: 'portal' | 'sheet'
  archived?: boolean
}

const INVALID_RESPONSE = '서울시 행사 응답을 확인하지 못했습니다. 다시 불러오거나 CSV 파일을 이용해 주세요.'

/** Normalize the proxy response with the same source-link/date rules as CSV imports. */
export function parseSeoulEventSnapshot(raw: unknown): SeoulEventSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error(INVALID_RESPONSE)
  const data = raw as Record<string, unknown>
  if (!Array.isArray(data.events) || data.events.length > 10_000 ||
    typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt)) ||
    !Number.isSafeInteger(data.total) || (data.total as number) < 0 ||
    !Number.isSafeInteger(data.scanned) || (data.scanned as number) < data.events.length ||
    (data.scanned as number) > (data.total as number) || typeof data.limited !== 'boolean') {
    throw new Error(INVALID_RESPONSE)
  }
  const fields = ['title', 'district', 'category', 'organization', 'venue', 'start', 'end', 'url'] as const
  const rows = data.events.map(rawEvent => {
    if (!rawEvent || typeof rawEvent !== 'object') throw new Error(INVALID_RESPONSE)
    const event = rawEvent as Record<string, unknown>
    if (fields.some(key => typeof event[key] !== 'string') || !(event.title as string).trim()) throw new Error(INVALID_RESPONSE)
    return fields.map(key => event[key] as string)
  })
  const events = rows.length ? parseSeoulEvents([
    ['TITLE', 'GUNAME', 'CODENAME', 'ORG_NAME', 'PLACE', 'STRTDATE', 'END_DATE', 'ORG_LINK'], ...rows,
  ]) : []
  return {
    events, fetchedAt: data.fetchedAt,
    total: data.total as number, scanned: data.scanned as number,
    limited: data.limited || (data.scanned as number) < (data.total as number),
    sourceKind: data.sourceKind === 'portal' ? 'portal' : 'sheet',
    archived: data.archived === true,
  }
}

/** Never place an upstream API key or arbitrary fetch URL in the browser. */
export async function fetchSeoulEvents(signal: AbortSignal, archived = false): Promise<SeoulEventSnapshot> {
  const path = archived ? '/data/seoul-events.json' : '/api/seoul-events'
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
  if (!response.ok) throw new Error('서울시 행사를 자동으로 불러오지 못했습니다. 잠시 후 다시 시도하거나 CSV 파일을 이용해 주세요.')
  let data: unknown
  try { data = await response.json() }
  catch { throw new Error(INVALID_RESPONSE) }
  return parseSeoulEventSnapshot(data)
}
