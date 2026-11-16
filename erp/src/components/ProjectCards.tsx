import { Link } from '../lib/router'
import { todayKey } from '../lib/date'
import { DIVISIONS, projectBrand, type Project, type Task } from '../lib/types'

/**
 * 프로젝트 카드 (디자인 v8 2단계 · 2026-11-16) — 홈 '진행 프로젝트' 줄 · 프로젝트 목록 '카드' 보기 공용
 * 위쪽 구분 색 띠 · 구분 · 남은 기간(또는 지연 수) · 이름 · 연번 · 장소 · 기간 진행 막대 · 남은 할 일
 */
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

export function ProjectCards({ projects, tasks, scroll = false, limit }: { projects: Project[]; tasks: Task[]; scroll?: boolean; limit?: number }) {
  const today = todayKey()
  const list = limit ? projects.slice(0, limit) : projects
  if (!list.length) return <span className="t-cap">프로젝트가 없습니다.</span>
  return (
    <div className={scroll ? 'home-projs' : 'proj-cards'}>
      {list.map(p => {
        const div = projectBrand(p)
        const left = tasks.filter(t => t.project_id === p.id && t.status !== '완료')
        const late = left.filter(t => t.due_date && t.due_date < today).length
        const start = p.start_date
        const end = p.end_date ?? p.start_date
        const label = p.status !== '진행' && p.status !== '기획' ? p.status : !end ? '기간 미정' : today > end ? `종료 후 ${days(end, today)}일` : today < (start ?? end) ? `시작 D-${days(today, start ?? end)}` : `종료 D-${days(today, end)}`
        const prog = start && end && end > start ? Math.max(0, Math.min(100, (days(start, today) / days(start, end)) * 100)) : null
        return (
          <Link key={p.id} to={`/projects?id=${p.id}`} className="home-proj" style={{ ['--div' as string]: DIVISIONS[div].color }}>
            <span className="home-proj-top">
              <span className="home-proj-div">{DIVISIONS[div].label}</span>
              <span className={`home-proj-d${late ? ' late' : ''}`}>{late ? `지연 ${late}` : label}</span>
            </span>
            <b className="home-proj-name">{p.name}</b>
            <span className="t-cap">{[p.code, p.location].filter(Boolean).join(' · ') || ' '}</span>
            {prog != null && (
              <span className="home-proj-bar" aria-label={`기간 ${Math.round(prog)}% 지남`}>
                <i style={{ width: `${prog}%` }} />
              </span>
            )}
            <span className="t-cap">남은 할 일 {left.length}건</span>
          </Link>
        )
      })}
    </div>
  )
}
