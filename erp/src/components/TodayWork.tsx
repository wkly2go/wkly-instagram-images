import { useState } from 'react'
import { useAction, useApp } from '../lib/app'
import { dateLabel, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { Project, Task } from '../lib/types'
import { SectionHead } from './ui'

/** 오늘 할 업무: 오늘이 기간 안에 있거나 오늘 마감 + 지연된 일 */
export function todayTasks(tasks: Task[], today = todayKey()): Task[] {
  return tasks
    .filter(t => t.status !== '완료')
    .filter(t => {
      const s = t.start_date ?? t.due_date
      const e = t.due_date ?? t.start_date
      if (!s || !e) return false
      return e < today || (s <= today && today <= e)
    })
    .sort((a, b) => Number((b.due_date ?? '9') < today) - Number((a.due_date ?? '9') < today) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
}

/**
 * 홈 맨 위 '오늘 업무' (대표 지시 2026-10-28, 전체 공통)
 *  - 기본은 내 업무, '팀 전체'로 바꿔 볼 수 있음. 체크하면 완료
 */
export function TodayWork({ tasks, projects }: { tasks: Task[]; projects: Project[] }) {
  const { api, me, profileName } = useApp()
  const { busy, run } = useAction()
  const [team, setTeam] = useState(false)
  const today = todayKey()
  const all = todayTasks(tasks, today)
  const mine = all.filter(t => t.assignee_id === me.id)
  const list = team ? all : mine
  const proj = new Map(projects.map(p => [p.id, p]))
  return (
    <section className="section today-work" aria-label="오늘 업무">
      <SectionHead
        title="오늘 업무"
        count={list.length}
        right={
          <span className="row gap-6">
            <span className="t-cap">{dateLabel(today)}</span>
            <span className="seg">
              <button type="button" className={!team ? 'on' : ''} onClick={() => setTeam(false)}>
                내 업무 {mine.length}
              </button>
              <button type="button" className={team ? 'on' : ''} onClick={() => setTeam(true)}>
                팀 전체 {all.length}
              </button>
            </span>
          </span>
        }
      />
      {list.length === 0 ? (
        <div className="today-empty">{team ? '오늘 팀 업무가 없습니다.' : '오늘 할 업무가 없습니다.'}</div>
      ) : (
        <div className="today-list">
          {list.slice(0, 12).map(t => {
            const late = !!t.due_date && t.due_date < today
            const p = t.project_id ? proj.get(t.project_id) : undefined
            return (
              <div key={t.id} className={`today-row${late ? ' late' : ''}`}>
                <input type="checkbox" checked={false} disabled={busy} onChange={() => run(() => api.saveTask({ id: t.id, status: '완료' }), '완료했습니다.')} aria-label={`${t.title} 완료`} />
                <span className="today-title">{t.title}</span>
                {p && (
                  <Link to={`/projects?id=${p.id}`} className="today-proj">
                    {p.code ?? p.name}
                  </Link>
                )}
                {team && <span className="t-cap nowrap">{t.assignee_id ? profileName(t.assignee_id) : '담당 미정'}</span>}
                <span className={`t-cap nowrap${late ? ' t-red' : ''}`}>{late ? `지연 · ${t.due_date!.slice(5)} 마감` : t.due_date === today ? '오늘 마감' : `~${t.due_date?.slice(5) ?? ''}`}</span>
              </div>
            )
          })}
          {list.length > 12 && (
            <Link to="/projects?view=mine" className="t-cap">
              {list.length - 12}건 더 보기 ›
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
