// DB 스키마(supabase/migrations)와 1:1로 맞춘 타입

export type Role = 'admin' | 'member'

export const TODAY_STATUSES = ['출근', '외근', '미팅', '재택', '휴가', '퇴근'] as const
export type TodayStatus = (typeof TODAY_STATUSES)[number]

export interface Profile {
  id: string
  email: string | null
  name: string
  role: Role
  active: boolean
  title: string | null
  today_status: TodayStatus
  status_message: string | null
  status_updated_at: string | null
  /** AI 팀원(에이전트) 계정 */
  is_agent: boolean
  created_at: string
}

export const CLIENT_CATEGORIES = ['클라이언트', '협력사', '기타'] as const
export type ClientCategory = (typeof CLIENT_CATEGORIES)[number]

export interface Client {
  id: string
  name: string
  category: ClientCategory
  business_no: string | null
  phone: string | null
  email: string | null
  address: string | null
  website: string | null
  memo: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  client_id: string
  name: string
  title: string | null
  phone: string | null
  email: string | null
  memo: string | null
  is_primary: boolean
  created_at: string
}

export const PROJECT_CATEGORIES = ['팝업', '캠페인', '콘텐츠', '기타'] as const
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]
export const PROJECT_STATUSES = ['기획', '진행', '완료', '보류'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  id: string
  name: string
  client_id: string | null
  category: ProjectCategory
  status: ProjectStatus
  owner_id: string | null
  start_date: string | null
  end_date: string | null
  location: string | null
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const TASK_STATUSES = ['할 일', '진행 중', '완료'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task {
  id: string
  project_id: string | null
  title: string
  assignee_id: string | null
  due_date: string | null
  status: TaskStatus
  memo: string | null
  completed_at: string | null
  /** 알람 시각 */
  remind_at: string | null
  reminded_at: string | null
  /** 자료실 리서치에서 만든 할 일 */
  source_research_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const LOG_KINDS = ['업무', '메일 발신', '메일 수신', '미팅', '전화', '메신저', '기타'] as const
export type LogKind = (typeof LOG_KINDS)[number]

export interface WorkLog {
  id: string
  user_id: string | null
  log_date: string
  kind: LogKind
  content: string
  email_counterpart: string | null
  email_subject: string | null
  client_id: string | null
  project_id: string | null
  minutes: number | null
  created_at: string
  updated_at: string
}

export interface ChatRoom {
  id: string
  name: string
  description: string | null
  project_id: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
}

export interface ChatRoomSummary extends ChatRoom {
  last_content: string | null
  last_at: string | null
  last_user_id: string | null
  unread: number
}

export interface ChatMessage {
  id: number
  room_id: string
  user_id: string | null
  content: string
  created_at: string
  edited_at: string | null
}

export const APPROVAL_KINDS = ['업무 보고', '일일 보고', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타'] as const
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]
export const APPROVAL_STATUSES = ['대기', '승인', '반려', '취소'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export interface MailPayload {
  to?: string
  subject?: string
  body?: string
}

export interface ReportPayload {
  date?: string
  user_id?: string
}

export interface Approval {
  id: string
  kind: ApprovalKind
  title: string
  content: string | null
  payload: MailPayload & ReportPayload & Record<string, unknown>
  target_id: string | null
  amount: number | null
  requested_by: string | null
  approver_id: string | null
  status: ApprovalStatus
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  created_at: string
  updated_at: string
  can_decide?: boolean
}

export interface ApprovalRoute {
  kind: ApprovalKind
  approver_id: string | null
  updated_at: string
}

// ---------- 재무 (관리자 전용) ----------
export interface ProjectFinance {
  project_id: string
  /** 계약 금액 (공급가액, VAT 별도) */
  contract_amount: number | null
  /** 예상 비용(예산) */
  budget_cost: number | null
  /** 목표 마진율 % */
  target_margin: number | null
  memo: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export const PAYMENT_DIRECTIONS = ['수금', '지급'] as const
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number]
/** 예정(요청) → 대기 → 완료 / 보류 / 취소. 청구는 수금(계산서 발행 후 입금 대기)용 */
export const PAYMENT_STATUSES = ['예정', '청구', '대기', '완료', '보류', '취소'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
/** 미지급·미수로 보는 상태 */
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ['예정', '청구', '대기', '보류']
/** 계약형태(증빙) */
export const CONTRACT_TYPES = ['세금계산서', '계산서', '카드', '현금영수증', '사업소득(3.3%)', '일용근로', '4대보험 근로', '기타'] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]
/** 노무비 대장에 들어가는 계약형태 */
export const LABOR_TYPES: ContractType[] = ['사업소득(3.3%)', '일용근로', '4대보험 근로']
export const TAX_INVOICE_STATES = ['발행', '미발행', '해당 없음'] as const
export type TaxInvoiceState = (typeof TAX_INVOICE_STATES)[number]
export const PAYMENT_STAGES = ['계약금', '선금', '중도금', '잔금', '추가', '환불'] as const

/** 결제 대장 한 줄 (엑셀 결제 대장과 같은 항목) */
export interface Payment {
  id: string
  direction: PaymentDirection
  project_id: string | null
  client_id: string | null
  budget_line_id: string | null
  /** 지출 승인에서 만들어진 결제 */
  approval_id: string | null
  /** 공사 구분 (목공·전기·운영비·노무비 …) */
  category: string | null
  /** 항목 (세부내용) */
  title: string
  /** 업체명 또는 성명 */
  payee: string | null
  contract_type: ContractType | null
  /** 계약금·선금·중도금·잔금 … */
  stage: string | null
  /** 실제 금액 (VAT 포함), 환불·차감은 음수 */
  amount: number
  /** amount 중 부가세 (공급가액 = amount - vat) */
  vat: number
  tax_invoice: TaxInvoiceState
  tax_invoice_date: string | null
  status: PaymentStatus
  /** 예상 비용 (아직 실제 결제가 아님) */
  is_estimate: boolean
  /** 결제요청일 */
  requested_date: string | null
  /** 지급예정일 (지급은 비워 두면 차주 월요일) */
  due_date: string | null
  paid_date: string | null
  /** 대지급자 (현장소장 등이 먼저 결제한 경우, 상태는 그 사람에게 정산했는지) */
  advance_by: string | null
  bank_name: string | null
  account_no: string | null
  account_holder: string | null
  memo: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** 공사 구분별 실행 예산 (공급가액) */
export interface BudgetLine {
  id: string
  project_id: string
  category: string
  item: string | null
  payee: string | null
  budget_amount: number
  /** 업체 계약금 */
  contract_amount: number | null
  sort_order: number
  memo: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AdminOverview {
  db_size_bytes: number
  active_members: number
  tables: Record<string, number>
  generated_at: string
}

// ---------- 자료실 ----------
export const RESEARCH_KINDS = ['팝업', '브랜드', '트렌드', '경쟁사', '인터뷰', '기타'] as const
export type ResearchKind = (typeof RESEARCH_KINDS)[number]
export const RESEARCH_STATUSES = ['새 자료', '검토 완료', '활용', '보관'] as const
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number]

export interface ResearchItem {
  id: string
  kind: ResearchKind
  title: string
  summary: string | null
  body: string | null
  source_url: string | null
  source_name: string | null
  brand_name: string | null
  tags: string[]
  status: ResearchStatus
  client_id: string | null
  project_id: string | null
  collected_by_agent: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const CONTACT_SOURCES = ['공식 홈페이지', '보도자료', '명함·미팅', '받은 메일', '소개', '에이전트 리서치', '기타'] as const
export type ContactSource = (typeof CONTACT_SOURCES)[number]
export const LEAD_STATUSES = ['신규', '연락함', '회신', '미팅', '거래 전환', '보류'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export interface BrandContact {
  id: string
  brand_name: string
  contact_name: string | null
  title: string | null
  email: string
  phone: string | null
  source_type: ContactSource
  source_url: string | null
  source_note: string | null
  status: LeadStatus
  opt_out: boolean
  opt_out_at: string | null
  client_id: string | null
  research_item_id: string | null
  last_contacted_at: string | null
  memo: string | null
  tags: string[]
  collected_by_agent: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  /** 광고성 메일: 제목 (광고) 표기 + 수신거부 안내 */
  is_ad: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ---------- 에이전트·알림 ----------
export const AGENT_SCOPES = ['research', 'contact', 'task', 'daily_report', 'notify', 'read'] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]

export interface AgentToken {
  id: string
  name: string
  profile_id: string | null
  scopes: AgentScope[]
  token_hint: string | null
  created_by: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export const NOTIFICATION_KINDS = ['할 일', '알람', '승인', '일일 보고', '멘션', '시스템', '결제'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface AppNotification {
  id: number
  user_id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  created_at: string
  read_at: string | null
}

// 저장용 입력 타입: id 가 있으면 수정, 없으면 생성
export type Draft<T> = Partial<T>
