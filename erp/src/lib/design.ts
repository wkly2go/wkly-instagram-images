import type { PlanGeometry, PlanLine } from './designPlan'
// 설계·견적 (인테리어 디자인 자동화) — 인트라넷 DB 의 design 구역을 public.design_* 보기로 읽고 쓴다 (0125~0127)
// 금액 계산은 작업 처리기(맥)의 견적 엔진만 한다. 화면은 수량 · 단가를 입력하고 결과를 보여 주기만 한다.

export type SpaceType = 'popup' | 'retail' | 'flagship' | 'booth' | 'office'
export const SPACE_LABELS: Record<SpaceType, string> = { popup: '팝업', retail: '매장', flagship: '플래그십', booth: '부스', office: '오피스' }

export type DesignStage = 'survey' | 'plan' | 'draft3d' | 'proposal' | 'meeting' | 'model' | 'estimate' | 'drawings' | 'purchase' | 'sitelog' | 'done'
export const STAGE_LABELS: Record<DesignStage, string> = {
  survey: '실측', plan: '평면', draft3d: '3D 초안', proposal: '제안서', meeting: '회의', model: '모델 완성',
  estimate: '견적', drawings: '도면 · 스펙북', purchase: '발주', sitelog: '현장', done: '납품',
}
export type Variant = 'economy' | 'standard' | 'premium'
export const VARIANT_LABELS: Record<Variant, string> = { economy: '절감안', standard: '기본안', premium: '고급안' }

export interface DesignProject {
  id: string
  code: string | null
  name: string
  address: string | null
  client_name: string | null
  space_type: SpaceType
  area_m2: number | null
  budget: number | null
  start_date: string | null
  end_date: string | null
  stage: DesignStage
  model_version: number
  status: string
  drive_url: string | null
  estimate_rules: EstimateRules
}
/** 프로젝트별 견적 규칙 (0128). 비우면 회사 공통 규칙 */
export interface EstimateRules {
  /** overhead_profit: 공과잡비 + 기업이윤 (공사형) · agency_fee: 대행 수수료 한 줄 (행사 · 렌탈형) */
  fee_mode?: 'overhead_profit' | 'agency_fee'
  agency_fee_rate?: string
  overhead_rate?: string
  profit_rate?: string
  /** 공급가액 절삭 단위 (원) */
  total_rounding_unit?: string
  /** '보통 필요한 공종' 경고 끄기 (목공 없는 렌탈형 등) */
  skip_required_trades?: boolean
  /** 제출용 견적서에 찍는 글 (제목 · 장소 · 일정 · 범위 · 참고 사항 · 대금지불조건) */
  doc?: EstimateDoc
}
export interface EstimateDoc { title?: string; place?: string; schedule?: string; scope?: string; notes?: string[]; payment?: string[] }

/** 산출물 파일 기록 (맥에서 만들고 프로젝트 드라이브 폴더에 사본) */
export interface DesignDocument { id: string; kind: string; version: number; file_path: string; drive_path: string | null; created_at: string }
export const DOC_LABELS: Record<string, string> = { estimate_deck: '제출용 견적서 (16:9 PDF)', estimate_pdf: '내역 견적서 (PDF)', estimate_xlsx: '견적서 (엑셀)', po_pdf: '발주서 (PDF)' }
export interface DesignCandidate { id: string; code: string | null; name: string; status: string }
export interface DesignTrade { code: string; name: string; group_name: string; sort: number }
export interface DesignBase { trades: DesignTrade[]; units: string[] }

export interface Placement {
  id: string
  project_id: string
  model_version: number
  trade_code: string
  item: string
  spec: string
  unit: string
  qty: number
  location: string | null
  source: 'model' | 'manual'
  sort: number
  /** 견적 구분 (예: 렌탈 · 설치·철거). 제출용 견적서에서 A·B·C 로 묶인다 */
  section: string | null
  note: string | null
}
export type PlacementDraft = Pick<Placement, 'project_id' | 'model_version' | 'trade_code' | 'item' | 'spec' | 'unit' | 'qty' | 'location' | 'section' | 'note'>

export interface EstimateTotals { fee?: string; fee_mode?: 'overhead_profit' | 'agency_fee'; direct: string; overhead: string; profit: string; subtotal: string; adjustment: string; supply: string; vat: string; total: string }
export interface EstimateWarning { code: string; level: 'error' | 'warning' | 'warn' | 'info'; message: string; trade_code: string | null }
export interface Estimate {
  id: string
  project_id: string
  revision: number
  variant: Variant
  model_version: number | null
  totals: EstimateTotals
  warnings: EstimateWarning[]
  created_at: string
}
export interface EstimateLine {
  id: string
  estimate_id: string
  trade_code: string
  item: string
  spec: string
  unit: string
  qty: number
  unit_price: number | null
  amount: number | null
  source: 'model' | 'manual'
  sort: number
  section: string | null
  note: string | null
}

