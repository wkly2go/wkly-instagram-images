import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newGrowth, type GrowthDraft, type GrowthItem } from '../src/lib/growth.ts'
import { contactImportIdentity, saveContactImportBatch, type ContactImportCandidate } from '../src/lib/contactImport.ts'

function candidate(id: string, email = `${id}@brand.kr`): ContactImportCandidate {
  const draft = newGrowth('contact', 'owner')
  draft.title = email
  draft.document.email = email
  return { id, draft }
}
function row(c: ContactImportCandidate): GrowthItem {
  return { ...structuredClone(c.draft), id: c.id, revision: 1, linked_sales_id: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', created_by: 'owner' }
}
const missing = async (): Promise<GrowthItem> => { throw new Error('조회 결과를 확인할 수 없습니다.') }

test('partial contact import removes confirmed successes and retains failed candidates and original errors', async () => {
  const input = [candidate('one'), candidate('two'), candidate('three')], before = structuredClone(input), failure = new Error('저장 실패')
  const writes: [string, number][] = [], reads: string[] = []
  const result = await saveContactImportBatch(input, {
    async saveGrowth(id, draft, revision) { writes.push([id, revision]); if (id === 'two') throw failure; return row({ id, draft }) },
    async getGrowth(id) { reads.push(id); return missing() },
  })
  assert.deepEqual(result.saved.map(c => c.id), ['one', 'three'])
  assert.deepEqual(result.pending.map(c => c.id), ['two'])
  assert.strictEqual(result.pending[0].error, failure)
  assert.deepEqual(result.pending[0].draft, before[1].draft)
  assert.deepEqual(writes, [['one', 0], ['two', 0], ['three', 0]])
  assert.deepEqual(reads, ['two'])
  assert.deepEqual(input, before)
})

test('lost save response is recovered only from the same ID and normalized complete payload', async () => {
  const c = candidate('lost', ' BRAND@Example.com ')
  c.draft.title = '  Brand  '
  c.draft.document.instagram = '@Brand'
  const stored = row(c)
  stored.title = 'Brand'
  stored.document = Object.fromEntries(Object.entries({ ...stored.document, email: 'brand@example.com', instagram: 'brand' }).reverse()) as GrowthDraft['document']
  let writes = 0, reads = 0
  const result = await saveContactImportBatch([c], {
    async saveGrowth(id, _draft, revision) { writes++; assert.equal(id, c.id); assert.equal(revision, 0); throw new Error('응답 유실') },
    async getGrowth(id) { reads++; assert.equal(id, c.id); return stored },
  })
  assert.deepEqual(result.saved.map(x => x.id), ['lost'])
  assert.equal(result.pending.length, 0)
  assert.equal(result.recovered, 1)
  assert.equal(writes, 1)
  assert.equal(reads, 1)
})

test('server-added empty contact keys and reordered JSON do not prevent a verified recovery', async () => {
  const c = candidate('empty')
  delete c.draft.document.instagram
  const stored = row(c)
  stored.document.instagram = ''
  stored.revision = 3
  const result = await saveContactImportBatch([c], { async saveGrowth() { throw new Error('버전 충돌') }, async getGrowth() { return stored } })
  assert.equal(result.recovered, 1)
  assert.equal(result.pending.length, 0)
})

test('readback mismatches never become successes or overwrite an existing record', async () => {
  const c = candidate('expected')
  const mutations: ((r: GrowthItem) => void)[] = [
    r => { r.id = 'different-id' },
    r => { r.kind = 'tender' },
    r => { r.title = '다른 제목' },
    r => { r.owner_id = 'other' },
    r => { r.status = '제외' },
    r => { r.campaign_id = 'campaign' },
    r => { r.document.email = 'other@brand.kr' },
    r => { r.document.instagram = 'other' },
    r => { r.document.note = '이미 수정한 연락 내용' },
    r => { r.document.division = 'AR' },
    r => { r.revision = 0 },
  ]
  for (const mutate of mutations) {
    const existing = row(c); mutate(existing)
    const original = structuredClone(existing), failure = new Error('기존 자료와 충돌'), calls: number[] = []
    const result = await saveContactImportBatch([c], {
      async saveGrowth(_id, _draft, revision) { calls.push(revision); throw failure },
      async getGrowth() { return existing },
    })
    assert.equal(result.saved.length, 0)
    assert.equal(result.recovered, 0)
    assert.strictEqual(result.pending[0].error, failure)
    assert.deepEqual(calls, [0])
    assert.deepEqual(existing, original)
  }
})

test('same email on a different ID remains a duplicate error and is never adopted', async () => {
  const c = candidate('new'), existing = row({ ...c, id: 'old' }), duplicate = new Error('같은 연락처가 이미 있습니다.')
  const result = await saveContactImportBatch([c], {
    async saveGrowth() { throw duplicate },
    async getGrowth(id) { assert.equal(id, 'new'); return existing },
  })
  assert.equal(result.saved.length, 0)
  assert.equal(result.pending[0].id, 'new')
  assert.strictEqual(result.pending[0].error, duplicate)
})

test('failed or empty readback retains the original write error and never automatically resends', async () => {
  for (const read of [missing, async () => null as unknown as GrowthItem]) {
    const c = candidate('uncertain'), failure = new Error('저장 결과 불확실')
    let writes = 0
    const result = await saveContactImportBatch([c], {
      async saveGrowth() { writes++; throw failure }, getGrowth: read,
    })
    assert.equal(writes, 1)
    assert.equal(result.saved.length, 0)
    assert.equal(result.pending[0].id, c.id)
    assert.strictEqual(result.pending[0].error, failure)
  }
})

test('explicit retry attempts only retained candidates with the same IDs and revision zero', async () => {
  const input = [candidate('first'), candidate('retry')], calls: [string, number][] = []
  let available = false
  const api = {
    async saveGrowth(id: string, draft: GrowthDraft, revision: number) { calls.push([id, revision]); if (id === 'retry' && !available) throw new Error('연결 실패'); return row({ id, draft }) },
    getGrowth: missing,
  }
  const first = await saveContactImportBatch(input, api)
  available = true
  const second = await saveContactImportBatch(first.pending, api)
  assert.deepEqual(second.saved.map(c => c.id), ['retry'])
  assert.equal(second.pending.length, 0)
  assert.deepEqual(calls, [['first', 0], ['retry', 0], ['retry', 0]])
})

test('batch snapshot isolates requests and comparisons from changes during an awaited save', async () => {
  const input = [candidate('first'), candidate('second')]
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const seen: string[] = []
  const pending = saveContactImportBatch(input, {
    async saveGrowth(id, draft) {
      const saved = row({ id, draft })
      if (id === 'first') await gate
      seen.push(draft.document.note)
      draft.document.note = 'API 내부 변경'
      return saved
    },
    getGrowth: missing,
  })
  input[1].draft.document.note = '호출 이후 입력 변경'
  release()
  const result = await pending
  assert.deepEqual(seen, ['', ''])
  assert.deepEqual(result.saved.map(c => c.draft.document.note), ['', ''])
  assert.equal(input[0].draft.document.note, '')
  assert.equal(input[1].draft.document.note, '호출 이후 입력 변경')
})

test('malformed successful response requires readback confirmation instead of assuming success', async () => {
  const c = candidate('malformed')
  const result = await saveContactImportBatch([c], { async saveGrowth() { return null as unknown as GrowthItem }, async getGrowth() { return row(c) } })
  assert.equal(result.recovered, 1)
  assert.equal(result.pending.length, 0)
})

test('contact identity applies server normalization while preserving distinct secondary identities', () => {
  const a = candidate('a', ' HELLO@Brand.kr '), b = candidate('b', 'hello@brand.kr')
  assert.equal(contactImportIdentity(a.draft), contactImportIdentity(b.draft))
  a.draft.document.instagram = '@BRAND'
  assert.notEqual(contactImportIdentity(a.draft), contactImportIdentity(b.draft))
  b.draft.document.instagram = 'brand'
  assert.equal(contactImportIdentity(a.draft), contactImportIdentity(b.draft))
})
