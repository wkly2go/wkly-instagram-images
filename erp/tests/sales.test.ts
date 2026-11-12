import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newSalesDraft, validateSales, canEditSales, needsFollowup, salesSummary } from '../src/lib/sales.ts'

test('unknown amount stays distinct from zero; amounts must be safe non-negative integers', () => {
  const d = { ...newSalesDraft('owner'), title: '공간 운영 제안' }
  for (const amount of [null, 0, 1200000]) assert.equal(validateSales({ ...d, expected_amount: amount }), null)
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.ok(validateSales({ ...d, expected_amount: amount }))
})
test('closed stages require a reason; only won opportunities can link a project', () => {
  const d = { ...newSalesDraft('owner'), title: '기회' }
  assert.ok(validateSales({ ...d, stage: '실주' }))
  assert.equal(validateSales({ ...d, stage: '실주', result_note: '일정 불일치' }), null)
  assert.ok(validateSales({ ...d, project_id: 'project' }))
  assert.equal(validateSales({ ...d, stage: '수주', result_note: '계약 확인', project_id: 'project' }), null)
})
test('follow-up requires an action and real calendar date; closed work is excluded', () => {
  const d = { ...newSalesDraft('owner'), title: '기회' }
  assert.ok(validateSales({ ...d, next_date: '2026-02-30', next_action: '전화' }))
  assert.ok(validateSales({ ...d, next_date: '2026-11-13' }))
  assert.equal(validateSales({ ...d, next_date: '2026-11-13', next_action: '전화' }), null)
  assert.equal(needsFollowup({ stage: '제안', next_date: '2026-11-12' }, '2026-11-12'), true)
  assert.equal(needsFollowup({ stage: '수주', next_date: '2026-11-11' }, '2026-11-12'), false)
})
test('active owner or admin can edit; inactive users and other members cannot', () => {
  const row = { owner_id: 'a' }
  assert.equal(canEditSales(row, { id: 'a', active: true, role: 'member' }), true)
  assert.equal(canEditSales(row, { id: 'b', active: true, role: 'admin' }), true)
  assert.equal(canEditSales(row, { id: 'b', active: true, role: 'member' }), false)
  assert.equal(canEditSales(row, { id: 'a', active: false, role: 'admin' }), false)
})
test('unsafe source links and unrelated contact selections are rejected', () => {
  const d = { ...newSalesDraft('owner'), title: '기회' }
  for (const source_url of ['javascript:alert(1)', 'file:///tmp/x', 'https://user:pass@example.com']) assert.ok(validateSales({ ...d, source_url }))
  assert.ok(validateSales({ ...d, contact_id: 'contact' }))
  assert.equal(validateSales({ ...d, source_url: 'https://example.com/info?q=1' }), null)
})
test('list summaries do not carry long notes or source URLs', () => {
  const row = { ...newSalesDraft('owner'), id: 'id', title: '기회', description: 'long', result_note: 'private', source_url: 'https://example.com', revision: 1, created_by: 'owner', updated_by: 'owner', created_at: '', updated_at: '' }
  const summary = salesSummary(row)
  assert.equal('description' in summary, false)
  assert.equal('result_note' in summary, false)
  assert.equal('source_url' in summary, false)
})
