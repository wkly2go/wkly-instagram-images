import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscoveryReport } from '../src/lib/discoveryIntake.ts'
import { createDiscoveryLedger, discoveryPayloadKey, matchesDiscoveryCreate, prepareDiscoveryBatch, recordDiscoveryBatch, saveDiscoveryBatch, type DiscoveryCandidate } from '../src/lib/discoveryBatch.ts'
import type { GrowthDraft, GrowthItem } from '../src/lib/growth.ts'

const today = '2026-11-13'
const source = (n = 1) => ({ kind: 'contact', title: `테스트 전용 브랜드 ${n}`, target: '가상 테스트 브랜드', source_url: 'https://example.com/test', verified_on: today, evidence: '테스트 공지', need: '테스트 수요', offer: '테스트 제안', next_action: '테스트 확인', email: `test${n}@example.com` })
const previews = (raw: unknown) => parseDiscoveryReport(JSON.stringify(raw), 'contact', 'owner', today)
const candidates = (n = 2) => prepareDiscoveryBatch(previews(Array.from({ length: n }, (_, i) => source(i + 1))), createDiscoveryLedger(), (() => { let id = 0; return () => `test-${++id}` })()).map(row => row.candidate!)
const savedRow = (id: string, draft: GrowthDraft): GrowthItem => ({ ...structuredClone(draft), id, revision: 1, linked_sales_id: null, created_at: '', updated_at: '', created_by: 'owner' })
const noRead = async (): Promise<GrowthItem> => { throw new Error('unexpected read') }

