// 홈 = 회사 대시보드 (2026-11-28 대표 지시 '홈은 대시보드로 만들어 · 대시보드 디자인 사례 만들어')
//  - 개인 일(내 할 일 · 내가 지시한 업무 · 출근)은 '개인 업무'(/my)로 옮김. 여기는 회사 전체를 읽기만 하는 화면
//  - 디자인 사례 세 가지(요약 · 일정 · 프로젝트) 중 대표가 '요약'으로 고정(2026-11-28 '요약 보기를 기본으로 고정해') — 숫자 띠 · 그래프 · 7일 · 마감 · 진행 프로젝트 카드
//  - 계산은 lib/dashboard.ts (AI 없음 · 이미 받던 할 일 · 프로젝트 · 결재 자료만)
import { AlarmClock, CalendarClock, CheckCheck, FileCheck2, FolderKanban, Inbox, UserRound } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateLabel, todayKey } from '../lib/date'
import { byDivision, dashKpis, nearDeadlines, teamLoad, weekAhead } from '../lib/dashboard'
import { Link } from '../lib/router'
import { DIVISIONS, type ApprovalSummary, type Project, type Task } from '../lib/types'
import { Shell } from '../components/Shell'
import { ProjectCards } from '../components/ProjectCards'
import { SectionHead } from '../components/ui'
import './Dashboard.css'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const dow = (key: string) => new Date(`${key}T00:00:00`).getDay()

