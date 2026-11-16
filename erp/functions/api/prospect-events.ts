import { fetchCoexProspectEvents } from '../../src/lib/prospectPublicSources'

export async function onRequest(context: { request: Request; waitUntil: (promise: Promise<unknown>) => void }) {
  const { request } = context
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.search) {
    return Response.json({ error: '공개 행사는 GET으로 조회합니다.' }, { status: request.method !== 'GET' ? 405 : 400, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
  }
  const cache = (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default
  const key = new Request(new URL('/api/prospect-events', url.origin))
  try {
    const existing = await cache?.match(key)
    if (existing) return existing
  } catch { /* Serve the listing even when the cache is unavailable. */ }
  try {
    const events = await fetchCoexProspectEvents()
    const response = Response.json(events, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=1800', 'X-Content-Type-Options': 'nosniff' } })
    if (cache) context.waitUntil(cache.put(key, response.clone()).catch(() => undefined))
    return response
  } catch {
    return Response.json({ error: '코엑스 공개 일정을 불러오지 못했습니다.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
