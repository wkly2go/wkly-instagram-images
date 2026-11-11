/** Share only in-flight requests for JSON data; give each caller its own mutable result. */
export function createPendingReads() {
  const pending = new Map<string, Promise<unknown>>()
  let scope: string | null = null
  let authRevision = 0
  return {
    setScope(next: string | null) {
      if (scope === next) return
      scope = next
      authRevision++
      pending.clear()
    },
    clear() { pending.clear() },
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const revision = authRevision
      const forCaller = (request: Promise<unknown>) => request.then(value => {
        if (revision !== authRevision) throw new Error('로그인 상태가 변경되었습니다. 다시 불러와 주세요.')
        return structuredClone(value as T)
      })
      const existing = scope ? pending.get(key) : undefined
      if (existing) return forCaller(existing)
      const request = Promise.resolve().then(load).then(value => {
        if (revision !== authRevision) throw new Error('로그인 상태가 변경되었습니다. 다시 불러와 주세요.')
        return value
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })
      if (scope) pending.set(key, request)
      // Consumers may sort arrays or edit nested drafts; sharing those objects would leak edits.
      return forCaller(request)
    },
  }
}
