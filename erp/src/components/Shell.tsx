import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useMyAgents } from './AgentDesk'
import { MobileAppBar, TopAppButton } from './InstallCard'
import { useTheme } from '../lib/theme'
import { menuColor } from '../lib/menuColors'
import { PencilRuler, Truck, Inbox, Calculator, Sigma, Building2, Layers, GraduationCap, Ruler, BookOpen, Bookmark, Bot, MonitorPlay, ListTodo, Plus, Search, Briefcase, HardDrive, ChevronDown, ChevronLeft, PenLine, ChevronRight, CircleHelp, PanelLeftClose, PanelLeftOpen, ClipboardCheck, FolderKanban, Home, Library, Megaphone, MessageCircle, MoreHorizontal, Settings, Users, UserRound, Landmark, FileQuestion, HandCoins, type LucideIcon } from 'lucide-react'
import { accessSource, isDesktopApp } from '../lib/desktop'
import { useAttendance } from '../lib/attendance'
import { AssignTaskModal } from './AssignTask'
import { NotificationBell } from './Notifications'
import { TopMenu, webSlot } from './WebSearch'
import { openCommandPalette } from './CommandPaletteHost'
import { detailSlot } from './RightPanel'

/** 검색 창 자리(한 개뿐인 DOM)를 이 화면의 .body 끝으로 옮김 */
const mountWebSlot = (el: HTMLDivElement | null) => {
  if (!el) return
  // 순서: … 본 화면 │ 결과 칸 │ 인터넷 칸
  if (detailSlot && detailSlot.parentElement !== el) el.appendChild(detailSlot)
  if (webSlot && (webSlot.parentElement !== el || webSlot.previousSibling !== detailSlot)) el.appendChild(webSlot)
}
import { useApp, useAsync, initial } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addDays, addMonths, manwon, monthGrid, todayKey } from '../lib/date'
import { squareThumb } from '../lib/image'
import { inQuickWindow } from '../lib/pip'
import { Link, useRouter } from '../lib/router'
import { TODAY_STATUSES, type TodayStatus } from '../lib/types'
import { Presence, toneOf } from './ui'
import { askQuickRoom, countedUnread, rememberRoomLevels, useChatTick } from '../lib/chat'
import { DockTodo } from './DockTodo'
import { TopbarEvent } from './TopbarEvent'
import { AssistantSettingsButton } from './AssistantSettings'
import { ErrorBoundary } from './ErrorBoundary'
import type { ChatRoomSummary } from '../lib/types'
import './ShellUsability.css'

// 왼쪽 채팅 칸 안의 대화 부품 · 비서 창은 본 화면이 뜬 뒤 따로 불러온다 (첫 화면 묶음을 가볍게 · 2026-11-19 성능)
const QuickChat = lazy(() => import('../pages/Quick').then(m => ({ default: m.QuickChat })))
const MediaDeck = lazy(() => import('./MediaDeck'))
const AssistantFloat = lazy(() => import('./AssistantFloat').then(m => ({ default: m.AssistantFloat })))

export type TabKey = 'design' | 'designOrders' | 'designCards' | 'designPrices' | 'ilwi' | 'designVendors' | 'designMaterials' | 'designLearn' | 'tenders' | 'leads' | 'sales' | 'home' | 'my' | 'reportTemplates' | 'approvals' | 'chat' | 'work' | 'projects' | 'clients' | 'library' | 'drive' | 'boards' | 'team' | 'site' | 'agents' | 'ads' | 'ledger' | 'interviewQuestions' | 'gov' | 'admin'

export const TABS: { key: TabKey; label: string; path: string; admin?: boolean; keywords?: string[] }[] = [
  // 홈 = 회사 대시보드 · 개인 일은 '개인 업무' (대표 지시 2026-11-28 '홈 화면은 개인만 사용하는 공간으로 · 개인 업무로 이름 변경 · 홈은 대시보드로')
  { key: 'home', label: '홈', path: '/', keywords: ['대시보드', '회사 현황'] },
  { key: 'my', label: '개인 업무', path: '/my', keywords: ['내 할 일', '내 업무', '출근', '개인'] },
  // 리서치와 보고서는 따로 (대표 지시 2026-11-12)
  { key: 'reportTemplates', label: '리서치', path: '/research' },
  { key: 'approvals', label: '보고서', path: '/approvals' },
  { key: 'chat', label: '채팅', path: '/chat' },
  { key: 'projects', label: '프로젝트', path: '/projects' },
  { key: 'drive', label: '드라이브', path: '/drive' },
  // 공통 화이트보드 (2026-11-27 대표 '모든 프로젝트에서 공통으로') — 공통 보드 · 템플릿 · 모든 프로젝트 보드
  { key: 'boards', label: '화이트보드', path: '/boards', keywords: ['화이트보드', '보드', '템플릿', '피그마', '피그잼'] },
  { key: 'team', label: '업무·근태', path: '/team' },
  // 현장 실측: 사진 위 치수 · 도면 배치 · 체크리스트 (2026-11-04)
  { key: 'site', label: '현장 실측', path: '/site', keywords: ['현장', '실측', '치수', '체크리스트'] },
  // 설계·견적: 인테리어 디자인 자동화 통합 (2026-11-15)
  { key: 'design', label: '설계 프로젝트', path: '/design', keywords: ['설계', '견적', '수량표', '공정표', '스케치업', '인테리어 자동화'] },
  { key: 'designOrders', label: '실행·발주', path: '/design-orders', admin: true, keywords: ['실행 내역', '발주서', '손익', '실행가'] },
  { key: 'designCards', label: '검토함', path: '/design-cards', keywords: ['견적 확정', '단가 가져오기', '검토'] },
  { key: 'designPrices', label: '단가', path: '/design-prices', keywords: ['판매 단가', '실행 단가', '물가 기준', '나라장터 자재목록'] },
  // 일위대가: 일반 인테리어 견적과 따로 (2026-11-18 대표 지시 '분리해서 개발')
  { key: 'ilwi', label: '일위대가', path: '/ilwi', keywords: ['일위대가', '품셈', '노임단가', '재료비', '노무비', '경비', '시장시공가격'] },
  { key: 'designVendors', label: '협력사', path: '/design-vendors', keywords: ['협력업체', '시공사', '나라장터 후보'] },
  { key: 'designMaterials', label: '자재', path: '/design-materials', keywords: ['마감재', '자재 코드', '스펙'] },
  { key: 'designLearn', label: '학습 자료', path: '/design-learn', keywords: ['도면 세트', '스펙북', '표본', '학습'] },
  { key: 'agents', label: 'AI 팀·비용', path: '/agents', keywords: ['AI팀', 'AI 팀', 'AI 사용', '사용량', '비용', '예산', 'API', '에이전트'] },
  // 광고는 팀원 모두에게 공개 (대표 지시 2026-11-06)
  { key: 'ads', label: '광고·콘텐츠', path: '/ads', keywords: ['인스타그램', 'Instagram', 'Meta', '블로그', '유튜브', '캠페인', '소재', '마케팅', 'SEO'] },
  { key: 'ledger', label: '입출금 장부', path: '/ledger', admin: true },
  { key: 'interviewQuestions', label: '인터뷰 질문 은행', path: '/interview-questions', admin: true, keywords: ['인터뷰지', '질문 은행', '서면 인터뷰', '인터뷰 질문', '구글 폼'] },
  // 정부지원사업: 공고 자동 수집 · 회사별 판정 · 마감 알림 (2026-11-19 대표 지시 · 관리자 전용)
  { key: 'gov', label: '정부지원사업', path: '/gov', admin: true, keywords: ['지원사업', '정부 지원', '보조금', '바우처', 'K-Startup', '기업마당', '창업 지원', '공고'] },
  { key: 'admin', label: '관리', path: '/admin', admin: true },
  { key: 'leads', label: '연락처 검토함', path: '/leads' },
  { key: 'sales', label: '영업·수주', path: '/sales', keywords: ['나라장터', '공고', '입찰', '신규 영업', '인테리어'] },
]

