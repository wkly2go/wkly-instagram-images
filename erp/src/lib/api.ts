import type { AccessSource } from './desktop'
import type {
  AccessLog,
  AttendanceCheckin,
  AttendanceMonthRow,
  AttendanceRules,
  CheckinKind,
  DecideStatus,
  Department,
  WorkPlan,
  WorkPlanKind,
  Note,
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
  AdCampaign,
  AdCreative,
  AdReport,
  AdDaily,
  AgentAction,
  AgentJob,
  AgentJobRequest,
  AgentReport,
  ReportTemplate,
  ResearchItem,
  Attendance,
  HrRecord,
  LeaveRecord,
  AgentInstruction,
  ChatMessage,
  ChatRead,
  ChatRoom,
  ChatRoomSummary,
  ChatAttachment,
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
  /** 기간 (log_date 포함) */
  from?: string
  to?: string
  /** 내용 검색 */
  q?: string
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

export const CHAT_FILE_MAX = 20 * 1024 * 1024

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
  /** clientId 없으면 전체 (거래처 검색용) */
  listContacts(clientId?: string): Promise<Contact[]>
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
  /** 팀원과 1:1 대화방 열기 (없으면 만듦) → 방 id */
  openDm(otherId: string): Promise<string>
  listMessages(roomId: string, limit?: number): Promise<ChatMessage[]>
  sendMessage(roomId: string, content: string): Promise<ChatMessage>
  /** 사진 · 파일 보내기 (한 파일 20MB 까지). caption 이 없으면 '📎 파일 이름' */
  sendFile(roomId: string, file: File, caption?: string): Promise<ChatMessage>
  /** 첨부 파일을 열 수 있는 주소 (1시간 유효). download 면 원래 이름으로 내려받기 */
  fileUrl(att: ChatAttachment, download?: boolean): Promise<string>
  deleteMessage(id: number): Promise<void>
  /** 내 메시지 고치기 (고친 시각 edited_at 이 남음) */
  editMessage(id: number, content: string): Promise<ChatMessage>
  markRead(roomId: string): Promise<void>
  /** 방 참여자들의 마지막 읽은 시각 (누가 읽었는지 표시) */
  listRoomReads(roomId: string): Promise<ChatRead[]>

  // 웹 푸시 (창을 닫아도 PC 알림). 체험 모드는 지원하지 않음 → pushPublicKey 가 null
  pushPublicKey(): Promise<string | null>
  pushSubscribe(sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }): Promise<void>
  pushUnsubscribe(endpoint: string): Promise<void>
  /** 구글 캘린더 'URL로 추가'용 내 일정 구독 주소. reset 이면 새 주소 발급(예전 주소 막힘). 체험 모드는 null */
  calendarFeedUrl(reset?: boolean): Promise<string | null>
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
  // Claude AI 에이전트 (관리자)
  listAgentJobs(): Promise<AgentJob[]>
  listAgentReports(from: string, to: string): Promise<AgentReport[]>
  listAgentJobRequests(): Promise<AgentJobRequest[]>
  requestAgentJob(r: { trigger_id: string; action: AgentAction; detail?: string | null }): Promise<void>
  cancelAgentJobRequest(id: string): Promise<void>
  // 광고 대시보드 (관리자)
  listAdDaily(from: string, to: string): Promise<AdDaily[]>
  listAdCampaigns(): Promise<AdCampaign[]>
  listAdCreatives(): Promise<AdCreative[]>
  listAdReports(): Promise<AdReport[]>
  listReportTemplates(): Promise<ReportTemplate[]>
  saveReportTemplate(t: Draft<ReportTemplate>): Promise<ReportTemplate>
  deleteReportTemplate(id: string): Promise<void>
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
  /** source: 접속 경로. 설정에 따라 PC 프로그램 접속만 출근으로 인정 */
  touchAttendance(source: AccessSource): Promise<void>
  listAttendance(day: string): Promise<Attendance[]>
  // 개인 메모장 (본인 것만)
  listNotes(): Promise<Note[]>
  saveNote(n: { id?: string; content: string; pinned?: boolean }): Promise<Note>
  deleteNote(id: string): Promise<void>
  /** 그날 경로별 접속 기록 (외부 접속 표시용) */
  listAccessLog(day: string): Promise<AccessLog[]>
  /** 출근은 PC 프로그램에서만 인정할지 (관리 설정) */
  getDesktopOnly(): Promise<boolean>
  setDesktopOnly(on: boolean): Promise<void>
  /** 한 사람의 fromDay 이후 근태 (최근 날짜 먼저) */
  listAttendanceFor(userId: string, fromDay: string): Promise<Attendance[]>
  // 부서 · 주요 업무
  listDepartments(): Promise<Department[]>
  saveDepartment(d: Partial<Department> & { name: string }): Promise<void>
  deleteDepartment(id: string): Promise<void>
  // 휴대폰 출근 · 외근 사전 신청
  listWorkPlans(fromDay: string): Promise<WorkPlan[]>
  requestWorkPlan(p: { day: string; kind: WorkPlanKind; place?: string | null; reason?: string | null }): Promise<void>
  cancelWorkPlan(id: string): Promise<void>
  decideWorkPlan(id: string, status: '승인' | '반려'): Promise<void>
  listCheckins(day: string): Promise<AttendanceCheckin[]>
  mobileCheckIn(c: { kind: CheckinKind; note?: string | null; lat?: number | null; lng?: number | null; accuracy?: number | null }): Promise<{ status: DecideStatus; already: boolean }>
  decideCheckin(id: string, status: '승인' | '반려'): Promise<void>
  getAttendanceRules(): Promise<AttendanceRules>
  setAttendanceRule(key: 'work_start' | 'plan_deadline', value: string): Promise<void>
  attendanceMonthSummary(month: string): Promise<AttendanceMonthRow[]>
  /** 인트라넷 구글 검색: Google 프로그래머블 검색 ID (없으면 null) */
  getSearchCx(): Promise<string | null>
  setSearchCx(cx: string | null): Promise<void>

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
