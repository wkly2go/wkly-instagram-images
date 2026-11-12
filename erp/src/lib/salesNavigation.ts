export type SalesView = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string }

/** The URL owns the visible sales panel, including direct links and history. */
export function readSalesView(query: URLSearchParams): SalesView {
  if (query.get('new') === '1') return { kind: 'new' }
  const id = query.get('id')
  return id ? { kind: 'detail', id } : { kind: 'list' }
}

export function salesViewUrl(query: URLSearchParams, view: SalesView): string {
  const next = new URLSearchParams(query)
  next.delete('id')
  next.delete('new')
  if (view.kind === 'new') next.set('new', '1')
  else if (view.kind === 'detail') next.set('id', view.id)
  const search = next.toString()
  return search ? `/sales?${search}` : '/sales'
}

export type SalesDraftGuard = { current: { dirty: boolean; busy: boolean } }

/** Release only this form during an accepted close or completed-save callback. */
export function afterSalesDraftConfirmed<T>(state: SalesDraftGuard, action: () => T): T {
  const previous = state.current
  state.current = { dirty: false, busy: false }
  try { return action() } finally { state.current = previous }
}

export function closeSalesDraft(state: SalesDraftGuard, confirmClose: () => boolean, close: () => void): boolean {
  if (state.current.busy || (state.current.dirty && !confirmClose())) return false
  afterSalesDraftConfirmed(state, close)
  return true
}
