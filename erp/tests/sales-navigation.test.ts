import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterSalesDraftConfirmed, closeSalesDraft, readSalesView, salesViewUrl } from '../src/lib/salesNavigation.ts'
import { registerDraftNavigation, requestViewChange } from '../src/lib/navigationGuard.ts'

const queryOf = (url: string) => new URL(url, 'https://example.test').searchParams

test('sales direct links select exactly one panel, with an explicit new form taking precedence', () => {
  assert.deepEqual(readSalesView(queryOf('/sales')), { kind: 'list' })
  assert.deepEqual(readSalesView(queryOf('/sales?id=A')), { kind: 'detail', id: 'A' })
  assert.deepEqual(readSalesView(queryOf('/sales?id=A&new=1')), { kind: 'new' })
  assert.deepEqual(readSalesView(queryOf('/sales?id=A&new=0')), { kind: 'detail', id: 'A' })
  assert.deepEqual(readSalesView(queryOf('/sales?id=')), { kind: 'list' })
})

test('sales panel URLs preserve unrelated query values and replace old panel parameters', () => {
  const query = queryOf('/sales?id=A&id=old&new=1&division=TW&search=%EC%A0%9C%EC%95%88')
  const detail = salesViewUrl(query, { kind: 'detail', id: 'B + /' })
  const next = queryOf(detail)
  assert.deepEqual(next.getAll('id'), ['B + /'])
  assert.equal(next.has('new'), false)
  assert.equal(next.get('division'), 'TW')
  assert.equal(next.get('search'), '제안')
  assert.equal(query.get('id'), 'A')
  assert.equal(query.get('new'), '1')
  assert.deepEqual(readSalesView(next), { kind: 'detail', id: 'B + /' })
})

test('same-route selection changes, saved new records, and closing derive their panel only from the current URL', () => {
  const a = '/sales?id=A', b = salesViewUrl(queryOf(a), { kind: 'detail', id: 'B' })
  assert.deepEqual([a, b, a].map(url => readSalesView(queryOf(url))), [
    { kind: 'detail', id: 'A' }, { kind: 'detail', id: 'B' }, { kind: 'detail', id: 'A' },
  ])
  const fresh = salesViewUrl(queryOf(b), { kind: 'new' })
  assert.equal(fresh, '/sales?new=1')
  const saved = salesViewUrl(queryOf(fresh), { kind: 'detail', id: 'saved-id' })
  assert.equal(saved, '/sales?id=saved-id')
  assert.deepEqual(readSalesView(queryOf(saved)), { kind: 'detail', id: 'saved-id' })
  assert.equal(salesViewUrl(queryOf(saved), { kind: 'list' }), '/sales')
})

test('declined closes and busy forms do not call navigation or clear their guard', () => {
  const state = { current: { dirty: true, busy: false } }
  let closed = 0, prompts = 0
  const confirm = () => { prompts++; return false }
  assert.equal(closeSalesDraft(state, confirm, () => { closed++ }), false)
  state.current.busy = true
  assert.equal(closeSalesDraft(state, confirm, () => { closed++ }), false)
  assert.equal(prompts, 1)
  assert.equal(closed, 0)
  assert.deepEqual(state.current, { dirty: true, busy: true })
})

test('an accepted close asks once and does not trigger its own navigation prompt', () => {
  const target = new EventTarget(), state = { current: { dirty: true, busy: false } }
  let closePrompts = 0, navigationPrompts = 0, changed = false
  const cleanup = registerDraftNavigation(target, () => state.current, () => { navigationPrompts++; return false })
  assert.equal(closeSalesDraft(state, () => { closePrompts++; return true }, () => {
    changed = requestViewChange('/sales', target)
  }), true)
  assert.equal(changed, true)
  assert.equal(closePrompts, 1)
  assert.equal(navigationPrompts, 0)
  assert.equal(state.current.dirty, true)
  cleanup()
})

test('completed-save navigation releases its own busy guard only during the callback', () => {
  const target = new EventTarget(), state = { current: { dirty: true, busy: true } }
  const cleanup = registerDraftNavigation(target, () => state.current, () => false)
  assert.equal(requestViewChange('/sales?id=saved', target), false)
  assert.equal(afterSalesDraftConfirmed(state, () => requestViewChange('/sales?id=saved', target)), true)
  assert.equal(requestViewChange('/sales?id=other', target), false)
  cleanup()
})

test('releasing a saved form never bypasses another form guard', () => {
  const target = new EventTarget(), state = { current: { dirty: true, busy: true } }
  const own = registerDraftNavigation(target, () => state.current, () => false)
  const other = registerDraftNavigation(target, () => ({ dirty: false, busy: true }), () => true)
  assert.equal(afterSalesDraftConfirmed(state, () => requestViewChange('/sales?id=saved', target)), false)
  assert.deepEqual(state.current, { dirty: true, busy: true })
  own(); other()
})

test('a failed close callback restores the form guard', () => {
  const previous = { dirty: true, busy: false }, state = { current: previous }
  assert.throws(() => afterSalesDraftConfirmed(state, () => { throw new Error('navigation failed') }), /navigation failed/)
  assert.equal(state.current, previous)
})