/** 휴대폰 · 태블릿 아래 메뉴: 자주 쓰는 4개 + 더보기 */
const ICONS: Record<TabKey, LucideIcon> = {
  sales: Briefcase,
  tenders: Briefcase,
  leads: Briefcase,
  home: Home,
  my: UserRound,
  approvals: ClipboardCheck,
  reportTemplates: BookOpen,
  chat: MessageCircle,
  work: Briefcase,
  projects: FolderKanban,
  clients: Briefcase,
  library: Library,
  drive: HardDrive,
  boards: PenLine,
  team: Users,
  site: Ruler,
  design: PencilRuler,
  designOrders: Truck,
  designCards: Inbox,
  designPrices: Calculator,
  ilwi: Sigma,
  designVendors: Building2,
  designMaterials: Layers,
  designLearn: GraduationCap,
  agents: Bot,
  ads: Megaphone,
  ledger: Landmark,
  interviewQuestions: FileQuestion,
  gov: HandCoins,
  admin: Settings,
}
const MAIN_TABS: TabKey[] = ['home', 'my', 'approvals', 'chat', 'projects', 'site']
const SHORT: Partial<Record<TabKey, string>> = { my: '내 업무', approvals: '보고서', site: '현장' }
const NAV_SHUT_KEY = 'wkly-side-groups-shut'
const NAV_GROUPS: { label: string; tabs: TabKey[] }[] = [
  { label: '업무', tabs: ['home', 'my', 'reportTemplates', 'approvals', 'projects'] },
  // 설계·견적 (인테리어 디자인 자동화) — 별도 묶음으로 세분화 (대표 지시 2026-11-15)
  { label: '설계·견적', tabs: ['site', 'design', 'designOrders', 'designCards', 'designPrices', 'ilwi', 'designVendors', 'designMaterials', 'designLearn'] },
  { label: '협업·자료', tabs: ['chat', 'drive', 'boards', 'team'] },
  { label: '운영', tabs: ['sales', 'leads', 'ads'] },
  // AI 팀·비용은 관리 묶음으로 (대표 지시 2026-11-16) — 팀원에게는 이 묶음에 AI 팀·비용만 보이므로 이름을 '관리'로 보여 줌
  { label: '관리자 전용', tabs: ['agents', 'ledger', 'interviewQuestions', 'gov', 'admin'] },
]

export interface Summary {
  myOpenTasks: number
  pendingToDecide: number
  unread: number
  /** 나중에 보기 (안 끝낸 것) */
  saved?: number
  countsError?: string | null
  retryCounts?: () => void
}

/** 프로필 칸·탭·카운터에 쓰는 요약 숫자 */
export function useSummary(): Summary {
  const { api, me, version } = useApp()
  const { data, error: countsError, reload: retryCounts } = useAsync<Summary>(
    async () => {
      return { ...await api.getNavigationCounts(me), unread: 0 }
    },
    [version, me.id, me.role],
    { myOpenTasks: 0, pendingToDecide: 0, unread: 0, saved: 0 },
  )
  // 안 읽은 채팅 수는 채팅 신호로만 (새 메시지마다 할 일 · 결재까지 다시 불러오지 않음)
  const chatTick = useChatTick()
  const { data: unread } = useAsync(
    async () => {
      const rooms = await api.listRooms()
      // 방마다 알림 단계 반영: 멘션만인 방은 나를 부른 것만, 끈 방은 세지 않음
      rememberRoomLevels(rooms)
      return rooms.reduce((s, r) => s + countedUnread(r), 0)
    },
    [version, chatTick, me.id],
    0,
  )
  return { ...data, unread, countsError, retryCounts }
}

