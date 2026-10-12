import { ApiError, type Api, type MessageEvent } from './api'
import { addDays, todayKey } from './date'
import type { Approval, ChatMessage, ChatRoom, ChatRoomSummary, Client, Contact, Profile, Project, Task, WorkLog } from './types'

// Supabase 연결 전 체험용. 데이터는 이 브라우저(localStorage)에만 저장된다.
// 권한 규칙은 DB 의 RLS 를 단순화해 흉내 낸다.

interface Store {
  profiles: Profile[]
  clients: Client[]
  contacts: Contact[]
  projects: Project[]
  tasks: Task[]
  work_logs: WorkLog[]
  chat_rooms: ChatRoom[]
  chat_messages: ChatMessage[]
  chat_reads: { user_id: string; room_id: string; last_read_at: string }[]
  approvals: Approval[]
  seq: number
}

const KEY = 'wkly-erp-demo-v1'
const SESSION_KEY = 'wkly-erp-demo-session'

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
/**
 * 체험 데이터 시각. 지난 날은 그날 'HH:mm'(KST),
 * 오늘은 언제 열어도 미래가 되지 않도록 '지금 - 3시간'을 08:30 으로 보고 상대 배치.
 */
function at(dayOffset: number, time: string): string {
  const [h, m] = time.split(':').map(Number)
  if (dayOffset === 0) return new Date(Date.now() - 3 * 3600_000 + (h * 60 + m - 510) * 60_000).toISOString()
  return new Date(`${addDays(todayKey(), dayOffset)}T${time}:00+09:00`).toISOString()
}

const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  haneul: '00000000-0000-4000-8000-000000000002',
  doyun: '00000000-0000-4000-8000-000000000003',
  seoyeon: '00000000-0000-4000-8000-000000000004',
  garam: '00000000-0000-4000-8000-000000000005',
}

export const DEMO_USERS = [
  { id: U.admin, email: 'admin@thewklyn.com', label: '관리자 (대표)' },
  { id: U.haneul, email: 'haneul@thewklyn.com', label: '김하늘 (매니저)' },
  { id: U.doyun, email: 'doyun@thewklyn.com', label: '이도윤 (매니저)' },
]

