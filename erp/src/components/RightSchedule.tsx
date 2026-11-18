// 오른쪽 칸: 주간 일정표 ↔ 프로젝트 일정 중 하나 고르기 (대표 지시 2026-10-31
//   "인터넷 창은 삭제하고 주간 일정표 위치에 프로젝트 스케줄을 이동시켜서 둘 중 하나 선택할 수 있게")
//   - 프로젝트를 열어 둔 동안: 그 프로젝트 일정(타임라인 · 한 줄 일정 넣기 · 일지로 편집)
//   - 프로젝트를 열지 않았을 때: 진행 · 기획 중 프로젝트들의 기간 · 다가오는 일정 목록 (누르면 그 프로젝트로)
import { useState, useSyncExternalStore } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, shortDate, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import { DIVISIONS, DIVISION_KEYS, projectBrand, type Client, type Payment, type Project, type Task } from '../lib/types'
import { ClientDetail } from '../pages/Clients'
import { useAction } from '../lib/app'
import { manwon } from '../lib/date'
import { ProjectVizLoader } from './ProjectViz'
import { WeekPanel } from './WeekPanel'

const KEY = 'wkly-right-tab'

/** 협력업체 관리에서 업체를 누르면 오른쪽 칸에 업체 상세 (대표 지시 2026-10-31) */
type VendorOpen = { name: string; clientId: string | null } | null
let vendorOpen: VendorOpen = null
const vListeners = new Set<() => void>()
export function openVendor(v: VendorOpen) {
  vendorOpen = v
  for (const l of vListeners) l()
}
const useVendorOpen = () => useSyncExternalStore(cb => (vListeners.add(cb), () => void vListeners.delete(cb)), () => vendorOpen)
const norm = (s: string) => s.replace(/\s|㈜|\(주\)|주식회사/g, '').toLowerCase()
type Tab = 'week' | 'project'
const dd = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

export function RightSchedule() {
  const { api, version } = useApp()
  const { path, query, navigate } = useRouter()
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return localStorage.getItem(KEY) === 'project' ? 'project' : 'week'
    } catch {
      return 'week'
    }
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* noop */
    }
  }
  const { data } = useAsync(
    async () => {
      const [projects, tasks] = await Promise.all([api.listProjects(), api.listTasks().catch(() => [] as Task[])])
      return { projects, tasks }
    },
    [version],
    { projects: [] as Project[], tasks: [] as Task[] },
  )
  const vendor = useVendorOpen()
  const pid = path.startsWith('/projects') ? query.get('id') : null
  if (vendor) return <VendorPane v={vendor} onClose={() => openVendor(null)} />
  const project = pid ? data.projects.find(p => p.id === pid) : undefined

  return (
    <div className="right-sched">
      <div className="right-tabs" role="tablist" aria-label="오른쪽 칸">
        <button type="button" role="tab" aria-selected={tab === 'week'} className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>
          주간 일정표
        </button>
        <button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'on' : ''} onClick={() => setTab('project')}>
          프로젝트 일정
        </button>
      </div>
      {tab === 'week' ? (
        <WeekPanel />
      ) : project ? (
        <div className="right-proj right-scroll">
          <ProjectVizLoader project={project} part="schedule" />
        </div>
      ) : (
        <AllProjects projects={data.projects} tasks={data.tasks} onOpen={id => navigate(`/projects?id=${id}`)} />
      )}
    </div>
  )
}

/** 프로젝트를 열지 않았을 때: 진행 · 기획 중 프로젝트를 구분(아트리어 · 더위클리 · 내부 리서치)별로 묶어 기간 · D-day · 다가오는 일정
 *  (대표 지시 2026-11-16 '프로젝트로 묶어줘') — 2주 안 일정 · 지연이 있는 프로젝트는 카드로, 없는 것은 묶음 아래 한 줄씩
 *  2026-11-17 '스크롤할 수 있게 · 가장 최근 일정을 맨 위에 · 프로젝트를 접을 수 있게': 탭 아래만 따로 스크롤(.right-scroll),
 *  카드는 가장 가까운 일정 순(지연은 오늘로 침), 카드마다 접기(localStorage wkly-right-pshut) · 모두 접기/펼치기 */