export interface ScheduleTask {
  id: string
  project_id: string
  trade_code: string | null
  name: string
  start_date: string
  end_date: string
  done: boolean
}
export type ScheduleDraft = Omit<ScheduleTask, 'id'>

export interface DesignJob {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface UnitPrice {
  id: string
  trade_code: string
  item: string
  spec: string
  unit: string
  variant: Variant
  sell_price: number
  effective_date: string
  source_doc: string | null
  approved: boolean
}
export interface UnitCost {
  id: string
  trade_code: string
  item: string
  spec: string
  unit: string
  cost_price: number
  vendor_id: string | null
  effective_date: string
  source_doc: string | null
  approved: boolean
}
export interface DesignVendor {
  id: string
  client_id: string | null
  name: string
  trades: string[]
  contact_name: string | null
  phone: string | null
  status: 'partner' | 'candidate'
  region: string | null
  source_url: string | null
  source_note: string | null
}
export interface DesignMaterial {
  id: string
  name: string
  category: string
  spec: string | null
  color_code: string | null
  unit: string | null
  supplier_id: string | null
  product_url: string | null
  notes: string | null
}
export interface Knowledge { id: string; kind: string; key: string; title: string; body: unknown; source: string | null; project_code: string | null }

export interface DesignCard {
  id: string
  project_id: string | null
  kind: string
  ref_id: string | null
  title: string
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  comment: string | null
}
export const CARD_LABELS: Record<string, string> = {
  estimate: '견적 확정', po_send: '발주 발송 준비', price_extract: '판매 단가 가져오기', cost_extract: '실행 단가 가져오기',
}

/** 실행 내역 한 줄 (관리자만) — 업체별 발주서와 손익의 바탕 */
export interface CostLine { id: string; project_id: string; zone: string | null; item: string; qty: number; cost_price: number | null; vendor_name: string | null; note: string | null; source_doc: string | null; sort: number }
export type CostLineDraft = Omit<CostLine, 'id' | 'sort' | 'source_doc'>
export interface PurchaseOrder { id: string; po_number: string; vendor_id: string; status: string; issue_date: string | null; due_date: string | null; total: number; payment_terms: string | null }
export interface PoLine { id: string; po_id: string; item: string; spec: string; unit: string; qty: number; cost_price: number | null; amount: number | null; received_qty: number }
export const PO_STATUS: Record<string, string> = { draft: '초안', sent: '발송', accepted: '수락', partially_received: '일부 입고', received: '입고 완료', settled: '정산', cancelled: '취소' }

export interface ProposalTemplateSection { key: string; title: string; required?: boolean; sources?: string[]; order?: number }
export interface ProposalFigure { label: string; value: string; unit?: string; source: string; as_of?: string }
export interface ProposalSection { id: string; project_id: string; section_key: string; body: string | null; figures: ProposalFigure[]; status: 'draft' | 'checked' | 'blank'; updated_at: string }

export type SpecBook = 'materials' | 'lighting' | 'hardware' | 'sanitary' | 'appliance'
export const SPEC_BOOKS: Record<SpecBook, string> = { materials: '마감재 (Materials)', lighting: '조명 (Lighting)', hardware: '하드웨어 (Hardware)', sanitary: '위생기구 (Sanitary Ware)', appliance: '가전 · 기타 (Appliance & etc)' }
export const SPEC_STATUS = { review: '검토', selected: '선정', confirmed: '확정', dropped: '제외' } as const
export interface SpecItem { id: string; project_id: string; book: SpecBook; code: string | null; name: string; spec: string | null; location: string | null; maker: string | null; material_id: string | null; qty: number | null; unit: string | null; product_url: string | null; note: string | null; status: keyof typeof SPEC_STATUS; sort: number; /** 표본 스펙북 카드 항목 */ finish?: string | null; size?: string | null; distributor?: string | null; contact?: string | null; delivery?: string | null; stock?: string | null }

export interface DesignOverview { projects: number; prices: number; vendors: number; candidates: number; materials: number; knowledge: number; pending: number }

export interface DesignApi {
  getDesignOverview(): Promise<DesignOverview>
  getDesignBase(): Promise<DesignBase>
  listDesignProjects(): Promise<DesignProject[]>
  /** 아직 설계를 시작하지 않은 아트리어(AR) 프로젝트 */
  listDesignCandidates(): Promise<DesignCandidate[]>
  startDesign(projectId: string, spaceType: SpaceType, areaM2: number | null): Promise<void>
  updateDesignProject(projectId: string, patch: { space_type?: SpaceType; area_m2?: number | null; budget?: number | null; work_start?: string | null; estimate_rules?: EstimateRules }): Promise<void>
  listPlacements(projectId: string, modelVersion: number): Promise<Placement[]>
  addPlacement(row: PlacementDraft): Promise<void>
  updatePlacementQty(id: string, qty: number): Promise<void>
  deletePlacement(id: string): Promise<void>
  listEstimates(projectId: string): Promise<Estimate[]>
  listEstimateLines(estimateId: string): Promise<EstimateLine[]>
  /** 견적 계산 · 발주서 만들기 요청 (작업 처리기가 계산) */
  requestDesignJob(projectId: string, kind: 'estimate.build' | 'po.build'): Promise<void>
  listDesignJobs(projectId: string): Promise<DesignJob[]>
  listDesignDocuments(projectId: string): Promise<DesignDocument[]>
  /** 보관된 산출물 파일 내려받기 (발주서는 관리자만) */
  downloadDesignFile(documentId: string): Promise<{ name: string; blob: Blob }>
  /** 작업 중인 평면(없으면 마지막으로 반영한 평면 · 그것도 없으면 null) */
  getDesignPlan(projectId: string): Promise<PlanGeometry | null>
  saveDesignPlan(projectId: string, plan: PlanGeometry): Promise<void>
  /** 평면의 수량을 수량표에 반영 (새 모델 버전) */
  applyDesignPlan(projectId: string, plan: PlanGeometry, lines: PlanLine[]): Promise<void>
  /** Template for the space type; falls back to any active template. */
  getProposalTemplate(spaceType: SpaceType): Promise<ProposalTemplateSection[]>
  listProposalSections(projectId: string): Promise<ProposalSection[]>
  saveProposalSection(projectId: string, key: string, patch: Pick<ProposalSection, 'body' | 'figures' | 'status'>): Promise<void>
  listSpecItems(projectId: string): Promise<SpecItem[]>
  addSpecItem(row: Omit<SpecItem, 'id' | 'sort'>): Promise<void>
  updateSpecItem(id: string, patch: Partial<Omit<SpecItem, 'id' | 'project_id'>>): Promise<void>
  /** 스펙 품목의 샘플 사진(작은 미리보기 data URL) — 품목 id 별 */
  listSpecImages(projectId: string): Promise<Record<string, string>>
  setSpecImage(projectId: string, itemId: string, data: string | null): Promise<void>
  deleteSpecItem(id: string): Promise<void>
  listCostLines(projectId: string): Promise<CostLine[]>
  /** 실행 내역을 통째로 바꾼다 (엑셀 다시 올리기) */
  replaceCostLines(projectId: string, rows: CostLineDraft[], sourceDoc: string): Promise<void>
  addCostLine(row: CostLineDraft): Promise<void>
  updateCostLine(id: string, patch: Partial<Pick<CostLine, 'qty' | 'cost_price' | 'vendor_name'>>): Promise<void>
  deleteCostLine(id: string): Promise<void>
  listPurchaseOrders(projectId: string): Promise<PurchaseOrder[]>
  listPoLines(poIds: string[]): Promise<PoLine[]>
  updatePlacement(id: string, patch: { section?: string | null; note?: string | null }): Promise<void>
  listScheduleTasks(projectId: string): Promise<ScheduleTask[]>
  addScheduleTask(row: ScheduleDraft): Promise<void>
  updateScheduleTask(id: string, patch: Partial<ScheduleDraft>): Promise<void>
  deleteScheduleTask(id: string): Promise<void>
  listUnitPrices(search: string, trade: string | null): Promise<UnitPrice[]>
  /** 관리자만 내용이 보인다 (팀원은 빈 목록) */
  listUnitCosts(search: string, trade: string | null): Promise<UnitCost[]>
  listDesignVendors(): Promise<DesignVendor[]>
  listDesignMaterials(search: string): Promise<DesignMaterial[]>
  listKnowledge(): Promise<Knowledge[]>
  listDesignCards(status: 'pending' | 'done', projectId?: string | null): Promise<DesignCard[]>
  decideDesignCard(id: string, approve: boolean, comment: string): Promise<void>
}
