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

export const APPROVAL_KINDS = ['업무 보고', '메일 발송', '프로젝트', '거래처', '할 일', '지출', '기타'] as const
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

// 저장용 입력 타입: id 가 있으면 수정, 없으면 생성
export type Draft<T> = Partial<T>
