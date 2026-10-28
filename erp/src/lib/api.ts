import type { AccessSource } from './desktop'
import type { LedgerEntry, LedgerStatus,
  AiAgent,
  AgentSchedule,
  ActivityInputKind,
  ApprovalActivity,
  DriveIndexFile,
  Subscription,
  ExchangeFile,
  ProjectDriveFile,
  MeetingRecording,
  SiteLog,
  ProjectContact,
  ProjectMember,
  AccessInfo,
  AccessLog,
  AttendanceDevice,
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
  SeoCheck,
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
  AgentActionLog,
  ChatMessage,
  ChatRead,
  ChatRoom,
  ChatRoomSummary,
  ChatAttachment,
  ChatCard,
  SavedItem,
  RoomLevel,
  Client,
  Contact,
  Draft,
  Profile,
  Project,
  Task,
  WorkLog,
} from './types'

/** 구글 드라이브 탭에 거는 회사 공용 폴더 */
export interface DriveFolder {
  name: string
  url: string
}

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'title' | 'today_status' | 'status_message' | 'photo' | 'role' | 'active' | 'is_agent' | 'manager_id'>>

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

export interface DriveStatus {
  clientId: boolean
  secret: boolean
  connected: boolean
  account: string | null
  /** 마지막 자동 동기화 시각 */
  syncedAt?: string | null
  fullAt?: string | null
}
export interface DriveEnsureResult {
  url: string
  action: 'created' | 'linked' | 'renamed' | 'moved' | 'ok'
}

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
  /** 상대방(거래처 담당자) */
  contactId?: string
  limit?: number
}

export interface TaskFilter {
  projectId?: string
  from?: string
  to?: string
}

export const CHAT_FILE_MAX = 20 * 1024 * 1024
export const EXCHANGE_FILE_MAX = 50 * 1024 * 1024