/** 왼쪽 프로필 사진: 눌러서 올리기 · 바꾸기 (256px 로 줄여 저장) */
function PhotoBox() {
  const { api, me, bump, toast } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const put = async (photo: string | null) => {
    setBusy(true)
    try {
      await api.updateProfile(me.id, { photo })
      bump()
      toast(photo ? '사진을 올렸습니다.' : '사진을 지웠습니다.')
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await put(await squareThumb(file))
    } catch (err) {
      toast(friendlyError(err))
    }
  }
  return (
    <div className="photo-wrap">
      <button
        type="button"
        className={`photo ${me.photo ? 'has-img' : toneOf(me.name)}`}
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={me.photo ? '프로필 사진 바꾸기' : '프로필 사진 올리기'}
        title={me.photo ? '사진 바꾸기' : '사진 올리기'}
      >
        {me.photo ? <img src={me.photo} alt="" /> : <span aria-hidden="true">{initial(me.name)}</span>}
        <Presence status={me.today_status} className="on-photo" />
        <span className="photo-cta">
          {busy ? '올리는 중…' : me.photo ? '사진 바꾸기' : '사진 올리기'}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {me.photo && (
        <button type="button" className="btn-ghost photo-del t-cap" onClick={() => put(null)} disabled={busy}>
          사진 지우기
        </button>
      )}
    </div>
  )
}

/**
 * 채팅 고정 칸 (대표 지시 2026-11-10 "채팅을 별도의 탭으로 하지 말고 고정 · 왼쪽 현재 위치가 적합")
 *  - 왼쪽 메뉴 바로 옆에 방 고르기 + 대화 + 입력창이 늘 붙어 있음 (PC) · 휴대폰은 아래 메뉴 '채팅' 그대로
 *  - 접기(◀)를 누르면 얇은 줄로 줄어듦 (안 읽은 수만) · 방 만들기 · 나중에 보기 등은 '전체 화면'
 */
