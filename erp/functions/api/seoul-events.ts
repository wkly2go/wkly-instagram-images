import { parseSeoulEventSnapshot } from '../../src/lib/seoulEventClient'
import { handleSeoulEvents } from '../../src/lib/seoulEventsTransport'

// Pages Git integration root is erp; this route serves only public source data.
export async function onRequest(context: { request: Request; waitUntil: (promise: Promise<unknown>) => void }) {
  const cache = (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default
  const response = await handleSeoulEvents(context.request, { cache, waitUntil: promise => context.waitUntil(promise) })
  if (response.status !== 502 && response.status !== 504) return response
  try {
    const snapshot = await fetch('https://raw.githubusercontent.com/wkly2go/wkly-instagram-images/refs/heads/data/seoul-events/seoul-events.json', {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(4000),
    })
    if (!snapshot.ok || Number(snapshot.headers.get('Content-Length') || 0) > 100000) return response
    const data = parseSeoulEventSnapshot(await snapshot.json())
    if (!data.events.length) return response
    return Response.json({ ...data, archived: true }, { headers: { 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } })
  } catch {
    return response
  }
}
