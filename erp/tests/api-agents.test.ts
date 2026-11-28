import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueSlots, priceUsd, skillRefs } from '../supabase/functions/api-agents/rules.ts'

// 2026-11-23(월) 05:40 KST = 2026-11-22 20:40 UTC
const mon0540 = new Date('2026-11-22T20:40:00Z')

test('정한 시각이 지나고 30분 안이면 실행 회차', () => {
  assert.deepEqual(dueSlots(['05:33'], null, mon0540), ['2026-11-23 05:33'])
  assert.deepEqual(dueSlots(['05:09'], null, mon0540), [])        // 31분 지남
  assert.deepEqual(dueSlots(['06:00'], null, mon0540), [])        // 아직
})

test('요일 · 형식', () => {
  assert.deepEqual(dueSlots(['05:33'], [1, 2, 3, 4, 5], mon0540), ['2026-11-23 05:33'])
  assert.deepEqual(dueSlots(['05:33'], [6, 7], mon0540), [])
  assert.deepEqual(dueSlots(['5:33', 'x'], null, mon0540), [])
})

test('비용 계산', () => {
  assert.equal(priceUsd('claude-sonnet-5-5', { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, web: 5 }), 3.05)
  assert.equal(priceUsd('claude-haiku-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, web: 0 }), 0.1)
  assert.equal(priceUsd('모름', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, web: 0 }), 2)
})

test('스킬 목록: 올라간 것만 · 같은 것은 한 번', () => {
  const rows = [{ name: 'a', console_skill_id: 'skill_1' }, { name: 'b', console_skill_id: null }, { name: 'c', console_skill_id: 'skill_1' }]
  assert.deepEqual(skillRefs(['a', 'b', 'c', '없음'], rows), [{ type: 'custom', skill_id: 'skill_1', version: 'latest' }])
  assert.deepEqual(skillRefs([], rows), [])
})
