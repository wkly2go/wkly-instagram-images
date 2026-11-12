import type { GrowthApi, GrowthDraft, GrowthItem } from './growth'

export interface ContactImportCandidate {
  id: string
  draft: GrowthDraft
  error?: unknown
}

export interface ContactImportResult {
  saved: ContactImportCandidate[]
  pending: ContactImportCandidate[]
  recovered: number
}

const trimSqlSpaces = (value: string) => value.replace(/^ +| +$/g, '')
function contactFields(draft: GrowthDraft): { email: string; instagram: string } | null {
  const document = draft?.document
  if (draft?.kind !== 'contact' || !document || typeof document !== 'object' || Array.isArray(document)) return null
  if (document.email != null && typeof document.email !== 'string') return null
  if (document.instagram != null && typeof document.instagram !== 'string') return null
  return {
    email: trimSqlSpaces(document.email ?? '').toLowerCase(),
    instagram: (document.instagram ?? '').replace(/^@/, '').toLowerCase(),
  }
}

export function contactImportIdentity(draft: GrowthDraft): string {
  const fields = contactFields(draft)
  return fields && (fields.email || fields.instagram) ? JSON.stringify([fields.email, fields.instagram]) : ''
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]))
  return value
}

function payload(draft: GrowthDraft): string | null {
  const fields = contactFields(draft)
  if (!fields || typeof draft.title !== 'string') return null
  return JSON.stringify(canonical({
    kind: draft.kind,
    title: trimSqlSpaces(draft.title),
    owner_id: draft.owner_id,
    status: draft.status,
    campaign_id: draft.campaign_id ?? null,
    document: { ...draft.document, ...fields },
  }))
}

function matches(candidate: ContactImportCandidate, row: GrowthItem | null | undefined): boolean {
  const identity = contactImportIdentity(candidate.draft)
  const expected = payload(candidate.draft)
  return !!row && row.id === candidate.id && row.kind === 'contact' && Number.isInteger(row.revision) && row.revision >= 1
    && !!identity && expected !== null && contactImportIdentity(row) === identity && expected === payload(row)
}

/** One explicit attempt per candidate. Read back the same ID after errors; never auto-resend or overwrite. */
export async function saveContactImportBatch(candidates: readonly ContactImportCandidate[], api: Pick<GrowthApi, 'saveGrowth' | 'getGrowth'>): Promise<ContactImportResult> {
  const snapshot = candidates.map(({ id, draft }) => ({ id, draft: structuredClone(draft) }))
  const result: ContactImportResult = { saved: [], pending: [], recovered: 0 }
  for (const candidate of snapshot) {
    try {
      if (!contactImportIdentity(candidate.draft)) throw new Error('확인할 연락처 정보가 없습니다.')
      const row = await api.saveGrowth(candidate.id, structuredClone(candidate.draft), 0)
      if (!matches(candidate, row)) throw new Error('저장 응답과 후보가 일치하지 않습니다. 기존 자료를 확인해 주세요.')
      result.saved.push(candidate)
    } catch (error) {
      let recovered = false
      try { recovered = matches(candidate, await api.getGrowth(candidate.id)) } catch { /* A failed read is not proof that the write failed. */ }
      if (recovered) {
        result.saved.push(candidate)
        result.recovered++
      } else result.pending.push({ ...candidate, error })
    }
  }
  return result
}
