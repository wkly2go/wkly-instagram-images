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
  /** 프로필 사진 (256px 정사각 data URL) */
  photo?: string | null
  /** AI 팀원(에이전트) 계정 */
  is_agent: boolean
  /** AI 팀원을 맡은 사람 관리자 (0032) */
  manager_id?: string | null
  created_at: string
}

/** 인사기록: 본인·관리자만 조회, 관리자만 수정 */
export interface HrRecord {
  profile_id: string
  joined_on: string | null
  phone: string | null
  birthday: string | null
  address: string | null
  emergency_contact: string | null
  note: string | null
  updated_at?: string
  updated_by?: string | null
}

export const LEAVE_KINDS = ['연차', '반차', '병가', '경조사', '기타'] as const
export type LeaveKind = (typeof LEAVE_KINDS)[number]
export type LeaveStatus = '신청' | '승인' | '반려'

/** 휴가: 본인 신청 → 관리자 승인. 연차 · 반차만 연차에서 차감 */
export interface LeaveRecord {
  id: string
  profile_id: string
  kind: LeaveKind
  start_date: string
  end_date: string
  days: number
  reason: string | null
  status: LeaveStatus
  decided_by: string | null
  decided_at: string | null
  created_by: string | null
  created_at: string
}

export type InstructionStatus = '대기' | '진행 중' | '완료' | '보류'

/** ERP 에서 AI 팀원에게 직접 지시 → 에이전트가 처리하고 답을 남김 */
export interface AgentInstruction {
  id: string
  agent_id: string
  instruction: string
  status: InstructionStatus
  response: string | null
  created_by: string | null
  created_at: string
  responded_at: string | null
}

/** AI 처리 기록 (채팅 · 지시로 AI 가 한 쓰기 작업 — 책임 추적) */
export interface AgentActionLog {
  id: number
  created_at: string
  agent_id: string | null
  lead_code: string | null
  team: string | null
  requester_id: string | null
  source: 'chat' | 'instruction'
  room_id: string | null
  tool: string
  input: Record<string, unknown> | null
  ok: boolean
  result: string | null
}

/** 근태: 하루 첫 접속(출근) · 마지막 접속 */
export interface Attendance {
  user_id: string
  /** YYYY-MM-DD (한국 시간) */
  day: string
  first_at: string
  last_at: string
}

/** 개인 메모 (본인만 봄 · 업무 일지에 안 들어감) */
export interface Note {
  id: string
  user_id: string
  content: string
  pinned: boolean
  created_at: string
  updated_at: string
}

/** 접속 기록: 하루 · 경로별 (PC 프로그램 / 브라우저 / 휴대폰) */
export interface AccessLog {
  user_id: string
  day: string
  source: 'desktop' | 'web' | 'mobile'
  first_at: string
  last_at: string
  /** 접속한 공인 IP (0027+) */
  ip?: string | null
}

/** 지금 내 접속 정보 · 회사 IP 설정 (회사 인터넷 + 등록된 회사 PC 에서만 출근) */
export interface AccessInfo {
  ip: string | null
  /** 지금 회사 인터넷인지 (회사 IP 미등록이면 true) */
  office: boolean
  /** 등록된 회사 IP 목록 (관리자만) */
  officeIps: string[] | null
  configured: boolean
}

/** 출근 인정 회사 PC (PC 프로그램 기기 ID) */
export interface AttendanceDevice {
  user_id: string
  device_id: string
  label: string | null
  created_at: string
  last_seen: string
}

