import { ApiError, type Api, type ImportResult, type MessageEvent } from './api'
import { addDays, nextMonday, toDateKey, todayKey } from './date'
import type {
  AgentToken,
  AppNotification,
  Approval,
  ApprovalRoute,
  BrandContact,
  BudgetLine,
  Attendance,
  HrRecord,
  ChatMessage,
  ChatRoom,
  ChatRoomSummary,
  Client,
  Contact,
  EmailTemplate,
  NotificationKind,
  Payment,
  Profile,
  Project,
  ProjectFinance,
  ResearchItem,
  Task,
  WorkLog,
} from './types'

// Supabase 연결 전 체험용. 데이터는 이 브라우저(localStorage)에만 저장된다.
// 권한 규칙과 알림 트리거는 DB(RLS·트리거)를 단순화해 흉내 낸다.

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
  approval_routes: ApprovalRoute[]
  finances: ProjectFinance[]
  payments: Payment[]
  budget_lines: BudgetLine[]
  research_items: ResearchItem[]
  brand_contacts: BrandContact[]
  email_templates: EmailTemplate[]
  agent_tokens: AgentToken[]
  notifications: AppNotification[]
  /** 예전 체험 데이터에는 없을 수 있음 */
  attendance?: Attendance[]
  hr_records?: HrRecord[]
  seq: number
  /** 하루 한 번 보내는 결제 요약 알림 (서버 daily_digest 흉내) */
  digest_date?: string
}

const KEY = 'wkly-erp-demo-v4'
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
/** 지금부터 n분 뒤 */
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  haneul: '00000000-0000-4000-8000-000000000002',
  doyun: '00000000-0000-4000-8000-000000000003',
  seoyeon: '00000000-0000-4000-8000-000000000004',
  garam: '00000000-0000-4000-8000-000000000005',
  pm: '00000000-0000-4000-8000-000000000006',
}

export const DEMO_USERS = [
  { id: U.admin, email: 'admin@thewklyn.com', label: '관리자 (대표)' },
  { id: U.haneul, email: 'haneul@thewklyn.com', label: '김하늘 (매니저)' },
  { id: U.doyun, email: 'doyun@thewklyn.com', label: '이도윤 (매니저)' },
]


