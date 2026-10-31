// 오른쪽 칸: 주간 일정표 ↔ 프로젝트 일정 중 하나 고르기 (대표 지시 2026-10-31
//   "인터넷 창은 삭제하고 주간 일정표 위치에 프로젝트 스케줄을 이동시켜서 둘 중 하나 선택할 수 있게")
//   - 프로젝트를 열어 둔 동안: 그 프로젝트 일정(타임라인 · 한 줄 일정 넣기 · 일지로 편집)
//   - 프로젝트를 열지 않았을 때: 진행 · 기획 중 프로젝트들의 기간 · 다가오는 일정 목록 (누르면 그 프로젝트로)
import { useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { addDays, shortDate, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import type { Project, Task } from '../lib/types'
import { ProjectVizLoader } from './ProjectViz'
import { WeekPanel } from './WeekPanel'

const KEY = 'wkly-right-tab'
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
  const pid = path.startsWith('/projects') ? query.get('id') : null
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