function seed(): Store {
  const t = todayKey()
  const p = (id: string, name: string, role: 'admin' | 'member', title: string, status: Profile['today_status'], msg: string, email: string): Profile => ({
    id, email, name, role, active: true, title, today_status: status, status_message: msg, status_updated_at: at(0, '08:50'), created_at: at(-30, '09:00'),
  })
  const profiles = [
    p(U.admin, '관리자', 'admin', '대표', '출근', '이번 주 팝업 철수 3건. 다들 화이팅!', 'admin@thewklyn.com'),
    p(U.haneul, '김하늘', 'member', '매니저', '외근', '오후엔 성수 현장에 있어요.', 'haneul@thewklyn.com'),
    p(U.doyun, '이도윤', 'member', '매니저', '미팅', '루프앤코 미팅 15:00', 'doyun@thewklyn.com'),
    p(U.seoyeon, '박서연', 'member', '에디터', '출근', '3주차 원고 마감 데이 ✍️', 'seoyeon@thewklyn.com'),
    p(U.garam, '최가람', 'member', '인턴', '휴가', '내일 복귀합니다', 'garam@thewklyn.com'),
  ]
  const c = (name: string, category: Client['category'], extra: Partial<Client> = {}): Client => ({
    id: uid(), name, category, business_no: null, phone: null, email: null, address: null, website: null, memo: null, created_by: U.admin, created_at: at(-40, '10:00'), updated_at: at(-40, '10:00'), ...extra,
  })
  const objet = c('오브제랩', '클라이언트', { business_no: '123-45-67890', phone: '02-1234-5678', email: 'hello@objetlab.example', address: '서울 성동구 성수이로 00, 2층', memo: '현장 담당 정민지 매니저 · 정산은 월말 일괄' })
  const loop = c('루프앤코', '클라이언트', { phone: '02-2222-3333', email: 'team@loopnco.example' })
  const green = c('그린테이블', '협력사', { email: 'sales@greentable.example', memo: '설치·집기 렌탈' })
  const high = c('하이브로우 스튜디오', '협력사', { phone: '02-555-0000', memo: '촬영 스튜디오' })
  const mono = c('모노웍스', '기타')
  const clients = [objet, loop, green, high, mono]
  const ct = (client: Client, name: string, title: string, phone: string, email: string, primary = false): Contact => ({ id: uid(), client_id: client.id, name, title, phone, email, memo: null, is_primary: primary, created_at: at(-40, '10:00') })
  const contacts = [
    ct(objet, '정민지', '매니저', '010-0000-1111', 'minji@objetlab.example', true), ct(objet, '강도현', '디자이너', '010-0000-2222', 'dohyun@objetlab.example'),
    ct(loop, '한서준', '팀장', '010-0000-3333', 'seojun@loopnco.example', true), ct(green, '오세라', '실장', '010-0000-4444', 'sales@greentable.example', true),
    ct(high, '윤태호', 'PD', '010-0000-5555', 'taeho@highbrow.example', true),
  ]
  const pj = (name: string, client: Client | null, category: Project['category'], status: Project['status'], owner: string, s: number, e: number, location: string | null = null, description: string | null = null): Project => ({
    id: uid(), name, client_id: client?.id ?? null, category, status, owner_id: owner, start_date: addDays(t, s), end_date: addDays(t, e), location, description, created_by: U.admin, created_at: at(-20, '10:00'), updated_at: at(-1, '10:00'),
  })
  const objetWeek = pj("성수 팝업 '오브제 위크'", objet, '팝업', '진행', U.haneul, -2, 14, '서울 성동구 성수동', '오브제랩 브랜드 팝업 운영 · 현장 사진 · 철수')
  const autumn = pj('가을 시즌 인스타 캠페인', loop, '캠페인', '진행', U.doyun, -11, 19, null, '릴스 6편 + 피드 12장')
  const weekly = pj('주간 핫 마케팅 3주차', null, '콘텐츠', '기획', U.seoyeon, 1, 7)
  const paper = pj("연남 팝업 '페이퍼 마켓'", high, '팝업', '기획', U.seoyeon, 21, 34, '서울 마포구 연남동')
  const yeouido = pj('여의도 팝업 리뷰 콘텐츠', green, '콘텐츠', '완료', U.haneul, -20, -7)
  const projects = [objetWeek, autumn, weekly, paper, yeouido]
  const tk = (project: Project | null, title: string, assignee: string, due: number, status: Task['status']): Task => ({
    id: uid(), project_id: project?.id ?? null, title, assignee_id: assignee, due_date: addDays(t, due), status, memo: null, completed_at: status === '완료' ? at(-1, '18:00') : null, created_by: U.admin, created_at: at(-5, '10:00'), updated_at: at(-1, '10:00'),
  })
  const tasks = [
    tk(objetWeek, '현장 사진 1차 셀렉', U.haneul, 0, '진행 중'), tk(autumn, '캠페인 2차 카피 컨펌 요청', U.doyun, 0, '할 일'), tk(weekly, '3주차 원고 마감', U.seoyeon, 0, '할 일'),
    tk(objetWeek, '팝업 철수 일정 협의', U.haneul, 2, '할 일'), tk(autumn, '인플루언서 리스트 정리', U.doyun, -2, '할 일'), tk(yeouido, '정산 자료 요청 메일', U.seoyeon, 4, '할 일'),
    tk(autumn, '캠페인 촬영', U.doyun, 5, '할 일'), tk(objetWeek, '오브제 위크 철수', U.haneul, 14, '할 일'), tk(objetWeek, '오픈 현장 점검', U.haneul, -2, '완료'),
  ]
  const lg = (user: string, day: number, time: string, kind: WorkLog['kind'], content: string, extra: Partial<WorkLog> = {}): WorkLog => ({
    id: uid(), user_id: user, log_date: addDays(t, day), kind, content, email_counterpart: null, email_subject: null, client_id: null, project_id: null, minutes: null, created_at: at(day, time), updated_at: at(day, time), ...extra,
  })
  const work_logs = [
    lg(U.haneul, 0, '09:05', '업무', '오브제 위크 현장 사진 1차 셀렉', { project_id: objetWeek.id, minutes: 40 }),
    lg(U.haneul, 0, '09:31', '메일 수신', '그린테이블 설치 견적 회신 확인 — 금액 조정 요청 예정', { email_counterpart: 'sales@greentable.example', email_subject: 'RE: 설치 견적 요청', client_id: green.id, minutes: 10 }),
    lg(U.doyun, 0, '09:12', '전화', '하이브로우 스튜디오 촬영 일정 조율', { client_id: high.id, project_id: autumn.id, minutes: 10 }),
    lg(U.seoyeon, 0, '09:50', '업무', '3주차 원고 초안 작성 (성수·여의도·홍대)', { project_id: weekly.id, minutes: 90 }),
    lg(U.doyun, 0, '10:05', '미팅', '루프앤코 캠페인 2차 방향 미팅. 릴스 3편 추가 제작 합의', { client_id: loop.id, project_id: autumn.id, minutes: 60 }),
    lg(U.haneul, 0, '10:42', '메일 발신', '철수 일정 안내 + 원상복구 체크리스트 전달', { email_counterpart: 'minji@objetlab.example', email_subject: '[오브제 위크] 철수 일정 안내', client_id: objet.id, project_id: objetWeek.id, minutes: 15 }),
    lg(U.admin, 0, '08:55', '업무', '주간 회의 안건 정리', { minutes: 20 }),
    lg(U.doyun, -2, '15:00', '미팅', '오브제랩 오픈 현장 점검 및 동선 수정', { client_id: objet.id, project_id: objetWeek.id, minutes: 90 }),
    lg(U.haneul, -4, '11:20', '전화', '오브제랩 설치 시간 2시간 앞당김 요청 받음', { client_id: objet.id, minutes: 10 }),
    lg(U.admin, -10, '14:00', '메일 수신', '오브제랩 계약서 날인본 수신', { client_id: objet.id, email_counterpart: 'hello@objetlab.example', email_subject: '계약서 날인본 송부' }),
  ]
  const room = (name: string, description: string | null, project: Project | null = null): ChatRoom => ({ id: uid(), name, description, project_id: project?.id ?? null, is_archived: false, created_by: U.admin, created_at: at(-30, '09:00') })
  const all = room('전체', '팀 전체 공지와 한마디')
  const rObjet = room('성수 팝업 오브제 위크', null, objetWeek)
  const rAutumn = room('가을 시즌 캠페인', null, autumn)
  const rContent = room('콘텐츠팀', null)
  let seq = 0
  const m = (r: ChatRoom, user: string, day: number, time: string, content: string): ChatMessage => ({ id: ++seq, room_id: r.id, user_id: user, content, created_at: at(day, time), edited_at: null })
  const chat_messages = [
    m(all, U.seoyeon, 0, '09:15', '3주차 원고 초안 업로드 완료!'), m(all, U.doyun, 0, '09:40', '오후 3시 루프앤코 미팅 같이 가실 분?'), m(all, U.haneul, 0, '10:44', '오브제 위크 철수 체크리스트 드라이브에 올렸어요'),
    m(rObjet, U.doyun, 0, '09:40', '오늘 현장 마감 체크 누가 가나요?'), m(rObjet, U.admin, 0, '09:42', '제가 오후 3시에 갈게요. 철수 일정도 오브제랩에 메일로 안내하겠습니다.'),
    m(rObjet, U.seoyeon, 0, '10:15', '현장 사진 1차 셀렉 드라이브에 올렸어요 📁'), m(rObjet, U.haneul, 0, '10:43', '철수 일정 메일 보냈어요. 업무 일지에도 기록 완료 👍'),
    m(rAutumn, U.doyun, 0, '10:20', '릴스 3편 추가 확정됐어요'), m(rContent, U.seoyeon, 0, '09:52', '3주차 원고 올렸어요'),
  ]
  const ap = (kind: Approval['kind'], title: string, by: string, time: [number, string], extra: Partial<Approval> = {}): Approval => ({
    id: uid(), kind, title, content: null, payload: {}, target_id: null, amount: null, requested_by: by, approver_id: null, status: '대기', decided_by: null, decided_at: null, decision_comment: null, created_at: at(time[0], time[1]), updated_at: at(time[0], time[1]), ...extra,
  })
  const approvals = [
    ap('업무 보고', `${t.slice(5).replace('-', '/')} 업무 보고 (기록 3건 · 1시간 5분)`, U.haneul, [0, '10:58'], { payload: { date: t, user_id: U.haneul } }),
    ap('메일 발송', '[오브제 위크] 철수 일정 안내 메일', U.haneul, [0, '10:31'], { payload: { to: 'minji@objetlab.example', subject: '[오브제 위크] 철수 일정 안내', body: '안녕하세요, 더위클리 김하늘입니다.\n오브제 위크 팝업 철수 일정과 원상복구 체크리스트를 공유드립니다. 확인 부탁드립니다.' } }),
    ap('지출', '촬영 소품 구매', U.doyun, [0, '09:44'], { amount: 128000, content: '가을 캠페인 릴스 촬영용 소품 (테이블 소품 6종)' }),
    ap('프로젝트', "신규: 연남 팝업 '페이퍼 마켓' 등록", U.seoyeon, [-1, '17:20'], { target_id: paper.id, content: '하이브로우 스튜디오 공동 기획 · 11월 오픈 예정' }),
    ap('업무 보고', `${addDays(t, -1).slice(5).replace('-', '/')} 업무 보고 (기록 6건)`, U.doyun, [-1, '18:30'], { status: '승인', decided_by: U.admin, decided_at: at(-1, '19:00'), payload: { date: addDays(t, -1), user_id: U.doyun } }),
    ap('메일 발송', '그린테이블 견적 조정 요청', U.haneul, [-3, '15:00'], { status: '반려', decided_by: U.admin, decided_at: at(-3, '16:00'), decision_comment: '금액 근거 자료 첨부 후 다시 요청해 주세요.', payload: { to: 'sales@greentable.example', subject: '견적 조정 요청', body: '설치 견적 조정 가능 여부 문의드립니다.' } }),
  ]
  const chat_reads = [all, rObjet].map(r => ({ user_id: U.admin, room_id: r.id, last_read_at: at(0, '10:50') }))
  return { profiles, clients, contacts, projects, tasks, work_logs, chat_rooms: [all, rObjet, rAutumn, rContent], chat_messages, chat_reads, approvals, seq }
}

