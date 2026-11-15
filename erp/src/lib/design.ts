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
}
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
}
export type PlacementDraft = Pick<Placement, 'project_id' | 'model_version' | 'trade_code' | 'item' | 'spec' | 'unit' | 'qty' | 'location'>

export interface EstimateTotals { direct: string; overhead: string; profit: string; subtotal: string; adjustment: string; supply: string; vat: string; total: string }
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

export interface DesignOverview { projects: number; prices: number; vendors: number; candidates: number; materials: number; knowledge: number; pending: number }

export interface DesignApi {
  getDesignOverview(): Promise<DesignOverview>
  getDesignBase(): Promise<DesignBase>
  listDesignProjects(): Promise<DesignProject[]>
  /** 아직 설계를 시작하지 않은 아트리어(AR) 프로젝트 */
  listDesignCandidates(): Promise<DesignCandidate[]>
  startDesign(projectId: string, spaceType: SpaceType, areaM2: number | null): Promise<void>
  updateDesignProject(projectId: string, patch: { space_type?: SpaceType; area_m2?: number | null; budget?: number | null; work_start?: string | null }): Promise<void>
  listPlacements(projectId: string, modelVersion: number): Promise<Placement[]>
  addPlacement(row: PlacementDraft): Promise<void>
  updatePlacementQty(id: string, qty: number): Promise<void>
  deletePlacement(id: string): Promise<void>
  listEstimates(projectId: string): Promise<Estimate[]>
  listEstimateLines(estimateId: string): Promise<EstimateLine[]>
  /** 견적 계산 · 발주서 만들기 요청 (작업 처리기가 계산) */
  requestDesignJob(projectId: string, kind: 'estimate.build' | 'po.build'): Promise<void>
  listDesignJobs(projectId: string): Promise<DesignJob[]>
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
