/** Private file URLs stay in memory and belong to one authenticated session. */
export type SignedUrlRequest = { bucket: string; path: string; download?: string }
type Entry = {
  request: SignedUrlRequest
  promise: Promise<string>
  resolve: (url: string) => void
  reject: (error: unknown) => void
  expiresAt: number
  pending: boolean
  invalid: boolean
}

export type SignedUrlCache = ReturnType<typeof createSignedUrlCache>

/**
 * Reuse the same URL so repeated views can also reuse the browser's file cache.
 * A cache miss still goes through the caller's normal Storage permission check.
 */
export function createSignedUrlCache(options: { now?: () => number; renewBeforeMs?: number; maxEntries?: number } = {}) {
  const now = options.now ?? Date.now
  const renewBeforeMs = Math.max(0, options.renewBeforeMs ?? 60_000)
  const maxEntries = Math.max(1, options.maxEntries ?? 512)
  const entries = new Map<string, Entry>()
  let scope: string | null = null
  let generation = 0
  const keyFor = (r: SignedUrlRequest) => JSON.stringify([r.bucket, r.path, r.download ?? null])
  const changed = () => new Error('파일 접근 상태가 변경되었습니다. 다시 열어 주세요.')

  const clear = () => {
    generation++
    for (const entry of entries.values()) entry.invalid = true
    entries.clear()
  }

  const trim = () => {
    for (const [key, entry] of entries) {
      if (!entry.pending && now() >= entry.expiresAt) entries.delete(key)
    }
    // In-flight requests must keep coalescing, even while a large list loads.
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break
      if (!entry.pending) entries.delete(key)
    }
  }

  const getMany = (
    requests: SignedUrlRequest[],
    load: (missing: SignedUrlRequest[]) => Promise<string[]>,
    expiresInSeconds = 3600,
  ): Promise<string[]> => {
    if (!requests.length) return Promise.resolve([])
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return Promise.reject(new Error('파일 링크 유효 시간을 확인해 주세요.'))
    const started = now()
    // For short-lived URLs, retain half their lifetime rather than expiring immediately.
    const lifetimeMs = expiresInSeconds * 1000
    const expiresAt = started + lifetimeMs - Math.min(renewBeforeMs, lifetimeMs / 2)
    const currentGeneration = generation
    const local = new Map<string, Entry>()
    const missing: Entry[] = []
    const pending = requests.map(request => {
      const key = keyFor(request)
      const existing = local.get(key) ?? (scope ? entries.get(key) : undefined)
      if (existing && !existing.invalid && (existing.pending || started < existing.expiresAt)) {
        // Recently accessed URLs are the last ones evicted when the cache fills.
        if (scope && entries.has(key)) { entries.delete(key); entries.set(key, existing) }
        return existing.promise
      }
      let resolve!: Entry['resolve']
      let reject!: Entry['reject']
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      const entry: Entry = { request: { ...request }, promise, resolve, reject, expiresAt, pending: true, invalid: false }
      local.set(key, entry)
      if (scope) entries.set(key, entry)
      missing.push(entry)
      return promise
    })

    // Attach consumers before calling a loader that may fail synchronously.
    const result = Promise.all(pending)
    if (missing.length) {
      const fail = (error: unknown) => {
        for (const entry of missing) {
          const key = keyFor(entry.request)
          if (entries.get(key) === entry) entries.delete(key)
          entry.pending = false
          entry.reject(error)
        }
      }
      void Promise.resolve().then(() => load(missing.map(entry => entry.request))).then(urls => {
        if (currentGeneration !== generation) throw changed()
        if (urls.length !== missing.length || urls.some(url => typeof url !== 'string' || !url)) throw new Error('파일 링크를 확인하지 못했습니다. 다시 열어 주세요.')
        missing.forEach((entry, i) => {
          entry.pending = false
          if (entry.invalid) entry.reject(changed())
          else entry.resolve(urls[i])
        })
        trim()
      }).catch(fail)
    }
    return result
  }

  return {
    /** Call with the current user ID on auth changes; null disables caching. */
    setScope(next: string | null) {
      if (scope === next) return
      scope = next
      clear()
    },
    clear,
    /** Invalidate variants; image retries can share a fresh signing request already in flight. */
    invalidate(bucket: string, path: string, options: { keepPending?: boolean } = {}) {
      for (const [key, entry] of entries) {
        if (entry.request.bucket !== bucket || entry.request.path !== path) continue
        if (options.keepPending && entry.pending) continue
        entry.invalid = true
        entries.delete(key)
      }
    },
    async get(request: SignedUrlRequest, load: () => Promise<string>, expiresInSeconds = 3600): Promise<string> {
      const urls = await getMany([request], async () => [await load()], expiresInSeconds)
      return urls[0]
    },
    getMany,
  }
}
