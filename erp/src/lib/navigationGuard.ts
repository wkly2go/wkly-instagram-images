type DraftState = { dirty: boolean; busy: boolean }

/** Local detail-panel changes must honor the same guards as URL navigation. */
export function requestViewChange(to: string, target: EventTarget = window): boolean {
  return target.dispatchEvent(new CustomEvent('wkly:before-navigate', { cancelable: true, detail: { to } }))
}

export function registerDraftNavigation(target: EventTarget, state: () => DraftState, confirmLeave: () => boolean): () => void {
  const navigate = (event: Event) => {
    if (event.defaultPrevented) return
    const { dirty, busy } = state()
    if (busy || (dirty && !confirmLeave())) event.preventDefault()
  }
  const unload = (event: Event) => {
    const { dirty, busy } = state()
    if (!dirty && !busy) return
    event.preventDefault()
    ;(event as BeforeUnloadEvent).returnValue = ''
  }
  target.addEventListener('wkly:before-navigate', navigate)
  target.addEventListener('beforeunload', unload)
  return () => {
    target.removeEventListener('wkly:before-navigate', navigate)
    target.removeEventListener('beforeunload', unload)
  }
}