function seed(): Store {
  const t = todayKey()
  const p = (id: string, name: string, role: 'admin' | 'member', title: string, status: Profile['today_status'], msg: string, email: string, is_agent = false): Profile => ({
    id, email, name, role, active: true, title, today_status: status, status_message: msg, status_updated_at: at(0, '08:50'), is_agent, created_at: at(-30, '09:00'),
  })
  const profiles = [
    p(U.admin, '관리자', 'admin', '대표', '출근', '이번 주 팝업 철수 3건. 다들 화이팅!', 'admin@thewklyn.com'),
    p(U.haneul, '김하늘', 'member', '매니저', '외근', '오후엔 성수 현장에 있어요.', 'haneul@thewklyn.com'),
    p(U.doyun, '이도윤', 'member', '매니저', '미팅', '루프앤코 미팅 15:00', 'doyun@thewklyn.com'),
    p(U.seoyeon, '박서연', 'member', '에디터', '출근', '3주차 원고 마감 데이 ✍️', 'seoyeon@thewklyn.com'),
    p(U.garam, '최가람', 'member', '인턴', '휴가', '내일 복귀합니다', 'garam@thewklyn.com'),
    p(U.pm, 'WKLY 총괄', 'member', '프로젝트 총괄 (AI)', '출근', '매일 08:30 할 일을 나누고, 18:00에 일일 보고를 올려요.', 'agent@thewklyn.com', true),
  ]
  const c = (name: string, category: Client['category'], extra: Partial<Client> = {}): Client => ({
    id: uid(), name, category, business_no: null, phone: null, email: null, address: null, website: null, memo: null, created_by: U.admin, created_at: at(-40, '10:00'), updated_at: at(-40, '10:00'), ...extra,
  })
  const objet = c('오브제랩', '클라이언트', { business_no: '123-45-67890', phone: '02-1234-5678', email: 'hello@objetlab.example', address: '서울 성동구 성수이로 00, 2층', memo: '현장 담당 정민지 매니저 · 정산은 월말 일괄' })
  const loop = c('루프앤코', '클라이언트', { phone: '02-2222-3333', email: 'team@loopnco.example' })
  const green = c('그린테이블', '협력사', { email: 'sales@greentable.example', memo: '설치·집기 렌탈' })
  const high = c('하이브로우 스튜디오', '협력사', { phone: '02-555-0000', memo: '촬영 스튜디오' })
  const mono = c('모노웍스', '협력사', { memo: '모델·편집 외주' })
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

  const plant: ResearchItem = {
    id: uid(), kind: '팝업', title: "성수 '플랜트 하우스' 팝업 오픈", summary: '식물 공방 클래스 + 굿즈 판매 체험형 팝업. 주말 예약제, 사전 예약 30분 만에 마감.',
    body: '기간: 오픈 후 2주\n장소: 서울 성동구 연무장길\n공개 연락처: collab@plant-house.example (협업 문의)\n활용: 주간 핫 마케팅 후보 · 팝업스케줄 게시',
    source_url: 'https://plant-house.example/press', source_name: '공식 보도자료', brand_name: '플랜트 하우스', tags: ['성수', '라이프스타일', '체험형'], status: '새 자료',
    client_id: null, project_id: null, collected_by_agent: '팝업스케줄 리서치', created_by: null, created_at: at(0, '09:12'), updated_at: at(0, '09:12'),
  }
  const research_items: ResearchItem[] = [
    plant,
    { id: uid(), kind: '브랜드', title: '루미에르 코스메틱 첫 오프라인 행사', summary: '뷰티 브랜드 첫 팝업. 보도자료에 협업 담당 이메일 공개.', body: null, source_url: 'https://lumiere.example/news/popup', source_name: '보도자료', brand_name: '루미에르 코스메틱', tags: ['뷰티', '첫팝업'], status: '새 자료', client_id: null, project_id: null, collected_by_agent: '팝업스케줄 리서치', created_by: null, created_at: at(0, '09:10'), updated_at: at(0, '09:10') },
    { id: uid(), kind: '트렌드', title: '10월 3주차 핫 마케팅 사례 5선', summary: '굿즈·체험형 팝업 강세, 예약제 운영이 늘어나는 흐름.', body: null, source_url: null, source_name: '마케팅 사례 에이전트', brand_name: null, tags: ['주간핫마케팅'], status: '검토 완료', client_id: null, project_id: weekly.id, collected_by_agent: '마케팅 사례', created_by: null, created_at: at(0, '08:55'), updated_at: at(0, '09:30') },
    { id: uid(), kind: '인터뷰', title: '오브제랩 대표 인터뷰 녹취 요약', summary: '공간 기획 의도 3가지와 방문객 동선 설계 이유.', body: null, source_url: 'https://drive.google.com/', source_name: 'Google Drive', brand_name: '오브제랩', tags: ['인터뷰'], status: '활용', client_id: objet.id, project_id: objetWeek.id, collected_by_agent: null, created_by: U.seoyeon, created_at: at(-1, '16:00'), updated_at: at(-1, '16:00') },
    { id: uid(), kind: '경쟁사', title: '경쟁 매거진 팝업 리뷰 포맷 비교', summary: '카드뉴스 8장 구성, 마지막 장 예약 링크 배치.', body: null, source_url: null, source_name: null, brand_name: null, tags: ['포맷'], status: '보관', client_id: null, project_id: null, collected_by_agent: null, created_by: U.admin, created_at: at(-6, '11:00'), updated_at: at(-6, '11:00') },
  ]

  const tk = (project: Project | null, title: string, assignee: string, due: number, status: Task['status'], extra: Partial<Task> = {}): Task => ({
    id: uid(), project_id: project?.id ?? null, title, assignee_id: assignee, due_date: addDays(t, due), status, memo: null, completed_at: status === '완료' ? at(-1, '18:00') : null,
    remind_at: null, reminded_at: null, source_research_id: null, created_by: U.admin, created_at: at(-5, '10:00'), updated_at: at(-1, '10:00'), ...extra,
  })
  const tasks = [
    tk(objetWeek, '현장 사진 1차 셀렉', U.haneul, 0, '진행 중'), tk(autumn, '캠페인 2차 카피 컨펌 요청', U.doyun, 0, '할 일'), tk(weekly, '3주차 원고 마감', U.seoyeon, 0, '할 일'),
    tk(objetWeek, '팝업 철수 일정 협의', U.haneul, 2, '할 일', { remind_at: `${addDays(t, 2)}T01:00:00.000Z` }),
    tk(autumn, '인플루언서 리스트 정리', U.doyun, -2, '할 일', { created_by: U.pm }),
    tk(yeouido, '정산 자료 요청 메일', U.admin, 0, '할 일', { remind_at: inMinutes(90) }),
    tk(null, '플랜트 하우스 협업 제안 메일', U.admin, 0, '진행 중', { source_research_id: plant.id, created_by: U.pm, remind_at: inMinutes(150) }),
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
  const y = addDays(t, -1)
  const approvals = [
    ap('일일 보고', `${y.slice(5).replace('-', '/')} 프로젝트 일일 보고`, U.pm, [0, '08:30'], {
      payload: { date: y },
      content: [
        '■ 오늘 요약',
        '진행 프로젝트 2 · 오늘 완료한 할 일 1 · 지연 1 · 새 리서치 2',
        '',
        '■ 프로젝트별 현황',
        "· 성수 팝업 '오브제 위크' (할 일 1/5) — 철수 일정 안내 완료, 철수 준비 중",
        '· 가을 시즌 인스타 캠페인 (할 일 0/4) — 릴스 3편 추가 확정, 중도금 입금 지연',
        '',
        '■ 이슈 · 리스크',
        '· 루프앤코 중도금 1,520만 원 입금 지연 — 관리자 확인 필요',
        '· 하이브로우 촬영 일정 변경 → 캠페인 일정 재조정',
        '',
        '■ 내일 할 일 (배정 완료)',
        '· 김하늘 — 팝업 철수 일정 협의',
        '· 이도윤 — 인플루언서 리스트 정리 (지연)',
        '· 관리자 — 플랜트 하우스 협업 제안 메일 (리서치에서 만든 할 일)',
        '',
        '■ 새로 모은 자료 활용 제안',
        '· 플랜트 하우스 팝업 → 주간 핫 마케팅 후보, 협업 담당 이메일 확보',
      ].join('\n'),
    }),
    ap('업무 보고', `${t.slice(5).replace('-', '/')} 업무 보고 (기록 3건 · 1시간 5분)`, U.haneul, [0, '10:58'], { payload: { date: t, user_id: U.haneul } }),
    ap('메일 발송', '[오브제 위크] 철수 일정 안내 메일', U.haneul, [0, '10:31'], { approver_id: U.admin, payload: { to: 'minji@objetlab.example', subject: '[오브제 위크] 철수 일정 안내', body: '안녕하세요, 더위클리 김하늘입니다.\n오브제 위크 팝업 철수 일정과 원상복구 체크리스트를 공유드립니다. 확인 부탁드립니다.' } }),
    ap('지출', '촬영 소품 구매', U.doyun, [0, '09:44'], { amount: 128000, content: '가을 캠페인 릴스 촬영용 소품 (테이블 소품 6종)', payload: { project_id: autumn.id, payee: '소품하우스', category: '촬영 소품', contract_type: '카드' } }),
    ap('프로젝트', "신규: 연남 팝업 '페이퍼 마켓' 등록", U.seoyeon, [-1, '17:20'], { target_id: paper.id, content: '하이브로우 스튜디오 공동 기획 · 11월 오픈 예정' }),
    ap('업무 보고', `${y.slice(5).replace('-', '/')} 업무 보고 (기록 6건)`, U.doyun, [-1, '18:30'], { status: '승인', decided_by: U.admin, decided_at: at(-1, '19:00'), payload: { date: y, user_id: U.doyun } }),
    ap('메일 발송', '그린테이블 견적 조정 요청', U.haneul, [-3, '15:00'], { status: '반려', decided_by: U.admin, decided_at: at(-3, '16:00'), decision_comment: '금액 근거 자료 첨부 후 다시 요청해 주세요.', payload: { to: 'sales@greentable.example', subject: '견적 조정 요청', body: '설치 견적 조정 가능 여부 문의드립니다.' } }),
  ]
  const approval_routes: ApprovalRoute[] = [
    { kind: '업무 보고', approver_id: U.haneul, updated_at: at(-10, '10:00') },
    { kind: '메일 발송', approver_id: U.admin, updated_at: at(-10, '10:00') },
  ]
  const fin = (p: Project, contract: number, budget: number, target: number): ProjectFinance => ({ project_id: p.id, contract_amount: contract, budget_cost: budget, target_margin: target, memo: null, updated_by: U.admin, created_at: at(-20, '10:00'), updated_at: at(-1, '10:00') })
  const finances = [fin(objetWeek, 45_000_000, 32_000_000, 30), fin(autumn, 38_000_000, 28_000_000, 28), fin(paper, 26_000_000, 19_000_000, 25), fin(yeouido, 9_000_000, 6_000_000, 35)]
  /** 공급가액 → VAT 포함 금액 */
  const vatIn = (supply: number) => ({ amount: Math.round(supply * 1.1), vat: Math.round(supply * 0.1) })
  const ACC = (n: number) => ({ bank_name: '국민', account_no: `000000-00-${String(100000 + n).slice(1)}` })
  const pay = (direction: Payment['direction'], p: Project | null, payee: Client | string, title: string, supply: number, status: Payment['status'], due: number, extra: Partial<Payment> = {}): Payment => {
    const client = typeof payee === 'string' ? null : payee
    const dueKey = addDays(t, due)
    const taxed = extra.contract_type === undefined || extra.contract_type === '세금계산서'
    const money = taxed ? vatIn(supply) : { amount: supply, vat: 0 }
    return {
      id: uid(), direction, project_id: p?.id ?? null, client_id: client?.id ?? null, budget_line_id: null, approval_id: null,
      category: null, title, payee: client?.name ?? (payee as string), contract_type: '세금계산서', stage: null, ...money,
      tax_invoice: taxed ? (status === '완료' ? '발행' : '미발행') : '해당 없음', tax_invoice_date: null, status, is_estimate: false,
      requested_date: direction === '지급' ? addDays(dueKey, -7) : null, due_date: dueKey, paid_date: status === '완료' ? dueKey : null,
      advance_by: null, bank_name: null, account_no: null, account_holder: null, memo: null, created_by: U.admin, created_at: at(-20, '10:00'), updated_at: at(-1, '10:00'),
      ...extra,
    }
  }
  const labor = (p: Project, name: string, item: string, amount: number, type: Payment['contract_type'], status: Payment['status'], due: number, n: number) =>
    pay('지급', p, name, item, amount, status, due, { category: '노무비', contract_type: type, account_holder: name, ...ACC(n) })
  const adv = (p: Project, payee: string, item: string, amount: number, day: number) =>
    pay('지급', p, payee, item, amount, '예정', 4, { category: '운영비', contract_type: '카드', advance_by: '정우진 (현장 실장)', requested_date: addDays(t, day), memo: '현장 실장 개인 카드 결제 · 영수증 제출' })
  const payments = [
    // 오브제 위크: 엑셀 결제 대장과 같은 항목 (공사 구분·업체·계약형태·VAT·대지급·예상 비용·환불)
    pay('수금', objetWeek, objet, '1차 선금 50%', 22_500_000, '완료', -11, { stage: '선금', tax_invoice_date: addDays(t, -12) }),
    pay('수금', objetWeek, objet, '잔금 50%', 22_500_000, '예정', 19, { stage: '잔금' }),
    pay('지급', objetWeek, green, '설치·집기 렌탈', 12_000_000, '완료', -4, { category: '설치·집기', stage: '일시불', ...ACC(1), account_holder: '그린테이블(주)' }),
    pay('지급', objetWeek, green, '집기 보증금 환불', -500_000, '완료', -1, { category: '설치·집기', stage: '환불', contract_type: '기타', memo: '파손 없음 · 보증금 환불' }),
    pay('지급', objetWeek, green, '철수·원상복구', 6_800_000, '대기', 15, { category: '철수·원상복구', stage: '잔금', ...ACC(2), account_holder: '그린테이블(주)', memo: '철수 완료 확인 후 지급' }),
    pay('지급', objetWeek, high, '현장 사진 촬영', 11_700_000, '예정', 8, { category: '촬영', ...ACC(3), account_holder: '하이브로우 스튜디오' }),
    labor(objetWeek, '정우진', '설치 목공', 450_000, '일용근로', '완료', -3, 4),
    labor(objetWeek, '한지호', '설치 목공', 450_000, '일용근로', '완료', -3, 5),
    labor(objetWeek, '오태민', '전기 배선', 300_000, '사업소득(3.3%)', '예정', 4, 6),
    pay('지급', objetWeek, '모던인력(주)', '현장 운영 스태프 2인', 600_000, '예정', 4, { category: '노무비', ...ACC(7), account_holder: '주식회사 모던인력' }),
    adv(objetWeek, '동네철물', '철물·소모품', 86_000, -3), adv(objetWeek, '퀵다방', '퀵 배송', 33_000, -2), adv(objetWeek, '현장 식대', '설치일 식대 (6인)', 54_000, -3),
    pay('지급', objetWeek, '현장 운영비', '현장 운영 인건비 (예상)', 600_000, '예정', 14, { category: '운영비', contract_type: '기타', is_estimate: true, memo: '철수일 추가 인력 예상' }),
    // 가을 캠페인
    pay('수금', autumn, loop, '착수금 30%', 11_400_000, '완료', -25, { stage: '계약금' }), pay('수금', autumn, loop, '중도금 40%', 15_200_000, '청구', -5, { stage: '중도금' }),
    pay('수금', autumn, loop, '잔금 30%', 11_400_000, '예정', 25, { stage: '잔금' }),
    pay('지급', autumn, high, '캠페인 촬영비 1차', 6_400_000, '예정', -2, { category: '촬영', stage: '선금' }),
    pay('지급', autumn, mono, '모델·스타일링', 9_000_000, '완료', -9, { category: '모델·스타일링', tax_invoice: '미발행', memo: '세금계산서 아직 못 받음' }),
    pay('지급', autumn, mono, '릴스 편집 외주', 14_100_000, '예정', 20, { category: '편집' }),
    // 여의도 (완료)
    pay('수금', yeouido, green, '콘텐츠 제작비', 9_000_000, '완료', -15), pay('지급', yeouido, high, '촬영·편집', 5_200_000, '완료', -12, { category: '촬영' }),
    // 지난 달들 (월별 차트용)
    pay('수금', null, loop, '8월 콘텐츠 제작비', 31_000_000, '완료', -45), pay('지급', null, mono, '8월 외주 편집', 18_000_000, '완료', -48, { category: '편집' }),
    pay('수금', null, objet, '9월 팝업 기획비', 24_000_000, '완료', -20), pay('지급', null, green, '9월 집기 렌탈', 16_000_000, '완료', -22, { category: '설치·집기' }),
    pay('수금', null, loop, '7월 캠페인 잔금', 15_000_000, '완료', -80), pay('지급', null, high, '7월 촬영', 11_000_000, '완료', -78, { category: '촬영' }),
    pay('수금', null, objet, '6월 팝업 운영비', 26_000_000, '완료', -110), pay('지급', null, green, '6월 시공', 15_000_000, '완료', -105, { category: '설치·집기' }),
    pay('수금', null, loop, '5월 콘텐츠 제작비', 18_000_000, '완료', -140), pay('지급', null, mono, '5월 외주', 9_000_000, '완료', -138, { category: '편집' }),
  ]
  const bl = (p: Project, category: string, budget: number, payee: string | null, order: number, contract: number | null = null): BudgetLine => ({
    id: uid(), project_id: p.id, category, item: null, payee, budget_amount: budget, contract_amount: contract, sort_order: order, memo: null, created_by: U.admin, created_at: at(-20, '10:00'), updated_at: at(-20, '10:00'),
  })
  const budget_lines = [
    bl(objetWeek, '설치·집기', 12_500_000, '그린테이블', 1, 12_000_000), bl(objetWeek, '촬영', 11_000_000, '하이브로우 스튜디오', 2, 11_700_000), bl(objetWeek, '철수·원상복구', 5_500_000, '그린테이블', 3, 6_800_000),
    bl(objetWeek, '노무비', 2_000_000, null, 4), bl(objetWeek, '운영비', 1_000_000, null, 5),
    bl(autumn, '촬영', 7_000_000, '하이브로우 스튜디오', 1), bl(autumn, '모델·스타일링', 8_000_000, '모노웍스', 2), bl(autumn, '편집', 13_000_000, '모노웍스', 3),
  ]
  const bc = (brand_name: string, contact_name: string | null, email: string, source_type: BrandContact['source_type'], status: BrandContact['status'], extra: Partial<BrandContact> = {}): BrandContact => ({
    id: uid(), brand_name, contact_name, title: null, email, phone: null, source_type, source_url: null, source_note: null, status, opt_out: false, opt_out_at: null, client_id: null, research_item_id: null, last_contacted_at: null, memo: null, tags: [], collected_by_agent: null, created_by: U.admin, created_at: at(-7, '10:00'), updated_at: at(-7, '10:00'), ...extra,
  })
  const brand_contacts = [
    bc('플랜트 하우스', '협업 담당', 'collab@plant-house.example', '에이전트 리서치', '신규', { source_url: 'https://plant-house.example/press', research_item_id: plant.id, collected_by_agent: '팝업스케줄 리서치', created_by: null, created_at: at(0, '09:12') }),
    bc('루미에르 코스메틱', '김소라 매니저', 'sora@lumiere.example', '보도자료', '연락함', { source_url: 'https://lumiere.example/news/popup', last_contacted_at: at(-4, '14:00') }),
    bc('오브제랩', '정민지 매니저', 'minji@objetlab.example', '명함·미팅', '거래 전환', { client_id: objet.id, last_contacted_at: at(0, '10:42') }),
    bc('노마드 커피', '마케팅팀', 'hello@nomad.example', '받은 메일', '회신', { source_note: '협업 문의 메일 수신 (10.09)', last_contacted_at: at(-2, '11:00') }),
    bc('스튜디오 휴', '박지원 실장', 'jiwon@studiohue.example', '공식 홈페이지', '보류', { opt_out: true, opt_out_at: at(-12, '09:00'), source_url: 'https://studiohue.example/contact', last_contacted_at: at(-12, '09:00') }),
  ]
  const tpl = (name: string, subject: string, body: string, is_ad: boolean): EmailTemplate => ({ id: uid(), name, subject, body, is_ad, created_by: U.admin, created_at: at(-30, '10:00'), updated_at: at(-30, '10:00') })
  const email_templates = [
    tpl('팝업 협업 제안 (광고)', '[더위클리] {{브랜드}} 팝업 협업 제안드립니다', '안녕하세요, {{브랜드}} {{담당자}}님.\n팝업 기획 매거진 더위클리의 {{보내는사람}}입니다.\n최근 진행하신 팝업을 주간 핫 마케팅 사례로 소개하고, 다음 팝업 기획을 함께 하고 싶어 연락드렸습니다.\n편하신 시간에 20분 정도 통화 가능하실까요?\n\n감사합니다.\n{{보내는사람}} 드림', true),
    tpl('인터뷰 요청', '[더위클리] {{브랜드}} 팝업 인터뷰 요청', '안녕하세요, {{담당자}}님.\n더위클리 {{보내는사람}}입니다. {{브랜드}} 팝업의 기획 의도를 독자들에게 소개하고 싶어 짧은 서면 인터뷰를 요청드립니다.\n질문은 5개 이내이며, 원고는 게재 전 확인받겠습니다.\n\n감사합니다.', false),
  ]
  const agent_tokens: AgentToken[] = [
    { id: uid(), name: '팝업스케줄 리서치', profile_id: null, scopes: ['research', 'contact'], token_hint: '9f2a', created_by: U.admin, created_at: at(-14, '10:00'), last_used_at: at(0, '09:12'), revoked_at: null },
    { id: uid(), name: 'WKLY 총괄 · ERP', profile_id: U.pm, scopes: ['read', 'task', 'daily_report', 'notify', 'research', 'finance'], token_hint: '41c7', created_by: U.admin, created_at: at(-14, '10:05'), last_used_at: at(0, '08:30'), revoked_at: null },
  ]
  let nseq = 0
  const nt = (user: string, kind: NotificationKind, title: string, body: string | null, link: string | null, time: [number, string], read = false): AppNotification => ({ id: ++nseq, user_id: user, kind, title, body, link, created_at: at(time[0], time[1]), read_at: read ? at(time[0], time[1]) : null })
  const notifications = [
    nt(U.admin, '일일 보고', `일일 보고 도착 · ${y.slice(5).replace('-', '/')} 프로젝트 일일 보고`, 'WKLY 총괄 · 확인이 필요해요', '/approvals', [0, '08:30']),
    nt(U.admin, '할 일', '새 할 일 배정 · 플랜트 하우스 협업 제안 메일', 'WKLY 총괄이 리서치에서 만들어 배정했어요', '/projects?view=mine', [0, '08:31']),
    nt(U.admin, '승인', '승인 요청 · 촬영 소품 구매', '이도윤 · 128,000원', '/approvals', [0, '09:44']),
    nt(U.doyun, '할 일', '새 할 일 배정 · 인플루언서 리스트 정리', 'WKLY 총괄이 배정했어요', '/projects?view=mine', [-3, '08:30']),
    nt(U.haneul, '승인', '반려됨 · 그린테이블 견적 조정 요청', '금액 근거 자료 첨부 후 다시 요청해 주세요.', '/approvals?view=mine', [-3, '16:00'], true),
  ]
  // 근태: 오늘은 최가람이 아직 접속 전 → 미출근으로 보임
  const att = (user: string, d: number, first: string, last: string): Attendance => ({ user_id: user, day: addDays(t, d), first_at: at(d, first), last_at: at(d, last) })
  const attendance = [
    att(U.haneul, 0, '08:42', '10:40'), att(U.doyun, 0, '08:55', '10:20'), att(U.seoyeon, 0, '09:10', '10:35'),
    ...[U.admin, U.haneul, U.doyun, U.seoyeon, U.garam].map((u, i) => att(u, -1, `0${8 + (i % 2)}:${10 + i * 7}`, '18:2' + i)),
  ]
  const chat_reads = [all, rObjet].map(r => ({ user_id: U.admin, room_id: r.id, last_read_at: at(0, '10:50') }))
  return {
    profiles, clients, contacts, projects, tasks, work_logs, chat_rooms: [all, rObjet, rAutumn, rContent], chat_messages, chat_reads, approvals, approval_routes,
    finances, payments, budget_lines, research_items, brand_contacts, email_templates, agent_tokens, notifications, attendance, seq: Math.max(seq, nseq) + 100,
  }
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
  const meProfile = () => store.profiles.find(p => p.id === me)
  const isAdmin = () => store.profiles.some(p => p.id === me && p.role === 'admin' && p.active)
  const requireAdmin = () => {
    if (!isAdmin()) throw new ApiError('관리자만 할 수 있습니다.')
  }
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
  const nameOf = (id: string | null | undefined) => store.profiles.find(p => p.id === id)?.name ?? '누군가'

  // ---------- 알림 (DB 트리거 흉내) ----------
  const notify = (userId: string | null | undefined, kind: NotificationKind, title: string, body: string | null, link: string | null) => {
    const target = store.profiles.find(p => p.id === userId)
    if (!target || !target.active || target.is_agent) return
    store.notifications.push({ id: ++store.seq, user_id: target.id, kind, title, body, link, created_at: now(), read_at: null })
    emit('notifications')
  }
  const adminsExcept = (exclude: string | null) => store.profiles.filter(p => p.role === 'admin' && p.active && !p.is_agent && p.id !== exclude)
  /** 알람 시각이 지난 할 일 → 알림 (서버의 예약 작업 역할) */
  const runReminders = () => {
    const nowIso = now()
    let changed = false
    for (const t of store.tasks) {
      if (t.remind_at && !t.reminded_at && t.remind_at <= nowIso && t.status !== '완료' && t.assignee_id) {
        t.reminded_at = nowIso
        notify(t.assignee_id, '알람', `알람 · ${t.title}`, t.due_date ? `마감 ${t.due_date.slice(5).replace('-', '.')}` : null, '/projects?view=mine')
        changed = true
      }
    }
    if (changed) persist()
  }

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
  const paymentDefaults = (): Payment => ({
    ...base(), id: '', direction: '지급', project_id: null, client_id: null, budget_line_id: null, approval_id: null, category: null, title: '', payee: null, contract_type: null, stage: null,
    amount: 0, vat: 0, tax_invoice: '미발행', tax_invoice_date: null, status: '예정', is_estimate: false, requested_date: todayKey(), due_date: null, paid_date: null, advance_by: null,
    bank_name: null, account_no: null, account_holder: null, memo: null,
  })
  /** payments 트리거: 지급예정일(차주 월요일) · 지급일 · VAT 범위 */
  const paymentRules = (row: Payment): Payment => {
    if (row.vat && (Math.sign(row.vat) !== Math.sign(row.amount) || Math.abs(row.vat) > Math.abs(row.amount))) throw new ApiError('부가세가 금액보다 클 수 없습니다.')
    const due_date = row.direction === '지급' && !row.due_date && row.requested_date ? nextMonday(row.requested_date) : row.due_date
    const paid_date = row.status === '완료' ? row.paid_date ?? todayKey() : null
    return { ...row, due_date, paid_date }
  }
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
      const p = store.profiles.find(x => x.email?.toLowerCase() === email.trim().toLowerCase() && !x.is_agent) ?? store.profiles.find(x => x.role === 'admin')
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
      if ((patch.role !== undefined || patch.active !== undefined || patch.is_agent !== undefined) && !isAdmin()) throw new ApiError('권한(role)과 활성 상태(active)는 관리자만 변경할 수 있습니다.')
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
      for (const p of store.payments) if (p.client_id === id) p.client_id = null
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
      store.finances = store.finances.filter(x => x.project_id !== id)
      store.budget_lines = store.budget_lines.filter(x => x.project_id !== id)
      for (const p of store.payments) if (p.project_id === id) p.project_id = null
      persist()
    },
    async listTasks(f = {}) {
      runReminders()
      return clone(
        store.tasks
          .filter(x => (!f.projectId || x.project_id === f.projectId) && (!f.from || (x.due_date ?? '') >= f.from) && (!f.to || (x.due_date && x.due_date <= f.to)))
          .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
      )
    },
    async saveTask(t) {
      const self = requireMe()
      const prev = t.id ? store.tasks.find(x => x.id === t.id) : undefined
      const status = t.status ?? prev?.status ?? '할 일'
      const completed_at = status === '완료' ? (prev?.status === '완료' ? prev.completed_at : now()) : null
      const patch: Partial<Task> = { ...t, completed_at }
      if (t.remind_at !== undefined && t.remind_at !== prev?.remind_at) patch.reminded_at = null
      const saved = upsert<'tasks', Task>('tasks', patch, () => ({ ...base(), project_id: null, title: '', assignee_id: null, due_date: null, status: '할 일', memo: null, completed_at: null, remind_at: null, reminded_at: null, source_research_id: null }) as Task)
      if (saved.assignee_id && saved.assignee_id !== self && saved.assignee_id !== prev?.assignee_id) {
        notify(saved.assignee_id, '할 일', `새 할 일 배정 · ${saved.title}`, `${nameOf(self)}님이 배정했어요`, '/projects?view=mine')
        persist()
      }
      return saved
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
      const room = store.chat_rooms.find(r => r.id === roomId)
      for (const p of store.profiles) if (p.id !== msg.user_id && content.includes(`@${p.name}`)) notify(p.id, '멘션', `${nameOf(msg.user_id)}님이 언급했어요 · ${room?.name ?? '채팅'}`, content.slice(0, 80), `/chat?room=${roomId}`)
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
      let approver = a.approver_id ?? null
      if (!approver) {
        const route = store.approval_routes.find(r => r.kind === a.kind)?.approver_id ?? null
        approver = route && route !== self && store.profiles.some(p => p.id === route && p.active) ? route : null
      }
      const row: Approval = { id: uid(), kind: '기타', title: '', content: null, payload: {}, target_id: null, amount: null, decided_by: null, decided_at: null, decision_comment: null, created_at: now(), updated_at: now(), ...a, approver_id: approver, requested_by: self, status: '대기' } as Approval
      store.approvals.push(row)
      const kind: NotificationKind = row.kind === '일일 보고' ? '일일 보고' : '승인'
      const title = `${row.kind === '일일 보고' ? '일일 보고 도착' : '승인 요청'} · ${row.title}`
      if (approver) notify(approver, kind, title, nameOf(self), '/approvals')
      else for (const p of adminsExcept(self)) notify(p.id, kind, title, nameOf(self), '/approvals')
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
      if (status === '승인' && a.kind === '지출' && a.amount && !store.payments.some(x => x.approval_id === a.id)) {
        const pl = a.payload as Record<string, unknown>
        const str = (k: string) => (typeof pl[k] === 'string' && pl[k] ? (pl[k] as string) : null)
        const projectId = str('project_id') ?? (a.target_id && store.projects.some(x => x.id === a.target_id) ? a.target_id : null)
        store.payments.push(
          paymentRules({
            ...paymentDefaults(), id: uid(), created_by: a.requested_by, direction: '지급', project_id: projectId, title: a.title, amount: a.amount, approval_id: a.id,
            category: str('category'), payee: str('payee'), contract_type: (str('contract_type') as Payment['contract_type']) ?? null, stage: str('stage'),
            bank_name: str('bank_name'), account_no: str('account_no'), account_holder: str('account_holder'), requested_date: a.created_at.slice(0, 10), memo: '지출 승인에서 등록',
          }),
        )
        emit('payments')
      }
      notify(a.requested_by, '승인', `${status === '승인' ? (a.kind === '일일 보고' ? '확인됨' : '승인됨') : '반려됨'} · ${a.title}`, comment || `${nameOf(self)}님이 처리했어요`, '/approvals?view=mine')
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
    async listApprovalRoutes() {
      return clone(store.approval_routes)
    },
    async saveApprovalRoute(kind, approverId) {
      requireAdmin()
      const r = store.approval_routes.find(x => x.kind === kind)
      if (r) Object.assign(r, { approver_id: approverId, updated_at: now() })
      else store.approval_routes.push({ kind, approver_id: approverId, updated_at: now() })
      persist()
      emit('approval_routes')
    },
    subscribeChanges(tables, cb) {
      const h = () => cb()
      for (const t of tables) bus.addEventListener(t, h)
      return () => {
        for (const t of tables) bus.removeEventListener(t, h)
      }
    },

    async listFinances() {
      return isAdmin() ? clone(store.finances) : []
    },
    async saveFinance(f) {
      requireAdmin()
      const prev = store.finances.find(x => x.project_id === f.project_id)
      const row: ProjectFinance = { contract_amount: null, budget_cost: null, target_margin: null, memo: null, created_at: now(), ...prev, ...f, updated_by: me, updated_at: now() } as ProjectFinance
      store.finances = [...store.finances.filter(x => x.project_id !== f.project_id), row]
      persist()
      emit('finances')
      return clone(row)
    },
    async listPayments(filter = {}) {
      if (!isAdmin()) return []
      return clone(store.payments.filter(p => (!filter.projectId || p.project_id === filter.projectId) && (!filter.clientId || p.client_id === filter.clientId)).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')))
    },
    async savePayment(p) {
      requireAdmin()
      const prev = p.id ? store.payments.find(x => x.id === p.id) : undefined
      if (p.id && !prev) throw new ApiError('항목을 찾을 수 없습니다.')
      const row = paymentRules({ ...(prev ?? paymentDefaults()), ...p, id: prev?.id ?? uid(), updated_at: now() } as Payment)
      if (prev) Object.assign(prev, row)
      else store.payments.push(row)
      persist()
      emit('payments')
      return clone(row)
    },
    async deletePayment(id) {
      requireAdmin()
      del('payments', id)
    },
    async updatePayments(ids, patch) {
      requireAdmin()
      for (const id of ids) {
        const prev = store.payments.find(x => x.id === id)
        if (!prev) throw new ApiError('항목을 찾을 수 없습니다.')
        Object.assign(prev, paymentRules({ ...prev, ...patch, id, updated_at: now() }))
      }
      persist()
      emit('payments')
    },
    async importPayments(rows, lines = []) {
      requireAdmin()
      for (const b of lines) store.budget_lines.push({ ...base(), id: uid(), project_id: '', category: '', item: null, payee: null, budget_amount: 0, contract_amount: null, sort_order: 0, memo: null, ...b } as BudgetLine)
      for (const r of rows) store.payments.push(paymentRules({ ...paymentDefaults(), ...r, id: uid() } as Payment))
      persist()
      emit('payments')
      return { payments: rows.length, budgetLines: lines.length }
    },
    async listBudgetLines(projectId) {
      if (!isAdmin()) return []
      return clone(store.budget_lines.filter(b => !projectId || b.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order))
    },
    async saveBudgetLine(b) {
      requireAdmin()
      if (b.budget_amount != null && b.budget_amount < 0) throw new ApiError('입력값을 확인해 주세요.')
      return upsert<'budget_lines', BudgetLine>('budget_lines', b, () => ({ ...base(), project_id: '', category: '', item: null, payee: null, budget_amount: 0, contract_amount: null, sort_order: store.budget_lines.length + 1, memo: null }) as BudgetLine)
    },
    async deleteBudgetLine(id) {
      requireAdmin()
      del('budget_lines', id)
      for (const p of store.payments) if (p.budget_line_id === id) p.budget_line_id = null
      persist()
    },

    async adminOverview() {
      requireAdmin()
      const tables: Record<string, number> = {
        profiles: store.profiles.length, clients: store.clients.length, contacts: store.contacts.length, projects: store.projects.length, tasks: store.tasks.length,
        work_logs: store.work_logs.length, chat_rooms: store.chat_rooms.length, chat_messages: store.chat_messages.length, approvals: store.approvals.length,
        payments: store.payments.length, project_finances: store.finances.length, project_budget_lines: store.budget_lines.length, approval_routes: store.approval_routes.length,
        notifications: store.notifications.length, research_items: store.research_items.length, brand_contacts: store.brand_contacts.length, email_templates: store.email_templates.length, agent_tokens: store.agent_tokens.length,
      }
      let bytes = 0
      try {
        bytes = new Blob([JSON.stringify(store)]).size
      } catch {
        bytes = 0
      }
      return { db_size_bytes: 8_400_000 + bytes, active_members: store.profiles.filter(p => p.active).length, tables, generated_at: now() }
    },
    async createMember(m) {
      requireAdmin()
      if (store.profiles.some(p => p.email?.toLowerCase() === m.email.trim().toLowerCase())) throw new ApiError('이미 등록된 이메일입니다.')
      store.profiles.push({ id: uid(), email: m.email.trim(), name: m.name.trim(), role: m.role, active: true, title: m.title ?? null, today_status: '출근', status_message: null, status_updated_at: null, is_agent: m.is_agent, created_at: now() })
      persist()
      emit('profiles')
    },
    async deleteMember(userId) {
      requireAdmin()
      const p = store.profiles.find(x => x.id === userId)
      if (!p) throw new ApiError('계정을 찾을 수 없습니다.')
      if (userId === me) throw new ApiError('본인 계정은 삭제할 수 없습니다.')
      if (p.role === 'admin') throw new ApiError('관리자는 먼저 멤버로 바꾼 뒤 삭제하세요.')
      store.profiles = store.profiles.filter(x => x.id !== userId)
      store.attendance = (store.attendance ?? []).filter(a => a.user_id !== userId)
      store.hr_records = (store.hr_records ?? []).filter(h => h.profile_id !== userId)
      store.notifications = store.notifications.filter(n => n.user_id !== userId)
      store.chat_reads = store.chat_reads.filter(r => r.user_id !== userId)
      for (const l of store.work_logs) if (l.user_id === userId) l.user_id = null
      for (const t of store.tasks) if (t.assignee_id === userId) t.assignee_id = null
      persist()
      emit('profiles')
    },
    async getHrRecord(profileId) {
      requireMe()
      if (profileId !== me && !isAdmin()) return null
      return clone((store.hr_records ?? []).find(h => h.profile_id === profileId) ?? null)
    },
    async saveHrRecord(r) {
      requireAdmin()
      const list = (store.hr_records ??= [])
      const next = { ...r, updated_at: now(), updated_by: me }
      const i = list.findIndex(h => h.profile_id === r.profile_id)
      if (i >= 0) list[i] = next
      else list.push(next)
      persist()
    },
    async resetMemberPassword(userId) {
      requireAdmin() // 체험 모드는 비밀번호 없이 계정을 골라 들어감
      if (!store.profiles.some(p => p.id === userId)) throw new ApiError('계정을 찾을 수 없습니다.')
    },
    async exportTable(table) {
      requireAdmin()
      const map = { ...store, project_finances: store.finances, project_budget_lines: store.budget_lines } as unknown as Record<string, unknown[]>
      return clone((map[table] ?? []) as Record<string, unknown>[])
    },
    async listAgentTokens() {
      requireAdmin()
      return clone([...store.agent_tokens].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },
    async createAgentToken(name, scopes, profileId) {
      requireAdmin()
      const raw = 'wkly_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
      store.agent_tokens.push({ id: uid(), name, profile_id: profileId, scopes, token_hint: raw.slice(-4), created_by: me, created_at: now(), last_used_at: null, revoked_at: null })
      persist()
      emit('agent_tokens')
      return raw
    },
    async revokeAgentToken(id) {
      requireAdmin()
      const t = store.agent_tokens.find(x => x.id === id)
      if (!t) throw new ApiError('항목을 찾을 수 없습니다.')
      t.revoked_at = now()
      persist()
      emit('agent_tokens')
    },

    async listResearch() {
      return clone([...store.research_items].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },
    async saveResearch(r) {
      requireMe()
      return upsert<'research_items', ResearchItem>('research_items', r, () => ({ ...base(), kind: '기타', title: '', summary: null, body: null, source_url: null, source_name: null, brand_name: null, tags: [], status: '새 자료', client_id: null, project_id: null, collected_by_agent: null }) as unknown as ResearchItem)
    },
    async deleteResearch(id) {
      const self = requireMe()
      del('research_items', id, () => isAdmin() || store.research_items.some(x => x.id === id && x.created_by === self))
    },
    async listBrandContacts() {
      return clone([...store.brand_contacts].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },
    async saveBrandContact(c) {
      requireMe()
      const email = c.email?.trim().toLowerCase()
      if (email !== undefined) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('이메일 형식을 확인해 주세요.')
        if (store.brand_contacts.some(x => x.email.toLowerCase() === email && x.id !== c.id)) throw new ApiError('이미 등록된 이메일입니다.')
      }
      const prev = c.id ? store.brand_contacts.find(x => x.id === c.id) : undefined
      const patch: Partial<BrandContact> = { ...c, ...(email !== undefined ? { email } : {}) }
      if (c.opt_out !== undefined && c.opt_out !== prev?.opt_out) patch.opt_out_at = c.opt_out ? now() : null
      return upsert<'brand_contacts', BrandContact>('brand_contacts', patch, () => ({ ...base(), brand_name: '', contact_name: null, title: null, email: '', phone: null, source_type: '기타', source_url: null, source_note: null, status: '신규', opt_out: false, opt_out_at: null, client_id: null, research_item_id: null, last_contacted_at: null, memo: null, tags: [], collected_by_agent: null }) as unknown as BrandContact)
    },
    async deleteBrandContact(id) {
      requireAdmin()
      del('brand_contacts', id)
    },
    async importBrandContacts(rows) {
      requireMe()
      const res: ImportResult = { created: 0, merged: 0, skipped: 0 }
      for (const r of rows) {
        const email = r.email?.trim().toLowerCase()
        if (!email || !r.brand_name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          res.skipped++
          continue
        }
        const prev = store.brand_contacts.find(x => x.email.toLowerCase() === email)
        if (prev) {
          for (const k of ['contact_name', 'title', 'phone', 'source_url', 'source_note', 'memo'] as const) if (!prev[k] && r[k]) (prev as unknown as Record<string, unknown>)[k] = r[k]
          prev.updated_at = now()
          res.merged++
        } else {
          store.brand_contacts.push({ id: uid(), brand_name: r.brand_name.trim(), contact_name: r.contact_name ?? null, title: r.title ?? null, email, phone: r.phone ?? null, source_type: r.source_type ?? '기타', source_url: r.source_url ?? null, source_note: r.source_note ?? null, status: '신규', opt_out: false, opt_out_at: null, client_id: null, research_item_id: null, last_contacted_at: null, memo: r.memo ?? null, tags: [], collected_by_agent: null, created_by: me, created_at: now(), updated_at: now() })
          res.created++
        }
      }
      persist()
      emit('brand_contacts')
      return res
    },
    async listTemplates() {
      return clone([...store.email_templates].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    },
    async saveTemplate(t) {
      requireMe()
      if (t.name && store.email_templates.some(x => x.name === t.name && x.id !== t.id)) throw new ApiError('이미 같은 이름이 있습니다.')
      return upsert<'email_templates', EmailTemplate>('email_templates', t, () => ({ ...base(), name: '', subject: '', body: '', is_ad: true }) as EmailTemplate)
    },
    async deleteTemplate(id) {
      const self = requireMe()
      del('email_templates', id, () => isAdmin() || store.email_templates.some(x => x.id === id && x.created_by === self))
    },

    async listNotifications(limit = 40) {
      const self = requireMe()
      runReminders()
      const today = todayKey()
      if (store.digest_date !== today) {
        store.digest_date = today
        const due = store.payments.filter(x => x.direction === '지급' && !x.is_estimate && (x.status === '예정' || x.status === '대기') && x.due_date && x.due_date <= today)
        const late = store.payments.filter(x => x.direction === '수금' && !x.is_estimate && x.status !== '완료' && x.status !== '취소' && x.due_date && x.due_date < today)
        for (const a of adminsExcept(null)) {
          if (due.length) notify(a.id, '결제', `지급 예정 ${due.length}건 · ${due.reduce((n, x) => n + x.amount, 0).toLocaleString('ko-KR')}원`, '지급예정일이 오늘이거나 지났어요', '/projects?view=payments')
          if (late.length) notify(a.id, '결제', `미수금 ${late.length}건 · ${late.reduce((n, x) => n + x.amount, 0).toLocaleString('ko-KR')}원`, '입금 예정일이 지났어요', '/projects?view=payments&dir=수금')
        }
        persist()
      }
      return clone(store.notifications.filter(n => n.user_id === self).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit))
    },
    async markNotificationsRead(ids) {
      const self = requireMe()
      for (const n of store.notifications) if (n.user_id === self && !n.read_at && (ids === 'all' || ids.includes(n.id))) n.read_at = now()
      persist()
      emit('notifications')
      void meProfile
    },
    async touchAttendance() {
      const self = requireMe()
      const day = todayKey()
      const list = (store.attendance ??= [])
      const row = list.find(a => a.user_id === self && a.day === day)
      if (!row) {
        list.push({ user_id: self, day, first_at: now(), last_at: now() })
        const p = store.profiles.find(x => x.id === self)
        if (p && p.today_status !== '출근' && (!p.status_updated_at || toDateKey(p.status_updated_at) < day)) {
          p.today_status = '출근'
          p.status_updated_at = now()
          emit('profiles')
        }
      } else if (Date.now() - new Date(row.last_at).getTime() > 60_000) row.last_at = now()
      else return
      persist()
      emit('attendance')
    },
    async listAttendance(day) {
      requireMe()
      return clone((store.attendance ?? []).filter(a => a.day === day))
    },
    async listAttendanceFor(userId, fromDay) {
      requireMe()
      return clone((store.attendance ?? []).filter(a => a.user_id === userId && a.day >= fromDay).sort((a, b) => b.day.localeCompare(a.day)))
    },

    async runReminders() {
      const before = store.notifications.length
      runReminders()
      return store.notifications.length - before
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
