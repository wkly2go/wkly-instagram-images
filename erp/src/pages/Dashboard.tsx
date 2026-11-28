// 홈 = 회사 대시보드 (2026-11-28 대표 지시 '홈은 대시보드로' → '대시보드또한 디자인 배치 다시하고' · 디자인 v9 모노톤 + 네온 빛)
//  - 배치는 대표가 고른 참고 화면 구성: 인사 · 숫자 카드 넷(작은 막대 + 아래 설명 줄) → 큰 흐름 그래프(점 격자) + 팀원 막대 → 마감이 가까운 프로젝트 표 → 앞으로 7일 · 구분별 → 진행 프로젝트 카드
//  - 개인 일은 '개인 업무'(/my). 여기는 회사 전체를 읽기만 · 계산은 lib/dashboard.ts (AI 없음 · 이미 받던 할 일 · 프로젝트 · 결재만)
import { AlarmClock, ArrowUpRight, CalendarClock, FileCheck2, FolderKanban } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateLabel, todayKey } from '../lib/date'
import { byDivision, dashKpis, dayFlow, nearDeadlines, sparkOf, teamLoad, weekAhead } from '../lib/dashboard'
import { Link } from '../lib/router'
import { DIVISIONS, type ApprovalSummary, type Project, type Task } from '../lib/types'
import { Shell } from '../components/Shell'
import { ProjectCards } from '../components/ProjectCards'
import { SectionHead } from '../components/ui'
import './Dashboard.css'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const dow = (key: string) => new Date(`${key}T00:00:00`).getDay()
const ROWS = 8