/** 부서 · 주요 업무 (사람 · AI 구분 없이 member_ids, 예약 작업은 agent_groups) */
export interface Department {
  id: string
  name: string
  duties: string | null
  lead_id: string | null
  member_ids: string[]
  agent_groups: string[]
  sort: number
  updated_at: string
}
export const WORK_PLAN_KINDS = ['외근', '재택', '현장 직출'] as const
export type WorkPlanKind = (typeof WORK_PLAN_KINDS)[number]
export type DecideStatus = '대기' | '승인' | '반려'
/** 외근 · 재택 · 현장 직출 사전 신청 (전날 승인 → 그날 휴대폰 출근 자동 승인) */
export interface WorkPlan {
  id: string
  user_id: string
  day: string
  kind: WorkPlanKind
  place: string | null
  reason: string | null
  status: DecideStatus
  decided_by: string | null
  decided_at: string | null
  created_at: string
  /** 전날 마감 시각 이후 신청 */
  late?: boolean
  /** 현장 일정(업무)에서 자동으로 만든 신청 */
  task_id?: string | null
}
/** 근태 규칙 (관리자 설정) */
export interface AttendanceRules {
  workStart: string
  planDeadline: string
}
/** 월간 근태 요약 (사람별) */
export interface AttendanceMonthRow {
  user_id: string
  name: string
  work_days: number
  late_days: number
  mobile_days: number
  field_days: number
  pending: number
  leave_days: number
  absent_days: number
}
export const CHECKIN_KINDS = ['출근', '외근', '재택', '현장 직출'] as const
export type CheckinKind = (typeof CHECKIN_KINDS)[number]
/** 휴대폰 출근 체크 (위치는 본인 · 관리자만) */
export interface AttendanceCheckin {
  id: string
  user_id: string
  day: string
  at: string
  kind: CheckinKind
  plan_id: string | null
  status: DecideStatus
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  note: string | null
  decided_by: string | null
  decided_at: string | null
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
/** NIC = Not In Contract (계약 전) */
export const PROJECT_STATUSES = ['기획', '진행', 'NIC', '완료', '보류'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  id: string
  /** 연번: 구분 + 시작 연월 + '-' + 일련번호 (예: AR2610-01, 0046) · 관리 폴더 AR0000 */
  code?: string | null
  name: string
  client_id: string | null
  category: ProjectCategory
  status: ProjectStatus
  owner_id: string | null
  start_date: string | null
  end_date: string | null
  location: string | null
  description: string | null
  /** 구글 드라이브 프로젝트 폴더 주소 (0035) */
  drive_url?: string | null
  /** 구분 (0046): AR 아트리어 · TW 더위클리 · RS 내부 리서치 */
  division?: Division
  created_by: string | null
  created_at: string
  updated_at: string
}

/** 프로젝트에 첨부한 구글 드라이브 자료 (0045) — 파일을 복사하지 않고 드라이브 파일을 가리킴 */
export interface ProjectDriveFile {
  id: string
  project_id: string
  drive_id: string
  name: string
  mime_type: string | null
  url: string
  icon_url: string | null
  note: string | null
  added_by: string | null
  created_at: string
}

/** 프로젝트 드라이브 폴더: 저장된 주소 → 설명 속 드라이브 주소 → 연번 · 이름으로 드라이브 검색 */
export function projectDriveUrl(p: Pick<Project, 'drive_url' | 'description' | 'code' | 'name'>): { url: string; exact: boolean } {
  if (p.drive_url) return { url: p.drive_url, exact: true }
  const m = p.description?.match(/https:\/\/drive\.google\.com\/[^\s)]+/)
  if (m) return { url: m[0], exact: true }
  // 드라이브 폴더 이름은 연번 앞부분(AR2610)을 씀
  return { url: `https://drive.google.com/drive/search?q=${encodeURIComponent(p.code ? `${p.code.split('-')[0]} ${p.name}` : p.name)}`, exact: false }
}

/**
 * 프로젝트 구분 · 대표 색상 (대표 지시 2026-10-21): AR 아트리어(그린) · TW 더위클리(블루) · RS 내부 리서치(핑크)
 * 연번 = 구분 + 시작 연월 + '-' + 그달 일련번호 (예: AR2610-01) — 프로젝트마다 다름 (0046)
 */
