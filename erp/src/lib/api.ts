import type {
  AdminOverview,
  AgentScope,
  AgentToken,
  AppNotification,
  Approval,
  ApprovalKind,
  ApprovalRoute,
  ApprovalStatus,
  BrandContact,
  BudgetLine,
  EmailTemplate,
  Payment,
  ProjectFinance,
  ResearchItem,
  Attendance,
  HrRecord,
  LeaveRecord,
  AgentInstruction,
  ChatMessage,
  ChatRoom,
  ChatRoomSummary,
  Client,
  Contact,
  Draft,
  Profile,
  Project,
  Task,
  WorkLog,
} from './types'

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'title' | 'today_status' | 'status_message' | 'photo' | 'role' | 'active' | 'is_agent'>>

export interface NewMember {
  email: string
  password: string
  name: string
  title?: string | null
  role: 'admin' | 'member'
  is_agent: boolean
}

export interface ImportResult {
  created: number
  merged: number
  skipped: number
}

/** 관리자 CSV 백업 대상 */
export const EXPORT_TABLES = ['work_logs', 'projects', 'tasks', 'clients', 'contacts', 'payments', 'project_finances', 'project_budget_lines', 'approvals', 'research_items', 'brand_contacts', 'chat_messages', 'profiles'] as const
export type ExportTable = (typeof EXPORT_TABLES)[number]

export interface WorkLogFilter {
  date?: string
  userId?: string
  clientId?: string
  projectId?: string
  limit?: number
}

export interface TaskFilter {
  projectId?: string
  from?: string
  to?: string
}

export type MessageEvent = { type: 'INSERT' | 'UPDATE' | 'DELETE'; message: ChatMessage }

/**
 * 화면은 이 인터페이스만 사용한다.
 * - supabaseApi: 실제 운영 (Supabase)
 * - demoApi: 환경변수가 없을 때 브라우저 저장소로 동작하는 체험판
 */
export interface Api {
  mode: 'supabase' | 'demo'