export default function Dashboard() {
  const { api, me, version, profiles } = useApp()
  const today = todayKey()
  const { data, loading } = useAsync(
    async () => {
      const [approvals, tasks, projects] = await Promise.all([api.listApprovals(), api.listTasks(), api.listProjects()])
      return { approvals, tasks, projects }
    },
    [version, today],
    { approvals: [] as ApprovalSummary[], tasks: [] as Task[], projects: [] as Project[] },
  )
  const k = dashKpis(data.tasks, data.projects, today)
  const waiting = data.approvals.filter(a => a.status === '대기').length
  const people = profiles.filter(p => !p.is_agent && p.active !== false)
  const load = teamLoad(data.tasks, people, today)
  const maxLoad = Math.max(1, ...load.map(r => r.open))
  const divs = byDivision(data.projects)
  const maxDiv = Math.max(1, ...divs.map(d => d.total))
  const week = weekAhead(data.tasks, data.projects, today)
  const near = nearDeadlines(data.tasks, data.projects, today)
  const active = data.projects.filter(p => p.status === '진행').sort((a, b) => (a.end_date ?? '9').localeCompare(b.end_date ?? '9'))
  const projName = (id?: string | null) => { const p = data.projects.find(x => x.id === id); return p ? p.code ?? p.name : '' }

  const kpis = (
    <div className="dash-kpis" role="group" aria-label="오늘 숫자">
      <Link to="/projects?view=list" className="dash-kpi"><span className="dash-ico k-proj"><FolderKanban size={15} /></span><span className="dash-kpi-l">진행 중</span><b>{k.active}</b></Link>
      <Link to="/projects?view=list" className="dash-kpi"><span className="dash-ico k-inq"><Inbox size={15} /></span><span className="dash-kpi-l">문의 · 상담</span><b>{k.inquiry}</b></Link>
      <Link to="/projects?view=tasks" className="dash-kpi"><span className="dash-ico k-today"><CalendarClock size={15} /></span><span className="dash-kpi-l">오늘 마감</span><b>{k.dueToday}</b></Link>
      <Link to="/projects?view=tasks" className={`dash-kpi${k.late ? ' bad' : ''}`}><span className="dash-ico k-late"><AlarmClock size={15} /></span><span className="dash-kpi-l">지연</span><b>{k.late}</b></Link>
      <Link to="/approvals" className="dash-kpi"><span className="dash-ico k-appr"><FileCheck2 size={15} /></span><span className="dash-kpi-l">결재 대기</span><b>{waiting}</b></Link>
      <Link to="/team" className="dash-kpi"><span className="dash-ico k-done"><CheckCheck size={15} /></span><span className="dash-kpi-l">7일간 끝낸 일</span><b>{k.doneWeek}</b></Link>
    </div>
  )
  const divisionCard = (
    <section className="dash-card" aria-label="구분별 프로젝트">
      <SectionHead title="구분별 프로젝트" right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
      <div className="dash-legend"><i className="s-active" />진행 <i className="s-inq" />문의 <i className="s-done" />완료 <i className="s-other" />그 밖</div>
      {divs.map(d => (
        <div key={d.div} className="dash-bar-row">
          <span className="dash-bar-name">{DIVISIONS[d.div].label}</span>
          <span className="dash-bar" style={{ width: `${Math.max(4, (d.total / maxDiv) * 100)}%` }} title={`진행 ${d.active} · 문의 ${d.inquiry} · 완료 ${d.done} · 그 밖 ${d.other}`}>
            {d.active > 0 && <i className="s-active" style={{ flex: d.active }} />}
            {d.inquiry > 0 && <i className="s-inq" style={{ flex: d.inquiry }} />}
            {d.done > 0 && <i className="s-done" style={{ flex: d.done }} />}
            {d.other > 0 && <i className="s-other" style={{ flex: d.other }} />}
          </span>
          <span className="dash-bar-n"><b>{d.active}</b> / {d.total}</span>
        </div>
      ))}
    </section>
  )
  const loadCard = (
    <section className="dash-card" aria-label="팀원별 업무량">
      <SectionHead title="팀원별 업무량" right={<Link to="/projects?view=tasks">할 일 보기 ›</Link>} />
      {load.length === 0 && <p className="dash-empty">{loading ? '불러오는 중…' : '팀원이 없습니다.'}</p>}
      {load.map(r => (
        <div key={r.id} className="dash-bar-row">
          <span className="dash-bar-name"><UserRound size={12} aria-hidden="true" /> {r.name}{r.id === me.id ? ' (나)' : ''}</span>
          <span className="dash-bar" style={{ width: `${r.open ? Math.max(4, (r.open / maxLoad) * 100) : 0}%` }}>
            {r.late > 0 && <i className="s-late" style={{ flex: r.late }} />}
            {r.open - r.late > 0 && <i className="s-active" style={{ flex: r.open - r.late }} />}
          </span>
          <span className="dash-bar-n"><b>{r.open}</b>{r.late ? <em> · 지연 {r.late}</em> : ''}</span>
        </div>
      ))}
    </section>
  )
  const weekCard = (
    <section className="dash-card dash-week-card" aria-label="앞으로 7일">
      <SectionHead title="앞으로 7일" right={<Link to="/projects?view=calendar">달력으로 ›</Link>} />
      <div className="dash-week">
        {week.map(d => (
          <div key={d.date} className={`dash-day${d.date === today ? ' is-today' : ''}${[0, 6].includes(dow(d.date)) ? ' is-rest' : ''}`}>
            <div className="dash-day-h"><b>{Number(d.date.slice(8))}</b> {WEEKDAY[dow(d.date)]}{d.date === today ? ' · 오늘' : ''}</div>
            {d.items.slice(0, 4).map(it => (
              <Link key={it.id} to={it.kind === 'task' ? `/projects?view=tasks&task=${it.id}` : `/projects?id=${it.projectId}`} className={`dash-ev e-${it.kind}`} title={it.title}>
                {it.kind === 'end' ? '마감 · ' : it.kind === 'start' ? '시작 · ' : ''}{it.title}{it.kind === 'task' && projName(it.projectId) ? <small> {projName(it.projectId)}</small> : null}
              </Link>
            ))}
            {d.items.length > 4 && <span className="dash-more">외 {d.items.length - 4}건</span>}
            {!d.items.length && <span className="dash-more">—</span>}
          </div>
        ))}
      </div>
    </section>
  )
  const nearCard = (
    <section className="dash-card" aria-label="마감이 가까운 프로젝트">
      <SectionHead title="마감이 가까운 프로젝트" right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
      {near.length === 0 && <p className="dash-empty">{loading ? '불러오는 중…' : '끝나는 날이 정해진 진행 프로젝트가 없습니다.'}</p>}
      {near.map(p => (
        <Link key={p.id} to={`/projects?id=${p.id}`} className="dash-near">
          <span className="dash-near-top">
            <i className="dash-dot" style={{ background: DIVISIONS[p.div].color }} />
            <span className="dash-near-name">{p.name}</span>
            <span className={`dash-d${p.daysLeft < 0 ? ' late' : p.daysLeft <= 7 ? ' soon' : ''}`}>{p.daysLeft < 0 ? `${-p.daysLeft}일 지남` : p.daysLeft === 0 ? '오늘' : `D-${p.daysLeft}`}</span>
          </span>
          <span className="dash-prog" aria-label={`진행 ${p.progress}%`}><i style={{ width: `${p.progress}%` }} /></span>
          <span className="dash-near-meta">{p.code} · 진행 {p.progress}% · 남은 일 {p.openTasks}건{p.lateTasks ? <em> · 지연 {p.lateTasks}</em> : null}</span>
        </Link>
      ))}
    </section>
  )
  const cardsBlock = active.length > 0 && (
    <section className="section" aria-label="진행 프로젝트">
      <SectionHead title="진행 프로젝트" count={active.length} right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
      <ProjectCards projects={active} tasks={data.tasks} scroll limit={12} />
    </section>
  )
  return (
    <Shell active="home">
      <div className="dash">
        <header className="dash-head">
          <div>
            <h1>회사 대시보드</h1>
            <span className="dash-sub">{dateLabel(today)} · 앞으로 7일 마감 {k.week}건{k.late ? ` · 지연 ${k.late}건` : ''}</span>
          </div>
          <span className="grow" />
          <Link to="/my" className="btn btn-outline btn-sm">개인 업무 ›</Link>
        </header>
        {kpis}
        <div className="dash-grid">{divisionCard}{loadCard}</div>
        <div className="dash-grid wide-left">{weekCard}{nearCard}</div>
        {cardsBlock}
      </div>
    </Shell>
  )
}
