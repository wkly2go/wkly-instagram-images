import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, ArrowLeft, Building2, CalendarDays, CalendarRange, GanttChart, LayoutDashboard, ListChecks, Network, Repeat, Users, Wallet, Plus, CheckCircle2, ChevronLeft, ChevronRight, CircleSlash, FolderOpen, Pencil, Search, Trash2 } from 'lucide-react'
import { ProjectMaterials } from '../components/ProjectMaterials'
import { SiteLogsSection } from '../components/SiteLogs'
import { ProjectDriveSection, useProjectFolderSync } from '../components/DriveFiles'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import type { Approval } from '../lib/types'
import { useAction, useApp, useAsync } from '../lib/app'
import { addMonths, dateLabel, monthGrid, shortDate, timeLabel, toDateKey, todayKey, weekRange, weekday, periodLabel } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { PROJECT_CATEGORIES, PROJECT_STATUSES, type ChatRoomSummary, type Client, type Contact, type Project, type ProjectStatus, type Task, type TaskStatus, type WorkLog, projectBrand, projectDriveUrl, DIVISIONS, DIVISION_KEYS, type Division } from '../lib/types'
import { ContactTimeline, ExchangeFilesSection, ProjectContactsSection } from '../components/ContactHistory'
import { OrgSection } from '../components/Org'
import { Board, type BoardCol } from '../components/Board'
import { Shell } from '../components/Shell'
import { Badge, Button, Chip, Empty, Field, FilterGroup, KindTag, Modal, SectionHead, StatusBadge, ViewTabs } from '../components/ui'
import { NewApproval } from './Approvals'
import { MaterialMoves } from '../components/MaterialMoves'
import { FinancePanel } from '../components/FinancePanel'
import { ProjectVizLoader } from '../components/ProjectViz'
import { ProjectDashboard } from './ProjectDashboard'
import { Payments } from './Payments'
import { Subscriptions } from './Subscriptions'
import { Gantt, MonthCalendar, SentTasks, TaskAssignModal, WeekView } from './Schedule'
import { OverdueCleanup, PendingReports, useWorkReports } from '../components/WorkReports'
import { ask } from '../components/Ask'

interface Data {
  projects: Project[]
  tasks: Task[]
  clients: Client[]
}