export function createDemoApi(): Api {
  let store: Store
  try {
    const raw = localStorage.getItem(KEY)
    store = raw ? (JSON.parse(raw) as Store) : seed()
  } catch {
    store = seed()
  }
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      /* 저장 불가 환경에서는 메모리로만 동작 */
    }
  }
  persist()

  let me: string | null = null
  try {
    me = localStorage.getItem(SESSION_KEY)
  } catch {
    me = null
  }
  const authListeners = new Set<(id: string | null) => void>()
  const bus = new EventTarget()
  const emit = (table: string, detail?: unknown) => bus.dispatchEvent(new CustomEvent(table, { detail }))

  const requireMe = () => {
    if (!me) throw new ApiError('로그인이 필요합니다.')
    return me
  }
  const isAdmin = () => store.profiles.some(p => p.id === me && p.role === 'admin' && p.active)
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

  function upsert<K extends keyof Store, T extends { id: string }>(table: K, row: Partial<T>, defaults: () => T): T {
    const list = store[table] as unknown as T[]
    if (row.id) {
      const i = list.findIndex(r => r.id === row.id)
      if (i < 0) throw new ApiError('항목을 찾을 수 없습니다.')
      const next = { ...list[i], ...row, updated_at: now() } as T
      list[i] = next
      persist()
      emit(String(table))
      return clone(next)
    }
    const created = { ...defaults(), ...row, id: uid() } as T
    list.push(created)
    persist()
    emit(String(table))
    return clone(created)
  }
  function del<K extends keyof Store>(table: K, id: string | number, guard?: () => boolean) {
    if (guard && !guard()) throw new ApiError('권한이 없습니다.')
    const list = store[table] as unknown as { id: string | number }[]
    const i = list.findIndex(r => r.id === id)
    if (i < 0) throw new ApiError('항목을 찾을 수 없습니다.')
    const [removed] = list.splice(i, 1)
    persist()
    emit(String(table), removed)
  }
  const base = () => ({ created_by: me, created_at: now(), updated_at: now() })
  const withCanDecide = (a: Approval): Approval => ({ ...a, can_decide: isAdmin() || (!!me && a.approver_id === me) })

  return {
    mode: 'demo',

    async getSessionUserId() {
      return me
    },
    onAuthChange(cb) {
      authListeners.add(cb)
      return () => authListeners.delete(cb)
    },
    async signIn(email) {
      const p = store.profiles.find(x => x.email?.toLowerCase() === email.trim().toLowerCase()) ?? store.profiles.find(x => x.role === 'admin')
      if (!p) throw new ApiError('계정을 찾을 수 없습니다.')
      me = p.id
      try {
        localStorage.setItem(SESSION_KEY, me)
      } catch {
        /* noop */
      }
      authListeners.forEach(cb => cb(me))
    },
    async signOut() {
      me = null
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        /* noop */
      }
      authListeners.forEach(cb => cb(null))
    },
    async changePassword() {
      /* 데모에서는 저장하지 않음 */
    },
    async isActiveMember() {
      return store.profiles.some(p => p.id === me && p.active)
    },

    async listProfiles() {
      return clone(store.profiles)
    },
    async updateProfile(id, patch) {
      const self = requireMe()
      if (id !== self && !isAdmin()) throw new ApiError('권한이 없습니다.')
      if ((patch.role !== undefined || patch.active !== undefined) && !isAdmin()) throw new ApiError('권한(role)과 활성 상태(active)는 관리자만 변경할 수 있습니다.')
      const p = store.profiles.find(x => x.id === id)
      if (!p) throw new ApiError('팀원을 찾을 수 없습니다.')
      const next = { ...p, ...patch }
      if (p.role === 'admin' && p.active && !(next.role === 'admin' && next.active) && !store.profiles.some(x => x.id !== id && x.role === 'admin' && x.active)) {
        throw new ApiError('활성 관리자가 최소 1명 있어야 합니다. 다른 관리자를 먼저 지정하세요.')
      }
      if (patch.today_status !== undefined || patch.status_message !== undefined) next.status_updated_at = now()
      Object.assign(p, next)
      persist()
      emit('profiles')
    },

    async listClients() {
      return clone([...store.clients].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    },
    async saveClient(c) {
      return upsert<'clients', Client>('clients', c, () => ({ ...base(), name: '', category: '클라이언트', business_no: null, phone: null, email: null, address: null, website: null, memo: null }) as Client)
    },
    async deleteClient(id) {
      del('clients', id, isAdmin)
      store.contacts = store.contacts.filter(x => x.client_id !== id)
      persist()
    },
    async listContacts(clientId) {
      return clone(store.contacts.filter(x => x.client_id === clientId).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)))
    },
    async saveContact(c) {
      return upsert<'contacts', Contact>('contacts', c, () => ({ created_at: now(), client_id: '', name: '', title: null, phone: null, email: null, memo: null, is_primary: false }) as unknown as Contact)
    },
    async deleteContact(id) {
      del('contacts', id)
    },

    async listProjects() {
      return clone([...store.projects].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')))
    },
    async saveProject(p) {
      if (p.start_date && p.end_date && p.end_date < p.start_date) throw new ApiError('종료일이 시작일보다 빠릅니다.')
      return upsert<'projects', Project>('projects', p, () => ({ ...base(), name: '', client_id: null, category: '팝업', status: '기획', owner_id: null, start_date: null, end_date: null, location: null, description: null }) as Project)
    },
    async deleteProject(id) {
      del('projects', id, isAdmin)
      store.tasks = store.tasks.filter(x => x.project_id !== id)
      persist()
    },
    async listTasks(f = {}) {
      return clone(
        store.tasks
          .filter(x => (!f.projectId || x.project_id === f.projectId) && (!f.from || (x.due_date ?? '') >= f.from) && (!f.to || (x.due_date && x.due_date <= f.to)))
          .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
      )
    },
    async saveTask(t) {
      const prev = t.id ? store.tasks.find(x => x.id === t.id) : undefined
      const status = t.status ?? prev?.status ?? '할 일'
      const completed_at = status === '완료' ? (prev?.status === '완료' ? prev.completed_at : now()) : null
      return upsert<'tasks', Task>('tasks', { ...t, completed_at }, () => ({ ...base(), project_id: null, title: '', assignee_id: null, due_date: null, status: '할 일', memo: null, completed_at: null }) as Task)
    },
    async deleteTask(id) {
      del('tasks', id)
    },

    async listWorkLogs(f) {
      let rows = store.work_logs.filter(x => (!f.date || x.log_date === f.date) && (!f.userId || x.user_id === f.userId) && (!f.clientId || x.client_id === f.clientId) && (!f.projectId || x.project_id === f.projectId))
      rows = rows.sort((a, b) => (f.date ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)))
      if (f.limit) rows = rows.slice(0, f.limit)
      return clone(rows)
    },
    async saveWorkLog(l) {
      const self = requireMe()
      if (l.id) {
        const prev = store.work_logs.find(x => x.id === l.id)
        if (!prev || (prev.user_id !== self && !isAdmin())) throw new ApiError('권한이 없습니다.')
      }
      return upsert<'work_logs', WorkLog>('work_logs', l, () => ({ user_id: self, log_date: todayKey(), kind: '업무', content: '', email_counterpart: null, email_subject: null, client_id: null, project_id: null, minutes: null, created_at: now(), updated_at: now() }) as WorkLog)
    },
    async deleteWorkLog(id) {
      const self = requireMe()
      del('work_logs', id, () => isAdmin() || store.work_logs.some(x => x.id === id && x.user_id === self))
    },
    async countWorkLogs(today) {
      return { today: store.work_logs.filter(x => x.log_date === today).length, total: store.work_logs.length + 3468 }
    },

    async listRooms() {
      const self = requireMe()
      const rows: ChatRoomSummary[] = store.chat_rooms
        .filter(r => !r.is_archived)
        .map(r => {
          const msgs = store.chat_messages.filter(m => m.room_id === r.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
          const last = msgs[msgs.length - 1]
          const read = store.chat_reads.find(x => x.room_id === r.id && x.user_id === self)?.last_read_at ?? ''
          return { ...r, last_content: last?.content ?? null, last_at: last?.created_at ?? null, last_user_id: last?.user_id ?? null, unread: msgs.filter(m => m.user_id !== self && m.created_at > read).length }
        })
      return clone(rows.sort((a, b) => (b.last_at ?? b.created_at).localeCompare(a.last_at ?? a.created_at)))
    },
    async createRoom(r) {
      if (store.chat_rooms.some(x => x.name === r.name)) throw new ApiError('이미 같은 이름이 있습니다.')
      const room: ChatRoom = { id: uid(), name: r.name, description: r.description ?? null, project_id: r.project_id ?? null, is_archived: false, created_by: me, created_at: now() }
      store.chat_rooms.push(room)
      persist()
      emit('chat_rooms')
      return clone(room)
    },
    async listMessages(roomId, limit = 150) {
      return clone(store.chat_messages.filter(m => m.room_id === roomId).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-limit))
    },
    async sendMessage(roomId, content) {
      const msg: ChatMessage = { id: ++store.seq + 1000, room_id: roomId, user_id: requireMe(), content, created_at: now(), edited_at: null }
      store.chat_messages.push(msg)
      persist()
      emit('chat_messages', { type: 'INSERT', message: msg } satisfies MessageEvent)
      return clone(msg)
    },
    async deleteMessage(id) {
      const self = requireMe()
      const msg = store.chat_messages.find(m => m.id === id)
      if (!msg || (msg.user_id !== self && !isAdmin())) throw new ApiError('권한이 없습니다.')
      store.chat_messages = store.chat_messages.filter(m => m.id !== id)
      persist()
      emit('chat_messages', { type: 'DELETE', message: msg } satisfies MessageEvent)
    },
    async markRead(roomId) {
      const self = requireMe()
      const r = store.chat_reads.find(x => x.room_id === roomId && x.user_id === self)
      if (r) r.last_read_at = now()
      else store.chat_reads.push({ user_id: self, room_id: roomId, last_read_at: now() })
      persist()
      emit('chat_reads')
    },
    subscribeMessages(roomId, cb) {
      const h = (e: Event) => {
        const detail = (e as CustomEvent<MessageEvent>).detail
        if (detail && (!roomId || detail.message.room_id === roomId)) cb(detail)
      }
      bus.addEventListener('chat_messages', h)
      return () => bus.removeEventListener('chat_messages', h)
    },

    async listApprovals() {
      const self = requireMe()
      return clone(
        store.approvals
          .filter(a => isAdmin() || a.requested_by === self || a.approver_id === self)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(withCanDecide),
      )
    },
    async createApproval(a) {
      const self = requireMe()
      const row: Approval = { id: uid(), kind: '기타', title: '', content: null, payload: {}, target_id: null, amount: null, approver_id: null, decided_by: null, decided_at: null, decision_comment: null, created_at: now(), updated_at: now(), ...a, requested_by: self, status: '대기' } as Approval
      store.approvals.push(row)
      persist()
      emit('approvals')
      return clone(withCanDecide(row))
    },
    async decideApproval(id, status, comment) {
      const self = requireMe()
      const a = store.approvals.find(x => x.id === id)
      if (!a || a.status !== '대기') throw new ApiError('권한이 없거나 이미 처리된 항목입니다.')
      if (!withCanDecide(a).can_decide) throw new ApiError('권한이 없습니다.')
      if (a.requested_by === self && !isAdmin()) throw new ApiError('본인 요청은 처리할 수 없습니다.')
      Object.assign(a, { status, decision_comment: comment || null, decided_by: self, decided_at: now(), updated_at: now() })
      persist()
      emit('approvals')
    },
    async cancelApproval(id) {
      const self = requireMe()
      const a = store.approvals.find(x => x.id === id)
      if (!a || a.status !== '대기' || a.requested_by !== self) throw new ApiError('권한이 없거나 이미 처리된 항목입니다.')
      a.status = '취소'
      a.updated_at = now()
      persist()
      emit('approvals')
    },
    subscribeChanges(tables, cb) {
      const h = () => cb()
      for (const t of tables) bus.addEventListener(t, h)
      return () => {
        for (const t of tables) bus.removeEventListener(t, h)
      }
    },
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
