import { newGrowth, safeWebUrl, type GrowthDraft } from './growth'

export interface TenderSearchQuery { category: 'service' | 'construction'; startDate: string; endDate: string; keyword: string; page: number }
export interface TenderCandidate { title: string; number: string; round: string; agency: string; deadline: string; amount: number | null; source_url: string; notice_date: string; warnings: string[] }
export interface TenderSearchResult { items: TenderCandidate[]; total: number; page: number; hasMore: boolean; limited: boolean; omitted: number }

/** Selecting a preset only edits query conditions. Lookup remains an explicit action. */
export const TENDER_SEARCH_PRESETS = [
  { keyword: 'SNS 홍보', category: 'service' },
  { keyword: '콘텐츠 제작', category: 'service' },
  { keyword: '행사 운영', category: 'service' },
  { keyword: '전시', category: 'service' },
  { keyword: '공간', category: 'service' },
  { keyword: '공간 설계', category: 'service' },
  { keyword: '인테리어', category: 'construction' },
  { keyword: '실내건축', category: 'construction' },
  { keyword: '리모델링', category: 'construction' },
] as const satisfies ReadonlyArray<Pick<TenderSearchQuery, 'keyword' | 'category'>>

export function defaultTenderQuery(now = new Date()): TenderSearchQuery {
  const koreanDay = now.getTime() + 9 * 3600000
  return { category: 'service', startDate: new Date(koreanDay - 6 * 86400000).toISOString().slice(0, 10), endDate: new Date(koreanDay).toISOString().slice(0, 10), keyword: '', page: 1 }
}
export function validateTenderQuery(query: TenderSearchQuery): string | null {
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!validDay(query.startDate) || !validDay(query.endDate) || query.endDate < query.startDate || Date.parse(query.endDate) - Date.parse(query.startDate) > 6 * 86400000) return '시작일·종료일을 포함해 최대 7일을 선택해 주세요.'
  if (!['service', 'construction'].includes(query.category) || !Number.isInteger(query.page) || query.page < 1 || query.page > 20) return '업무 구분과 조회 페이지를 확인해 주세요.'
  if (query.keyword.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(query.keyword)) return '공고명 검색어는 100자 이내로 입력해 주세요.'
  return null
}
export function readTenderSearchResult(value: unknown): TenderSearchResult {
  const fail = () => { throw new Error('공고 조회 응답을 확인하지 못했습니다. 서버 적용 상태를 확인해 주세요.') }
  if (!value || typeof value !== 'object') return fail()
  const r = value as TenderSearchResult
  if (!Array.isArray(r.items) || r.items.length > 30 || !Number.isSafeInteger(r.total) || r.total < 0 || !Number.isSafeInteger(r.page) || r.page < 1 || r.page > 20 || !Number.isSafeInteger(r.omitted) || r.omitted < 0 || r.omitted > 30 || typeof r.hasMore !== 'boolean' || typeof r.limited !== 'boolean') return fail()
  for (const item of r.items) {
    if (!item || typeof item !== 'object' || !['title', 'number', 'round', 'agency', 'deadline', 'source_url', 'notice_date'].every(key => typeof item[key as keyof TenderCandidate] === 'string')) return fail()
    if (!item.title.trim() || item.title.length > 160 || !item.number.trim() || !item.round.trim() || !item.agency.trim() || item.agency.length > 200 || !safeWebUrl(item.source_url) || item.source_url.length > 2000) return fail()
    if (item.source_url) { const url = new URL(item.source_url); if (!(url.hostname === 'g2b.go.kr' || url.hostname.endsWith('.g2b.go.kr'))) return fail() }
    if (item.amount !== null && (!Number.isSafeInteger(item.amount) || item.amount < 0)) return fail()
    if (item.deadline && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(item.deadline) || !Number.isFinite(Date.parse(item.deadline)))) return fail()
    if (!Array.isArray(item.warnings) || item.warnings.length > 10 || item.warnings.some(x => typeof x !== 'string' || x.length > 300)) return fail()
  }
  const expected = Math.min(30, Math.max(r.total - (r.page - 1) * 30, 0))
  if (r.items.length + r.omitted !== expected || r.hasMore !== (r.page < 20 && r.page * 30 < r.total) || r.limited !== (r.page === 20 && r.page * 30 < r.total)) return fail()
  return r
}
/** Prefill only. Saving remains the existing editor's explicit operation. */
export function tenderCandidateDraft(candidate: TenderCandidate, owner: string, category: TenderSearchQuery['category']): GrowthDraft {
  const draft = newGrowth('tender', owner)
  draft.title = candidate.title
  if (category === 'construction') draft.document.division = 'AR'
  Object.assign(draft.document, {
    number: candidate.number, round: candidate.round, agency: candidate.agency, deadline: candidate.deadline,
    amount: candidate.amount, source_url: candidate.source_url,
    note: [`나라장터 ${category === 'service' ? '용역' : '공사'} 조회 후보`, candidate.notice_date ? `공고 게시: ${candidate.notice_date}` : '', '금액은 추정가격입니다. 원문·마감·참가 조건을 확인한 뒤 저장해 주세요.', ...candidate.warnings].filter(Boolean).join('\n'),
  })
  return draft
}