test('selected-only batch stores review drafts with expectedRevision zero and no promotion', async () => {
  const rows = candidates(), calls: string[] = []
  const result = await saveDiscoveryBatch([rows[1]], { async saveGrowth(id, draft, revision) { calls.push(id); assert.equal(revision, 0); assert.equal(draft.status, '검토'); return savedRow(id, draft) }, getGrowth: noRead })
  assert.deepEqual(calls, ['test-2']); assert.equal(result.saved.length, 1); assert.equal(result.pending.length, 0)
})
test('successful candidates disappear, explicit failures keep their IDs and payload through repeat preview', async () => {
  const ledger = createDiscoveryLedger(), before = prepareDiscoveryBatch(previews([source(1), source(2)]), ledger)
  const all = before.map(row => row.candidate!), failed = all[1]
  const result = await saveDiscoveryBatch(all, { async saveGrowth(id, draft) { if (id === failed.id) throw Object.assign(new Error('permission denied'), { code: '42501' }); return savedRow(id, draft) }, getGrowth: noRead })
  recordDiscoveryBatch(result, ledger)
  const after = prepareDiscoveryBatch(previews([source(1), source(2)]), ledger)
  assert.equal(after.length, 1); assert.equal(after[0].candidate?.id, failed.id)
  assert.deepEqual(after[0].candidate?.draft, failed.draft); assert.match(after[0].candidate?.error ?? '', /permission/)
  const calls: string[] = []
  const retried = await saveDiscoveryBatch([after[0].candidate!], { async saveGrowth(id, draft) { calls.push(id); return savedRow(id, draft) }, getGrowth: noRead })
  assert.deepEqual(calls, [failed.id]); recordDiscoveryBatch(retried, ledger)
  assert.equal(prepareDiscoveryBatch(previews([source(1), source(2)]), ledger).length, 0)
})
test('invalid previews remain visible and never receive a candidate ID or save selection', () => {
  const rows = prepareDiscoveryBatch(previews([source(), { ...source(2), evidence: '' }]), createDiscoveryLedger())
  assert.equal(rows.length, 2); assert.ok(rows[0].candidate); assert.equal(rows[1].candidate, undefined); assert.ok(rows[1].error)
})
test('ambiguous write recovers only the same ID, full normalized payload, revision one and no sales link', async () => {
  const candidate = candidates(1)[0]
  const persisted = savedRow(candidate.id, candidate.draft)
  const result = await saveDiscoveryBatch([candidate], { async saveGrowth() { throw new TypeError('Failed to fetch') }, async getGrowth(id) { assert.equal(id, candidate.id); return persisted } })
  assert.equal(result.saved.length, 1); assert.equal(result.recovered, 1)
  for (const patch of [{ id: 'other' }, { revision: 2 }, { created_by: 'other' }, { created_by: null }, { linked_sales_id: 'sales' }, { title: 'different' }, { owner_id: 'other' }, { status: '확인' }, { document: { ...persisted.document, note: 'different' } }]) assert.equal(matchesDiscoveryCreate(candidate, { ...persisted, ...patch }), false)
})
test('explicit database rejection cannot become success even if a matching ID already exists', async () => {
  const candidate = candidates(1)[0]
  for (const error of [Object.assign(new Error('conflict'), { code: '40001' }), Object.assign(new Error('denied'), { code: '42501', uncertain: true }), Object.assign(new Error('unauthorized'), { status: 403 }), new Error('same record exists'), new TypeError('Cannot read properties of undefined'), Object.assign(new TypeError('Failed to fetch'), { code: '40001' }), Object.assign(new Error('database rejection'), { uncertain: true, code: 'P0001', status: 503 })]) {
    let reads = 0
    const result = await saveDiscoveryBatch([candidate], { async saveGrowth() { throw error }, async getGrowth() { reads++; return savedRow(candidate.id, candidate.draft) } })
    assert.equal(result.saved.length, 0); assert.equal(result.pending.length, 1); assert.equal(reads, 0)
  }
})
test('failed ambiguity read preserves exact candidate; next explicit retry reads first without resending', async () => {
  const candidate = candidates(1)[0]
  const first = await saveDiscoveryBatch([candidate], { async saveGrowth() { throw Object.assign(new Error('transport'), { uncertain: true, status: 503 }) }, async getGrowth() { throw new TypeError('offline') } })
  assert.equal(first.pending[0].uncertain, true); assert.equal(first.pending[0].id, candidate.id); assert.deepEqual(first.pending[0].draft, candidate.draft)
  let writes = 0
  const retried = await saveDiscoveryBatch(first.pending, { async saveGrowth() { writes++; throw new Error('must not write') }, async getGrowth() { return savedRow(candidate.id, candidate.draft) } })
  assert.equal(writes, 0); assert.equal(retried.recovered, 1)
})
test('retry after a proven missing ID creates with original ID; other read failures never resend', async () => {
  const candidate: DiscoveryCandidate = { ...candidates(1)[0], uncertain: true, attempted: true }
  const result = await saveDiscoveryBatch([candidate], { async getGrowth() { throw Object.assign(new Error('no rows'), { code: 'PGRST116', status: 406 }) }, async saveGrowth(id, draft, revision) { assert.equal(id, candidate.id); assert.equal(revision, 0); return savedRow(id, draft) } })
  assert.equal(result.saved.length, 1)
  for (const error of [new TypeError('offline'), Object.assign(new Error('denied'), { code: '42501', status: 404 })]) {
    let writes = 0
    const failed = await saveDiscoveryBatch([candidate], { async getGrowth() { throw error }, async saveGrowth() { writes++; throw new Error('must not write') } })
    assert.equal(writes, 0); assert.equal(failed.pending.length, 1); assert.equal(failed.pending[0].uncertain, true)
  }
})
test('unknown write followed by a changed revision stays pending and does not overwrite on retry', async () => {
  const candidate = candidates(1)[0], stored = { ...savedRow(candidate.id, candidate.draft), revision: 2 }
  const result = await saveDiscoveryBatch([candidate], { async saveGrowth() { throw new TypeError('Failed to fetch') }, async getGrowth() { return stored } })
  let writes = 0
  const retry = await saveDiscoveryBatch(result.pending, { async saveGrowth() { writes++; return stored }, async getGrowth() { return stored } })
  assert.equal(writes, 0); assert.equal(retry.pending.length, 1)
})
test('full payload comparison normalizes only SQL title/email/instagram and object key order', () => {
  const d = candidates(1)[0].draft
  assert.equal(discoveryPayloadKey({ ...d, title: ` ${d.title} `, document: { ...d.document, email: ' TEST1@EXAMPLE.COM ', instagram: '@TEST' } }), discoveryPayloadKey({ ...d, document: { ...d.document, email: 'test1@example.com', instagram: 'test' } }))
  assert.notEqual(discoveryPayloadKey(d), discoveryPayloadKey({ ...d, document: { ...d.document, source_url: 'https://example.com/changed' } }))
})
test('same identity already saved is not reinserted after report formatting or other source changes', () => {
  const ledger = createDiscoveryLedger(), prepared = prepareDiscoveryBatch(previews(source()), ledger), candidate = prepared[0].candidate!
  recordDiscoveryBatch({ saved: [candidate], pending: [], recovered: 0 }, ledger)
  assert.equal(prepareDiscoveryBatch(previews({ ...source(), offer: '수정된 제안' }), ledger).length, 0)
})
test('tender draft stays review with exact public identifiers and is never submitted or qualified by batch', async () => {
  const raw = { ...source(), kind: 'tender', number: 'TEST-01', round: '00', deadline: '2026-12-01T18:00:00+09:00' }
  const candidate = prepareDiscoveryBatch(parseDiscoveryReport(JSON.stringify(raw), 'tender', 'owner', today), createDiscoveryLedger())[0].candidate!
  const saved = await saveDiscoveryBatch([candidate], { async saveGrowth(id, draft) { assert.equal(draft.document.qualification, '추가 확인'); assert.equal(draft.document.number, 'TEST-01'); assert.equal(draft.status, '검토'); return savedRow(id, draft) }, getGrowth: noRead })
  assert.equal(saved.saved.length, 1)
  const altered = { ...candidate, draft: { ...candidate.draft, document: { ...candidate.draft.document, qualification: '충족' } } }
  const rejected = await saveDiscoveryBatch([altered], { async saveGrowth() { throw new Error('must not save') }, getGrowth: noRead })
  assert.equal(rejected.pending.length, 1); assert.match(rejected.pending[0].error ?? '', /검토 전/)
})
test('the whole selection is snapshotted before awaiting saves and malformed success is read back', async () => {
  const rows = candidates(), expectedSecond = structuredClone(rows[1].draft)
  let first: GrowthItem | null = null, reads = 0
  const result = await saveDiscoveryBatch(rows, { async saveGrowth(id, draft) {
    if (id === rows[0].id) { first = savedRow(id, draft); rows[1].draft.document.note = 'mutated after start'; return null as unknown as GrowthItem }
    assert.deepEqual(draft, expectedSecond); return savedRow(id, draft)
  }, async getGrowth(id) { reads++; assert.equal(id, rows[0].id); return first! } })
  assert.equal(result.saved.length, 2); assert.equal(result.recovered, 1); assert.equal(reads, 1)
})
