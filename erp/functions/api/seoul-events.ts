import { handleSeoulEvents } from '../../src/lib/seoulEventsTransport'

// Pages Git integration root is erp; this route serves only public source data.
export function onRequest(context: { request: Request; waitUntil: (promise: Promise<unknown>) => void }) {
  const cache = (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default
  return handleSeoulEvents(context.request, { cache, waitUntil: promise => context.waitUntil(promise) })
}
