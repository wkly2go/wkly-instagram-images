import type {
  Approval,
  ApprovalStatus,
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

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'title' | 'today_status' | 'status_message' | 'role' | 'active'>>

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
  subscribeChanges(tables: string[], cb: () => void): () => void
}

export class ApiError extends Error {}

/** Supabase/Postgres 오류를 한국어 메시지로 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 맞지 않습니다.'
  if (/row-level security|permission denied/i.test(msg)) return '권한이 없습니다.'
  if (/duplicate key/i.test(msg)) return '이미 같은 이름이 있습니다.'
  if (/violates check constraint/i.test(msg)) return '입력값을 확인해 주세요.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return '네트워크 연결을 확인해 주세요.'
  return msg
}
