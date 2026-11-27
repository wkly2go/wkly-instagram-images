// 마케팅 대시보드 (2026-11-27 대표 지시 '마케팅 자동화 프로그램' · 참고 화면: 카드 요약형 분석 화면 + 주간 달력 '이걸로 만들어')
// 광고·콘텐츠 › 콘텐츠·배포 › 자동화 흐름 — 숫자 띠 + 추이 그래프 · 지금 할 일 · 유입 경로 · 캠페인 · 문의 종류 · 이번 주 달력 · 여섯 단계
// 이 화면은 스스로 만들거나 보내지 않는다 (제작은 사람이 원할 때만 · CRM 은 문의 · 요청이 있을 때만)
import { useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Film, RefreshCw } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { convertRate, creativeReport, type CreativeSource, type Money } from '../lib/creativeReport'
import { dateTimeLabel, manwon } from '../lib/date'
import { calendarDays, flowKpis, flowSteps, shareWidths, shiftWeek, trendScale, weekLabel, type FlowTrend, type MarketingCalendar, type MarketingFlow as Flow } from '../lib/marketingFlow'
import { Link } from '../lib/router'
import { Button } from './ui'
import './MarketingFlow.css'

type Series = 'total' | 'direct' | 'ads'
const SERIES: Record<string, Series> = { total: 'total', direct: 'direct', ads: 'ads' }
const KIND_COLORS = ['#1f6b4a', '#2457b3', '#d8a200', '#8a6fc9', '#c2553f', '#5d8f9a', '#9aa39d', '#b9c2bc']