export default function Projects() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const { profileName } = useApp()
  const view = query.get('view') // null(대시보드) | 'schedule' | 'week' | 'calendar' | 'list' | 'mine' | 'tasks' | 'payments'
  const status = (query.get('status') as ProjectStatus | 'all' | null) ?? '진행'
  const selectedId = query.get('id')
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [newDiv, setNewDiv] = useState<Division | null>(null)
  // 왼쪽 '+ 새로 만들기' 에서 들어오면 바로 새 프로젝트 창
  useEffect(() => {
    if (query.get('new') !== '1') return
    setEditing('new')
    navigate(withQuery(path, query, { new: null }), { replace: true })
  }, [query, path, navigate])
  const [assigning, setAssigning] = useState(false)
  const { data, loading } = useAsync<Data>(
    async () => {
      const [projects, tasks, clients] = await Promise.all([api.listProjects(), api.listTasks(), api.listClients()])
      return { projects, tasks, clients }
    },
    [version],
    { projects: [], tasks: [], clients: [] },
  )
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: !('id' in patch) })
  const selected = data.projects.find(p => p.id === selectedId)
  // 넓은 화면: 프로젝트를 누르면 지금 화면은 왼쪽에 두고 오른쪽 칸에 프로젝트 전체 (2026-10-28)
  const wide = usePanelWide()
  // 첫 화면(넓은 화면): 가운데 = 프로젝트 목록, 오른쪽 = 대시보드 요약 → 프로젝트를 누르면 오른쪽이 그 프로젝트 상세 (2026-10-28)
  const view0 = query.get('view')
  const dashRight = wide && !view0 && !query.get('q')
  useRightPanel(
    wide && selected ? `projfull:${selected.id}` : dashRight ? 'projdash' : null,
    selected ? `${selected.code ? `${selected.code} · ` : ''}${selected.name}` : '대시보드 · 요약',
    selected ? (
      <ProjectDetail key={selected.id} project={selected} data={data} panel onEdit={() => setEditing(selected)} onBack={() => go({ id: null })} />
    ) : dashRight ? (
      <div className="panel-dash">
        <ProjectDashboard projects={data.projects} tasks={data.tasks} clients={data.clients} />
      </div>
    ) : null,
    { wide: true, onClose: selected ? () => go({ id: null }) : undefined },
  )

  if (selectedId && !wide) {
    return (
      <Shell active="projects">
        {selected ? <ProjectDetail project={selected} data={data} onEdit={() => setEditing(selected)} onBack={() => go({ id: null })} /> : <Empty>{loading ? '불러오는 중…' : '프로젝트를 찾을 수 없습니다.'}</Empty>}
        {editing && <ProjectForm key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? null : editing} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />}
      </Shell>
    )
  }

  // 목록: 회사(AR 아트리어 · TW 더위클리) 거르기 + 정렬(연번 · 이름 · 최근)
  const brand = query.get('brand')
  const sort = query.get('sort')
  const OPEN: ProjectStatus[] = ['진행', '기획']
  const shown = brand ? data.projects.filter(p => projectBrand(p) === brand) : data.projects
  const sorted = (rows: Project[]) =>
    [...rows].sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : sort === 'recent'
          ? (b.start_date ?? b.created_at).localeCompare(a.start_date ?? a.created_at)
          : (b.code ?? '').localeCompare(a.code ?? '') || a.name.localeCompare(b.name, 'ko'),
    )
  // 프로젝트 검색: 연번 · 이름 · 장소 · 설명 · 거래처 · 담당 + 할 일 제목 (상태 · 회사 상관없이 전부)
  const q = query.get('q') ?? ''
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const clientName = (id: string | null) => data.clients.find(c => c.id === id)?.name ?? ''
  const hit = (text: string) => words.every(w => text.toLowerCase().includes(w))
  const foundProjects = words.length ? data.projects.filter(p => hit([p.code, p.name, p.location, p.description, p.category, p.status, clientName(p.client_id), profileName(p.owner_id)].filter(Boolean).join(' '))) : []
  const foundTasks = words.length ? data.tasks.filter(t => hit([t.title, t.memo, data.projects.find(p => p.id === t.project_id)?.name, profileName(t.assignee_id)].filter(Boolean).join(' '))) : []
  const I = 14
  const tabs: { key: string | null; label: string; icon: JSX.Element }[] = [
    { key: null, label: wide ? '프로젝트' : '대시보드', icon: <LayoutDashboard size={I} /> },
    ...(wide ? [] : [{ key: 'list', label: '프로젝트 목록', icon: <FolderOpen size={I} /> }]),
    { key: 'schedule', label: '일정표', icon: <GanttChart size={I} /> },
    { key: 'week', label: '주간', icon: <CalendarRange size={I} /> },
    { key: 'calendar', label: '캘린더', icon: <CalendarDays size={I} /> },
    { key: 'org', label: '조직 · 진행', icon: <Network size={I} /> },
    { key: 'mine', label: '내 할 일', icon: <ListChecks size={I} /> },
    { key: 'tasks', label: '팀 할 일', icon: <Users size={I} /> },
    { key: 'payments', label: '결제 대장', icon: <Wallet size={I} /> },
    { key: 'subs', label: '구독료', icon: <Repeat size={I} /> },
  ]
  const activeTab = tabs.some(t => t.key === view) ? view : null
  return (
    <Shell active="projects">
      {/* ① 화면 고르기 (밑줄 탭) */}
      <ViewTabs label="프로젝트 화면" items={tabs} active={activeTab} onPick={v => navigate(v ? `/projects?view=${v}` : '/projects')} />
      {/* ② 찾기 · 만들기 (한 줄) */}
      {/* ② 찾기 · 만들기: 한 줄, 검색이 가장 넓게 (2026-10-28 "더 미니멀하게") */}
      <div className="row proj-tools">
        <ProjectSearch value={q} onChange={v => go({ q: v || null })} />
        {/* 거래처 · 연락처 (대표 지시 2026-10-22 "거래처 프로젝트에 통합") */}
        <button type="button" className="icon-btn" onClick={() => navigate('/clients')} title="거래처 · 연락처" aria-label="거래처 · 연락처">
          <Building2 size={16} />
        </button>
        {view !== 'payments' && view !== 'schedule' && view !== 'subs' && (
          <Button kind="ghost" size="sm" onClick={() => setAssigning(true)} title="팀원에게 업무 지시">
            <ListChecks size={14} /> 업무 지시
          </Button>
        )}
        {view !== 'payments' && (
          <Button size="sm" onClick={() => setEditing('new')} title="새 프로젝트">
            <Plus size={14} /> 프로젝트
          </Button>
        )}
      </div>
      {words.length ? (
        <div className="col gap-10">
          <SectionHead title={`‘${q}’ 프로젝트`} count={String(foundProjects.length)} right={<button type="button" className="link-btn t-cap" onClick={() => go({ q: null })}>검색 지우기</button>} />
          <ProjectBoard list={sorted(foundProjects)} data={data} loading={loading} onOpen={id => go({ id })} />
          <SectionHead title={`‘${q}’ 할 일`} count={String(foundTasks.length)} />
          <TaskBoard list={foundTasks} projects={data.projects} onStatus={() => undefined} onEdit={t => t.project_id && go({ id: t.project_id })} />
        </div>
      ) : view === 'payments' ? (
        <Payments projects={data.projects} clients={data.clients} />
      ) : view === 'org' ? (
        <OrgSection />
      ) : view === 'subs' ? (
        <Subscriptions />
      ) : view === 'schedule' ? (
        <Gantt projects={data.projects} tasks={data.tasks} />
      ) : view === 'week' ? (
        <WeekView projects={data.projects} tasks={data.tasks} />
      ) : view === 'calendar' ? (
        <MonthCalendar projects={data.projects} tasks={data.tasks} />
      ) : view === 'mine' || view === 'tasks' ? (
        <div className="col gap-12">
          {view === 'mine' && <MineReports />}
          {view === 'mine' && <SentTasks projects={data.projects} tasks={data.tasks} />}
          <TaskList tasks={data.tasks} projects={data.projects} mineOnly={view === 'mine'} />
        </div>
      ) : view === 'list' || (!view && wide) ? (
        <div className="proj-list-wrap">
        <div className="row top gap-12" style={{ flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
          <div className="col grow" style={{ flexBasis: 320 }}>
            {/* ③ 거르기: 이름표가 붙은 묶음 · 정렬은 풀다운 */}
            <div className="row wrap proj-filters">
              <FilterGroup label="상태">
                {(['진행', '기획'] as ProjectStatus[]).map(s => (
                  <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => go({ status: s === '진행' ? null : s })}>
                    {s} <b>{shown.filter(p => p.status === s).length}</b>
                  </button>
                ))}
                <button type="button" className={status === 'all' ? 'on' : ''} onClick={() => go({ status: 'all' })}>
                  전체 <b>{shown.filter(p => OPEN.includes(p.status)).length}</b>
                </button>
              </FilterGroup>
              <FilterGroup label="회사">
                {([[null, '전체'], ...DIVISION_KEYS.map(k => [k, DIVISIONS[k].label])] as [string | null, string][]).map(([k, l]) => (
                  <button key={l} type="button" className={brand === k ? 'on' : ''} onClick={() => go({ brand: k })}>
                    {k && <i className="div-dot" style={{ background: DIVISIONS[k as Division].color }} />}
                    {l}
                  </button>
                ))}
              </FilterGroup>
              <span className="grow" />
              <label className="filter-group" title="정렬">
                <select className="sort-select" value={sort ?? ''} onChange={e => go({ sort: e.target.value || null })} aria-label="정렬">
                  <option value="">연번순</option>
                  <option value="name">이름순</option>
                  <option value="recent">최근순</option>
                </select>
              </label>
            </div>
            {/* 회사별로 나눠 보기: 아트리어(AR) · 더위클리(TW) — 회사 칩을 고르면 그 회사만 */}
            {/* 구분별 카드 (조직 · 진행 현황과 같은 모양): 아트리어 · 더위클리 · 내부 리서치 — 위쪽 색 띠 = 대표 색상 */}
            <div className="div-cards">
              {DIVISION_KEYS.filter(k => !brand || brand === k).map(k => {
                const rows = sorted(shown.filter(p => projectBrand(p) === k && OPEN.includes(p.status) && (status === 'all' || p.status === status)))
                return (
                  <section key={k} className="div-card" style={{ borderTopColor: DIVISIONS[k].color }}>
                    <div className="row">
                      <span className="t-bodyb grow" style={{ color: DIVISIONS[k].color }}>
                        {DIVISIONS[k].full}
                      </span>
                      <span className="board-count">{rows.length}</span>
                    </div>
                    <ProjectBoard list={rows} data={data} loading={loading} onOpen={id => go({ id })} />
                    {/* 이 자리에서 바로 만들기 (대표 지시 2026-10-23 "프로젝트를 열어서 바로 생성") */}
                    <QuickProject division={k} onCreated={id => go({ id })} onMore={() => setNewDiv(k)} />
                  </section>
                )
              })}
            </div>
            {/* 드라이브 폴더 구성과 같게: 완료 · 대기 / NIC 는 펼쳐 보기 */}
            {([
              ['done', '완료 · 대기 프로젝트', ['완료', '보류']],
              ['nic', 'NIC 프로젝트', ['NIC']],
            ] as [string, string, ProjectStatus[]][]).map(([k, label, sts]) => {
              const rows = sorted(shown.filter(p => sts.includes(p.status)))
              return (
                <details key={k} className={`proj-group g-${k}`} open={sts.includes(status as ProjectStatus)}>
                  <summary>
                    {k === 'done' ? <CheckCircle2 size={14} /> : <CircleSlash size={14} />}
                    <span className="t-bodyb">{label}</span>
                    <span className="board-count">{rows.length}</span>
                  </summary>
                  <ProjectBoard list={rows} data={data} loading={loading} onOpen={id => go({ id })} />
                </details>
              )
            })}
          </div>
          <MiniCalendar data={data} />
        </div>
        </div>
      ) : (
        <ProjectDashboard projects={data.projects} tasks={data.tasks} clients={data.clients} />
      )}
      {editing && <ProjectForm key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? null : editing} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />}
      {newDiv && <ProjectForm key={`new-${newDiv}`} project={null} division={newDiv} clients={data.clients} onClose={() => setNewDiv(null)} onSaved={id => go({ id })} />}
      {assigning && <TaskAssignModal projects={data.projects} tasks={data.tasks} onClose={() => setAssigning(false)} />}
    </Shell>
  )
}

