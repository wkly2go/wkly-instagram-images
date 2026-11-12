/** 탭 사이에는 실행 시각만 저장한다. 알림 본문·인증 정보는 저장하지 않는다. */
export function createTabTaskGate({ read, write, lock, now = Date.now }: {
  read: (key: string) => number; write: (key: string, at: number) => void
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T | undefined>; now?: () => number
}) {
  const pending = new Map<string, Promise<unknown>>()
  return async function run<T>(key: string, intervalMs: number, work: () => Promise<T>): Promise<T | undefined> {
    if (pending.has(key)) return undefined
    const request = lock(key, async () => {
      const last = read(key)
      if (last > 0 && now() >= last && now() - last < intervalMs) return undefined
      const result = await work()
      write(key, now())
      return result
    })
    pending.set(key, request)
    try { return await request } finally { if (pending.get(key) === request) pending.delete(key) }
  }
}

export const runTabTask = createTabTaskGate({
  read: key => { try { return Number(localStorage.getItem(`wkly-task:${key}`)) || 0 } catch { return 0 } },
  write: (key, at) => { try { localStorage.setItem(`wkly-task:${key}`, String(at)) } catch { /* 저장 차단 */ } },
  lock: async (key, work) => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(`wkly-task:${key}`, { ifAvailable: true }, lock => lock ? work() : undefined)
    }
    // Web Locks 미지원 환경에서도 같은 탭의 중복 실행과 반복 주기는 제한한다.
    return work()
  },
})