export function MarketingFlow() {
  const { api, version, bump } = useApp()
  const flow = useAsync<Flow | null>(() => api.marketingFlow().catch(() => null), [api, version], null)
  const trend = useAsync<FlowTrend | null>(() => api.marketingTrend().catch(() => null), [api, version], null)
  const [pick, setPick] = useState<Series>('total')
  const f = flow.data
  const t = trend.data
  if (!f) return <section className="card mf-card"><h3 className="mf-h">마케팅 대시보드</h3><p className="mf-empty">{flow.loading ? '불러오는 중…' : '아직 보여 줄 자료가 없습니다.'}</p></section>
  const steps = flowSteps(f)
  const todos = steps.filter(s => s.todo)
  const kpis = flowKpis(f, t)
  return (
    <div className="mf">
      <header className="mf-top">
        <div><h3 className="mf-h">마케팅 대시보드</h3><p className="mf-sub">최근 30일 · {dateTimeLabel(f.at)} 기준</p></div>
        <Button kind="outline" size="sm" onClick={bump}><RefreshCw size={13} /> 새로고침</Button>
      </header>

      <div className="mf-row mf-row-main">
        <section className="card mf-card mf-trend">
          <div className="mf-kpis" role="tablist" aria-label="숫자 고르기">
            {kpis.map(k => {
              const series = SERIES[k.key]
              const inner = (<>
                <span className="mf-kpi-label">{k.label}</span>
                <b className="mf-kpi-value">{k.value}</b>
                <span className="mf-kpi-note">
                  {k.delta != null && <em className={k.delta >= 0 ? 'up' : 'down'}>{k.delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(k.delta)}{k.key === 'tagged' ? '%p' : '%'}</em>}
                  {k.delta == null && k.note}
                </span>
              </>)
              return series
                ? <button key={k.key} type="button" role="tab" aria-selected={pick === series} className={`mf-kpi${pick === series ? ' on' : ''}`} onClick={() => setPick(series)}>{inner}</button>
                : <div key={k.key} className="mf-kpi still">{inner}</div>
            })}
          </div>
          {t ? <TrendChart daily={t.daily} pick={pick} /> : <p className="mf-empty">{trend.loading ? '추이를 불러오는 중…' : '추이 자료를 불러오지 못했습니다.'}</p>}
        </section>

        <section className="card mf-card mf-todo-card">
          <h4 className="mf-h4">지금 할 일</h4>
          {todos.length === 0 ? <p className="mf-empty">지금 밀린 일이 없습니다.</p> : (
            <ul className="mf-todos">{todos.map(s => (
              <li key={s.key}><Link to={s.link}><span className="mf-tag">{s.title}</span><span>{s.todo}</span><ArrowRight size={13} /></Link></li>
            ))}</ul>
          )}
          <p className="mf-foot">제작은 사람이 누를 때만 하고, 고객 관리는 문의 · 요청이 왔을 때만 진행합니다.</p>
        </section>
      </div>

      <div className="mf-row mf-row-3">
        <section className="card mf-card">
          <h4 className="mf-h4">어디서 왔나 <small>30일</small></h4>
          {!t || t.by_source.length === 0 ? <p className="mf-empty">문의가 없습니다.</p> : <BarRows rows={t.by_source.map(r => ({ name: r.source, value: r.inquiries, extra: r.projects ? `프로젝트 ${r.projects}` : '' }))} head={['유입 경로', '문의']} />}
        </section>
        <section className="card mf-card">
          <h4 className="mf-h4">어떤 캠페인이 일이 되었나 <small>90일</small></h4>
          {f.by_campaign.length === 0 ? <p className="mf-empty">문의가 없습니다.</p> : <BarRows rows={f.by_campaign.slice(0, 8).map(r => ({ name: r.campaign, value: r.inquiries, extra: `프로젝트 ${r.projects} · 진행 ${r.won}` }))} head={['꼬리표 (캠페인)', '문의']} />}
        </section>
        <section className="card mf-card">
          <h4 className="mf-h4">문의 종류 <small>30일</small></h4>
          {!t || t.by_kind.length === 0 ? <p className="mf-empty">문의가 없습니다.</p> : <Donut parts={t.by_kind.map(k => ({ name: k.kind, value: k.inquiries }))} />}
        </section>
      </div>

      <CreativeBoard />

      <WeekBoard />

      <section className="card mf-card">
        <h4 className="mf-h4">분석에서 수주까지</h4>
        <ol className="mf-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={`mf-step ${s.tone}`}>
              <div className="mf-step-head"><span className="mf-no">{i + 1}</span><b>{s.title}</b></div>
              {s.lines.map(line => <p key={line}>{line}</p>)}
              <Link to={s.link} className="mf-go">{s.linkLabel} <ArrowRight size={12} /></Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function TrendChart({ daily, pick }: { daily: FlowTrend['daily']; pick: Series }) {
  const W = 760, H = 240, L = 34, R = 10, T = 12, B = 26
  const { max, ticks } = trendScale(daily)
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, daily.length - 1)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const line = (key: Series) => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const area = `${line(pick)} L${x(daily.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`
  const label = pick === 'total' ? '문의' : pick === 'direct' ? '직접 문의' : '광고 유입'
  const sum = daily.reduce((a, d) => a + d[pick], 0)
  return (
    <svg className="mf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 30일 ${label} 추이 · 합계 ${sum}건`}>
      {ticks.map(v => (<g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="mf-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="mf-axis">{v}</text></g>))}
      {pick !== 'total' && <path d={line('total')} className="mf-line-ghost" />}
      <path d={area} className="mf-area" />
      <path d={line(pick)} className="mf-line" />
      {daily.map((d, i) => (i % 5 === 4 || i === 0) && <text key={d.d} x={x(i)} y={H - 6} textAnchor="middle" className="mf-axis">{`${Number(d.d.slice(5, 7))}.${Number(d.d.slice(8))}`}</text>)}
      {daily.map((d, i) => <circle key={d.d} cx={x(i)} cy={y(d[pick])} r={7} className="mf-dot"><title>{`${d.d} · ${label} ${d[pick]}건`}</title></circle>)}
    </svg>
  )
}

function BarRows({ rows, head }: { rows: { name: string; value: number; extra: string }[]; head: [string, string] }) {
  const widths = shareWidths(rows.map(r => r.value))
  return (
    <div className="mf-bars">
      <div className="mf-bars-head"><span>{head[0]}</span><span>{head[1]}</span></div>
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className="mf-bar-row">
          <span className="mf-bar" style={{ width: `${widths[i]}%` }} />
          <span className="mf-bar-name">{r.name}{r.extra && <small>{r.extra}</small>}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  )
}

function Donut({ parts }: { parts: { name: string; value: number }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  const C = 2 * Math.PI * 42
  let acc = 0
  return (
    <div className="mf-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={`문의 종류 · 합계 ${total}건`}>
        {parts.map((p, i) => { const len = (p.value / total) * C; const el = <circle key={p.name} cx="60" cy="60" r="42" fill="none" stroke={KIND_COLORS[i % KIND_COLORS.length]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />; acc += len; return el })}
        <text x="60" y="58" textAnchor="middle" className="mf-donut-n">{total}</text>
        <text x="60" y="74" textAnchor="middle" className="mf-donut-l">건</text>
      </svg>
      <ul>{parts.map((p, i) => <li key={p.name}><i style={{ background: KIND_COLORS[i % KIND_COLORS.length] }} /><span>{p.name}</span><b>{p.value}</b><small>{Math.round((p.value / total) * 100)}%</small></li>)}</ul>
    </div>
  )
}

function CreativeBoard() {
  const { api, version } = useApp()
  const src = useAsync<CreativeSource | null>(() => api.marketingCreatives().catch(() => null), [api, version], null)
  if (!src.data) return src.loading ? null : <section className="card mf-card"><h4 className="mf-h4">소재별 성과</h4><p className="mf-empty">성과 자료를 불러오지 못했습니다.</p></section>
  const r = creativeReport(src.data)
  const lost = r.tagged - r.matched
  // 새 DB 함수(20261127230000)는 프로젝트 번호를 줌 → 같은 프로젝트는 한 번만 셈
  const byProject = !!src.data.projects
  return (
    <section className="card mf-card">
      <h4 className="mf-h4">소재별 성과 <small>최근 {r.days}일 · 어떤 콘텐츠 · 광고에서 온 문의가 프로젝트 · 수주가 되었나</small></h4>
      {r.rows.length === 0 ? <p className="mf-empty">아직 소재와 이어진 문의가 없습니다. 콘텐츠를 저장하면 우리 홈페이지 주소에 꼬리표가 자동으로 붙고, 그 주소로 들어온 문의부터 여기에 잡힙니다.</p> : (
        <div className="mf-cr" role="table" aria-label="소재별 성과">
          <div className="mf-cr-row head" role="row"><span role="columnheader">소재</span><span role="columnheader">들어온 곳</span><span role="columnheader">문의</span><span role="columnheader">직접 문의</span><span role="columnheader">프로젝트</span><span role="columnheader">견적</span><span role="columnheader">수주</span></div>
          {r.rows.map(row => {
            const projects = byProject ? row.money.projects : row.projects
            const rate = convertRate(row.inquiries, projects)
            return (
              <div key={row.key} className="mf-cr-row" role="row">
                <span role="cell" className="mf-cr-name">
                  <em className={`mf-cr-kind k-${row.kind === '콘텐츠' ? 'c' : row.kind === '광고' ? 'a' : 't'}`}>{row.kind}</em>
                  {row.link ? <Link to={row.link}>{row.title}</Link> : <span>{row.title}</span>}
                  {row.placed.length > 0 && <small>{row.placed.join(' · ')}</small>}
                </span>
                <span role="cell" className="mf-cr-src">{row.sources.length ? row.sources.map(s => `${s.source} ${s.inquiries}`).join(' · ') : '문의 없음'}</span>
                <b role="cell" data-label="문의">{row.inquiries}</b>
                <span role="cell" data-label="직접 문의">{row.direct}</span>
                <span role="cell" data-label="프로젝트">{projects}{rate != null && projects > 0 && <small> ({rate}%)</small>}</span>
                <span role="cell" data-label="견적">{row.money.quoted}</span>
                <span role="cell" data-label="수주" className="mf-cr-won"><WonCell m={row.money} /></span>
              </div>
            )
          })}
        </div>
      )}
      <p className="mf-foot">
        꼬리표가 붙은 문의 {r.tagged}건 중 {r.matched}건이 콘텐츠 · 광고와 이어졌습니다.
        {lost > 0 && ` 나머지 ${lost}건은 예전에 손으로 붙인 꼬리표라 이름 그대로 보여 줍니다.`}
        {' '}꼬리표가 없는 문의는 {r.untagged.inquiries}건(프로젝트 {byProject ? r.untaggedMoney.projects : r.untagged.projects}곳{r.untaggedMoney.wonProjects > 0 && ` · 수주 ${r.untaggedMoney.wonProjects}곳${r.untaggedMoney.wonAmount > 0 ? ` ${manwon(r.untaggedMoney.wonAmount)}` : ''}`})입니다.
        {' '}수주 금액은 이어진 프로젝트의 매출 계약 금액을 같은 프로젝트는 한 번만 더한 값이고, 견적은 인트라넷 견적이 있는 프로젝트 수입니다.
      </p>
    </section>
  )
}

/** 수주 칸: 수주한 곳 수 + 매출 계약 금액 합계 (금액을 안 적은 곳은 따로 알림) */
function WonCell({ m }: { m: Money }) {
  if (m.wonProjects === 0) return <>0</>
  const missing = m.wonProjects - m.wonPriced
  return (
    <>
      <b>{m.wonAmount > 0 ? manwon(m.wonAmount) : `${m.wonProjects}곳`}</b>
      <small className="mf-cr-won-sub">{m.wonAmount > 0 ? `${m.wonProjects}곳` : ''}{missing > 0 ? `${m.wonAmount > 0 ? ' · ' : ''}금액 미입력 ${missing}곳` : ''}</small>
    </>
  )
}

function WeekBoard() {
  const { api, version, toast } = useApp()
  const [start, setStart] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [saving, setSaving] = useState('')
  const cal = useAsync<MarketingCalendar | null>(() => api.marketingCalendar(start).catch(() => null), [api, version, start, tick], null)
  const c = cal.data
  if (!c) return <section className="card mf-card"><h4 className="mf-h4">콘텐츠 달력</h4><p className="mf-empty">{cal.loading ? '불러오는 중…' : '달력 자료를 불러오지 못했습니다.'}</p></section>
  const days = calendarDays(c, Date.now())
  const plan = async (id: string, date: string | null) => {
    if (saving) return
    setSaving(id)
    try { await api.setContentPlan(id, date); setTick(t => t + 1); toast(date ? '게시 예정일을 정했습니다.' : '게시 예정일을 지웠습니다.') }
    catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.') }
    finally { setSaving('') }
  }
  const planned = c.items.filter(x => x.type === 'content' && x.planned)
  return (
    <section className="card mf-card">
      <div className="mf-cal-head">
        <h4 className="mf-h4">콘텐츠 달력 <small>{weekLabel(c.week_start)}</small></h4>
        <div className="mf-cal-nav">
          <button type="button" className="btn btn-outline btn-sm" aria-label="이전 주" onClick={() => setStart(shiftWeek(c.week_start, -1))}><ChevronLeft size={13} /></button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setStart(undefined)}>이번 주</button>
          <button type="button" className="btn btn-outline btn-sm" aria-label="다음 주" onClick={() => setStart(shiftWeek(c.week_start, 1))}><ChevronRight size={13} /></button>
        </div>
      </div>
      <div className="mf-week">
        {days.map(d => (
          <div key={d.date} className={`mf-day${d.today ? ' today' : ''}${d.past ? ' past' : ''}`}>
            <div className="mf-day-head"><span>{d.name}</span><b>{d.day}</b><em>{d.items.length || ''}</em></div>
            <div className="mf-day-body">
              {d.items.map(w => (
                <Link key={`${w.type}-${w.id}-${w.planned}`} to={w.type === 'video' ? '/ads?tab=video' : `/ads?tab=content&item=${w.id}`} className={`mf-post ${w.type}${w.planned ? ' planned' : ''}`}>
                  <span className="mf-post-ch">{w.type === 'video' && <Film size={12} />}{w.channels.join(' · ') || '채널 없음'}</span>
                  <span className="mf-post-title">{w.title}</span>
                  <span className="mf-post-tags"><span className={`mf-post-st${/발행|완료/.test(w.status) ? ' done' : ''}`}>{w.status}</span>{w.planned && <span className="mf-post-st plan">게시 예정</span>}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(c.unplanned.length > 0 || planned.length > 0) && (
        <div className="mf-plan">
          <h5 className="mf-h5">게시 예정일 <small>날짜를 정하면 그날 칸에 놓입니다. 게시는 사람이 합니다.</small></h5>
          <ul>
            {planned.map(x => (
              <li key={x.id}><span className="mf-plan-title">{x.title}</span><span className="mf-post-st">{x.status}</span>
                <input type="date" aria-label={`${x.title} 게시 예정일`} value={x.day} disabled={saving === x.id} onChange={e => void plan(x.id, e.target.value || null)} />
                <button type="button" className="btn btn-ghost btn-sm" disabled={saving === x.id} onClick={() => void plan(x.id, null)}>지우기</button></li>
            ))}
            {c.unplanned.map(x => (
              <li key={x.id}><span className="mf-plan-title">{x.title}</span><span className="mf-post-st">{x.status}</span>
                <input type="date" aria-label={`${x.title} 게시 예정일`} value="" disabled={saving === x.id} onChange={e => e.target.value && void plan(x.id, e.target.value)} /><span /></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
