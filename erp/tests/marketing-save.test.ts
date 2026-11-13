import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultMarketingCampaign } from '../src/lib/marketing.ts'
import { saveMarketingWithRecovery } from '../src/lib/marketingSave.ts'
const user = '10000000-0000-4000-8000-000000000001'
const lost = new Error('save response lost')
function setup(patch: Record<string, unknown> = {}) {
  const draft = defaultMarketingCampaign()
  const row = { ...structuredClone(draft), revision: 1, updatedBy: user, ...patch }
  let writes = 0, reads = 0
  const store = {
    async saveMarketingCampaign() { writes++; throw lost },
    async listMarketingCampaigns() { reads++; return [row] },
  }
  return { draft, row, store, counts: () => ({ writes, reads }) }
}
test('uncertain save recovers only the same document, next revision and actor', async () => {
  const s = setup()
  assert.deepEqual(await saveMarketingWithRecovery(s.store, s.draft, user), s.row)
  assert.deepEqual(s.counts(), { writes: 1, reads: 1 })
})
for (const [name, patch] of Object.entries({
  'other id': { id: crypto.randomUUID() }, 'previous revision': { revision: 0 },
  'later revision': { revision: 2 }, 'other editor': { updatedBy: 'another-editor' },
  'changed budget': { totalBudget: 9999 },
  'changed approval': { reviews: { content: true, rights: false, budget: false } },
  'changed status': { status: 'ready' }, 'changed destination': { landingUrl: 'https://example.com/other' },
})) test('uncertain save preserves the original error for ' + name, async () => {
  const s = setup(patch)
  await assert.rejects(saveMarketingWithRecovery(s.store, s.draft, user), e => e === lost)
  assert.deepEqual(s.counts(), { writes: 1, reads: 1 })
})
test('failed or missing readback never causes another write', async () => {
  for (const read of [async () => [], async () => { throw new Error('read failed') }]) {
    const s = setup(); s.store.listMarketingCampaigns = read
    await assert.rejects(saveMarketingWithRecovery(s.store, s.draft, user), e => e === lost)
    assert.equal(s.counts().writes, 1)
  }
})
test('successful saves do not issue a recovery query', async () => {
  const s = setup()
  assert.deepEqual(await saveMarketingWithRecovery({ ...s.store, async saveMarketingCampaign() { return s.row } }, s.draft, user), s.row)
  assert.equal(s.counts().reads, 0)
})
test('recovery ignores key order and preserves intent if transport mutates its copy', async () => {
  const s = setup(), row = Object.fromEntries(Object.entries(s.row).reverse())
  s.store.listMarketingCampaigns = async () => [row as typeof s.row]
  s.store.saveMarketingCampaign = async (candidate?: typeof s.draft) => {
    if (candidate) candidate.title = 'mutated by transport'
    throw lost
  }
  const title = s.draft.title
  assert.deepEqual(await saveMarketingWithRecovery(s.store, s.draft, user), row)
  assert.equal(s.draft.title, title)
})
