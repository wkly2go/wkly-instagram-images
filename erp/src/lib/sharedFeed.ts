import { createVisiblePoller } from './visiblePolling'

/** 같은 사용자·날짜의 구독자들이 한 번의 조회와 실시간 구독을 공유한다. */
export function createSharedFeed<T>({ initial, load, connect, isVisible, onVisibility, intervalMs = 300_000 }: {
  initial: T; load: () => Promise<T>; connect: (changed: () => void) => () => void
  isVisible: () => boolean; onVisibility: (changed: () => void) => () => void; intervalMs?: number
}) {
  let value = initial
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (!stop) {
        const poller = createVisiblePoller({ load, isVisible, intervalMs,
          onValue: next => { value = next; listeners.forEach(fn => fn()) },
          onError: () => undefined,
        })
        const disconnect = connect(() => { void poller.refresh(true) })
        const unlisten = onVisibility(poller.visibilityChanged)
        stop = () => { poller.stop(); disconnect(); unlisten() }
        poller.setEnabled(true)
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { stop?.(); stop = undefined; value = initial }
      }
    },
  }
}