  // 인증
  getSessionUserId(): Promise<string | null>
  onAuthChange(cb: (userId: string | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  changePassword(password: string): Promise<void>
  isActiveMember(): Promise<boolean>

  // 팀원
  listProfiles(): Promise<Profile[]>
  updateProfile(id: string, patch: ProfilePatch): Promise<void>

  // 거래처
  listClients(): Promise<Client[]>
  saveClient(c: Draft<Client>): Promise<Client>
  deleteClient(id: string): Promise<void>
  listContacts(clientId: string): Promise<Contact[]>
  saveContact(c: Draft<Contact>): Promise<Contact>
  deleteContact(id: string): Promise<void>

  // 프로젝트·할 일
  listProjects(): Promise<Project[]>
  saveProject(p: Draft<Project>): Promise<Project>
  deleteProject(id: string): Promise<void>
  listTasks(filter?: TaskFilter): Promise<Task[]>
  saveTask(t: Draft<Task>): Promise<Task>
  deleteTask(id: string): Promise<void>

  // 업무 일지
  listWorkLogs(filter: WorkLogFilter): Promise<WorkLog[]>
  saveWorkLog(l: Draft<WorkLog>): Promise<WorkLog>
  deleteWorkLog(id: string): Promise<void>
  countWorkLogs(today: string): Promise<{ today: number; total: number }>

  // 채팅
  listRooms(): Promise<ChatRoomSummary[]>
  createRoom(r: { name: string; description?: string | null; project_id?: string | null }): Promise<ChatRoom>
  listMessages(roomId: string, limit?: number): Promise<ChatMessage[]>
  sendMessage(roomId: string, content: string): Promise<ChatMessage>
  deleteMessage(id: number): Promise<void>
  markRead(roomId: string): Promise<void>
  /** roomId 가 null 이면 모든 방 */
  subscribeMessages(roomId: string | null, cb: (e: MessageEvent) => void): () => void

  // 승인
  listApprovals(): Promise<Approval[]>
  createApproval(a: Draft<Approval>): Promise<Approval>
  decideApproval(id: string, status: Extract<ApprovalStatus, '승인' | '반려'>, comment?: string): Promise<void>
  cancelApproval(id: string): Promise<void>
  listApprovalRoutes(): Promise<ApprovalRoute[]>
  saveApprovalRoute(kind: ApprovalKind, approverId: string | null): Promise<void>
  subscribeChanges(tables: string[], cb: () => void): () => void

  // 재무 (관리자 전용: RLS 로 막혀 일반 팀원은 빈 목록)
  listFinances(): Promise<ProjectFinance[]>
  saveFinance(f: Draft<ProjectFinance> & { project_id: string }): Promise<ProjectFinance>
  listPayments(filter?: { projectId?: string; clientId?: string }): Promise<Payment[]>
  savePayment(p: Draft<Payment>): Promise<Payment>
  deletePayment(id: string): Promise<void>
  /** 여러 결제를 한 번에 (대지급 정산·상태 일괄 변경) */
  updatePayments(ids: string[], patch: Partial<Payment>): Promise<void>
  /** 엑셀 가져오기: 결제 + 실행 예산을 한 번에 저장 */
  importPayments(rows: Draft<Payment>[], budgetLines?: Draft<BudgetLine>[]): Promise<{ payments: number; budgetLines: number }>
  listBudgetLines(projectId?: string): Promise<BudgetLine[]>
  saveBudgetLine(b: Draft<BudgetLine>): Promise<BudgetLine>
  deleteBudgetLine(id: string): Promise<void>

  // 관리자
  adminOverview(): Promise<AdminOverview>
  /** 팀원(사람·AI) 계정 만들기: Supabase Edge Function 'admin-create-user' */
  createMember(m: NewMember): Promise<void>
  /** 팀원 비밀번호를 관리자가 정한 임시 비밀번호로 바꿈 (같은 Edge Function) */
  resetMemberPassword(userId: string, password: string): Promise<void>
  /** 팀원 계정 삭제 (기록은 남고 작성자는 '알 수 없음'). 본인·관리자 계정은 삭제 불가 */
  deleteMember(userId: string): Promise<void>
  /** 인사기록: 볼 권한이 없거나 아직 없으면 null */
  getHrRecord(profileId: string): Promise<HrRecord | null>
  saveHrRecord(r: HrRecord): Promise<void>
  /** 볼 수 있는 인사기록 전부 (관리자: 전원, 팀원: 본인) */
  listHrRecords(): Promise<HrRecord[]>
  exportTable(table: ExportTable): Promise<Record<string, unknown>[]>
  listAgentTokens(): Promise<AgentToken[]>
  /** 새 키를 만들고 평문 키를 한 번만 돌려준다 */
  createAgentToken(name: string, scopes: AgentScope[], profileId: string | null): Promise<string>
  revokeAgentToken(id: string): Promise<void>

  // 자료실
  listResearch(): Promise<ResearchItem[]>
  saveResearch(r: Draft<ResearchItem>): Promise<ResearchItem>
  deleteResearch(id: string): Promise<void>
  listBrandContacts(): Promise<BrandContact[]>
  saveBrandContact(c: Draft<BrandContact>): Promise<BrandContact>
  deleteBrandContact(id: string): Promise<void>
  /** 이메일 기준으로 합치며 가져오기 (기존 값은 덮어쓰지 않음, 수신거부는 유지) */
  importBrandContacts(rows: Draft<BrandContact>[]): Promise<ImportResult>
  listTemplates(): Promise<EmailTemplate[]>
  saveTemplate(t: Draft<EmailTemplate>): Promise<EmailTemplate>
  deleteTemplate(id: string): Promise<void>

  // 알림
  listNotifications(limit?: number): Promise<AppNotification[]>
  markNotificationsRead(ids: number[] | 'all'): Promise<void>
  /** 알람 시각이 지난 할 일을 알림으로 보냄 (서버 예약 작업이 없을 때 앱이 대신 실행). 보낸 개수 */
  runReminders(): Promise<number>

  // 근태
  /** 앱을 연 동안 몇 분마다 호출: 오늘 첫 호출이 출근 시각 */
  touchAttendance(): Promise<void>
  listAttendance(day: string): Promise<Attendance[]>
  /** 한 사람의 fromDay 이후 근태 (최근 날짜 먼저) */
  listAttendanceFor(userId: string, fromDay: string): Promise<Attendance[]>

  // 휴가
  listLeave(): Promise<LeaveRecord[]>
  /** 본인 신청(상태 '신청') · 관리자는 다른 사람 것도 status 와 함께 등록 */
  createLeave(r: Pick<LeaveRecord, 'profile_id' | 'kind' | 'start_date' | 'end_date' | 'days' | 'reason'> & { status?: LeaveRecord['status'] }): Promise<void>
  decideLeave(id: string, status: '승인' | '반려'): Promise<void>
  deleteLeave(id: string): Promise<void>

  // AI 팀원 직접 지시
  listAgentInstructions(): Promise<AgentInstruction[]>
  instructAgent(agentId: string, instruction: string): Promise<void>
  deleteAgentInstruction(id: string): Promise<void>
}

export class ApiError extends Error {}

/** Supabase/Postgres 오류를 한국어 메시지로 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 받은 이메일 주소를 그대로 입력했는지 확인하고, 계속 안 되면 관리자에게 비밀번호 재설정을 요청하세요.'
  if (/row-level security|permission denied/i.test(msg)) return '권한이 없습니다.'
  if (/duplicate key/i.test(msg)) return '이미 같은 이름이 있습니다.'
  if (/violates check constraint/i.test(msg)) return '입력값을 확인해 주세요.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return '네트워크 연결을 확인해 주세요.'
  if (/brand_contacts_email|email.*already/i.test(msg)) return '이미 등록된 이메일입니다.'
  return msg
}