function Spark({ values }: { values: number[] }) {
  return <span className="dash-spark" aria-hidden="true">{sparkOf(values).map((v, i) => <i key={i} style={{ height: `${Math.max(10, v * 100)}%` }} className={v >= 1 && values.some(x => x > 0) ? 'top' : ''} />)}</span>
}

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
  const waitingList = data.approvals.filter(a => a.status === '대기')
  const people = profiles.filter(p => !p.is_agent && p.active !== false)
  const load = teamLoad(data.tasks, people, today)
  const maxLoad = Math.max(1, ...load.map(r => r.open))
  const divs = byDivision(data.projects)
  const maxDiv = Math.max(1, ...divs.map(d => d.total))
  const week = weekAhead(data.tasks, data.projects, today)
  const near = nearDeadlines(data.tasks, data.projects, today, 7)
  const flow = dayFlow(data.tasks, today)
  const flowMax = Math.max(ROWS, ...flow.map(d => d.done + d.due + d.late))
  const cell = (n: number) => Math.round((n / flowMax) * ROWS)
  const active = data.projects.filter(p => p.status === '진행').sort((a, b) => (a.end_date ?? '9').localeCompare(b.end_date ?? '9'))
  const projName = (id?: string | null) => { const p = data.projects.find(x => x.id === id); return p ? p.code ?? p.name : '' }
  const ahead7 = flow.filter(d => d.date >= today).slice(0, 7)
  const back7 = flow.filter(d => d.date <= today).slice(-7)
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date()))
  const hello = hour < 11 ? '좋은 아침입니다' : hour < 17 ? '좋은 오후입니다' : '오늘도 수고 많으셨습니다'

  return (
    <Shell active="home">
      <div className="dash">
        <header className="dash-head">
          <div>
            <h1>{me.name}님, {hello}</h1>
            <span className="dash-sub">{dateLabel(today)} · 회사 전체 현황</span>
          </div>
          <span className="grow" />
          <Link to="/projects?view=calendar" className="btn btn-outline btn-sm">달력</Link>
          <Link to="/my" className="btn btn-primary btn-sm">개인 업무 <ArrowUpRight size={13} /></Link>
        </header>

        <div className="dash-kpis" role="group" aria-label="오늘 숫자">
          <Link to="/projects?view=list" className="dash-kpi is-key">
            <span className="dash-kpi-l"><FolderKanban size={13} /> 진행 프로젝트</span>
            <b>{k.active}</b><Spark values={divs.map(d => d.active)} />
            <span className="dash-kpi-foot">문의 {k.inquiry} · 전체 {data.projects.length}</span>
          </Link>
          <Link to="/projects?view=tasks" className="dash-kpi">
            <span className="dash-kpi-l"><CalendarClock size={13} /> 오늘 마감</span>
            <b>{k.dueToday}</b><Spark values={ahead7.map(d => d.due)} />
            <span className="dash-kpi-foot">앞으로 7일 {k.week}건</span>
          </Link>
          <Link to="/projects?view=tasks" className={`dash-kpi${k.late ? ' bad' : ''}`}>
            <span className="dash-kpi-l"><AlarmClock size={13} /> 지연</span>
            <b>{k.late}</b><Spark values={back7.map(d => d.late)} />
            <span className="dash-kpi-foot">{k.late ? '마감이 지난 할 일' : '지연 없음'}</span>
          </Link>
          <Link to="/approvals" className="dash-kpi">
            <span className="dash-kpi-l"><FileCheck2 size={13} /> 결재 대기</span>
            <b>{waitingList.length}</b><Spark values={back7.map(d => d.done)} />
            <span className="dash-kpi-foot">7일간 끝낸 일 {k.doneWeek}건</span>
          </Link>
        </div>

        <div className="dash-grid wide-left">
          <section className="dash-card" aria-label="업무 흐름">
            <SectionHead title="업무 흐름" right={<Link to="/projects?view=tasks">할 일 보기 ›</Link>} />
            <div className="dash-body">
              <div className="dash-flow-top">
                <span className="lbl">지난 2주 끝낸 일</span><b>{flow.filter(d => d.date <= today).reduce((n, d) => n + d.done, 0)}</b>
                <span className="grow" />
                <span className="dash-legend"><i className="s-active" />끝낸 일 <i className="s-inq" />마감 예정 <i className="s-late" />지연</span>
              </div>
              <div className="dash-flow" role="img" aria-label="지난 2주 끝낸 일과 앞으로 2주 마감 예정">
                {flow.map(d => {
                  const a = cell(d.done), b = cell(d.due), c = cell(d.late)
                  const need = (n: number, v: number) => (v > 0 && n === 0 ? 1 : n)
                  const na = need(a, d.done), nb = need(b, d.due), nc = need(c, d.late)
                  return (
                    <div key={d.date} className={`dash-flow-col${d.date === today ? ' is-today' : ''}`} title={`${d.date.slice(5)} · 끝낸 일 ${d.done} · 마감 예정 ${d.due}${d.late ? ` · 지연 ${d.late}` : ''}`}>
                      {Array.from({ length: ROWS }, (_, r) => {
                        const i = ROWS - 1 - r
                        const cls = i < na ? 'f-done' : i < na + nc ? 'f-late' : i < na + nc + nb ? 'f-due' : ''
                        return <i key={r} className={cls} />
                      })}
                      <span>{d.date === today ? '오늘' : dow(d.date) === 1 ? d.date.slice(5).replace('-', '.') : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
          <section className="dash-card" aria-label="팀원별 업무량">
            <SectionHead title="팀원별 업무량" right={<Link to="/projects?view=tasks">전체 ›</Link>} />
            <div className="dash-body">
              {load.length === 0 && <p className="dash-empty">{loading ? '불러오는 중…' : '팀원이 없습니다.'}</p>}
              <div className="dash-vbars">
                {load.slice(0, 8).map(r => (
                  <div key={r.id} className="dash-vbar" title={`${r.name} · 안 끝난 일 ${r.open}${r.late ? ` · 지연 ${r.late}` : ''}`}>
                    <span className="dash-vbar-n">{r.open}</span>
                    <span className="dash-vbar-track">
                      {r.late > 0 && <i className="s-late" style={{ height: `${(r.late / maxLoad) * 100}%` }} />}
                      <i className="s-active" style={{ height: `${((r.open - r.late) / maxLoad) * 100}%` }} />
                    </span>
                    <span className="dash-vbar-name">{r.name}{r.id === me.id ? '·나' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="dash-card" aria-label="마감이 가까운 프로젝트">
          <SectionHead title="마감이 가까운 프로젝트" right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
          <div className="dash-body dash-table-wrap">
            {near.length === 0 ? <p className="dash-empty">{loading ? '불러오는 중…' : '끝나는 날이 정해진 진행 프로젝트가 없습니다.'}</p> : (
              <table className="dash-table">
                <thead><tr><th>연번</th><th>프로젝트</th><th>구분</th><th>마감</th><th>진행</th><th>남은 일</th><th>상태</th></tr></thead>
                <tbody>
                  {near.map(p => (
                    <tr key={p.id}>
                      <td className="mono">{p.code || '—'}</td>
                      <td><Link to={`/projects?id=${p.id}`} className="dash-table-name">{p.name}</Link></td>
                      <td>{DIVISIONS[p.div].label}</td>
                      <td><span className={`dash-d${p.daysLeft < 0 ? ' late' : p.daysLeft <= 7 ? ' soon' : ''}`}>{p.daysLeft < 0 ? `${-p.daysLeft}일 지남` : p.daysLeft === 0 ? '오늘' : `D-${p.daysLeft}`}</span></td>
                      <td><span className="dash-prog" aria-label={`진행 ${p.progress}%`}><i style={{ width: `${p.progress}%` }} /></span><span className="mono dash-pct">{p.progress}%</span></td>
                      <td className="mono">{p.openTasks}</td>
                      <td>{p.lateTasks ? <span className="dash-pill bad">지연 {p.lateTasks}</span> : p.daysLeft < 0 ? <span className="dash-pill bad">기한 지남</span> : <span className="dash-pill ok">정상</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <div className="dash-grid wide-left">
          <section className="dash-card" aria-label="앞으로 7일">
            <SectionHead title="앞으로 7일" right={<Link to="/projects?view=calendar">달력으로 ›</Link>} />
            <div className="dash-body">
              <div className="dash-week">
                {week.map(d => (
                  <div key={d.date} className={`dash-day${d.date === today ? ' is-today' : ''}${[0, 6].includes(dow(d.date)) ? ' is-rest' : ''}`}>
                    <div className="dash-day-h"><b>{Number(d.date.slice(8))}</b> {WEEKDAY[dow(d.date)]}</div>
                    {d.items.slice(0, 3).map(it => (
                      <Link key={it.id} to={it.kind === 'task' ? `/projects?view=tasks&task=${it.id}` : `/projects?id=${it.projectId}`} className={`dash-ev e-${it.kind}`} title={`${it.title}${it.kind === 'task' && projName(it.projectId) ? ` · ${projName(it.projectId)}` : ''}`}>
                        {it.kind === 'end' ? '마감 · ' : it.kind === 'start' ? '시작 · ' : ''}{it.title}
                      </Link>
                    ))}
                    {d.items.length > 3 && <span className="dash-more">외 {d.items.length - 3}건</span>}
                    {!d.items.length && <span className="dash-more">—</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="dash-card" aria-label="구분별 프로젝트">
            <SectionHead title="구분별 프로젝트" right={<Link to="/projects?view=list">전체 ›</Link>} />
            <div className="dash-body">
              <div className="dash-legend"><i className="s-active" />진행 <i className="s-inq" />문의 <i className="s-done" />완료 <i className="s-other" />그 밖</div>
              {divs.map(d => (
                <div key={d.div} className="dash-bar-row">
                  <span className="dash-bar-name">{DIVISIONS[d.div].label}</span>
                  <span className="dash-bar" style={{ width: `${d.total ? Math.max(4, (d.total / maxDiv) * 100) : 0}%` }} title={`진행 ${d.active} · 문의 ${d.inquiry} · 완료 ${d.done} · 그 밖 ${d.other}`}>
                    {d.active > 0 && <i className="s-active" style={{ flex: d.active }} />}
                    {d.inquiry > 0 && <i className="s-inq" style={{ flex: d.inquiry }} />}
                    {d.done > 0 && <i className="s-done" style={{ flex: d.done }} />}
                    {d.other > 0 && <i className="s-other" style={{ flex: d.other }} />}
                  </span>
                  <span className="dash-bar-n"><b>{d.active}</b> / {d.total}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {active.length > 0 && (
          <section className="section" aria-label="진행 프로젝트">
            <SectionHead title="진행 프로젝트" count={active.length} right={<Link to="/projects?view=list">전체 보기 ›</Link>} />
            <ProjectCards projects={active} tasks={data.tasks} scroll limit={12} />
          </section>
        )}
      </div>
    </Shell>
  )
}