export type MessageEvent = { type: 'INSERT' | 'UPDATE' | 'DELETE'; message: ChatMessage }
/** AI 팀원이 답을 쓰는 중 (서버가 실시간 방송, DB 에는 다 쓴 뒤 한 번 저장) */
export type AgentDraft = { agent_id: string; seq: number; text: string; status: string; done?: boolean }

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
  /** 프로젝트 ↔ 거래처 담당자 */
  listProjectContacts(f: { projectId?: string; contactId?: string }): Promise<ProjectContact[]>
  linkProjectContact(projectId: string, contactId: string, role?: string | null): Promise<void>
  unlinkProjectContact(projectId: string, contactId: string): Promise<void>
  listProjectMembers(projectId: string): Promise<ProjectMember[]>
  addProjectMember(projectId: string, profileId: string, role?: string | null): Promise<void>
  removeProjectMember(projectId: string, profileId: string): Promise<void>
  /** 주고받은 자료 (거래처 · 담당자 · 프로젝트 중 하나 이상으로 찾음) */
  listExchangeFiles(f: { clientId?: string; contactId?: string; projectId?: string }): Promise<ExchangeFile[]>
  addExchangeFile(f: { client_id: string | null; contact_id?: string | null; project_id?: string | null; direction: '받음' | '보냄'; note?: string | null; file_date?: string; file?: File; url?: string; name?: string }): Promise<void>
  /** 올린 사람 · 관리자만: 이름 · 메모 · 구분 · 날짜 · 프로젝트 고치기 */
  updateExchangeFile(id: string, patch: Partial<Pick<ExchangeFile, 'name' | 'note' | 'direction' | 'file_date' | 'project_id' | 'contact_id'>>): Promise<void>
  deleteExchangeFile(id: string): Promise<void>
  /** 프로젝트 · 구글 드라이브 자료 (0045) */
  listProjectDriveFiles(projectId: string): Promise<ProjectDriveFile[]>
  addProjectDriveFiles(projectId: string, files: Pick<ProjectDriveFile, 'drive_id' | 'name' | 'mime_type' | 'url' | 'icon_url'>[]): Promise<void>
  renameProjectDriveFile(id: string, patch: Partial<Pick<ProjectDriveFile, 'name' | 'note' | 'mime_type' | 'icon_url'>>): Promise<void>
  removeProjectDriveFile(id: string): Promise<void>
  /** download=true 면 내려받기 주소, 아니면 인트라넷 안에서 보는 주소 */
  exchangeFileUrl(f: ExchangeFile, download?: boolean): Promise<string>

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
  /** 채팅방 삭제 (만든 사람 · 관리자 · 1:1 대화 당사자). 메시지도 함께 지워짐 */
  deleteRoom(id: string): Promise<void>
  /** 팀원과 1:1 대화방 열기 (없으면 만듦) → 방 id */
  openDm(otherId: string): Promise<string>
  listMessages(roomId: string, limit?: number): Promise<ChatMessage[]>
  /** parentId 가 있으면 그 메시지의 스레드 답글 */
  sendMessage(roomId: string, content: string, parentId?: number | null): Promise<ChatMessage>
  /** 이모지 반응 넣기/빼기 (한 번 더 누르면 취소) → 바뀐 반응 */
  reactMessage(id: number, emoji: string): Promise<Record<string, string[]>>
  /** 사진 · 파일 보내기 (한 파일 20MB 까지). caption 이 없으면 '📎 파일 이름' */
  sendFile(roomId: string, file: File, caption?: string): Promise<ChatMessage>
  /** 첨부 파일을 열 수 있는 주소 (1시간 유효). download 면 원래 이름으로 내려받기 */
  fileUrl(att: ChatAttachment, download?: boolean): Promise<string>
  deleteMessage(id: number): Promise<void>
  /** 내 메시지 고치기 (고친 시각 edited_at 이 남음) */
  editMessage(id: number, content: string): Promise<ChatMessage>
  markRead(roomId: string): Promise<void>
  /** 이 방 알림 단계 (전체 · 멘션만 · 끄기) */
  setRoomLevel(roomId: string, level: RoomLevel): Promise<void>
  /** 나중에 보기: 안 끝낸 것 (최근 순) */
  listSaved(): Promise<SavedItem[]>
  saveForLater(item: { message_id: number | null; room_id: string | null; preview: string; remind_at: string | null }): Promise<SavedItem>
  finishSaved(id: number): Promise<void>
  /** 카드 메시지 보내기 (/할일 · /결재 · /일정 으로 만든 것) */
  sendCard(roomId: string, content: string, card: ChatCard): Promise<ChatMessage>
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
  /** AI 팀원 답이 써지는 대로 받기 (글자 단위 실시간) */
  subscribeAgentDrafts(roomId: string, cb: (d: AgentDraft) => void): () => void

  // 승인
  listApprovals(): Promise<Approval[]>
  createApproval(a: Draft<Approval>): Promise<Approval>
  decideApproval(id: string, status: Extract<ApprovalStatus, '승인' | '반려'>, comment?: string): Promise<void>
  cancelApproval(id: string): Promise<void>
  /** 결재 · 보고 기록 (오래된 것부터) */
  listApprovalActivity(approvalId: string): Promise<ApprovalActivity[]>
  /** 답글 · 진행 상황 · 결과 보고 남기기 (AI 팀원이 올린 결재면 그 AI 에게도 전달돼 답이 붙음) */
  addApprovalActivity(approvalId: string, kind: ActivityInputKind, body: string): Promise<ApprovalActivity>
  removeApprovalActivity(id: number): Promise<void>
  listApprovalRoutes(): Promise<ApprovalRoute[]>
  saveApprovalRoute(kind: ApprovalKind, approverId: string | null): Promise<void>
  subscribeChanges(tables: string[], cb: () => void): () => void

  // 재무 (관리자 전용: RLS 로 막혀 일반 팀원은 빈 목록)
  listFinances(): Promise<ProjectFinance[]>
  saveFinance(f: Draft<ProjectFinance> & { project_id: string }): Promise<ProjectFinance>
  /** 구독료: 보기는 모두, 등록 · 수정 · 삭제는 관리자 */
  // 입출금 장부 (관리자 · 비밀번호 잠금 해제 때만, 서버에서 막음)
  ledgerStatus(): Promise<LedgerStatus>
  ledgerSetPassword(oldPw: string | null, newPw: string): Promise<void>
  ledgerUnlock(pw: string): Promise<string>
  ledgerLock(): Promise<void>
  ledgerTouch(): Promise<string | null>
  listLedger(from: string, to: string): Promise<LedgerEntry[]>
  saveLedger(e: Draft<LedgerEntry>): Promise<LedgerEntry>
  deleteLedger(id: number): Promise<void>
  listSubscriptions(): Promise<Subscription[]>
  saveSubscription(s: Draft<Subscription>): Promise<Subscription>
  deleteSubscription(id: string): Promise<void>
  /** 회의록 AI: 녹음을 올리고 AI 정리를 시작, 진행 상태는 getMeetingRecording 으로 확인 */
  startMeetingMinutes(audio: Blob, meta: { title?: string; attendees?: string; duration_sec?: number; filename?: string }): Promise<MeetingRecording>
  getMeetingRecording(id: string): Promise<MeetingRecording | null>
  /** 인테리어 현장 작업일지 (프로젝트별 · 날짜별 한 장) */
  listSiteLogs(projectId: string): Promise<SiteLog[]>
  saveSiteLog(l: Draft<SiteLog>): Promise<SiteLog>
  deleteSiteLog(id: string): Promise<void>
  /** 현장 사진 올리기 (휴대폰 카메라 · 앨범). url 은 드라이브 저장 작업용 30일 서명 링크 */
  uploadSitePhoto(projectId: string, file: File): Promise<{ path: string; url: string }>
  /** 화면에 보일 사진 링크 (1시간) */
  sitePhotoUrl(path: string): Promise<string>
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
  /** AI 팀원: 설정 목록 · 만들기(관리자, 로그인하지 않는 계정을 만듦) · 고치기 */
  listAiAgents(): Promise<AiAgent[]>
  createAiAgent(a: { name: string; title: string | null; role: string; instructions: string; tools: string[]; owner_id: string | null; model: AiAgent['model'] }): Promise<string>
  saveAiAgent(profileId: string, patch: Partial<Pick<AiAgent, 'role' | 'instructions' | 'tools' | 'owner_id' | 'model'>>): Promise<void>
  /** AI 예약 */
  listAgentSchedules(): Promise<AgentSchedule[]>
  saveAgentSchedule(s: Partial<AgentSchedule> & Pick<AgentSchedule, 'agent_id' | 'title' | 'instruction' | 'repeat'>): Promise<AgentSchedule>
  deleteAgentSchedule(id: string): Promise<void>
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
  /** 검색 노출 점검 (SEO · AEO · GEO) 최근 측정값 */
  listSeoChecks(): Promise<SeoCheck[]>
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
  /** 지금 내 IP · 회사 인터넷 여부 · (관리자) 회사 IP 목록 */
  getAccessInfo(): Promise<AccessInfo>
  /** 회사 공인 IP (IP 또는 CIDR). 빈 목록이면 IP 제한 없음 */
  setOfficeIps(ips: string[]): Promise<void>
  /** 최근 14일 PC 프로그램 접속 IP (회사 IP 등록 도우미 · 관리자) */
  listRecentDesktopIps(): Promise<{ ip: string; users: number; days: number; last: string }[]>
  listAttendanceDevices(): Promise<AttendanceDevice[]>
  /** 등록된 회사 PC 초기화 → 다음에 회사에서 켠 PC 가 새로 등록됨 */
  deleteAttendanceDevice(userId: string, deviceId: string): Promise<void>
  /** 인트라넷 구글 검색: Google 프로그래머블 검색 ID (없으면 null) */
  getSearchCx(): Promise<string | null>
  setSearchCx(cx: string | null): Promise<void>
  /** 구글 드라이브 탭: 회사 공용 폴더 (관리자 등록) */
  getDriveFolders(): Promise<DriveFolder[]>
  setDriveFolders(list: DriveFolder[]): Promise<void>
  /** 웹 브라우저 드라이브 목록용 구글 OAuth 클라이언트 ID (공개 값, 관리자 등록) */
  getGoogleClientId(): Promise<string | null>
  setGoogleClientId(id: string | null): Promise<void>
  /** 회사 구글 계정 드라이브 연동 (gdrive 함수) */
  driveStatus(): Promise<DriveStatus>
  driveConnect(code: string): Promise<{ account: string | null }>
  /** 프로젝트 폴더 만들기 · 맞추기. 회사 계정이 연결 안 됐으면 null */
  driveEnsure(projectId: string): Promise<DriveEnsureResult | null>
  driveEnsureAll(): Promise<{ made: number; fixed: number; fail: string[] }>
  /** 회사 계정 드라이브 접근 토큰 (탐색기용 · 1시간). 연결 안 됐으면 null */
  driveAccessToken(): Promise<{ token: string; expires_at: number } | null>
  /** 프로젝트 폴더 안 파일 (자동 동기화된 목록). projectId 가 없으면 전체 (최근 고친 순) */
  listDriveIndex(projectId?: string): Promise<DriveIndexFile[]>
  /** 관리자 · 지금 동기화 (full 이면 전체 다시 훑기) */
  driveSync(full?: boolean): Promise<{ mode: 'full' | 'changes'; files: number; changed: number }>

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
  /** AI 처리 기록 (관리자 · 사람 팀장 · 요청 본인) */
  listAgentActions(): Promise<AgentActionLog[]>
}

/** PC 프로그램 접속 기록 → IP 별 사람 수 · 날 수 (회사 IP 찾기) */
export function groupIps(rows: { user_id: string; day: string; ip: string; last_at: string }[]) {
  const m = new Map<string, { users: Set<string>; days: Set<string>; last: string }>()
  for (const r of rows) {
    const g = m.get(r.ip) ?? { users: new Set<string>(), days: new Set<string>(), last: r.last_at }
    g.users.add(r.user_id)
    g.days.add(r.day)
    if (r.last_at > g.last) g.last = r.last_at
    m.set(r.ip, g)
  }
  return [...m].map(([ip, g]) => ({ ip, users: g.users.size, days: g.days.size, last: g.last })).sort((a, b) => b.users - a.users || b.days - a.days)
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
