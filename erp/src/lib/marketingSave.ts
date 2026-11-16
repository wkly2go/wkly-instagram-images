import type { MarketingCampaign } from './marketing'
interface CampaignStore {
  saveMarketingCampaign: (campaign: MarketingCampaign) => Promise<MarketingCampaign>
  listMarketingCampaigns: () => Promise<MarketingCampaign[]>
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
function document(campaign: MarketingCampaign): string {
  const { id: _id, revision: _revision, createdAt: _created, updatedAt: _updated, createdBy: _creator, updatedBy: _editor, ...fields } = campaign
  return JSON.stringify(canonical(fields))
}
/** Confirm uncertain writes against the complete submitted document, next revision and actor. */
export async function saveMarketingWithRecovery(store: CampaignStore, campaign: MarketingCampaign, userId: string): Promise<MarketingCampaign> {
  const expected = structuredClone(campaign)
  try { return await store.saveMarketingCampaign(structuredClone(expected)) }
  catch (error) {
    try {
      const row = (await store.listMarketingCampaigns()).find(item => item.id === expected.id)
      if (row && row.revision === expected.revision + 1 && row.updatedBy === userId && document(row) === document(expected)) return row
    } catch { /* Failed reads cannot confirm the original write. */ }
    throw error
  }
}
