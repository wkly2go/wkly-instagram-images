// 오른쪽 칸: 주간 일정표 ↔ 프로젝트 일정 중 하나 고르기 (대표 지시 2026-10-31
//   "인터넷 창은 삭제하고 주간 일정표 위치에 프로젝트 스케줄을 이동시켜서 둘 중 하나 선택할 수 있게")
//   - 프로젝트를 열어 둔 동안: 그 프로젝트 일정(타임라인 · 한 줄 일정 넣기 · 일지로 편집)
//   - 프로젝트를 열지 않았을 때: 진행 · 기획 중 프로젝트들의 기간 · 다가오는 일정 목록 (누르면 그 프로젝트로)
import { useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, shortDate, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import type { Client, Payment, Project, Task } from '../lib/types'
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
        <div className="right-proj">
          <ProjectVizLoader project={project} part="schedule" />
        </div>
      ) : (
        <AllProjects projects={data.projects} tasks={data.tasks} onOpen={id => navigate(`/projects?id=${id}`)} />
      )}
    </div>
  )
}

/** 프로젝트를 열지 않았을 때: 진행 · 기획 중 프로젝트별 기간 · D-day · 다가오는 일정 */
function AllProjects({ projects, tasks, onOpen }: { projects: Project[]; tasks: Task[]; onOpen: (id: string) => void }) {
  const { profileName } = useApp()
  const today = todayKey()
  const until = addDays(today, 14)
  const list = projects
    .filter(p => p.status === '진행' || p.status === '기획')
    .sort((a, b) => (a.end_date ?? a.start_date ?? '9').localeCompare(b.end_date ?? b.start_date ?? '9'))
  if (!list.length) return <span className="t-cap">진행 중인 프로젝트가 없습니다.</span>
  return (
    <ul className="right-plist">
      {list.map(p => {
        const mine = tasks.filter(t => t.project_id === p.id && t.status !== '완료' && t.due_date)
        const late = mine.filter(t => t.due_date! < today)
        const next = mine.filter(t => t.due_date! >= today && t.due_date! <= until).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
        const start = p.start_date
        const end = p.end_date ?? p.start_date
        const label = !start || !end ? '기간 미정' : today < start ? `시작 D-${dd(today, start)}` : today <= end ? `종료 D-${dd(today, end)}` : `종료 후 ${dd(end, today)}일`
        const prog = start && end && end > start ? Math.max(0, Math.min(100, (dd(start, today) / dd(start, end)) * 100)) : null
        return (
          <li key={p.id}>
            <button type="button" className="right-pitem" onClick={() => onOpen(p.id)}>
              <span className="rp-top">
                <b className="truncate">{[p.code, p.name].filter(Boolean).join(' ')}</b>
                <span className={`rp-dday${late.length ? ' late' : ''}`}>{late.length ? `지연 ${late.length}` : label}</span>
              </span>
              {prog != null && (
                <span className="rp-bar" title={`${shortDate(start!)} ~ ${shortDate(end!)}`}>
                  <i style={{ width: `${prog}%` }} />
                </span>
              )}
              {next.slice(0, 3).map(t => (
                <span key={t.id} className="rp-task">
                  <em>{shortDate(t.due_date!)}</em> {t.title}
                  {t.assignee_id && <span className="t-cap"> · {profileName(t.assignee_id)}</span>}
                </span>
              ))}
              {!next.length && !late.length && <span className="t-cap">2주 안 일정 없음</span>}
            </button>
          </li>
        )
      })}
    </ul>
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
