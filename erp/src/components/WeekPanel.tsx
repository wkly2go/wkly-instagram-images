import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import type { Project, Task } from '../lib/types'
import { mondayOf, TaskAssignModal } from '../pages/Schedule'

/**
 * 오른쪽 칸 주간 일정표 (대표 지시 2026-10-23 "오른쪽에는 주간 일정표, 인터넷 검색이 필요하면 주간 일정표는 사라지고")
 *  - 인터넷 검색 · 링크를 열면 이 자리에 검색 결과가 나오고, 닫으면 다시 주간 일정표
 *  - 월~일 하루씩: 마감 할 일 · 일정 · 프로젝트 시작/종료, 오늘은 노랑
 */
const WD = ['월', '화', '수', '목', '금', '토', '일']

export function WeekPanel() {
  const { api, me, version, profileName } = useApp()
  const { navigate } = useRouter()
  const today = todayKey()
  const [from, setFrom] = useState(() => mondayOf(today))
  const [mine, setMine] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const { data } = useAsync(
    async () => {
      const [tasks, projects] = await Promise.all([api.listTasks().catch(() => [] as Task[]), api.listProjects().catch(() => [] as Project[])])
      return { tasks, projects }
    },
    [version],
    { tasks: [] as Task[], projects: [] as Project[] },
  )
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const byDay = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sub?: string; tone: string; to: string }[]>()
    const push = (d: string | null | undefined, it: { key: string; label: string; sub?: string; tone: string; to: string }) => {
      if (!d || d < days[0] || d > days[6]) return
      m.set(d, [...(m.get(d) ?? []), it])
    }
    for (const t of data.tasks) {
      if (mine && t.assignee_id !== me.id) continue
      const done = t.status === '완료'
      const late = !done && !!t.due_date && t.due_date < today
      const to = t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=mine'
      const who = t.assignee_id ? profileName(t.assignee_id) : '미정'
      const time = t.remind_at ? new Date(t.remind_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : ''
      push(t.due_date ?? t.start_date, { key: `t${t.id}`, label: t.title, sub: [time, who].filter(Boolean).join(' · '), tone: done ? 'done' : late ? 'late' : t.phase === '일정' ? 'event' : 'task', to })
    }
    for (const p of data.projects) {
      if (mine && p.owner_id !== me.id) continue
      push(p.start_date, { key: `ps${p.id}`, label: `${p.name} 시작`, sub: p.code ?? undefined, tone: 'proj', to: `/projects?id=${p.id}` })
      push(p.end_date, { key: `pe${p.id}`, label: `${p.name} 종료`, sub: p.code ?? undefined, tone: 'proj', to: `/projects?id=${p.id}` })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mine, from, me.id, today])
  const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`

  return (
    <div className="week-panel">
      <div className="week-panel-head">
        <b className="t-bodyb">주간 일정표</b>
        <span className="t-cap">
          {md(days[0])} – {md(days[6])}
        </span>
        <span className="grow" />
        <button type="button" className={`chip ${mine ? 'active' : ''}`} onClick={() => setMine(v => !v)}>
          {mine ? '내 일정' : '전체'}
        </button>
        <button type="button" className="icon-btn sm" onClick={() => setFrom(addDays(from, -7))} aria-label="지난주">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="chip" onClick={() => setFrom(mondayOf(today))}>
          이번 주
        </button>
        <button type="button" className="icon-btn sm" onClick={() => setFrom(addDays(from, 7))} aria-label="다음 주">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="week-days">
        {days.map((d, i) => {
          const list = byDay.get(d) ?? []
          return (
            <section key={d} className={`week-day${d === today ? ' today' : ''}${i >= 5 ? ' weekend' : ''}`}>
              <div className="week-day-h">
                <span className="wd">{WD[i]}</span>
                <span className="dd">{md(d)}</span>
                <span className="grow" />
                <button type="button" className="icon-btn sm" onClick={() => setAdding(d)} aria-label={`${md(d)} 일정 추가`} title="이 날 일정 · 할 일 추가">
                  <Plus size={12} />
                </button>
              </div>
              {list.length === 0 ? (
                <span className="t-cap week-empty">일정 없음</span>
              ) : (
                list.map(it => (
                  <button key={it.key} type="button" className={`week-item ${it.tone}`} onClick={() => navigate(it.to)} title={it.label}>
                    <span className="truncate">{it.label}</span>
                    {it.sub && <span className="t-meta truncate">{it.sub}</span>}
                  </button>
                ))
              )}
            </section>
          )
        })}
      </div>
      <span className="t-cap">검색하거나 링크를 열면 이 자리에 인터넷 창이 나옵니다. 닫으면(✕) 다시 주간 일정표.</span>
      {adding && <TaskAssignModal projects={data.projects} tasks={data.tasks} presetDate={adding} presetAssignee={me.id} onClose={() => setAdding(null)} />}
    </div>
  )
}