const DOCK_KEY = 'wkly-chat-dock'
const DOCK_W_KEY = 'wkly-chat-dock-w'
const DOCK_MIN = 260
const DOCK_MAX = 720
function ChatDock() {
  const { api, version, bump, toast } = useApp()
  const chatTick = useChatTick()
  const { data: rooms } = useAsync(() => api.listRooms(), [version, chatTick], [] as ChatRoomSummary[])
  const unread = rooms.reduce((s, r) => s + countedUnread(r), 0)
  // 2026-11-28 대표 지시 '채팅방 자리에 유튜브 · 인스타그램 · 틱톡을 볼 수 있는 화면': the dock body shows chat or the media deck
  const [media, setMedia] = useState(() => {
    try {
      return localStorage.getItem('wkly-dock-media') === '1'
    } catch {
      return false
    }
  })
  const flipMedia = () => setMedia(m => {
    try {
      localStorage.setItem('wkly-dock-media', m ? '0' : '1')
    } catch {
      /* 저장 못 해도 화면은 그대로 */
    }
    return !m
  })
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(DOCK_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  // 폭 조절 (대표 지시 2026-11-10 "폭 조절 가능하게 · 구분선은 핑크"): 오른쪽 핑크 선을 끌어서 260~720px
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(DOCK_W_KEY))
      return v >= DOCK_MIN && v <= DOCK_MAX ? v : 340
    } catch {
      return 340
    }
  })
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    let w = w0
    document.body.classList.add('dock-resizing')
    const move = (ev: PointerEvent) => {
      w = Math.max(DOCK_MIN, Math.min(DOCK_MAX, w0 + ev.clientX - x0))
      setWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dock-resizing')
      try {
        localStorage.setItem(DOCK_W_KEY, String(Math.round(w)))
      } catch {
        /* 저장 못 해도 이번엔 그대로 */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = (d: number) => {
    const w = Math.max(DOCK_MIN, Math.min(DOCK_MAX, width + d))
    setWidth(w)
    try {
      localStorage.setItem(DOCK_W_KEY, String(w))
    } catch {
      /* 무시 */
    }
  }
  const openAssistant = async () => {
    try {
      const { room_id } = await api.openMyAssistant()
      bump()
      // 방 목록이 새로 읽힌 뒤 그 방을 고르게 함
      window.setTimeout(() => askQuickRoom(room_id), 400)
      askQuickRoom(room_id)
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const toggle = () => {
    setOpen(o => {
      try {
        localStorage.setItem(DOCK_KEY, o ? 'closed' : 'open')
      } catch {
        /* 저장 못 해도 화면은 그대로 */
      }
      return !o
    })
  }
  if (!open)
    return (
      <aside className="chat-dock closed" aria-label="채팅 (접힘)">
        <button type="button" className="chat-dock-open" onClick={toggle} title="채팅 펼치기">
          <MessageCircle size={16} aria-hidden="true" />
          {unread > 0 && <span className="side-n">{unread > 99 ? '99+' : unread}</span>}
          <span className="chat-dock-vert">채팅</span>
        </button>
        <button type="button" className="ast-icon chat-dock-ast" onClick={() => { toggle(); void openAssistant() }} aria-label="내 비서" title="내 비서 열기">
          <Bot size={16} aria-hidden="true" />
        </button>
      </aside>
    )
  return (
    <aside className="chat-dock" aria-label="채팅" style={{ width }}>
      <div className="chat-dock-h">
        <MessageCircle size={15} aria-hidden="true" />
        <b>채팅</b>
        {unread > 0 && <span className="side-n">{unread > 99 ? '99+' : unread}</span>}
        <span className="grow" />
        {/* 2026-11-28 대표 지시 '아래 내 비서는 없애고 상부에 있는 거 아이콘으로 · 그림자 네온으로 빛나게 · 반응형' */}
        <button type="button" className="ast-icon" onClick={openAssistant} aria-label="내 비서" title="내 비서 — 나만 보는 개인 AI 비서 · 할 일 · 일정 · 업무 일지 · 주간 보고 초안">
          <Bot size={16} aria-hidden="true" />
        </button>
        <button type="button" className={`ast-icon md-toggle${media ? ' on' : ''}`} onClick={flipMedia} aria-pressed={media} aria-label={media ? '채팅으로 돌아가기' : '영상 보기'} title={media ? '채팅으로 돌아가기' : '영상 보기 — 유튜브 · 인스타그램 · 틱톡'}>
          {media ? <MessageCircle size={16} aria-hidden="true" /> : <MonitorPlay size={16} aria-hidden="true" />}
        </button>
        <AssistantSettingsButton />
        <Link to="/chat" className="chat-dock-full" title="방 만들기 · 나중에 보기 · 스레드는 전체 화면에서">
          전체 화면
        </Link>
        <button type="button" className="icon-btn sm dock-fold" onClick={toggle} aria-label="채팅 접기" title="채팅 접기">
          <ChevronLeft size={15} />
        </button>
      </div>
      {!media && <DockTodo calendar={<MiniCalendar />} />}
      {media ? (
        <div className="chat-dock-in md-host">
          <ErrorBoundary area="영상 보기">
            <Suspense fallback={<span className="t-cap" style={{ padding: 12 }}>화면 불러오는 중…</span>}>
              <MediaDeck />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        <div className="quick q2 chat-dock-in">
          <ErrorBoundary area="채팅">
            <Suspense fallback={<span className="t-cap" style={{ padding: 12 }}>대화 불러오는 중…</span>}>
              <QuickChat rooms={rooms} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
      <div
        className="chat-dock-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="채팅 칸 폭 조절"
        aria-valuemin={DOCK_MIN}
        aria-valuemax={DOCK_MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="끌어서 폭 조절 · 두 번 누르면 처음 폭"
        onPointerDown={startResize}
        onDoubleClick={() => nudge(340 - width)}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') nudge(-20)
          if (e.key === 'ArrowRight') nudge(20)
        }}
      />
    </aside>
  )
}

/**
 * 왼쪽 메뉴 (2026-10-23 "오른쪽 탭은 삭제, 다른 방법"): 아이콘 · 이름 · 처리할 숫자를 한 줄씩
 *  - 맨 위 '+ 새로 만들기' 하나로 할 일 · 결재 · 프로젝트 · 업무 일지 · 메시지 · AI 지시
 */
function SideNav({ active, summary, onExpand }: { active: TabKey; summary: Summary; onExpand: () => void }) {
  const { me } = useApp()
  const { navigate } = useRouter()
  const tabs = TABS.filter(t => !t.admin || me.role === 'admin')
  // 큰 묶음(업무 · 설계·견적 …) 접기 (대표 지시 2026-11-16 · 2026-11-22 '접으면 모두 접히게' — 지금 보는 화면 줄도 숨김, 숨은 숫자 합은 묶음 이름 옆)
  const [shut, setShut] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(NAV_SHUT_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggleGroup = (label: string) =>
    setShut(prev => {
      const next = prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
      try {
        localStorage.setItem(NAV_SHUT_KEY, JSON.stringify(next))
      } catch {
        /* 저장 못 해도 이번엔 그대로 */
      }
      return next
    })
  const count = (k: TabKey) => (k === 'chat' ? summary.unread : summary.countsError ? 0 : k === 'approvals' ? summary.pendingToDecide : k === 'projects' ? summary.myOpenTasks : 0)
  return (
    <nav className="side-nav" aria-label="메뉴">
      <NewMenu onExpand={onExpand} />
      {NAV_GROUPS.map(group => {
        const items = group.tabs.map(key => tabs.find(t => t.key === key)).filter((t): t is typeof tabs[number] => !!t)
        if (!items.length) return null
        const closed = shut.includes(group.label)
        const hidden = closed ? items.filter(t => t.key !== 'projects').reduce((a, t) => a + count(t.key), 0) : 0
        return <div className={`side-nav-group${closed ? ' shut' : ''}`} key={group.label}>
          <button type="button" className="side-group-label" onClick={() => toggleGroup(group.label)} aria-expanded={!closed} title={closed ? `${group.label} 펼치기` : `${group.label} 접기`}>
            <ChevronDown size={12} aria-hidden="true" /><span className="grow">{group.label === '관리자 전용' && me.role !== 'admin' ? '관리' : group.label}</span>
            {hidden > 0 && <span className="side-n">{hidden > 99 ? '99+' : hidden}</span>}
          </button>
          {items.map(t => {
            const Icon = ICONS[t.key]
            const n = count(t.key)
            const index = tabs.indexOf(t)
            return <a key={t.key} href={t.path} className={`side-item ${t.key === active ? 'on' : ''} ${n && t.key !== 'projects' ? 'has-n' : ''}${t.key === 'chat' ? ' side-chat' : ''}`} aria-current={t.key === active ? 'page' : undefined} style={{ '--mc': menuColor(t.key) } as CSSProperties} title={`${t.label}${index < 9 ? ` (Alt+${index + 1})` : ''}`} onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
              event.preventDefault()
              navigate(t.path)
            }}>
              <Icon size={17} aria-hidden="true" /><span className="grow">{t.label}</span>
              {n > 0 && <span className={`side-n ${t.key === 'projects' ? 'soft' : ''}`} aria-label={`${t.key === 'approvals' ? '처리할 보고서' : t.key === 'chat' ? '안 읽은 메시지' : '내 할 일'} ${n}개`}>{n > 99 ? '99+' : n}</span>}
            </a>
          })}
        </div>
      })}
      {!!summary.saved && !summary.countsError && (
        <Link to="/chat?view=saved" className="side-item sub">
          <Bookmark size={13} aria-hidden="true" />
          <span className="grow">나중에 보기</span>
          <span className="side-n soft">{summary.saved}</span>
        </Link>
      )}
      {summary.countsError && <button type="button" className="btn-ghost t-cap t-red" onClick={summary.retryCounts} title={summary.countsError}>메뉴 숫자 확인 실패 · 다시 확인</button>}
    </nav>
  )
}

function NewMenu({ onExpand }: { onExpand: () => void }) {
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [task, setTask] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', escape)
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', escape)
      cancelAnimationFrame(frame)
    }
  }, [open])
  const items: [string, LucideIcon, () => void][] = [
    ['할 일 · 업무 지시', ListTodo, () => setTask(true)],
    ['보고서 결재 올리기', ClipboardCheck, () => navigate('/approvals?new=1')],
    ['새 프로젝트', FolderKanban, () => navigate('/projects?new=1')],
    ['업무 일지 쓰기', Briefcase, () => navigate('/work')],
    ['메시지 · 1:1 대화', MessageCircle, () => navigate('/chat')],
    ['AI 에게 시키기', Bot, () => openCommandPalette()],
  ]
  return (
    <div className="new-menu" ref={ref}>
      <button type="button" ref={trigger} className="new-btn" onClick={() => { if (!open) onExpand(); setOpen(o => !o) }} aria-expanded={open} aria-haspopup="menu" aria-controls={open ? menuId : undefined}>
        <Plus size={15} /> 새로 만들기
      </button>
      {open && (
        <div id={menuId} className="new-pop" role="menu" aria-label="새 업무 만들기" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}>
          {items.map(([label, Icon, run]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                run()
              }}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {task && <AssignTaskModal onClose={() => setTask(false)} />}
    </div>
  )
}

/** 왼쪽 칸 아이콘만 보기 (이 PC에 기억) */
const RAIL_KEY = 'wkly-side-rail'
function useSideRail(): [boolean, (v: boolean) => void] {
  const [rail, set] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('side-rail', rail)
  }, [rail])
  const setRail = (v: boolean) => {
    set(v)
    try {
      localStorage.setItem(RAIL_KEY, v ? '1' : '0')
    } catch {
      /* 기억 못 해도 이번 화면에서는 적용 */
    }
  }
  return [rail, setRail]
}

