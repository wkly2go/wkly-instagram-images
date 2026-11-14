import { parseSeoulEvents, SEOUL_EVENT_DATASET, type SeoulEvent } from './seoulSales.ts'

// Official OA-23041 public Sheet endpoint, inspected from its own sheetView.do page.
// No client-controlled URL, SQL filter, credential, cookie, or authorization is forwarded.
export const SEOUL_SHEET_URL = 'https://data.seoul.go.kr/dataList/dataView.do?infId=OA-23041&srvType=S&serviceKind=1&pageNo=1&onepagerow=1000&ssUserId=SAMPLE_VIEW&strWhere=&strOrderby=DATE%20DESC'
export const SEOUL_PORTAL_URL = 'https://culture.seoul.go.kr/culture/culture/cultureEvent/jsonList.json'
export const SEOUL_PORTAL_SOURCE = 'https://culture.seoul.go.kr/culture/culture/cultureEvent/list.do?menuNo=200008'
export const SEOUL_EVENTS_CACHE_SECONDS = 1800
const MAX_SOURCE_BYTES = 3 * 1024 * 1024
const MAX_RESPONSE_BYTES = 100000
const MAX_EVENTS = 200
export interface SeoulEventsResponse { events: SeoulEvent[]; fetchedAt: string; total: number; scanned: number; limited: boolean; sourceUrl: string; sourceKind?: 'portal' | 'sheet' }

/** This public Sheet uses unquoted identifier keys and trailing commas, not valid JSON.
 * Only those two lexical extensions are accepted. Strings are copied verbatim, never executed.
 */
export function parseSeoulSheet(text: string): { list: Record<string, unknown>[]; total: number } {
  if (!text.trim() || new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) throw new Error('서울시 응답 크기를 확인할 수 없습니다.')
  // Consume a complete quoted string first so key-like text and commas inside it stay untouched.
  const json = text.replace(/"(?:[^"\\]|\\.)*"|([A-Za-z_][A-Za-z0-9_]*)(?=\s*:)|,(?=\s*[}\]])/g,
    (token, key: string | undefined) => key ? JSON.stringify(key) : token === ',' ? '' : token)
  let data: unknown
  try { data = JSON.parse(json) } catch { throw new Error('서울시 공개 목록 응답 형식이 변경되었습니다.') }
  const root = data as { result?: unknown; page?: { totalCount?: unknown }; list?: unknown }
  if (!root || root.result !== 'ok' || !Array.isArray(root.list) || root.list.length > 1000 ||
      !Number.isSafeInteger(root.page?.totalCount) || Number(root.page?.totalCount) < root.list.length ||
      root.list.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('서울시 공개 목록의 결과·전체 건수를 확인하지 못했습니다.')
  return { list: root.list, total: Number(root.page!.totalCount) }
}

