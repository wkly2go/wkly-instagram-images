import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDraftNavigation, requestViewChange } from '../src/lib/navigationGuard.ts'

test('switching a detail panel preserves unsaved input when leaving is declined', () => {
  const target = new EventTarget()
  let selection = 'A', accepted = false, confirmations = 0
  const state = { dirty: true, busy: false }
  const cleanup = registerDraftNavigation(target, () => state, () => { confirmations++; return accepted })
  const select = (id: string) => { if (requestViewChange(`detail:${id}`, target)) selection = id }
  select('B'); assert.equal(selection, 'A'); assert.equal(confirmations, 1)
  accepted = true; select('B'); assert.equal(selection, 'B')
  cleanup()
})

test('saving or running AI blocks route and panel changes without a discard confirmation', () => {
  const target = new EventTarget()
  const state = { dirty: false, busy: true }
  let confirmations = 0
  const cleanup = registerDraftNavigation(target, () => state, () => { confirmations++; return true })
  assert.equal(requestViewChange('/ads', target), false)
  assert.equal(requestViewChange('growth:new', target), false)
  assert.equal(confirmations, 0)
  state.busy = false
  assert.equal(requestViewChange('/ads', target), true)
  state.dirty = true
  assert.equal(requestViewChange('growth:new', target), true)
  assert.equal(confirmations, 1)
  cleanup()
})

test('page unload is guarded only while dirty or busy, and unmount removes listeners', () => {
  const target = new EventTarget(), state = { dirty: false, busy: false }
  const cleanup = registerDraftNavigation(target, () => state, () => false)
  // Node's base Event has a read-only boolean returnValue; browsers expose a
  // writable string on BeforeUnloadEvent instead.
  const unload = () => Object.defineProperty(new Event('beforeunload', { cancelable: true }), 'returnValue', { value: 'unchanged', writable: true })
  assert.equal(target.dispatchEvent(unload()), true)
  state.dirty = true; assert.equal(target.dispatchEvent(unload()), false)
  state.dirty = false; state.busy = true; assert.equal(target.dispatchEvent(unload()), false)
  cleanup()
  assert.equal(target.dispatchEvent(unload()), true)
  assert.equal(requestViewChange('/sales', target), true)
})

test('a blocked nested editor does not trigger a second discard prompt', () => {
  const target = new EventTarget()
  const removeChild = registerDraftNavigation(target, () => ({ dirty: false, busy: true }), () => true)
  let confirmations = 0
  const removeParent = registerDraftNavigation(target, () => ({ dirty: true, busy: false }), () => { confirmations++; return true })
  assert.equal(requestViewChange('/sales', target), false)
  assert.equal(confirmations, 0)
  removeChild(); removeParent()
})