function ProfilePanel({ summary, active }: { summary: Summary; active: TabKey }) {
  const [, setRail] = useSideRail()
  const { api, me, bump, toast, openQuick } = useApp()
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState(me.status_message ?? '')
  // 근태: 고르고 '확인'을 눌러야 인정 (대표 지시 2026-10-28)
  const [pick, setPick] = useState<TodayStatus>(me.today_status)
  useEffect(() => setPick(me.today_status), [me.today_status])
  const [punching, setPunching] = useState(false)
  const att = useAttendance().get(me.id)
  const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : null)
  const confirmStatus = async () => {
    setPunching(true)
    try {
      if (pick === '출근' || pick === '외근' || pick === '재택' || pick === '퇴근') {
        const r = await api.punchAttendance(pick, accessSource())
        toast(`${pick} 확인 · ${hm(r.at) ?? ''}`)
      } else {
        await api.updateProfile(me.id, { today_status: pick })
        toast(`오늘 상태: ${pick}`)
      }
      bump()
    } catch (e) {
      toast(friendlyError(e))
      setPick(me.today_status)
    } finally {
      setPunching(false)
    }
  }

  const save = async (patch: { today_status?: TodayStatus; status_message?: string | null }) => {
    try {
      await api.updateProfile(me.id, patch)
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <aside className="profile" aria-label="내 프로필">
      {/* 작게 (대표 지시 2026-10-29 "이 부분을 줄여서 작업 공간 확보"): 사진 · 이름 한 줄, 달력 접기, 아이콘만 보기 */}
      <div className="me-row">
        <PhotoBox />
        <div className="me-name">
          <span className="t-bodyb truncate">{me.name}</span>
          {me.title && <span className="t-cap truncate">{me.title}</span>}
        </div>
        <button type="button" className="icon-btn sm side-fold" onClick={() => setRail(true)} aria-label="왼쪽 칸 접기" title="왼쪽 칸 접기 (아이콘만)">
          <PanelLeftClose size={15} />
        </button>
      </div>
      <button type="button" className="icon-btn side-unfold" onClick={() => setRail(false)} aria-label="왼쪽 칸 펼치기" title="왼쪽 칸 펼치기">
        <PanelLeftOpen size={16} />
      </button>
      <MiniCalendar />
      <SideNav active={active} summary={summary} onExpand={() => setRail(false)} />
      <div className="today-is">
        <span className="t-meta">TODAY IS</span>
        <select value={pick} onChange={e => setPick(e.target.value as TodayStatus)} aria-label="오늘 상태">
          {TODAY_STATUSES.map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button type="button" className="today-ok" onClick={() => void confirmStatus()} disabled={punching} title="고른 상태로 출근 · 퇴근을 확인합니다 (눌러야 근태 인정)">
          확인
        </button>
      </div>
      <span className="today-rec t-meta">
        {att?.checkin_at ? `출근 확인 ${hm(att.checkin_at)}${att.kind && att.kind !== '출근' ? ` · ${att.kind}` : ''}${att.checkout_at ? ` · 퇴근 ${hm(att.checkout_at)}` : ''}` : '오늘 출근 확인 전 — 고르고 확인을 눌러 주세요'}
      </span>
      {editing ? (
        <div className="status-msg">
          <textarea
            autoFocus
            rows={3}
            maxLength={80}
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (msg !== (me.status_message ?? '')) save({ status_message: msg.trim() || null })
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
            aria-label="오늘의 한마디"
          />
        </div>
      ) : (
        <div
          className="status-msg"
          role="button"
          tabIndex={0}
          title="눌러서 오늘의 한마디 수정"
          onClick={() => {
            setMsg(me.status_message ?? '')
            setEditing(true)
          }}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            setMsg(me.status_message ?? '')
            setEditing(true)
          }}
        >
          {me.status_message || <span className="t-muted">오늘의 한마디를 남겨 보세요.</span>}
        </div>
      )}
      <div className="side-tools">
        <Link to="/help" className="quick-btn" title="사용법" style={{ textDecoration: 'none' }}>
          <CircleHelp size={14} /> 사용법
        </Link>
        {inQuickWindow() ? (
          <Link to="/quick" className="quick-btn" style={{ textDecoration: 'none' }}>
            빠른 창으로
          </Link>
        ) : (
          <button type="button" className="quick-btn pc-only" onClick={() => openQuick('window')} title="작은 독립 창. 전체 창을 닫아도 계속 쓸 수 있습니다.">
            빠른 창 띄우기
          </button>
        )}
      </div>
      {/* 사이드바 아래 빈 곳에 오늘 브리핑 (대표 지시 2026-11-01 "이곳에도 정보를 전달할 수 있도록") */}
      <SideBrief />
    </aside>
  )
}

