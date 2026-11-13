import { validateGrowth, type GrowthApi, type GrowthDraft, type GrowthItem } from './growth.ts'
import type { DiscoveryPreview } from './discoveryIntake.ts'

export interface DiscoveryCandidate {
  id: string
  key: string
  identity: string
  draft: GrowthDraft
  attempted: boolean
  uncertain: boolean
  error?: string
}
export interface DiscoveryBatchRow extends DiscoveryPreview { candidate?: DiscoveryCandidate }
export interface DiscoveryBatchResult { saved: DiscoveryCandidate[]; pending: DiscoveryCandidate[]; recovered: number }
export interface DiscoveryLedger { known: Map<string, DiscoveryCandidate>; saved: Set<string> }
export function createDiscoveryLedger(): DiscoveryLedger { return { known: new Map(), saved: new Set() } }

const trimSql = (value: string) => value.replace(/^ +| +$/g, '')
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
export function discoveryIdentity(draft: GrowthDraft): string {
  const d = draft.document
  if (draft.kind === 'contact') {
    const email = trimSql(d.email ?? '').toLowerCase(), instagram = (d.instagram ?? '').replace(/^@/, '').toLowerCase()
    return email ? `contact:email:${email}` : instagram ? `contact:ig:${instagram}` : ''
  }
  return draft.kind === 'tender' && d.number?.trim() && d.round?.trim() ? `tender:${trimSql(d.number)}:${trimSql(d.round)}` : ''
}
export function discoveryPayloadKey(draft: GrowthDraft): string {
  const document = structuredClone(draft.document)
  if (draft.kind === 'contact') {
    document.email = trimSql(document.email ?? '').toLowerCase()
    document.instagram = (document.instagram ?? '').replace(/^@/, '').toLowerCase()
  }
  return JSON.stringify(canonical({ kind: draft.kind, title: trimSql(draft.title), owner_id: draft.owner_id, status: draft.status, document, campaign_id: draft.campaign_id ?? null }))
}

/** Keep the original ID and payload for repeat previews in this open dialog only. */
export function prepareDiscoveryBatch(previews: readonly DiscoveryPreview[], ledger: DiscoveryLedger, createId = () => crypto.randomUUID()): DiscoveryBatchRow[] {
  return previews.flatMap(row => {
    if (!row.draft) return [{ ...row }]
    const identity = discoveryIdentity(row.draft), key = discoveryPayloadKey(row.draft)
    if (ledger.saved.has(identity)) return []
    let candidate = ledger.known.get(key)
    if (!candidate) {
      candidate = { id: createId(), key, identity, draft: structuredClone(row.draft), attempted: false, uncertain: false }
      ledger.known.set(key, candidate)
    }
    return [{ ...row, draft: structuredClone(candidate.draft), candidate }]
  })
}
export function recordDiscoveryBatch(result: DiscoveryBatchResult, ledger: DiscoveryLedger): void {
  for (const candidate of result.saved) { ledger.saved.add(candidate.identity); ledger.known.set(candidate.key, candidate) }
  for (const candidate of result.pending) ledger.known.set(candidate.key, candidate)
}
export function matchesDiscoveryCreate(candidate: DiscoveryCandidate, row: GrowthItem | null | undefined): boolean {
  try {
    // Intake always creates drafts for the signed-in importer; it never assigns another owner.
    return !!row && row.id === candidate.id && row.revision === 1 && row.linked_sales_id === null && row.created_by === candidate.draft.owner_id
      && row.kind === candidate.draft.kind && discoveryPayloadKey(row) === discoveryPayloadKey(candidate.draft)
  } catch { return false }
}
function uncertainError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; status?: unknown; uncertain?: unknown; name?: unknown; message?: unknown }
  if ((typeof e.code === 'string' && e.code) || (typeof e.status === 'number' && e.status >= 400 && e.status < 500)) return false
  if (e.uncertain === true && (e.status === undefined || [0, 502, 503, 504].includes(Number(e.status)))) return true
  const message = typeof e.message === 'string' ? e.message : ''
  return (e.name === 'TypeError' && /\b(?:failed to fetch|fetch failed|networkerror|network request failed|network error|load failed|network connection (?:lost|failed))\b/i.test(message))
    || (e.name === 'AbortError' && /\babort(?:ed)?\b/i.test(message))
    || (e.name === 'TimeoutError' && /\b(?:timed? out|timeout)\b/i.test(message))
}
function missingRow(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; status?: unknown }
  return e.code === 'PGRST116' || (!e.code && e.status === 404)
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '저장하지 못했습니다. 같은 후보로 다시 확인해 주세요.'

/** Explicit selected-only create attempt. Never update an existing record or promote review status. */
export async function saveDiscoveryBatch(candidates: readonly DiscoveryCandidate[], api: Pick<GrowthApi, 'saveGrowth' | 'getGrowth'>): Promise<DiscoveryBatchResult> {
  const result: DiscoveryBatchResult = { saved: [], pending: [], recovered: 0 }
  const seen = new Set<string>()
  const snapshot = candidates.map(candidate => ({ ...candidate, draft: structuredClone(candidate.draft) }))
  for (const original of snapshot) {
    const candidate = { ...original, draft: structuredClone(original.draft), attempted: true }
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    const invalid = validateGrowth(candidate.draft)
    if (invalid || !candidate.identity || !['contact', 'tender'].includes(candidate.draft.kind) || candidate.draft.status !== '검토'
      || candidate.draft.campaign_id !== null || (candidate.draft.kind === 'tender' && candidate.draft.document.qualification !== '추가 확인')) {
      result.pending.push({ ...candidate, uncertain: false, error: invalid || '검토 전 후보만 신규 등록할 수 있습니다.' }); continue
    }
    // An earlier ambiguous write may already exist. Resolve it before any further write.
    if (candidate.uncertain) {
      try {
        const row = await api.getGrowth(candidate.id)
        if (matchesDiscoveryCreate(candidate, row)) { result.saved.push({ ...candidate, uncertain: false, error: undefined }); result.recovered++; continue }
        result.pending.push({ ...candidate, error: '같은 ID의 저장 내용 또는 버전이 다릅니다. 기존 자료를 덮어쓰지 않았습니다.' }); continue
      } catch (error) {
        if (!missingRow(error)) { result.pending.push({ ...candidate, error: '이전 저장 여부를 확인하지 못했습니다. 원래 후보와 ID를 유지합니다.' }); continue }
      }
    }
    try {
      const row = await api.saveGrowth(candidate.id, structuredClone(candidate.draft), 0)
      if (matchesDiscoveryCreate(candidate, row)) { result.saved.push({ ...candidate, uncertain: false, error: undefined }); continue }
      // A malformed success response is ambiguous, unlike an explicit DB rejection.
      throw Object.assign(new Error('저장 응답과 후보가 일치하지 않습니다.'), { uncertain: true })
    } catch (error) {
      if (!uncertainError(error)) { result.pending.push({ ...candidate, uncertain: false, error: errorMessage(error) }); continue }
      let recovered = false
      try { recovered = matchesDiscoveryCreate(candidate, await api.getGrowth(candidate.id)) } catch { /* Keep uncertainty and the original ID. */ }
      if (recovered) { result.saved.push({ ...candidate, uncertain: false, error: undefined }); result.recovered++ }
      else result.pending.push({ ...candidate, uncertain: true, error: '저장 여부를 확정하지 못했습니다. 원래 후보와 ID로 다시 확인해 주세요.' })
    }
  }
  return result
}
