import type { GrowthDocument } from './growth'

export const SALES_STAGES = ['발굴', '접촉', '미팅', '제안', '협상', '수주', '실주', '보류'] as const
export type SalesStage = typeof SALES_STAGES[number]
export const SALES_SOURCES = ['직접 발굴', '홈페이지', '소개', 'SNS', '광고', '나라장터', '기타'] as const
export const SALES_COMPANIES = { TW: '더위클리', AR: '아트리어' } as const
export interface SalesDraft {
  title: string
  division: keyof typeof SALES_COMPANIES
  client_id: string | null
  contact_id: string | null
  owner_id: string
  stage: SalesStage
  source: typeof SALES_SOURCES[number]
  source_url: string
  expected_amount: number | null
  next_action: string
  next_date: string | null
  description: string
  result_note: string
  project_id: string | null
}
export interface SalesOpportunity extends SalesDraft {
  id: string
  revision: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}
export type SalesSummary = Omit<SalesOpportunity, 'description' | 'result_note' | 'source_url'>
export interface SalesActivity {
  id: string
  opportunity_id: string
  kind: '메모' | '전화' | '메일' | '미팅' | '상태 변경' | '등록'
  body: string
  created_by: string
  created_at: string
}
export interface SalesFilter {
  page: number
  search?: string
  source?: typeof SALES_SOURCES[number] | ''
  stage?: SalesStage | ''
  division?: keyof typeof SALES_COMPANIES | ''
  dueBefore?: string
  ownerId?: string
  work?: 'unscheduled' | 'handoff' | ''
}
export const SALES_PAGE_SIZE = 30
export function newSalesDraft(ownerId: string): SalesDraft {
  return { title: '', division: 'TW', client_id: null, contact_id: null, owner_id: ownerId, stage: '발굴', source: '직접 발굴', source_url: '', expected_amount: null, next_action: '', next_date: null, description: '', result_note: '', project_id: null }
}
export function validateSales(d: SalesDraft): string | null {
  if (!d.title.trim() || d.title.length > 160) return '영업 건 이름을 160자 이내로 적어 주세요.'
  if (!['TW', 'AR'].includes(d.division) || !SALES_STAGES.includes(d.stage) || !SALES_SOURCES.includes(d.source)) return '회사·진행 단계·유입 경로를 확인해 주세요.'
  if (!d.owner_id) return '담당자를 선택해 주세요.'
  if (d.expected_amount !== null && (!Number.isSafeInteger(d.expected_amount) || d.expected_amount < 0)) return '예상 금액은 0 이상의 정수로 입력해 주세요.'
  if (d.contact_id && !d.client_id) return '연락처를 연결할 거래처를 선택해 주세요.'
  if (d.next_date && (!/^\d{4}-\d{2}-\d{2}$/.test(d.next_date) || !Number.isFinite(Date.parse(d.next_date)) || new Date(d.next_date).toISOString().slice(0, 10) !== d.next_date)) return '다음 연락일을 확인해 주세요.'
  if (d.next_date && !d.next_action.trim()) return '다음 연락일에 할 일을 적어 주세요.'
  if (['수주', '실주', '보류'].includes(d.stage) && !d.result_note.trim()) return '수주·실주·보류 사유를 적어 주세요.'
  if (d.project_id && d.stage !== '수주') return '프로젝트 연결은 수주 단계에서 가능합니다.'
  if (d.source_url) {
    try { const u = new URL(d.source_url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '출처는 http 또는 https 주소로 입력해 주세요.' } catch { return '출처 주소를 확인해 주세요.' }
  }
  if (d.source_url.length > 2000 || d.next_action.length > 500 || d.description.length > 10000 || d.result_note.length > 2000) return '입력 내용이 너무 깁니다.'
  return null
}
export function salesSummary(row: SalesOpportunity): SalesSummary {
  const { description: _description, result_note: _result, source_url: _source, ...summary } = row
  return summary
}
export function canEditSales(row: Pick<SalesOpportunity, 'owner_id'>, user: { id: string; role: string; active: boolean }): boolean {
  return user.active && (user.role === 'admin' || row.owner_id === user.id)
}
export function needsFollowup(row: Pick<SalesSummary, 'stage' | 'next_date'>, today: string): boolean {
  return !['수주', '실주', '보류'].includes(row.stage) && !!row.next_date && row.next_date <= today
}
export interface SalesOrigin {
  id: string; kind: 'contact' | 'tender'; title: string; status: string; document: GrowthDocument; updated_at: string
}
export interface SalesApi {
  listSalesOrigins(id: string): Promise<SalesOrigin[]>

  listSales(filter: SalesFilter): Promise<{ items: SalesSummary[]; hasMore: boolean }>
  getSales(id: string): Promise<SalesOpportunity>
  saveSales(id: string, draft: SalesDraft, expectedRevision: number): Promise<SalesOpportunity>
  listSalesActivities(id: string): Promise<SalesActivity[]>
  addSalesActivity(id: string, opportunityId: string, kind: '메모' | '전화' | '메일' | '미팅', body: string): Promise<void>
}