/** 오늘 브리핑: 내 할 일(지연 · 오늘 · 이번 주) · 다음 일정 · (관리자) 이번 주 지급 · 수금 연체 — 누르면 해당 화면 */
function SideBrief() {
  const { api, me, version } = useApp()
  const today = todayKey()
  const week = addDays(today, 7)
  const [expanded, setExpanded] = useState(true)
  const { data } = useAsync(
    async () => {
      const [tasks, payments] = await Promise.all([api.listTasks().catch(() => []), me.role === 'admin' ? api.listPayments().catch(() => []) : Promise.resolve([])])
      return { tasks, payments }
    },
    [version, me.id],
    { tasks: [] as Awaited<ReturnType<typeof api.listTasks>>, payments: [] as Awaited<ReturnType<typeof api.listPayments>> },
  )
  const mine = data.tasks.filter(t => t.assignee_id === me.id && t.status !== '완료')
  const late = mine.filter(t => t.due_date && t.due_date < today)
  const todayN = mine.filter(t => t.due_date === today)
  const weekN = mine.filter(t => t.due_date && t.due_date > today && t.due_date <= week)
  const next = [...mine].filter(t => t.due_date && t.due_date >= today).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0]
  const open = (p: { status: string; is_estimate: boolean }) => p.status !== '완료' && p.status !== '취소' && !p.is_estimate
  const payWeek = data.payments.filter(p => p.direction === '지급' && open(p) && p.due_date && p.due_date >= today && p.due_date <= week)
  const lateIn = data.payments.filter(p => p.direction === '수금' && open(p) && p.due_date && p.due_date < today)
  const man = (n: number) => manwon(n) // 반올림 없이 (대표 지시 2026-11-06)
  const rows: { label: string; value: string; to: string; tone?: 'red' | 'yellow' }[] = [
    { label: '지연된 내 할 일', value: `${late.length}건`, to: '/projects?view=mine', tone: late.length ? 'red' : undefined },
    { label: '오늘 마감', value: `${todayN.length}건`, to: '/projects?view=mine', tone: todayN.length ? 'yellow' : undefined },
    { label: '이번 주 마감', value: `${weekN.length}건`, to: '/projects?view=mine' },
  ]
  if (me.role === 'admin') {
    rows.push({ label: '7일 안 지급', value: payWeek.length ? `${payWeek.length}건 · ${man(payWeek.reduce((n, p) => n + p.amount, 0))}` : '없음', to: '/projects?view=payments&sub=run' })
    rows.push({ label: '수금 연체', value: lateIn.length ? `${lateIn.length}건 · ${man(lateIn.reduce((n, p) => n + p.amount, 0))}` : '없음', to: '/projects?view=payments&sub=check', tone: lateIn.length ? 'red' : undefined })
  }
  return (
    <details className="side-brief" aria-label="오늘 브리핑" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="sb-title">오늘 브리핑<ChevronDown size={14} aria-hidden="true" /></summary>
      {rows.map(r => (
        <Link key={r.label} to={r.to} className={`sb-row${r.tone ? ` ${r.tone}` : ''}`}>
          <span>{r.label}</span>
          <em>{r.value}</em>
        </Link>
      ))}
      {next && (
        <Link to={next.project_id ? `/projects?id=${next.project_id}` : '/projects?view=mine'} className="sb-next" title={next.title}>
          <span>다음 일정</span>
          <b>
            {next.due_date === today ? '오늘' : next.due_date!.slice(5).replace('-', '.')} {next.title}
          </b>
        </Link>
      )}
    </details>
  )
}

/** 왼쪽 위 작은 달력: 일정이 있는 날에 점, 날짜를 누르면 큰 달력으로 */
function MiniCalendar() {
  const { api, me, version, profileName } = useApp()
  const { navigate, path, query } = useRouter()
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  // 달력은 늘 펼쳐 둠 (대표 지시 2026-10-29 "왼쪽 달력 고정")
  const open = true
  const { data } = useAsync(
    async () => {
      const [tasks, projects, leaves] = await Promise.all([api.listTasks(), api.listProjects(), api.listLeave()])
      return { tasks, projects, leaves }
    },
    [version],
    { tasks: [], projects: [], leaves: [] } as { tasks: Awaited<ReturnType<typeof api.listTasks>>; projects: Awaited<ReturnType<typeof api.listProjects>>; leaves: Awaited<ReturnType<typeof api.listLeave>> },
  )
  const byDay = useMemo(() => {
    const m = new Map<string, { mine: boolean; labels: string[] }>()
    const add = (d: string | null | undefined, label: string, mine = false) => {
      if (!d || d.slice(0, 7) !== month) return
      const cur = m.get(d) ?? { mine: false, labels: [] }
      m.set(d, { mine: cur.mine || mine, labels: [...cur.labels, label] })
    }
    for (const t of data.tasks) {
      if (t.status === '완료') continue
      add(t.due_date ?? t.start_date, `${t.title} · ${profileName(t.assignee_id)}`, t.assignee_id === me.id)
    }
    for (const p of data.projects) {
      if (p.status === '보류') continue
      add(p.start_date, `${p.name} 시작`)
      add(p.end_date, `${p.name} 종료`)
    }
    for (const l of data.leaves) {
      if (l.status !== '승인') continue
      for (let d = l.start_date; d <= l.end_date; d = addDays(d, 1)) add(d, `${profileName(l.profile_id)} ${l.masked ? (l.kind === '반차' ? '반차' : '휴가') : l.kind}`, l.profile_id === me.id)
    }
    return m
  }, [data, month, me.id, profileName])
  const [y, mo] = month.split('-')
  // 주간 보기 중이면 그 주(월~일)를 표시
  const weekOf = useMemo<[string, string] | null>(() => {
    if (path !== '/projects' || query.get('view') !== 'week') return null
    const d = query.get('date') ?? today
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
    return [addDays(d, -dow), addDays(d, 6 - dow)]
  }, [path, query, today])
  return (
    <section className={`mini-cal${open ? '' : ' folded'}`} aria-label="이번 달 달력">
      <div className="row">
        {open && (
          <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달">
            <ChevronLeft size={14} />
          </button>
        )}
        <button type="button" className="mini-cal-title grow" onClick={() => setMonth(today.slice(0, 7))} title="이번 달로">
          {y}.{mo}
        </button>
        {open && (
          <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {open && <div className="mini-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map(w => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {monthGrid(month).map((d, i) => {
          if (!d) return <span key={i} />
          const ev = byDay.get(d)
          const dow = i % 7
          return (
            <button
              key={d}
              type="button"
              className={`day${d === today ? ' today' : ''}${dow === 0 ? ' sun' : ''}${weekOf && d >= weekOf[0] && d <= weekOf[1] ? ' in-week' : ''}`}
              aria-label={`${y}년 ${Number(mo)}월 ${Number(d.slice(8))}일${ev ? ` · ${ev.labels.length}개 일정` : ''} · 주간 일정 보기`}
              aria-current={d === today ? 'date' : undefined}
              title={ev ? ev.labels.join('\n') : '이 주 일정 보기'}
              onClick={() => navigate(`/projects?view=week&date=${d}`)}
            >
              {Number(d.slice(8))}
              {ev && <i className={ev.mine ? 'mine' : ''} />}
            </button>
          )
        })}
      </div>}
    </section>
  )
}

