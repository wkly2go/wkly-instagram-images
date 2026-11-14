/** Read-only discovery from the public COEX schedule, inspected 2026-11-14.
 * This is a bounded first-page sample, not an API coverage or buying-intent claim. */
export const COEX_SCHEDULE_URL = 'https://www.coex.co.kr/event/full-schedules/'
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_ROWS = 12
export interface CoexProspectEvent {
  id: string
  title: string
  category: string
  venue: string
  start: string
  end: string
  url: string
}
export interface CoexProspectResult {
  rows: CoexProspectEvent[]
  scanned: number
  limited: true
  fetchedAt: string
  sourceUrl: string
  note: string
}
function cleanText(raw: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return raw.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return entities[code.toLowerCase()] ?? entity
    const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : ''
  }).replace(/\s+/g, ' ').trim()
}
function date(raw: string): string {
  if (!/^20\d{2}\.\d{2}\.\d{2}$/.test(raw)) return ''
  const iso = raw.replaceAll('.', '-')
  const stamp = Date.parse(iso + 'T00:00:00.000Z')
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === iso ? iso : ''
}
function field(html: string, name: string): string {
  const match = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i').exec(html)
  return match ? cleanText(match[2]) : ''
}
function detailUrl(raw: string): string {
  const url = new URL(cleanText(raw), COEX_SCHEDULE_URL)
  if (url.protocol !== 'https:' || url.hostname !== 'www.coex.co.kr' || url.port || url.username || url.password || !/^\/exhibitions\/[^/]+\/$/.test(url.pathname)) throw new Error('코엑스 행사 출처 링크를 확인하지 못했습니다.')
  url.search = ''; url.hash = ''
  return url.href
}
export function parseCoexProspectEvents(html: string, fetchedAt: string): CoexProspectResult {
  const stamp = Date.parse(fetchedAt)
  if (!Number.isFinite(stamp) || !html.includes('EXHIBITIONS_LIST_TYPE_SECTION') || new TextEncoder().encode(html).byteLength > MAX_SOURCE_BYTES) throw new Error('코엑스 행사 목록 형식이 변경되었습니다.')
  const today = new Date(stamp + 9 * 3600000).toISOString().slice(0, 10)
  const until = new Date(stamp + 9 * 3600000 + 90 * 86400000).toISOString().slice(0, 10)
  const rows: CoexProspectEvent[] = [], seen = new Set<string>()
  let scanned = 0
  const cards = html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bBlogEventItem-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)
  for (const card of cards) {
    if (++scanned > MAX_ROWS) throw new Error('코엑스 첫 페이지 조회 범위가 변경되었습니다.')
    const href = /\bhref=["']([^"']+)["']/i.exec(card[1])?.[1]
    const title = field(card[2], 'BlogEventItemCont-tit')
    const period = field(card[2], 'BlogEventItemCont-date').match(/^(20\d{2}\.\d{2}\.\d{2})\s*-\s*(20\d{2}\.\d{2}\.\d{2})$/)
    if (!href || !title || !period) throw new Error('코엑스 행사 제목·일정을 확인하지 못했습니다.')
    const url = detailUrl(href), start = date(period[1]), end = date(period[2])
    if (!start || !end || start > end) throw new Error('코엑스 행사 날짜가 올바르지 않습니다.')
    if (seen.has(url) || end < today || start > until) continue
    seen.add(url)
    rows.push({ id: url, title: title.slice(0, 240), category: field(card[2], 'BlogEventItemCont-cate').slice(0, 60), venue: field(card[2], 'BlogEventItemCont-hall').slice(0, 180), start, end, url })
  }
  if (!scanned) throw new Error('코엑스 공개 행사 목록을 확인하지 못했습니다. 공식 일정을 확인해 주세요.')
  return { rows, scanned, limited: true, fetchedAt: new Date(stamp).toISOString(), sourceUrl: COEX_SCHEDULE_URL, note: '코엑스 공식 일정의 향후 90일 첫 페이지(최대 12건)입니다. 비공개 행사와 나머지 페이지는 포함하지 않습니다. 행사 개최는 용역 발주·참가 모집·구매 의사의 근거가 아닙니다.' }
}
interface CoexFetchOptions { fetcher?: typeof fetch; now?: () => Date; signal?: AbortSignal }
export async function fetchCoexProspectEvents({ fetcher = fetch, now = () => new Date(), signal }: CoexFetchOptions = {}): Promise<CoexProspectResult> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 10000)
  const stamp = now().toISOString()
  try {
    if (signal?.aborted) controller.abort()
    controller.signal.throwIfAborted()
    const today = new Date(Date.parse(stamp) + 9 * 3600000)
    const url = new URL(COEX_SCHEDULE_URL)
    url.search = new URLSearchParams({ search_start_date: today.toISOString().slice(0, 10).replaceAll('-', '.'), search_end_date: new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10).replaceAll('-', '.'), list_type: 'LIST', var_page: '1' }).toString()
    const response = await fetcher(url.href, { method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; WKLY-Intranet/1.0)' } })
    if (!response.ok || !response.body) throw new Error('코엑스 공식 일정이 정상 응답하지 않았습니다.')
    if (Number(response.headers.get('Content-Length') ?? 0) > MAX_SOURCE_BYTES) throw new Error('코엑스 일정 응답이 크기 제한을 초과했습니다.')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        controller.signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_SOURCE_BYTES) { void reader.cancel(); throw new Error('코엑스 일정 응답이 크기 제한을 초과했습니다.') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const buffer = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    return parseCoexProspectEvents(new TextDecoder('utf-8', { fatal: true }).decode(buffer), stamp)
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
