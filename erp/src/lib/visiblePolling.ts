/** 보이는 화면만 갱신한다. 느린 요청이 끝나기 전에는 다음 요청을 시작하지 않는다. */
export function createVisiblePoller<T>({
  load,
  onValue,
  onError,
  onLoading,
  isVisible,
  intervalMs,
  setTimer = (fn, ms) => window.setTimeout(fn, ms),
  clearTimer = id => window.clearTimeout(id),
}: {
  load: () => Promise<T>
  onValue: (value: T) => void
  onError: (error: unknown) => void
  onLoading?: (loading: boolean) => void
  isVisible: () => boolean
  intervalMs: number
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}) {
  let enabled = false
  let stopped = false
  let inFlight = false
  let queued = false
  let timer: number | undefined
  const allowed = () => enabled && !stopped && isVisible()
  const clear = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }
  const schedule = () => {
    clear()
    if (allowed()) timer = setTimer(() => void refresh(), intervalMs)
  }

  // 저장/가져오기가 진행 중 조회와 겹치면 딱 한 번 더 읽어 최신 결과를 반영한다.
  async function refresh(queueIfRunning = false) {
    clear()
    if (!allowed()) return
    if (inFlight) {
      queued ||= queueIfRunning
      return
    }
    inFlight = true
    onLoading?.(true)
    try {
      const value = await load()
      if (!stopped) onValue(value)
    } catch (error) {
      if (!stopped) onError(error)
    } finally {
      inFlight = false
      if (!stopped) onLoading?.(false)
      if (queued && allowed()) {
        queued = false
        void refresh()
      } else {
        queued = false
        schedule()
      }
    }
  }

  return {
    refresh,
    setEnabled(value: boolean) {
      if (enabled === value || stopped) return
      enabled = value
      if (value) void refresh()
      else {
        queued = false
        clear()
      }
    },
    visibilityChanged() {
      clear()
      if (allowed()) void refresh()
    },
    stop() {
      stopped = true
      enabled = false
      queued = false
      clear()
    },
  }
}