/** 로고: 흰 로고는 시리즈 블루 위에서만 (로고 규정 허용 조합). 로그인 카드 위에 씀 */
export function LogoTile() {
  return (
    <Link to="/" className="profile-logo" aria-label="THE WKLY 홈" style={{ alignSelf: 'center' }}>
      <img src="/logo-on-series.svg" alt="WKLY" width={120} height={54} />
    </Link>
  )
}

/**
 * 화면 틀 (위쪽 줄 · 프로필 · 왼쪽 메뉴 · 인터넷 칸)은 한 번만 만들고 계속 유지 (2026-10-22 "화면 전환 애니메이션이 부자연스러워")
 *  - 예전: 화면마다 <Shell> 을 새로 만들어 이동할 때마다 틀 전체가 지워졌다 다시 그려짐 → 깜빡임 · 숫자 0 표시 · 인터넷 칸 다시 나타남
 *  - 지금: App 이 <ShellFrame> 을 한 번 그리고, 각 화면의 <Shell> 은 탭 표시(active · flush)만 알려 줌. 가운데만 부드럽게 바뀜
 */
type ShellState = { active: TabKey; flush: boolean }
const ShellCtx = createContext<((s: ShellState) => void) | null>(null)

export function Shell({ active, flush, children }: { active: TabKey; flush?: boolean; children: ReactNode }) {
  const set = useContext(ShellCtx)
  useLayoutEffect(() => {
    set?.({ active, flush: !!flush })
  }, [set, active, flush])
  if (!set) return <ShellFrame initial={{ active, flush: !!flush }}>{children}</ShellFrame>
  return <>{children}</>
}

function OneBox() {
  const ai = useMyAgents()[0]
  return (
    <button type="button" className="top-ai one-box" onClick={() => openCommandPalette()} aria-label="통합 검색 열기 (Ctrl K 또는 ⌘ K)" title={`사람 · 프로젝트 · 자료 찾기, ${ai?.name ?? 'AI'}에게 묻기, 인터넷 검색`}>
      <Search size={17} aria-hidden="true" /><span className="one-box-label">프로젝트·사람·자료 검색</span><span className="one-box-hint">AI에게 묻기</span><kbd className="pc-only">⌘ / Ctrl K</kbd>
    </button>
  )
}