export type Division = 'AR' | 'TW' | 'RS'
export const DIVISIONS: Record<Division, { label: string; full: string; color: string }> = {
  AR: { label: '아트리어', full: '아트리어 프로젝트', color: 'var(--green)' },
  TW: { label: '더위클리', full: '더위클리 프로젝트', color: 'var(--blue)' },
  RS: { label: '내부 리서치', full: '내부 리서치 프로젝트', color: 'var(--pink)' },
}
export const DIVISION_KEYS = Object.keys(DIVISIONS) as Division[]
/** 구분 (division 이 없으면 연번 앞자리로) */
export const projectBrand = (p: Pick<Project, 'code' | 'division'>): Division => p.division ?? (p.code?.startsWith('TW') ? 'TW' : p.code?.startsWith('RS') ? 'RS' : 'AR')

export const TASK_STATUSES = ['할 일', '진행 중', '완료'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task {
  id: string
  project_id: string | null
  title: string
  assignee_id: string | null
  due_date: string | null
  /** 일정표(간트)용 시작일 · 단계 (예: 디자인 기획) */
  start_date?: string | null
  phase?: string | null
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
  /** 상대방 (거래처 담당자). 메일 상대 주소가 등록된 담당자면 자동 연결 (0028+) */
  contact_id?: string | null
  minutes: number | null
  created_at: string
  updated_at: string
}

/** 프로젝트에 참여하는 거래처 담당자 */
export interface ProjectContact {
  project_id: string
  contact_id: string
  role: string | null
  created_at: string
}

/** 프로젝트에 참여하는 우리 팀원 (대표 지시 2026-10-21 "담당자 추가는 우리 팀원 중에서만") */
export interface ProjectMember {
  project_id: string
  profile_id: string
  role: string | null
  created_at: string
}

/** 거래처 · 담당자 · 프로젝트와 주고받은 자료 (파일 또는 링크) */
export interface ExchangeFile {
  id: string
  client_id: string | null
  contact_id: string | null
  project_id: string | null
  direction: '받음' | '보냄'
  name: string
  url: string | null
  storage_path: string | null
  size: number | null
  mime: string | null
  note: string | null
  file_date: string
  source: '직접' | '메일' | '채팅' | 'AI'
  work_log_id: string | null
  created_by: string | null
  created_at: string
}

export interface ChatRoom {
  id: string
  name: string
  description: string | null
  project_id: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  /** 비어 있으면 전체 공개 방, 값이 있으면 이 사람들만 보는 1:1 대화 */
  members?: string[] | null
}

export interface ChatRoomSummary extends ChatRoom {
  last_content: string | null
  last_at: string | null
  last_user_id: string | null
  unread: number
}

/** 채팅 첨부 파일 (파일은 비공개 저장소, 방 사람만 열 수 있음) */
export interface ChatAttachment {
  path: string
  name: string
  size: number
  type: string
  /** 체험 모드: 브라우저에 담아 둔 파일 */
  url?: string
}

export interface ChatMessage {
  id: number
  room_id: string
  user_id: string | null
  content: string
  created_at: string
  edited_at: string | null
  attachment?: ChatAttachment | null
}

/** 채팅방별 마지막 읽은 시각 (읽음 표시용) */
export interface ChatRead {
  user_id: string
  room_id: string
  last_read_at: string
}

export const APPROVAL_KINDS = ['업무 보고', '일일 보고', '회의록', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타'] as const
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

/** 구독 서비스 · 프로그램 (구독료 관리) */
export const SUB_CATEGORIES = ['디자인', '협업 · 문서', 'AI', '개발 · 서버', '마케팅 · SNS', '회계 · 세무', '통신', '기타'] as const
export type SubCategory = (typeof SUB_CATEGORIES)[number]
export const SUB_CYCLES = ['월', '년', '1회'] as const
export type SubCycle = (typeof SUB_CYCLES)[number]
export const SUB_STATUSES = ['사용 중', '해지 예정', '해지'] as const
export type SubStatus = (typeof SUB_STATUSES)[number]
export interface Subscription {
  id: string
  name: string
  category: SubCategory
  plan: string | null
  amount: number
  currency: 'KRW' | 'USD'
  cycle: SubCycle
  next_billing: string | null
  pay_method: string | null
  account_email: string | null
  owner_id: string | null
  seats: number | null
  url: string | null
  status: SubStatus
  memo: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

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
export const RESEARCH_KINDS = ['거래처 리포트', '팝업', '브랜드', '트렌드', '경쟁사', '인터뷰', '기타'] as const
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
  /** 보고받는 담당자 (거래처 리포트) */
  shared_to?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** 리서치 보고서 공통 양식: {{거래처}} {{구분}} {{작성일}} {{작성자}} 를 채워 씀 */
export interface ReportTemplate {
  id: string
  name: string
  body: string
  is_default: boolean
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
export const AGENT_SCOPES = ['read', 'task', 'daily_report', 'notify', 'research', 'contact', 'finance'] as const
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

// ---------- Claude AI 에이전트 · 광고 ----------
export const AGENT_VERDICTS = ['완료', '변동 없음', '일부 실패', '실패', '미실행', '진행 중'] as const
export type AgentVerdict = (typeof AGENT_VERDICTS)[number]
export interface AgentJob {
  trigger_id: string
  name: string
  group_name: string
  cron: string | null
  schedule_label: string | null
  enabled: boolean
  model: string | null
  last_status: string | null
  last_fired_at: string | null
  last_finished_at: string | null
  next_run_at: string | null
  last_verdict: string | null
  last_summary: string | null
  session_url: string | null
  removed: boolean
  synced_at: string
}
export interface AgentReport {
  id: string
  trigger_id: string | null
  job_name: string
  report_date: string
  run_at: string | null
  verdict: AgentVerdict
  title: string
  summary: string | null
  body: string | null
  link: string | null
  created_at: string
}
export const AGENT_ACTIONS = ['지금 실행', '일시정지', '재개', '시간 변경', '지시 수정'] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]
export interface AgentJobRequest {
  id: string
  trigger_id: string
  action: AgentAction
  detail: string | null
  status: '대기' | '처리 중' | '완료' | '수동 필요' | '거절'
  result: string | null
  requested_by: string | null
  created_at: string
  handled_at: string | null
}
export const AD_PLATFORMS = ['Google', 'Meta', 'Naver', '기타'] as const
export type AdPlatform = (typeof AD_PLATFORMS)[number]
export interface AdDaily {
  date: string
  platform: AdPlatform
  campaign: string
  impressions: number | null
  clicks: number | null
  cost: number | null
  conversions: number | null
  note: string | null
  updated_at: string
}
export interface AdCampaign {
  platform: AdPlatform
  campaign: string
  full_name: string | null
  status: string | null
  daily_budget: number | null
  start_date: string | null
  end_date: string | null
  flags: string | null
  checked_at: string
}
export const AD_SIDES = ['우리', '경쟁사', '해외'] as const
export type AdSide = (typeof AD_SIDES)[number]
export interface AdCreative {
  id: string
  side: AdSide
  brand: string
  platform: string | null
  campaign: string | null
  name: string
  format: string | null
  headline: string | null
  body: string | null
  image_url: string | null
  link: string | null
  status: string | null
  started_on: string | null
  last_seen: string | null
  impressions: number | null
  clicks: number | null
  cost: number | null
  note: string | null
  updated_at: string
}
export const SEO_KINDS = ['SEO', 'AEO', 'GEO'] as const
export type SeoKind = (typeof SEO_KINDS)[number]
export const SEO_STATUSES = ['양호', '주의', '미흡', '미측정'] as const
export type SeoStatus = (typeof SEO_STATUSES)[number]
/** 검색 노출 점검 항목 측정값 (0031) */
export interface SeoCheck {
  checked_on: string
  kind: SeoKind
  item: string
  score: number | null
  status: SeoStatus
  value: string | null
  target: string | null
  note: string | null
  source: string | null
  updated_at: string
}
export const AD_REPORT_KINDS = ['일일 보고', '경쟁사 분석', '해외 사례'] as const
export type AdReportKind = (typeof AD_REPORT_KINDS)[number]
export interface AdReport {
  id: string
  kind: AdReportKind
  report_date: string
  title: string
  summary: string | null
  body: string | null
  sources: string | null
  created_at: string
  updated_at: string
}

// ---------- 인테리어 현장 작업일지 (엑셀 '작업일지' 양식) ----------
/** 가. 공종별 투입 인원 한 줄: 공종 묶음 · 세부 공종 · 계약 · 주간/야간 인원 · 작업 내용 · 협력사 */
export interface SiteLabor {
  group: string
  trade: string
  contract: string
  day: number
  night: number
  /** 예전 일지 호환용 (화면에는 비용을 보이지 않음) */
  unit_price?: number
  vendor: string
  /** 공종별 금일 작업 내용 */
  note?: string
}
/** 나. 자재 반출입 / 인건비 지급 한 줄 */
export interface SiteMaterial {
  item: string
  spec: string
  qty: number
  amount: number
  vendor: string
}
export interface SitePhoto {
  label: string
  /** 링크 사진(드라이브 등) 또는 업로드 사진의 서명 링크 (드라이브 저장 작업이 내려받음) */
  url: string
  /** 휴대폰으로 올린 사진의 저장 위치 (site-photos 저장소) */
  path?: string
}
export const SITE_SIGNERS = ['현장소장', '현장감리', '대표'] as const
export type SiteSigner = (typeof SITE_SIGNERS)[number]
export interface SiteLog {
  id: string
  project_id: string
  log_date: string
  weather: string | null
  site_manager: string | null
  staff: string | null
  labor: SiteLabor[]
  materials: SiteMaterial[]
  today_work: string | null
  next_work: string | null
  photos: SitePhoto[]
  /** 이벤트 · 특이사항 (안전 · 민원 · 검측 · 방문 등) */
  events: string | null
  signs: Partial<Record<SiteSigner, { by: string; at: string }>>
  /** 구글 드라이브에 저장된 일지 (예약 작업이 채움) */
  drive_file_id: string | null
  drive_url: string | null
  synced_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
/** 양식 기본 공종 (엑셀 템플릿 그대로) */
export const SITE_TRADES: [group: string, trade: string, contract: string][] = [
  ['철거 · 가설', '가설 칸막이', '용역비'],
  ['철거 · 가설', 'H빔 보강', '용역비'],
  ['철거 · 가설', '철거', '용역비'],
  ['철거 · 가설', '벽 샌딩 작업', '용역비'],
  ['기계 · 설비 · 전기', '전기', '용역비'],
  ['기계 · 설비 · 전기', '통신 / 네트워크', ''],
  ['기계 · 설비 · 전기', '공조', '도급계약'],
  ['기계 · 설비 · 전기', '에어컨', '도급계약'],
  ['기계 · 설비 · 전기', '소방', ''],
  ['기계 · 설비 · 전기', '설비', '도급계약'],
  ['건축공사', '경량', ''],
  ['건축공사', '목공', '용역비'],
  ['건축공사', '금속', ''],
  ['건축공사', '자동문', ''],
  ['건축공사', '유리', ''],
  ['건축공사', '바닥', ''],
  ['마감공사', '수성페인트', ''],
  ['마감공사', '조형물', ''],
  ['마감공사', '스페셜 페인트', ''],
  ['마감공사', '조명기구', ''],
  ['마감공사', '가구공사', ''],
  ['마감공사', '인테리어 필름', ''],
  ['마감공사', 'AV SYSTEM', ''],
  ['마감공사', '사인물', ''],
  ['마감공사', '준공청소', ''],
  ['기타', '현장정리공', '용역비'],
  ['기타', '장비', ''],
  ['기타', '자재양중', ''],
  ['기타', '현장관리', ''],
  ['기타', '현장소장', ''],
]
export const SITE_MATERIAL_ITEMS = ['운영비', '목공 노무비', '전기 노무비', '용역', '현장소장비', '전기공사']

// ---------- 회의록 AI (녹음 → 화자 구분 받아쓰기 → 회의록 초안) ----------
export interface MeetingRecording {
  id: string
  created_by: string
  title: string | null
  attendees: string | null
  audio_path: string | null
  mime: string | null
  duration_sec: number | null
  status: '업로드' | '처리 중' | '완료' | '실패'
  transcript: string | null
  minutes: string | null
  error: string | null
  created_at: string
  updated_at: string
}