const SHUT_KEY = 'wkly-right-pshut'
const readShut = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHUT_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
/** 일정이 가장 가까운 것부터: 지연이 있으면 오늘, 아니면 다음 할 일 마감일. 같으면 지연 많은 것 먼저 */
export function nearestKey(today: string, late: number, nextDue: string | undefined) {
  return late ? today : nextDue ?? '9999-12-31'
}
/** 2주 안 일정이 없는 줄: 앞으로 시작 · 남은 할 일이 가까운 것 → 끝난 지 얼마 안 된 것 → 기간 미정 */
export function quietKey(today: string, start: string | null | undefined, end: string | null | undefined, laterDue: string | undefined) {
  if (laterDue) return `0 ${laterDue}`
  if (start && start >= today) return `1 ${start}`
  if (end && end >= today) return `1 ${end}`
  if (end) return `2 ${String(99999999 - Number(end.replaceAll('-', ''))).padStart(8, '0')}`
  return '3'
}

function AllProjects({ projects, tasks, onOpen }: { projects: Project[]; tasks: Task[]; onOpen: (id: string) => void }) {
  const { profileName } = useApp()
  const [shut, setShutState] = useState<Set<string>>(readShut)
  const setShut = (next: Set<string>) => {
    setShutState(next)
    try {
      localStorage.setItem(SHUT_KEY, JSON.stringify([...next]))
    } catch {
      /* noop */
    }
  }
  const toggle = (id: string) => {
    const next = new Set(shut)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setShut(next)
  }
  const today = todayKey()
  const until = addDays(today, 14)
  const list = projects.filter(p => p.status === '진행' || p.status === '기획' || p.status === '상담협의')
  if (!list.length) return <span className="t-cap">진행 중인 프로젝트가 없습니다.</span>
  const rows = list.map(p => {
    const mine = tasks.filter(t => t.project_id === p.id && t.status !== '완료' && t.due_date)
    const late = mine.filter(t => t.due_date! < today).sort((a, b) => b.due_date!.localeCompare(a.due_date!))
    const upcoming = mine.filter(t => t.due_date! >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    const next = upcoming.filter(t => t.due_date! <= until)
    const start = p.start_date
    const end = p.end_date ?? p.start_date
    const label = !start || !end ? '기간 미정' : today < start ? `시작 D-${dd(today, start)}` : today <= end ? `종료 D-${dd(today, end)}` : `종료 후 ${dd(end, today)}일`
    const prog = start && end && end > start ? Math.max(0, Math.min(100, (dd(start, today) / dd(start, end)) * 100)) : null
    return { p, late, next, start, end, label, prog, busy: late.length > 0 || next.length > 0, key: nearestKey(today, late.length, next[0]?.due_date ?? undefined), qkey: quietKey(today, start, end, upcoming[0]?.due_date ?? undefined) }
  })
  const busyIds = rows.filter(r => r.busy).map(r => r.p.id)
  const allShut = busyIds.length > 0 && busyIds.every(id => shut.has(id))
  return (
    <div className="right-scroll">
      <div className="right-pgroups">
        {busyIds.length > 1 && (
          <div className="right-ptools">
            <span className="t-cap">가까운 일정 순</span>
            <button type="button" className="link-btn" onClick={() => setShut(allShut ? new Set([...shut].filter(id => !busyIds.includes(id))) : new Set([...shut, ...busyIds]))}>
              {allShut ? '모두 펼치기' : '모두 접기'}
            </button>
          </div>
        )}
        {DIVISION_KEYS.map(div => {
          const group = rows.filter(r => projectBrand(r.p) === div)
          if (!group.length) return null
          const busy = group.filter(r => r.busy).sort((a, b) => a.key.localeCompare(b.key) || b.late.length - a.late.length || (a.next[0]?.due_date ?? '').localeCompare(b.next[0]?.due_date ?? ''))
          const quiet = group.filter(r => !r.busy).sort((a, b) => a.qkey.localeCompare(b.qkey))
          const lateN = group.reduce((n, r) => n + r.late.length, 0)
          return (
            <details key={div} className={`right-pgroup g-${div}`} open>
              <summary>
                <ChevronDown size={13} className="rp-chev" aria-hidden="true" />
                <i style={{ background: DIVISIONS[div].color }} aria-hidden="true" />
                <b>{DIVISIONS[div].label}</b>
                <span className="t-cap">프로젝트 {group.length}</span>
                {lateN > 0 && <span className="rp-dday late">지연 {lateN}</span>}
              </summary>
              <ul className="right-plist">
                {busy.map(({ p, late, next, start, end, label, prog }) => {
                  const closed = shut.has(p.id)
                  const name = [p.code, p.name].filter(Boolean).join(' ')
                  const lines = [...late.slice(0, 3).map(t => ({ t, late: true })), ...next.slice(0, 3).map(t => ({ t, late: false }))]
                  return (
                    <li key={p.id} className={`right-pitem${closed ? ' shut' : ''}`}>
                      <div className="rp-top">
                        <button type="button" className="rp-fold" onClick={() => toggle(p.id)} aria-expanded={!closed} aria-label={`${name} ${closed ? '펼치기' : '접기'}`} title={closed ? '펼치기' : '접기'}>
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" className="rp-name truncate" onClick={() => onOpen(p.id)} title={`${name} 열기`}>{name}</button>
                        <span className={`rp-dday${late.length ? ' late' : ''}`}>{late.length ? `지연 ${late.length}` : label}</span>
                        {closed && next[0] && <span className="rp-next t-cap">{shortDate(next[0].due_date!)}</span>}
                      </div>
                      {!closed && (
                        <>
                          {prog != null && (
                            <span className="rp-bar" title={`${shortDate(start!)} ~ ${shortDate(end!)}`}>
                              <i style={{ width: `${prog}%` }} />
                            </span>
                          )}
                          {lines.map(({ t, late: isLate }) => (
                            <button key={t.id} type="button" className={`rp-task${isLate ? ' late' : ''}`} onClick={() => onOpen(p.id)}>
                              <em>{shortDate(t.due_date!)}</em> {t.title}
                              {t.assignee_id && <span className="t-cap"> · {profileName(t.assignee_id)}</span>}
                            </button>
                          ))}
                          {late.length > 3 && <span className="t-cap rp-more">지난 일정 {late.length - 3}건 더</span>}
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
              {quiet.length > 0 && (
                <div className="right-pquiet">
                  <span className="t-cap">2주 안 일정 없음 {quiet.length}</span>
                  {quiet.map(({ p, label }) => (
                    <button key={p.id} type="button" className="rp-quiet" onClick={() => onOpen(p.id)}>
                      <span className="truncate">{[p.code, p.name].filter(Boolean).join(' ')}</span>
                      <em>{label}</em>
                    </button>
                  ))}
                </div>
              )}
            </details>
          )
        })}
      </div>
    </div>
  )
}

/** 오른쪽 칸 업체 상세: 거래처로 등록돼 있으면 거래처 상세 그대로, 아니면 결제 기록 요약 + 거래처로 등록 */
function VendorPane({ v, onClose }: { v: NonNullable<VendorOpen>; onClose: () => void }) {
  const { api, version } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const { data } = useAsync(
    async () => {
      const [clients, payments, projects] = await Promise.all([api.listClients(), api.listPayments().catch(() => [] as Payment[]), api.listProjects()])
      return { clients, payments, projects }
    },
    [version],
    { clients: [] as Client[], payments: [] as Payment[], projects: [] as Project[] },
  )
  const client = data.clients.find(c => c.id === v.clientId) ?? data.clients.find(c => norm(c.name) === norm(v.name))
  const mine = data.payments.filter(p => p.status !== '취소' && (p.payee && norm(p.payee) === norm(v.name)))
  const byProject = new Map<string, Payment[]>()
  for (const p of mine) byProject.set(p.project_id ?? '-', [...(byProject.get(p.project_id ?? '-') ?? []), p])
  const pname = (id: string) => data.projects.find(p => p.id === id)?.name ?? '현장 없음'
  return (
    <div className="right-sched vendor-pane">
      <div className="vp-bar">
        <b className="grow truncate">{client?.name ?? v.name}</b>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label="업체 상세 닫기" title="닫고 일정으로">
          <X size={14} />
        </button>
      </div>
      {client ? (
        <ClientDetail key={client.id} client={client} clients={data.clients} onEdit={() => navigate(`/clients?id=${client.id}`)} onBack={onClose} />
      ) : (
        <div className="col gap-6">
          <span className="t-cap">거래처로 등록되지 않은 업체입니다. 등록하면 연락처 · 주고받은 자료 · 리서치가 이 칸에 함께 나옵니다.</span>
          <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => void run(() => api.saveClient({ name: v.name, category: '협력사' }), `${v.name}을(를) 협력사로 등록했습니다.`)}>
            협력사로 등록
          </button>
        </div>
      )}
      <div className="vp-sec">
        <b>결제 기록</b> <span className="t-cap">{mine.length}건 · 합계 {manwon(mine.reduce((n, p) => n + p.amount, 0)) || '0'}</span>
        {[...byProject.entries()].map(([pid, list]) => (
          <div key={pid} className="vp-proj">
            <button type="button" className="link-btn strong" onClick={() => pid !== '-' && navigate(`/projects?id=${pid}`)}>
              {pname(pid)}
            </button>
            {list.map(p => (
              <span key={p.id} className="vp-pay">
                <em>{p.paid_date ?? p.due_date ?? p.requested_date ?? ''}</em> {p.stage ?? p.title} <b>{manwon(p.amount)}</b> <span className={p.status === '완료' ? 't-blue' : 't-cap'}>{p.status}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