export function ShellFrame({ children, initial }: { children: ReactNode; initial?: ShellState }) {
  const { api } = useApp()
  const { path } = useRouter()
  const summary = useSummary()
  const [{ active, flush }, setState] = useState<ShellState>(initial ?? { active: 'home', flush: false })
  const set = useCallback((s: ShellState) => setState(o => (o.active === s.active && o.flush === s.flush ? o : s)), [])
  // 메뉴마다 다른 강조색: 지금 화면의 색을 --v9-accent 로 (mono.css 의 빛 · 연한 바탕이 이 값에서 계산됨)
  useEffect(() => {
    document.documentElement.style.setProperty('--v9-accent', menuColor(active))
  }, [active])
  const mainRef = useRef<HTMLElement>(null)
  // 화면을 옮기면 가운데 창은 맨 위부터
  useLayoutEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 })
  }, [path])
  return (
    <ShellCtx.Provider value={set}>
    <div className={`page app-page tab-${active}`}>
      <a href="#wkly-main" className="shell-skip-link" onClick={event => { event.preventDefault(); mainRef.current?.focus({ preventScroll: true }); mainRef.current?.scrollTo({ top: 0 }) }}>본문으로 바로가기</a>
      <div className="mini">
        <div className="book">
          <div className="inner">
            <header className="topbar">
              <Link to="/" className="top-logo" aria-label="THE WKLY 홈">
                <img className="logo-white" src="/wkly-logo-white.svg" alt="WKLY" width={76} height={24} />
                <img className="logo-ink" src="/wkly-logo-black.svg" alt="" aria-hidden="true" width={76} height={24} />
              </Link>
              <span className="site-title">사내 인트라넷</span>
              <span className="site-url t-meta">{window.location.host}</span>
              {api.mode === 'demo' && <span className="mode-badge" title="Supabase 연결 전 체험 모드. 데이터는 이 브라우저에만 저장됩니다.">DEMO</span>}
              {/* 기념일 · 이벤트에 맞춰 위쪽 바 장식 · 인사말 (2026-11-16) */}
              <TopbarEvent />
              {/* 입력칸 하나 (2026-10-23): 찾기 · AI 에게 묻기 · 인터넷 검색을 Ctrl K 한 칸으로 */}
              {/* 화면 뒤로 · 앞으로: 가운데 창 위 한 줄을 없애고 위쪽 바로 (2026-10-28 "여백 정리") */}
              <span className="main-nav" role="group" aria-label="화면 이동">
                <button type="button" className="icon-btn sm" onClick={() => window.history.back()} aria-label="이전 화면" title="이전 화면 (Alt+←)">
                  <ChevronLeft size={15} />
                </button>
                <button type="button" className="icon-btn sm" onClick={() => window.history.forward()} aria-label="다음 화면" title="다음 화면 (Alt+→)">
                  <ChevronRight size={15} />
                </button>
              </span>
              <span className="grow" />
              {/* 검색창은 오른쪽 (2026-10-29) */}
              <OneBox />
              {/* 휴대폰 앱 받기: 검색창 옆 (PC) */}
              <TopAppButton />
              <NotificationBell />
              {/* 오른쪽 위 아이콘들은 '보기' 펼침 메뉴 하나로 (2026-10-28) */}
              <TopMenu showDownload={!isDesktopApp()} />
            </header>
            {/* 휴대폰 홈 맨 위: 앱 다운로드 한 줄 (PC 는 홈 본문 맨 위 QR 칸) */}
            {(active === 'home' || active === 'my') && <MobileAppBar />}
            <div className="body" ref={mountWebSlot}>
              <ProfilePanel summary={summary} active={active} />
              {active !== 'chat' && <ChatDock />}
              <main id="wkly-main" ref={mainRef} tabIndex={-1} aria-label={`${TABS.find(t => t.key === active)?.label ?? '업무'} 본문`} className={`main ${flush ? 'flush' : ''}`}>
                {/* 화면이 바뀔 때만 가운데 내용이 살짝 나타남 (같은 화면 안 탭 · 검색 이동은 그대로) */}
                <div className="main-view" key={path}>
                  {children}
                </div>
              </main>
            </div>
            {/* 휴대폰 홈 맨 아래: 지금 보고 있는 버전 (배포 시각) — 새 버전이 들어왔는지 확인용 */}
            {active === 'home' && <p className="m-ver phone-only">인트라넷 버전 {buildLabel()}</p>}
          </div>
        </div>
        <MobileNav active={active} summary={summary} />
        {/* 모든 화면의 AI 비서 창 (2026-11-16) */}
        <ErrorBoundary area="비서">
          <Suspense fallback={null}>
            <AssistantFloat pageLabel={TABS.find(t => t.key === active)?.label ?? '업무'} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
    </ShellCtx.Provider>
  )
}

/** 휴대폰 · 태블릿(터치 화면) 아래 고정 메뉴: 홈 · 결제 · 채팅 · 프로젝트 · 더보기 (나머지 메뉴는 더보기 시트) */
function MobileNav({ active, summary }: { active: TabKey; summary: Summary }) {
  const { me } = useApp()
  const [more, setMore] = useState(false)
  const tabs = TABS.filter(t => !t.admin || me.role === 'admin')
  const rest = tabs.filter(t => !MAIN_TABS.includes(t.key))
  const dotOf = (k: TabKey) => (k === 'approvals' && !summary.countsError ? summary.pendingToDecide : k === 'chat' ? summary.unread : 0)
  const restActive = rest.some(t => t.key === active)
  return (
    <>
      <nav className="m-nav" aria-label="메뉴">
        {tabs
          .filter(t => MAIN_TABS.includes(t.key))
          .map(t => {
            const Icon = ICONS[t.key]
            const dot = dotOf(t.key)
            return (
              <Link key={t.key} to={t.path} className={t.key === active ? 'on' : ''} aria-current={t.key === active ? 'page' : undefined}>
                <Icon size={20} aria-hidden="true" />
                {SHORT[t.key] ?? t.label}
                {dot > 0 && <span className="m-dot">{dot > 99 ? '99+' : dot}</span>}
              </Link>
            )
          })}
        <button type="button" className={restActive || more ? 'on' : ''} onClick={() => setMore(v => !v)} aria-expanded={more}>
          <MoreHorizontal size={20} aria-hidden="true" />
          {restActive ? (SHORT[active] ?? TABS.find(t => t.key === active)?.label) : '더보기'}
        </button>
      </nav>
      {more && (
        <div className="m-more-scrim" onClick={() => setMore(false)}>
          <div className="m-more" role="dialog" aria-label="전체 메뉴" onClick={e => e.stopPropagation()}>
            <div className="m-more-grid">
              {rest.map(t => {
                const Icon = ICONS[t.key]
                return (
                  <Link key={t.key} to={t.path} className={t.key === active ? 'on' : ''} onNavigate={() => setMore(false)}>
                    <Icon size={22} aria-hidden="true" />
                    {t.label}
                  </Link>
                )
              })}
              <Link to="/help" onNavigate={() => setMore(false)}>
                <CircleHelp size={22} aria-hidden="true" />
                사용법
              </Link>
            </div>
            <ThemePick />
          </div>
        </div>
      )}
    </>
  )
}

/** 빌드 번호(배포 시각 36진수-커밋) → '11.04 23:41 · 1a2b3c4' */
function buildLabel(): string {
  const [t, sha] = __BUILD_ID__.split('-')
  const ms = parseInt(t, 36)
  if (!ms) return __BUILD_ID__
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}${sha ? ` · ${sha}` : ''}`
}

/** 더보기 메뉴: 화면 밝기 (기본 밝게 · 어둡게는 본인이 고를 때만, 이 기기에만 기억) */
function ThemePick() {
  const [theme, setTheme] = useTheme()
  return (
    <div className="m-theme" role="group" aria-label="화면 밝기">
      <span>화면</span>
      <div className="seg2">
        <button type="button" className={theme === 'light' ? 'on' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          밝게
        </button>
        <button type="button" className={theme === 'dark' ? 'on' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          어둡게
        </button>
      </div>
    </div>
  )
}