export function normalizeSeoulSheet(text: string, fetchedAt: string): SeoulEventsResponse {
  const { list, total } = parseSeoulSheet(text)
  const stamp = Date.parse(fetchedAt)
  if (!Number.isFinite(stamp)) throw new Error('조회 시각을 확인하지 못했습니다.')
  const today = new Date(stamp + 9 * 3600000).toISOString().slice(0, 10)
  const headers = ['TITLE', 'GUNAME', 'CODENAME', 'ORG_NAME', 'PLACE', 'STRTDATE', 'END_DATE', 'DATE', 'ORG_LINK', 'HMPG_ADDR']
  const grid = [headers, ...list.map(row => headers.map(key => typeof row[key] === 'string' ? row[key] as string : ''))]
  const parsed = list.length ? parseSeoulEvents(grid) : []
  // This is public event discovery; event publication is not evidence of a procurement need.
  const upcoming = parsed.filter(event => event.start && event.end && event.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
  const result: SeoulEventsResponse = { events: [], fetchedAt: new Date(stamp).toISOString(), total, scanned: list.length, limited: total > list.length, sourceUrl: SEOUL_EVENT_DATASET, sourceKind: 'sheet' }
  const encoder = new TextEncoder()
  let encodedBytes = encoder.encode(JSON.stringify(result)).byteLength
  for (const event of upcoming) {
    if (result.events.length === MAX_EVENTS) { result.limited = true; break }
    const eventBytes = encoder.encode(JSON.stringify(event)).byteLength + (result.events.length ? 1 : 0)
    if (encodedBytes + eventBytes > MAX_RESPONSE_BYTES - 64) { result.limited = true; break }
    result.events.push(event); encodedBytes += eventBytes
  }
  if (encoder.encode(JSON.stringify(result)).byteLength > MAX_RESPONSE_BYTES) throw new Error('서울시 정규화 응답 크기를 확인해 주세요.')
  return result
}

async function limitedBody(response: Response): Promise<string> {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) throw new Error('서울시 응답 크기가 제한을 초과했습니다.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error('서울시 응답 크기가 제한을 초과했습니다.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Official portal list AJAX, discovered in its public list.do page. It exposes ten
 * rows per page and no total; three explicit pages are a bounded discovery sample. */
export function normalizeSeoulPortal(pages: string[], fetchedAt: string): SeoulEventsResponse {
  const stamp = Date.parse(fetchedAt)
  if (!Number.isFinite(stamp) || pages.length !== 3) throw new Error('문화포털 조회 범위를 확인하지 못했습니다.')
  const today = new Date(stamp + 9 * 3600000).toISOString().slice(0, 10)
  const until = new Date(stamp + 9 * 3600000 + 90 * 86400000).toISOString().slice(0, 10)
  const rows: Record<string, unknown>[] = []
  for (const page of pages) {
    const data = JSON.parse(page) as { resultList?: unknown }
    if (!data || !Array.isArray(data.resultList) || data.resultList.length > 10 || data.resultList.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('문화포털 목록 형식이 변경되었습니다.')
    rows.push(...data.resultList as Record<string, unknown>[])
  }
  const text = (row: Record<string, unknown>, key: string) => typeof row[key] === 'string' ? row[key] as string : ''
  const grid = [['TITLE', 'GUNAME', 'CODENAME', 'ORG_NAME', 'PLACE', 'STRTDATE', 'END_DATE', 'ORG_LINK'], ...rows.map(row => {
    const cultcode = String(row.cultcode ?? '')
    if (!/^\d{1,12}$/.test(cultcode) || !text(row, 'title').trim()) throw new Error('문화포털 행사 식별자를 확인하지 못했습니다.')
    return [text(row, 'title'), text(row, 'gcodeCdNm'), text(row, 'subjcodeNm'), text(row, 'orgcodeCdNm'), text(row, 'facName'), text(row, 'strtdate'), text(row, 'endDate'), `https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=${cultcode}&menuNo=200008`]
  })]
  const events = rows.length ? parseSeoulEvents(grid).filter(event => event.start && event.end && event.end >= today && event.start <= until).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)) : []
  return { events, fetchedAt: new Date(stamp).toISOString(), total: rows.length, scanned: rows.length, limited: true, sourceKind: 'portal', sourceUrl: SEOUL_PORTAL_SOURCE }
}

export async function fetchSeoulEvents(fetcher: typeof fetch = fetch, now = () => new Date(), timeoutMs = 15000): Promise<SeoulEventsResponse> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  const stamp = now().toISOString()
  const requestOptions: RequestInit = { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json,text/plain,*/*' } }
  const read = async (url: string) => {
    const response = await fetcher(url, requestOptions)
    if (!response.ok) throw new Error('서울시 공개 목록이 정상 응답하지 않았습니다.')
    return limitedBody(response)
  }
  try {
    try {
      const date = new Date(Date.parse(stamp) + 9 * 3600000)
      const start = date.toISOString().slice(0, 10).replaceAll('-', '.')
      const end = new Date(date.getTime() + 90 * 86400000).toISOString().slice(0, 10).replaceAll('-', '.')
      const pages = await Promise.all([1, 2, 3].map(page => {
        const url = new URL(SEOUL_PORTAL_URL)
        url.search = new URLSearchParams({ pageIndex: String(page), menuNo: '200008', sdate: start, edate: end, isSearched: 'Y' }).toString()
        return read(url.href)
      }))
      return normalizeSeoulPortal(pages, stamp)
    } catch (error) {
      if (controller.signal.aborted) throw error
      // One alternate official public source; never retry or forward client inputs.
      return normalizeSeoulSheet(await read(SEOUL_SHEET_URL), stamp)
    }
  } finally { clearTimeout(timer) }
}

interface Dependencies { fetcher?: typeof fetch; cache?: Pick<Cache, 'match' | 'put'>; waitUntil?: (promise: Promise<unknown>) => void; now?: () => Date }
export async function handleSeoulEvents(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'GET 요청만 지원합니다.' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
  const url = new URL(request.url)
  if (url.search) return Response.json({ error: '조회 조건은 가져온 목록에서 선택해 주세요.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  const cacheKey = new Request(new URL('/api/seoul-events', url.origin), { method: 'GET' })
  try {
    const hit = await dependencies.cache?.match(cacheKey)
    if (hit) return hit
  } catch { /* Cache outages must not block the public data request. */ }
  try {
    const data = await fetchSeoulEvents(dependencies.fetcher, dependencies.now)
    const response = Response.json(data, { headers: { 'Cache-Control': `public, max-age=60, s-maxage=${SEOUL_EVENTS_CACHE_SECONDS}`, 'X-Content-Type-Options': 'nosniff' } })
    if (dependencies.cache) {
      const save = dependencies.cache.put(cacheKey, response.clone()).catch(() => undefined)
      if (dependencies.waitUntil) dependencies.waitUntil(save)
      else await save
    }
    return response
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'AbortError'
    return Response.json({ error: timeout ? '서울시 응답 시간이 길어 조회를 중단했습니다. 잠시 후 다시 시도하거나 CSV를 사용해 주세요.' : '서울시 문화행사를 가져오지 못했습니다. 잠시 후 다시 시도하거나 공식 CSV를 사용해 주세요.' }, { status: timeout ? 504 : 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
