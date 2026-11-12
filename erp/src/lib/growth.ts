export type GrowthKind = 'tender' | 'content' | 'contact'
export const GROWTH_LABELS = { tender: '나라장터', content: '콘텐츠·배포', contact: '연락처 검토함' }
export const CHANNELS = ['네이버 블로그', '인스타그램', '유튜브'] as const
export type Channel = typeof CHANNELS[number]
export interface ChannelDraft { channel: Channel; title: string; body: string; tags: string; status: '초안' | '검수' | '승인' | '발행'; rights: boolean; publication_url: string; external_id: string }
export interface GrowthDocument {
  division: 'TW' | 'AR'; source_url: string; note: string
  number?: string; round?: string; agency?: string; deadline?: string; amount?: number | null; qualification?: string; evidence?: string
  original?: string; versions?: ChannelDraft[]
  name?: string; brand?: string; email?: string; instagram?: string; segment?: string; source?: string
}
export interface GrowthDraft { kind: GrowthKind; title: string; owner_id: string; status: string; document: GrowthDocument; campaign_id: string | null }
export interface GrowthItem extends GrowthDraft { id: string; revision: number; linked_sales_id: string | null; created_at: string; updated_at: string; created_by: string | null }
export type GrowthSummary = Omit<GrowthItem, 'document'>
export interface GrowthFilter { kind: GrowthKind; page: number; search: string; status: string }
export const GROWTH_STATUSES = { tender: ['검토', '준비', '제출', '종료', '취소'], content: ['작성 중', '검수 중', '발행 기록'], contact: ['검토', '확인', '제외'] }
export function newGrowth(kind: GrowthKind, owner_id: string): GrowthDraft {
  const document: GrowthDocument = { division: 'TW', source_url: '', note: '' }
  if (kind === 'tender') Object.assign(document, { number: '', round: '00', agency: '', deadline: '', amount: null, qualification: '추가 확인', evidence: '' })
  if (kind === 'content') Object.assign(document, { original: '', versions: CHANNELS.map(channel => ({ channel, title: '', body: '', tags: '', status: '초안', rights: false, publication_url: '', external_id: '' })) })
  if (kind === 'contact') Object.assign(document, { name: '', brand: '', email: '', instagram: '', segment: '미분류', source: '직접 등록' })
  return { kind, title: '', owner_id, status: GROWTH_STATUSES[kind][0], document, campaign_id: null }
}
export function safeWebUrl(value: string): boolean {
  if (!value) return true
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !/\s/.test(value) } catch { return false }
}
export function koreaDateTimeInput(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 16) : ''
}
export function validateGrowth(d: GrowthDraft): string | null {
  if (!d.title.trim() || d.title.length > 160 || !d.owner_id) return '제목과 담당자를 확인해 주세요.'
  if (!GROWTH_STATUSES[d.kind]?.includes(d.status) || !['TW', 'AR'].includes(d.document.division)) return '종류·상태·회사를 확인해 주세요.'
  const x = d.document
  if (!safeWebUrl(x.source_url) || x.source_url.length > 2000 || x.note.length > 10000) return '출처 주소 또는 메모 길이를 확인해 주세요.'
  if (d.kind === 'tender') {
    if (!x.number?.trim() || !x.agency?.trim() || !x.round?.trim()) return '공고번호·차수·발주처를 입력해 주세요.'
    if (x.deadline && (!/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(x.deadline) || !Number.isFinite(Date.parse(x.deadline)))) return '마감 시각과 시간대를 확인해 주세요.'
    if (x.amount != null && (!Number.isSafeInteger(x.amount) || x.amount < 0)) return '금액은 0 이상의 정수로 입력해 주세요.'
    if (x.qualification !== '추가 확인' && !x.evidence?.trim()) return '참가 조건 판단의 근거를 적어 주세요.'
  }
  if (d.kind === 'contact') {
    if (!x.email && !x.instagram) return '이메일 또는 인스타 계정을 입력해 주세요.'
    if (x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)) return '이메일 형식을 확인해 주세요.'
    if (x.instagram && !/^@?[a-zA-Z0-9_.]{1,30}$/.test(x.instagram)) return '인스타 계정명만 입력해 주세요.'
  }
  if (d.kind === 'content') {
    if (!x.original?.trim() || x.original.length > 20000) return '원본 내용을 20,000자 이내로 입력해 주세요.'
    if (!x.versions || x.versions.length !== 3 || new Set(x.versions.map(v => v.channel)).size !== 3) return '채널 버전을 확인해 주세요.'
    for (const v of x.versions) {
      if (!CHANNELS.includes(v.channel) || v.title.length > 300 || v.body.length > 10000 || v.tags.length > 500 || !safeWebUrl(v.publication_url)) return '채널 본문·태그·발행 주소를 확인해 주세요.'
      if (['승인', '발행'].includes(v.status) && (!v.title.trim() || !v.body.trim() || !v.rights)) return '제목·본문·사용 권리를 확인한 뒤 승인해 주세요.'
      if (v.status === '발행' && !v.publication_url) return '실제 발행 주소를 입력해 주세요.'
    }
  }
  return null
}
export function changeChannel(v: ChannelDraft, patch: Partial<ChannelDraft>): ChannelDraft {
  const changed = (['title', 'body', 'tags', 'rights'] as const).some(k => k in patch && v[k] !== patch[k])
  return { ...v, ...patch, ...(changed ? { status: '초안' as const, publication_url: '', external_id: '' } : {}) }
}
export function contactCandidates(text: string, source: '받은 메일' | '인스타그램', owner: string): GrowthDraft[] {
  if (text.length > 100000) throw new Error('한 번에 100,000자 이하로 가져와 주세요.')
  const values = [...new Set(source === '받은 메일' ? (text.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).map(x => x.toLowerCase()) : [...text.matchAll(/(?:instagram\.com\/|@)([a-zA-Z0-9_.]{1,30})/g)].map(x => x[1].toLowerCase()).filter(x => !['p','reel','reels','stories','explore','accounts'].includes(x)))].slice(0,50)
  return values.map(value => { const d = newGrowth('contact', owner); d.title = value; d.document.source = source; if (source === '받은 메일') d.document.email = value; else { d.document.instagram = value; d.document.source_url = `https://www.instagram.com/${value}/` }; return d })
}
export interface AiModel { key: string; label: string; model_id: string; input_rate: number; output_rate: number; enabled: boolean }
export interface AiBudget { id: string; starts_at: string; ends_at: string; limit_usd: number; enabled: boolean }
export interface AiUsage { id: string; task: string; status: string; reserved_usd: number; actual_usd: number | null; created_at: string }
/** Keep microcharges visible; unknown amounts must never appear to be free. */
export function formatAiCost(value: unknown): string {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return '확인 필요'
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return '확인 필요'
  if (amount > 0 && amount < 0.000001) return '<$0.000001'
  return `$${amount.toFixed(6)}`
}
export interface AiState { models: AiModel[]; budgets: AiBudget[]; usage: AiUsage[] }
export interface GrowthApi {
  listGrowth(f: GrowthFilter): Promise<{ items: GrowthSummary[]; hasMore: boolean }>
  getGrowth(id: string): Promise<GrowthItem>
  saveGrowth(id: string, draft: GrowthDraft, revision: number): Promise<GrowthItem>
  linkGrowthSales(id: string, revision: number): Promise<string>
  backfillMailLeads(): Promise<number>
  getAiState(): Promise<AiState>
  reconcileAi(id: string, actual: number, note: string): Promise<void>
  configureAi(budget: AiBudget, models: AiModel[]): Promise<void>
  runGrowthAi(request: { id: string; task: 'classify' | 'write' | 'compare'; model: string; prompt: string }): Promise<{ text: string; cost: number; status: string }>
}