/** 프로젝트 목록 게시판: 번호 · 상태 · 프로젝트 · 거래처 · 구분 · 담당 · 기간 · 할 일 */
function ProjectBoard({ list, data, loading, onOpen }: { list: Project[]; data: Data; loading: boolean; onOpen: (id: string) => void }) {
  const { api, profileName, toast } = useApp()
  const { busy, run } = useAction()
  const syncFolder = useProjectFolderSync()
  const today = todayKey()
  // 그룹(구분) 바꾸기 (대표 지시 2026-10-21 "프로젝트 목록에서 프로젝트가 포함된 그룹을 수정할 수 있게")
  const moveTo = async (p: Project, div: Division) => {
    if (div === projectBrand(p)) return
    const auto = /^(AR|TW|RS)\d{4}-\d+$/.test(p.code ?? '')
    if (!(await ask(`'${p.name}'을(를) ${DIVISIONS[div].full}(으)로 옮길까요?${auto ? `\n연번이 ${div}로 새로 매겨집니다.` : ''}`))) return
    void (async () => {
      let saved: Project | null = null
      const ok = await run(async () => {
        saved = await api.saveProject({ id: p.id, division: div })
      }, `${DIVISIONS[div].label}(으)로 옮겼습니다.`)
      if (ok && saved) syncFolder(saved).then(m => m && toast(m)).catch(() => undefined)
    })()
  }
  const cols: BoardCol<Project>[] = [
    {
      key: 'name',
      label: '프로젝트',
      kind: 'title',
      cell: p => (
        <>
          <span className="t-smallb">{p.name}</span>
          {p.location && <span className="cell-sub">{p.location}</span>}
        </>
      ),
    },
    { key: 'code', label: '연번', width: 92, cell: p => (
        <span className="t-mono row" style={{ gap: 4 }} title={DIVISIONS[projectBrand(p)].full}>
          <i className="div-dot" style={{ background: DIVISIONS[projectBrand(p)].color }} />
          {p.code ?? '-'}
        </span>
      ) },
    {
      key: 'group',
      label: '그룹',
      width: 104,
      cell: p => (
        <select
          className="div-select"
          value={projectBrand(p)}
          disabled={busy}
          style={{ borderColor: DIVISIONS[projectBrand(p)].color, color: DIVISIONS[projectBrand(p)].color }}
          onClick={e => e.stopPropagation()}
          onChange={e => moveTo(p, e.target.value as Division)}
          aria-label={`${p.name} 그룹`}
          title="그룹 바꾸기"
        >
          {DIVISION_KEYS.map(k => (
            <option key={k} value={k}>
              {DIVISIONS[k].label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'drive',
      label: '드라이브',
      width: 64,
      cell: p => {
        const d = projectDriveUrl(p)
        return (
          <a href={d.url} target="_blank" rel="noreferrer" className={`drive-link${d.exact ? '' : ' guess'}`} onClick={e => e.stopPropagation()} title={d.exact ? '드라이브 폴더 열기' : '드라이브에서 찾기 (폴더 주소 없음)'}>
            <FolderOpen size={14} />
          </a>
        )
      },
    },
    {
      key: 'status',
      label: '상태',
      width: 76,
      cell: p => (
        <select
          className="div-select"
          value={p.status}
          disabled={busy}
          onClick={e => e.stopPropagation()}
          onChange={e => run(() => api.saveProject({ id: p.id, status: e.target.value as ProjectStatus }), `${e.target.value}(으)로 바꿨습니다.`)}
          aria-label={`${p.name} 상태`}
          title="상태 바꾸기 (완료 · 보류 · NIC 는 아래 묶음으로 옮겨짐)"
        >
          {PROJECT_STATUSES.map(st => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      ),
    },
    { key: 'client', label: '거래처', width: 140, hideNarrow: true, cell: p => data.clients.find(c => c.id === p.client_id)?.name ?? '자체' },
    { key: 'cat', label: '구분', width: 70, hideNarrow: true, cell: p => p.category },
    { key: 'owner', label: '담당', width: 80, cell: p => (p.owner_id ? profileName(p.owner_id) : '-') },
    { key: 'period', label: '기간', width: 150, hideNarrow: true, cell: p => periodLabel(p.start_date, p.end_date) },
    {
      key: 'tasks',
      label: '할 일',
      width: 90,
      kind: 'num',
      cell: p => {
        const tasks = data.tasks.filter(t => t.project_id === p.id)
        const late = tasks.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length
        return tasks.length ? (
          <>
            {tasks.filter(t => t.status === '완료').length}/{tasks.length}
            {late > 0 && <span className="t-red"> 지연 {late}</span>}
          </>
        ) : (
          '-'
        )
      },
    },
  ]
  return <Board rows={list} cols={cols} rowKey={p => p.id} onRow={p => onOpen(p.id)} numbered={false} empty={loading ? '불러오는 중…' : '프로젝트가 없습니다.'} />
}

function MiniCalendar({ data }: { data: Data }) {
  const today = todayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sel, setSel] = useState<string | null>(null)
  const events = useMemo(() => {
    const m = new Map<string, { label: string; red?: boolean; to: string }[]>()
    const push = (d: string | null, e: { label: string; red?: boolean; to: string }) => d && m.set(d, [...(m.get(d) ?? []), e])
    for (const t of data.tasks) if (t.status !== '완료') push(t.due_date, { label: t.title, to: t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=tasks' })
    for (const p of data.projects) if (p.status !== '완료') push(p.end_date, { label: `${p.name} 종료`, red: true, to: `/projects?id=${p.id}` })
    return m
  }, [data])
  const [ws, we] = weekRange(today)
  const listDays = sel ? [sel] : [...events.keys()].filter(d => d >= ws && d <= we).sort()
  return (
    <aside className="box col gap-6 proj-mini-cal" aria-label="일정 달력">
      <div className="row">
        <button type="button" className="icon-btn sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="이전 달">
          <ChevronLeft size={14} />
        </button>
        <span className="t-meta t-blue">{month.replace('-', '.')}</span>
        <button type="button" className="icon-btn sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRight size={14} />
        </button>
        <span className="grow" />
        {month !== today.slice(0, 7) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(today.slice(0, 7))}>
            오늘
          </button>
        )}
      </div>
      <div className="cal">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {monthGrid(month).map((d, i) =>
          d ? (
            <button key={d} type="button" className={`${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d === sel ? null : d)} aria-label={`${dateLabel(d)} 일정 ${events.get(d)?.length ?? 0}건`}>
              <span className="n">{Number(d.slice(8))}</span>
              <span className="dots">
                {(events.get(d) ?? []).slice(0, 3).map((e, j) => (
                  <i key={j} className={e.red ? 'red' : ''} />
                ))}
              </span>
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <div className="dashed" />
      <span className="t-smallb">{sel ? dateLabel(sel) : '이번 주 일정'}</span>
      {/* 최신 날짜가 위로 (대표 지시 2026-10-23) */}
      {[...listDays].reverse().flatMap(d =>
        (events.get(d) ?? []).map((e, j) => (
          <Link key={`${d}-${j}`} to={e.to} className="row t-cap mini-cal-ev" title={e.label}>
            <span className={`t-meta nowrap ${e.red ? 't-red' : ''}`}>
              {shortDate(d)} {weekday(d)}
            </span>
            <span className="truncate">{e.label}</span>
          </Link>
        )),
      )}
      {listDays.every(d => !(events.get(d) ?? []).length) && <span className="t-cap">일정이 없습니다.</span>}
    </aside>
  )
}

/** 그룹 아래 '+ 새 프로젝트' 줄: 이름만 쓰고 Enter → 바로 만들고 열기 (진행 · 담당 나 · 연번 자동) */
function QuickProject({ division, onCreated, onMore }: { division: Division; onCreated: (id: string) => void; onMore: () => void }) {
  const { api, me, toast, bump } = useApp()
  const syncFolder = useProjectFolderSync()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    const v = name.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      const p = await api.saveProject({ name: v, division, category: division === 'AR' ? '팝업' : '콘텐츠', status: '진행', owner_id: me.id })
      setName('')
      bump()
      toast(`'${v}' 프로젝트를 만들었습니다${p.code ? ` (${p.code})` : ''}.`)
      onCreated(p.id)
      syncFolder(p).then(m => m && toast(m)).catch(() => undefined)
    } catch (e) {
      toast(e instanceof Error ? e.message : '만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="quick-proj">
      <Plus size={14} style={{ color: DIVISIONS[division].color }} />
      <input
        className="input"
        value={name}
        maxLength={120}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && void create()}
        placeholder={`새 ${DIVISIONS[division].label} 프로젝트 이름 · Enter 로 바로 만들기`}
        disabled={busy}
        aria-label={`새 ${DIVISIONS[division].label} 프로젝트`}
      />
      <button type="button" className="btn btn-sm" onClick={() => void create()} disabled={busy || !name.trim()}>
        만들기
      </button>
      <button type="button" className="link-btn t-cap" onClick={onMore} title="거래처 · 기간 · 장소까지 정해서 만들기">
        자세히
      </button>
    </div>
  )
}

const NEXT: Record<TaskStatus, TaskStatus> = { '할 일': '진행 중', '진행 중': '완료', 완료: '할 일' }

/** datetime-local 값 → ISO */
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
const alarmLabel = (iso: string) => `${shortDate(toDateKey(iso))} ${timeLabel(iso)}`

/** 할 일 추가 줄: 제목 · 담당 · 마감 · 알람 */
function TaskAdder({ projectId, defaultAssignee }: { projectId: string | null; defaultAssignee: string }) {
  const { api, profiles } = useApp()
  const { busy, run } = useAction()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(defaultAssignee)
  const [due, setDue] = useState('')
  const [alarm, setAlarm] = useState('')
  const add = async () => {
    if (!title.trim()) return
    if (await run(() => api.saveTask({ project_id: projectId, title: title.trim(), assignee_id: assignee || null, due_date: due || null, remind_at: fromLocalInput(alarm) }), alarm ? `알람을 ${alarmLabel(fromLocalInput(alarm)!)}에 맞췄어요.` : undefined)) {
      setTitle('')
      setDue('')
      setAlarm('')
    }
  }
  return (
    <div className="row wrap" style={{ paddingTop: 2 }}>
      <input className="input" style={{ flex: '2 1 180px' }} placeholder="할 일 추가 (Enter)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && add()} aria-label="새 할 일" />
      <select className="select" style={{ width: 104 }} value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="담당자">
        <option value="">담당 없음</option>
        {profiles
          .filter(x => x.active)
          .map(x => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
      </select>
      <input className="input" style={{ width: 132 }} type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="마감일" title="마감일" />
      <label className="row" style={{ gap: 4 }} title="이 시각에 알림 (PC 알림을 켜면 화면 밖에서도 알려 줘요)">
        <AlarmClock size={15} className="t-blue" />
        <input className="input" style={{ width: 178 }} type="datetime-local" value={alarm} onChange={e => setAlarm(e.target.value)} aria-label="알람 시각" />
      </label>
      <Button onClick={add} disabled={busy || !title.trim()}>
        추가
      </Button>
    </div>
  )
}

function TaskList({ tasks, projects, mineOnly }: { tasks: Task[]; projects: Project[]; mineOnly: boolean }) {
  const { api, me } = useApp()
  const { run } = useAction()
  const today = todayKey()
  const [, we] = weekRange(today)
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const rows = tasks.filter(t => (!mineOnly || t.assignee_id === me.id) && (showDone || t.status !== '완료'))
  const groups: [string, Task[]][] = [
    ['지연', rows.filter(t => t.status !== '완료' && t.due_date && t.due_date < today)],
    ['오늘', rows.filter(t => t.due_date === today)],
    ['이번 주', rows.filter(t => t.due_date && t.due_date > today && t.due_date <= we)],
    ['이후', rows.filter(t => t.due_date && t.due_date > we)],
    ['날짜 없음', rows.filter(t => !t.due_date)],
    ['완료', showDone ? rows.filter(t => t.status === '완료' && t.due_date && t.due_date < today) : []],
  ]
  return (
    <div className="col gap-10">
      <TaskAdder projectId={null} defaultAssignee={me.id} />
      <label className="row t-cap" style={{ gap: 6 }}>
        <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 완료한 할 일도 보기
        <span className="grow" />
        {!mineOnly && <TaskLegend />}
      </label>
      {groups.map(([label, list]) =>
        list.length ? (
          <div key={label} className="col gap-2">
            <div className="section-h">
              <span className={`t-bodyb ${label === '지연' ? 't-red' : ''}`}>{label}</span>
              <Badge tone={label === '지연' ? 'red' : 'yellow'}>{list.length}</Badge>
            </div>
            <TaskBoard
              list={list}
              late={label === '지연'}
              projects={projects}
              onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT[t.status] }))}
              onEdit={t => setEditing(t)}
            />
          </div>
        ) : null,
      )}
      {rows.length === 0 && <Empty>{mineOnly ? '나에게 배정된 할 일이 없습니다.' : '할 일이 없습니다.'}</Empty>}
      {editing && <TaskAssignModal key={editing.id} task={editing} projects={projects} tasks={tasks} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** 할 일 게시판: 번호 · 상태 · 할 일 · 프로젝트 · 담당 · 마감 · 알람 · 고치기 */
function TaskBoard({ list, late, projects, onStatus, onEdit, onDelete }: { list: Task[]; late?: boolean; projects: Project[]; onStatus: (t: Task) => void; onEdit?: (t: Task) => void; onDelete?: (t: Task) => void }) {
  const { me, profileName, profileOf } = useApp()
  const today = todayKey()
  const cols: BoardCol<Task>[] = [
    {
      key: 'status',
      label: '상태',
      width: 72,
      cell: t => (
        <button type="button" className="link-btn" onClick={e => (e.stopPropagation(), onStatus(t))} title="눌러서 상태 변경 (할 일 → 진행 중 → 완료)">
          <StatusBadge status={late || (t.status !== '완료' && !!t.due_date && t.due_date < today) ? '지연' : t.status} />
        </button>
      ),
    },
    {
      key: 'title',
      label: '할 일',
      kind: 'title',
      cell: t => {
        const creator = profileOf(t.created_by)
        const sub = [t.phase, creator?.is_agent ? `${creator.name} 배정` : creator && creator.id !== t.assignee_id ? `${creator.name} 지시` : null, t.start_date && t.due_date && t.start_date !== t.due_date ? `${shortDate(t.start_date)}~${shortDate(t.due_date)}` : null].filter(Boolean).join(' · ')
        return (
          <>
            <span className="t-smallb" style={t.status === '완료' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
              {t.title}
            </span>
            {sub && <span className="cell-sub">{sub}</span>}
          </>
        )
      },
    },
    { key: 'project', label: '프로젝트', width: 170, hideNarrow: true, cell: t => (t.project_id ? <span onClick={e => e.stopPropagation()}><Link to={`/projects?id=${t.project_id}`}>{projects.find(p => p.id === t.project_id)?.name ?? ''}</Link></span> : '-') },
    { key: 'assignee', label: '담당', width: 80, cell: t => (t.assignee_id ? <span className={t.assignee_id === me.id ? 't-smallb' : ''}>{profileName(t.assignee_id)}</span> : '-') },
    { key: 'due', label: '마감', width: 96, cell: t => (t.due_date ? <span className={`t-meta ${t.status !== '완료' && t.due_date < today ? 't-red' : ''}`}>{t.due_date === today ? '오늘' : `${shortDate(t.due_date)} ${weekday(t.due_date)}`}</span> : '-') },
    { key: 'alarm', label: '알람', width: 100, hideNarrow: true, cell: t => (t.remind_at && t.status !== '완료' ? <span className="t-meta">{alarmLabel(t.remind_at)}</span> : '-') },
    {
      key: 'act',
      label: '',
      width: onDelete ? 56 : 34,
      kind: 'center',
      cell: t => (
        <>
          {onEdit && (
            <button type="button" className="icon-btn sm" onClick={e => (e.stopPropagation(), onEdit(t))} aria-label={`${t.title} 고치기`} title="고치기 (제목 · 담당 · 날짜 · 메모)">
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button type="button" className="icon-btn sm" onClick={e => (e.stopPropagation(), onDelete(t))} aria-label="할 일 삭제" title="삭제">
              <Trash2 size={13} />
            </button>
          )}
        </>
      ),
    },
  ]
  return <Board rows={list} cols={cols} rowKey={t => t.id} onRow={onEdit} rowClass={t => (t.status === '완료' ? 'done' : undefined)} compact empty="할 일이 없습니다." />
}

/** 내 할 일 · 팀 할 일 색 구분 */
function TaskLegend() {
  return (
    <span className="legend">
      <span>
        <i style={{ background: 'var(--blue)' }} />내 할 일
      </span>
      <span>
        <i style={{ background: 'var(--blue-tint)' }} />팀 할 일
      </span>
    </span>
  )
}


function ProjectDetail({ project: p, data, onEdit, onBack, panel = false }: { project: Project; data: Data; onEdit: () => void; onBack: () => void; /** 오른쪽 칸 안에 그릴 때 (자료 칸을 따로 띄우지 않음) */ panel?: boolean }) {
  const { api, me, profileName, version } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const [approving, setApproving] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const tasks = data.tasks.filter(t => t.project_id === p.id)
  const client = data.clients.find(c => c.id === p.client_id)
  // 이 프로젝트에 연결된 자료는 오른쪽 칸(검색 창 자리)에 표시
  useRightPanel(panel ? null : `project:${p.id}`, '프로젝트 자료', <ProjectMaterials projectId={p.id} />)
  const { data: extra } = useAsync(
    async () => {
      const [logs, rooms, contacts, approvals] = await Promise.all([
        api.listWorkLogs({ projectId: p.id, limit: 50 }),
        api.listRooms(),
        api.listContacts().catch(() => [] as Contact[]),
        api.listApprovals().catch(() => [] as Approval[]),
      ])
      const related = approvals.filter(a => a.target_id === p.id || a.payload?.project_id === p.id)
      return { logs, room: rooms.find(r => r.project_id === p.id && !r.members) ?? null, contacts, approvals: related }
    },
    [p.id, version],
    { logs: [] as WorkLog[], room: null as ChatRoomSummary | null, contacts: [] as Contact[], approvals: [] as Approval[] },
  )

  const openRoom = async () => {
    if (extra.room) return navigate(`/chat?room=${extra.room.id}`)
    let id = ''
    const ok = await run(async () => {
      id = (await api.createRoom({ name: p.name, project_id: p.id })).id
    }, '프로젝트 채팅방을 만들었습니다.')
    if (ok) navigate(`/chat?room=${id}`)
  }

  return (
    <>
      <div className="row wrap">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        {p.code && <span className="proj-code" style={{ background: DIVISIONS[projectBrand(p)].color }} title={DIVISIONS[projectBrand(p)].full}>{p.code}</span>}
        <h2 className="t-title truncate">{p.name}</h2>
        <StatusBadge status={p.status} />
        <Badge>{p.category}</Badge>
        <span className="grow" />
        <a className="btn btn-outline btn-sm drive-btn" href={projectDriveUrl(p).url} target="_blank" rel="noreferrer" title={projectDriveUrl(p).exact ? '구글 드라이브 프로젝트 폴더 열기' : '폴더 주소가 아직 없어 드라이브에서 연번 · 이름으로 찾기'}>
          <FolderOpen size={13} /> 드라이브{projectDriveUrl(p).exact ? '' : ' 찾기'}
        </a>
        <Button kind="outline" size="sm" onClick={openRoom} disabled={busy}>
          {extra.room ? '채팅방' : '채팅방 만들기'}
        </Button>
        <Button kind="outline" size="sm" onClick={() => setApproving(true)}>
          승인 요청
        </Button>
        <Button kind="yellow" size="sm" onClick={onEdit}>
          수정
        </Button>
        {me.role === 'admin' && (
          <Button
            kind="ghost"
            size="sm"
            onClick={async () => {
              if ((await ask(`'${p.name}' 프로젝트와 할 일을 모두 삭제할까요?`)) && (await run(() => api.deleteProject(p.id), '삭제했습니다.'))) onBack()
            }}
          >
            삭제
          </Button>
        )}
      </div>
      <div className="box">
        <dl className="kv">
          <dt>연번</dt>
          <dd>{p.code ?? '-'} <span className="t-cap">· 드라이브 폴더 이름과 같은 번호</span></dd>
          <dt>거래처</dt>
          <dd>{client ? <Link to={`/clients?id=${client.id}`}>{client.name}</Link> : '자체'}</dd>
          <dt>담당</dt>
          <dd>{p.owner_id ? profileName(p.owner_id) : '-'}</dd>
          <dt>기간</dt>
          <dd>{p.start_date && p.end_date ? `${dateLabel(p.start_date)} – ${dateLabel(p.end_date)}` : p.start_date ? `${dateLabel(p.start_date)} 시작 · 종료일 미정` : p.end_date ? `${dateLabel(p.end_date)} 마감 · 시작일 미정` : '기간 미정'}</dd>
          {p.location && (
            <>
              <dt>장소</dt>
              <dd>{p.location}</dd>
            </>
          )}
          {p.description && (
            <>
              <dt>설명</dt>
              <dd className="pre">{p.description}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="row top gap-12" style={{ flexWrap: 'wrap' }}>
        <div className="col grow" style={{ flexBasis: 300 }}>
          <SectionHead title="할 일" count={`${tasks.filter(t => t.status === '완료').length}/${tasks.length}`} right={<TaskLegend />} />
          <TaskBoard
            list={tasks}
            projects={data.projects}
            onStatus={t => run(() => api.saveTask({ id: t.id, status: NEXT[t.status] }))}
            onDelete={async t => (await ask('이 할 일을 삭제할까요?')) && run(() => api.deleteTask(t.id))}
            onEdit={t => setEditingTask(t)}
          />
          <TaskAdder projectId={p.id} defaultAssignee={me.id} />
        </div>
        <div className="col proj-inline-materials" style={{ flexBasis: 240, flexGrow: 1, maxWidth: 360 }}>
          <ProjectContactsSection project={p} clients={data.clients} contacts={extra.contacts} />
          <ExchangeFilesSection clientId={p.client_id} projectId={p.id} contacts={extra.contacts} projects={data.projects} />
          <SectionHead title="관련 업무 기록" count={extra.logs.length ? String(extra.logs.length) : undefined} right={<Link to={`/work?team=1`}>업무 일지 ›</Link>} />
          <ContactTimeline logs={extra.logs} projects={[]} showContact contacts={extra.contacts} />
        </div>
      </div>
      {/* 구글 드라이브 자료: 드라이브 파일을 가리켜 늘 최신 · 구글 문서는 편집 화면으로 */}
      <ProjectDriveSection project={p} />
      {/* 인테리어(아트리어 · AR) 프로젝트는 현장 작업일지, 다른 프로젝트는 작업일지가 있을 때만 */}
      <SiteLogsSection project={p} always={projectBrand(p) === 'AR'} />
      {/* 프로젝트 시각화: 목표 대비 KPI · 예산 대 집행 · 비용 구성 · 월별 흐름 · 업체 지급률 · 일정 진행 */}
      <ProjectVizLoader project={p} />
      <FinancePanel project={p} clients={data.clients} projects={data.projects} />
      {/* 자재 입출고: 입고 · 반품은 위 결제 내역(지급)에 자동 등록 */}
      <MaterialMoves project={p} clients={data.clients} />
      {/* 이 프로젝트의 결재 · 보고 */}
      <SectionHead title="결재 · 보고" count={extra.approvals.length ? String(extra.approvals.length) : undefined} right={<Link to="/approvals">보고서 결제 ›</Link>} />
      {extra.approvals.length === 0 ? (
        <span className="t-cap">이 프로젝트로 올린 결재가 없습니다.</span>
      ) : (
        <div className="col">
          {extra.approvals.slice(0, 12).map(a => (
            <Link key={a.id} to={`/approvals?id=${a.id}`} className="row dashed link-row" style={{ padding: '5px 0', gap: 6 }}>
              <KindTag kind={a.kind} />
              <span className="t-small truncate grow">{a.title}</span>
              <StatusBadge status={a.status} />
            </Link>
          ))}
        </div>
      )}
      {editingTask && <TaskAssignModal key={editingTask.id} task={editingTask} projects={data.projects} tasks={data.tasks} onClose={() => setEditingTask(null)} />}
      {approving && <NewApproval preset={{ kind: '프로젝트', target_id: p.id, title: `프로젝트: ${p.name}` }} onClose={() => setApproving(false)} onCreated={id => navigate(`/approvals?view=mine&id=${id}`)} />}
    </>
  )
}

/** 프로젝트 탭 맨 위 검색창 (Enter 또는 입력을 멈추면 검색) */
function ProjectSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  return (
    <form
      className="search proj-search"
      onSubmit={e => {
        e.preventDefault()
        onChange(text.trim())
      }}
    >
      <Search size={13} />
      <input className="input" value={text} onChange={e => setText(e.target.value)} onBlur={() => text.trim() !== value && onChange(text.trim())} placeholder="프로젝트 · 연번 · 거래처 · 할 일 검색" aria-label="프로젝트 검색" />
    </form>
  )
}

export function ProjectForm({ project, clients, division, onClose, onSaved }: { project: Project | null; clients: Client[]; /** 새로 만들 때 구분 (그룹에서 바로 만들기) */ division?: Division; onClose: () => void; onSaved: (id: string) => void }) {
  const { api, me, profiles, toast } = useApp()
  const { busy, run } = useAction()
  const syncFolder = useProjectFolderSync()
  const [f, setF] = useState<Partial<Project>>(() => project ?? { name: '', division: division ?? 'AR', category: '팝업', status: '기획', owner_id: me.id, client_id: null, start_date: null, end_date: null, location: null, description: null })
  const set = (p: Partial<Project>) => setF(prev => ({ ...prev, ...p }))
  const submit = async () => {
    let saved: Project | null = null
    const ok = await run(async () => {
      saved = await api.saveProject({ ...f, name: (f.name ?? '').trim() })
    }, project ? '저장했습니다.' : '프로젝트를 만들었습니다.')
    if (ok && saved) {
      const p: Project = saved
      onClose()
      onSaved(p.id)
      // 드라이브 폴더 자동 생성 · 이름 맞춤 (회사 구글 계정에 로그인돼 있을 때)
      syncFolder(p).then(m => m && toast(m)).catch(e => toast(`드라이브 폴더: ${e instanceof Error ? e.message : '맞추지 못했습니다'}`))
    }
  }
  return (
    <Modal
      title={project ? '프로젝트 수정' : '새 프로젝트'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !f.name?.trim()} onClick={submit}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {/* label 로 감싸면 칩 클릭이 첫 칩으로 넘어가므로 div 로 */}
        <div className="label full">
          <span>구분</span>
          <div className="chips" role="radiogroup" aria-label="구분">
            {DIVISION_KEYS.map(k => (
              <Chip key={k} active={(f.division ?? 'AR') === k} onClick={() => set({ division: k })}>
                <i className="div-dot" style={{ background: DIVISIONS[k].color }} /> {DIVISIONS[k].label} ({k})
              </Chip>
            ))}
          </div>
        </div>
        {project && (
          <Field label="연번 (자동: 구분 + 시작 연월 + 번호 · 구분을 바꾸면 새 번호 · 관리자만 직접 변경)">
            <input className="input" value={f.code ?? ''} onChange={e => set({ code: e.target.value.trim().toUpperCase() || null })} disabled={me.role !== 'admin'} maxLength={12} />
          </Field>
        )}
        <Field label="이름" className="full">
          <input className="input" autoFocus value={f.name ?? ''} onChange={e => set({ name: e.target.value })} placeholder="예) 성수 팝업 '오브제 위크'" />
        </Field>
        <Field label="구글 드라이브 폴더 주소" className="full">
          <input className="input" value={f.drive_url ?? ''} onChange={e => set({ drive_url: e.target.value.trim() || null })} placeholder="https://drive.google.com/drive/folders/…  (비우면 연번 · 이름으로 찾기)" />
        </Field>
        <Field label="거래처">
          <select className="select" value={f.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null })}>
            <option value="">자체</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="담당">
          <select className="select" value={f.owner_id ?? ''} onChange={e => set({ owner_id: e.target.value || null })}>
            <option value="">없음</option>
            {profiles
              .filter(x => x.active)
              .map(x => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="구분">
          <select className="select" value={f.category} onChange={e => set({ category: e.target.value as Project['category'] })}>
            {PROJECT_CATEGORIES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <select className="select" value={f.status} onChange={e => set({ status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="시작일">
          <input className="input" type="date" value={f.start_date ?? ''} onChange={e => set({ start_date: e.target.value || null })} />
        </Field>
        <Field label="종료일">
          <input className="input" type="date" value={f.end_date ?? ''} min={f.start_date ?? undefined} onChange={e => set({ end_date: e.target.value || null })} />
        </Field>
        <Field label="장소" className="full">
          <input className="input" value={f.location ?? ''} onChange={e => set({ location: e.target.value || null })} />
        </Field>
        <Field label="설명" className="full">
          <textarea className="textarea" rows={3} value={f.description ?? ''} onChange={e => set({ description: e.target.value || null })} />
        </Field>
      </div>
    </Modal>
  )
}


/** 내 할 일 위: 승인 안 된 업무 보고 (승인될 때까지 남음) */
function MineReports() {
  const { data } = useWorkReports()
  return (
    <>
      <OverdueCleanup renderEdit={(t, projects, tasks, close) => <TaskAssignModal key={t.id} task={t} projects={projects} tasks={tasks} onClose={close} />} />
      <PendingReports reports={data} />
    </>
  )
}
