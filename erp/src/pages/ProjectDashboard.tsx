import { useMemo } from 'react'
import { useApp, useAsync } from '../lib/app'
import { addMonths, manwon, shortDate, toDateKey, todayKey, weekRange } from '../lib/date'
import { budgetByCategory, isOverdue, monthlyFlow, paymentChecks, paymentRun, projectMoney, runMonday, upcomingPayments, vendorSummary } from '../lib/finance'
import { Link, useRouter } from '../lib/router'
import type { BudgetLine, Client, Payment, Project, ProjectFinance, Task } from '../lib/types'
import { BarChart, FlowChart, HBarChart, Meter, StackBar, shortMan } from '../components/charts'
import { Avatar, Badge, Empty, type Tone } from '../components/ui'

interface FinData {
  finances: ProjectFinance[]
  payments: Payment[]
  lines: BudgetLine[]
}

const pct = (n: number | null | undefined, digits = 1) => (n == null || !isFinite(n) ? '–' : `${n.toFixed(digits)}%`)

export function ProjectDashboard({ projects, tasks, clients }: { projects: Project[]; tasks: Task[]; clients: Client[] }) {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const today = todayKey()
  const { data: fin } = useAsync<FinData>(
    async () => {
      if (!admin) return { finances: [], payments: [], lines: [] }
      const [finances, payments, lines] = await Promise.all([api.listFinances(), api.listPayments(), api.listBudgetLines()])
      return { finances, payments, lines }
    },
    [version, admin],
    { finances: [], payments: [], lines: [] },
  )

  const money = useMemo(() => {
    const m = new Map<string, ReturnType<typeof projectMoney>>()
    for (const p of projects) {
      const f = fin.finances.find(x => x.project_id === p.id)
      const pays = fin.payments.filter(x => x.project_id === p.id)
      const lines = fin.lines.filter(x => x.project_id === p.id)
      if (f || pays.length) m.set(p.id, projectMoney(f, pays, lines, today))
    }
    return m
  }, [projects, fin, today])

  return (
    <div className="col gap-12">
      {admin ? <AdminKpis projects={projects} fin={fin} money={money} today={today} /> : <MemberKpis projects={projects} tasks={tasks} today={today} />}
      {admin && <CheckStrip fin={fin} projects={projects} today={today} />}
      <Orders projects={projects} money={money} today={today} admin={admin} />
      <ProgressBoard projects={projects} tasks={tasks} today={today} />
      <OwnerProgress projects={projects} tasks={tasks} money={money} today={today} />
      {admin && (
        <>
          <Profitability projects={projects} money={money} />
          <BudgetAlerts projects={projects} fin={fin} />
          <Vendors payments={fin.payments} clients={clients} today={today} />
          <section className="section" aria-label="월별 수금·지급">
            <div className="section-h">
              <span className="t-bodyb">월별 수금 · 지급</span>
              <span className="cap">단위: 만원 · 완료 기준 · 공급가액</span>
            </div>
            <FlowChart data={monthlyFlow(fin.payments, Array.from({ length: 6 }, (_, i) => addMonths(today.slice(0, 7), i - 5)))} />
          </section>
          <Upcoming payments={fin.payments} projects={projects} today={today} />
        </>
      )}
    </div>
  )
}

function AdminKpis({ projects, fin, money, today }: { projects: Project[]; fin: FinData; money: Map<string, ReturnType<typeof projectMoney>>; today: string }) {
  const { navigate } = useRouter()
  const count = (s: Project['status']) => projects.filter(p => p.status === s).length
  const year = today.slice(0, 4)
  const thisYear = projects.filter(p => (p.start_date ?? p.created_at).startsWith(year) && p.status !== '보류' && p.status !== 'NIC')
  const contracts = thisYear.map(p => money.get(p.id)?.contract ?? 0)
  const contractSum = contracts.reduce((a, b) => a + b, 0)
  const withMargin = thisYear.map(p => money.get(p.id)).filter((m): m is NonNullable<typeof m> => !!m?.contract)
  const cSum = withMargin.reduce((n, m) => n + (m.contract ?? 0), 0)
  const rate = cSum ? (withMargin.reduce((n, m) => n + (m.margin ?? 0), 0) / cSum) * 100 : null
  const targeted = withMargin.filter(m => m.target != null)
  const tSum = targeted.reduce((n, m) => n + (m.contract ?? 0), 0)
  const target = tSum ? targeted.reduce((n, m) => n + (m.target ?? 0) * (m.contract ?? 0), 0) / tSum : null
  // 프로젝트 없는 결제(지출 승인 등)까지 포함한 전체 미수·미지급
  const whole = projectMoney(undefined, fin.payments, [], today)
  const receivable = whole.receivable
  const overdueIn = whole.overdueIn
  const payable = whole.payable
  const [, we] = weekRange(today)
  const thisWeek = fin.payments.filter(p => p.direction === '지급' && !p.is_estimate && ['예정', '대기', '청구'].includes(p.status) && p.due_date && p.due_date <= we)
  const month = today.slice(0, 7)
  const prev = addMonths(month, -1)
  const inMonth = (m: string) => fin.payments.filter(p => p.direction === '수금' && p.status === '완료' && p.paid_date?.startsWith(m)).reduce((n, p) => n + p.amount - p.vat, 0)
  const diff = rate != null && target != null ? rate - target : null
  return (
    <div className="kpis">
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=list')}>
        <span className="t-cap">진행 프로젝트</span>
        <span className="v">{count('진행')}</span>
        <span className="sub">
          기획 {count('기획')} · NIC {count('NIC')} · 보류 {count('보류')}
        </span>
      </button>
      <div className="kpi">
        <span className="t-cap">올해 계약액</span>
        <span className="v">{contractSum ? manwon(contractSum) : '–'}</span>
        <span className="sub">프로젝트 {contracts.filter(Boolean).length}건</span>
      </div>
      <div className="kpi">
        <span className="t-cap">예상 마진율</span>
        <span className="v">{pct(rate)}</span>
        <span className={`sub ${diff != null && diff < 0 ? 'red' : ''}`}>
          {target != null ? `목표 ${pct(target, 0)} · ${diff == null ? '' : diff >= 0 ? `▲${diff.toFixed(1)}%p 달성` : `▼${Math.abs(diff).toFixed(1)}%p 미달`}` : '목표 마진 미입력'}
        </span>
      </div>
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=payments&dir=수금&st=open')}>
        <span className="t-cap">받을 돈 (미수)</span>
        <span className="v">{manwon(receivable) || '0'}</span>
        <span className={`sub ${overdueIn.length ? 'red' : ''}`}>{overdueIn.length ? `연체 ${overdueIn.length}건 · ${manwon(overdueIn.reduce((n, p) => n + p.amount - p.vat, 0))}` : '연체 없음'}</span>
      </button>
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=payments&dir=지급&st=open')}>
        <span className="t-cap">줄 돈 (미지급)</span>
        <span className="v">{manwon(payable) || '0'}</span>
        <span className="sub">이번 주 지급 {thisWeek.length}건</span>
      </button>
      <div className="kpi">
        <span className="t-cap">이번 달 입금</span>
        <span className="v">{manwon(inMonth(month)) || '0'}</span>
        <span className="sub">지난달 {manwon(inMonth(prev)) || '0'}</span>
      </div>
    </div>
  )
}

function MemberKpis({ projects, tasks, today }: { projects: Project[]; tasks: Task[]; today: string }) {
  const { me } = useApp()
  const { navigate } = useRouter()
  const open = tasks.filter(t => t.status !== '완료')
  const mine = open.filter(t => t.assignee_id === me.id)
  const late = open.filter(t => t.due_date && t.due_date < today)
  const [, we] = weekRange(today)
  return (
    <div className="kpis">
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=list')}>
        <span className="t-cap">진행 프로젝트</span>
        <span className="v">{projects.filter(p => p.status === '진행').length}</span>
        <span className="sub">
          기획 {projects.filter(p => p.status === '기획').length} · NIC {projects.filter(p => p.status === 'NIC').length}
        </span>
      </button>
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=mine')}>
        <span className="t-cap">내 할 일</span>
        <span className="v">{mine.length}</span>
        <span className="sub">이번 주 마감 {mine.filter(t => t.due_date && t.due_date <= we).length}</span>
      </button>
      <button type="button" className="kpi" onClick={() => navigate('/projects?view=tasks')}>
        <span className="t-cap">지연 할 일 (팀)</span>
        <span className="v">{late.length}</span>
        <span className={`sub ${late.some(t => t.assignee_id === me.id) ? 'red' : ''}`}>내 것 {late.filter(t => t.assignee_id === me.id).length}</span>
      </button>
    </div>
  )
}

const STATUS_COLOR: Record<Project['status'], string> = { 진행: 'var(--blue)', 기획: 'var(--green)', NIC: 'var(--red)', 완료: 'var(--pink)', 보류: 'var(--gray)' }

/** 수주 현황: 상태별 프로젝트 수 + (관리자) 월별 수주액 = 프로젝트 시작 월 기준 계약액(공급가) */
function Orders({ projects, money, today, admin }: { projects: Project[]; money: Map<string, ReturnType<typeof projectMoney>>; today: string; admin: boolean }) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 7), i - 11))
  const monthOf = (p: Project) => (p.start_date ?? toDateKey(p.created_at)).slice(0, 7)
  const won = projects.filter(p => p.status !== '보류' && p.status !== 'NIC')
  const data = months.map(m => {
    const list = won.filter(p => monthOf(p) === m)
    const value = list.reduce((s, p) => s + (money.get(p.id)?.contract ?? 0), 0)
    return { key: m, label: `${Number(m.slice(5))}월`, value, note: list.length ? `${list.length}건 · ${list.map(p => p.name).join(', ')}` : '수주 없음' }
  })
  const year = today.slice(0, 4)
  const thisYear = won.filter(p => monthOf(p).startsWith(year))
  const yearSum = thisYear.reduce((s, p) => s + (money.get(p.id)?.contract ?? 0), 0)
  return (
    <section className="section" aria-label="수주 현황">
      <div className="section-h">
        <span className="t-bodyb">수주 현황</span>
        <span className="cap">{admin ? '수주액 = 프로젝트 시작 월의 계약액 (공급가)' : '상태별 프로젝트 수'}</span>
      </div>
      <StackBar label="상태별 프로젝트" parts={(['진행', '기획', 'NIC', '완료', '보류'] as const).map(s => ({ key: s, label: s, value: projects.filter(p => p.status === s).length, color: STATUS_COLOR[s] }))} />
      {admin && (
        <>
          <div className="row wrap gap-12">
            <span className="t-cap">
              {year}년 수주 <b className="t-blue">{thisYear.length}건</b> · <b className="t-blue">{manwon(yearSum)}</b>
            </span>
            <span className="t-cap">
              최근 12개월 <b className="t-blue">{manwon(data.reduce((s, d) => s + d.value, 0))}</b>
            </span>
          </div>
          <BarChart data={data} label="월별 수주액" />
        </>
      )}
    </section>
  )
}

/** 프로젝트 진행 현황: 일정 경과율(기간 중 지난 날) vs 업무 완료율(할 일 완료/전체) → 뒤처짐 표시 */
function ProgressBoard({ projects, tasks, today }: { projects: Project[]; tasks: Task[]; today: string }) {
  const { profileName } = useApp()
  const rows = projects
    .filter(p => p.status === '진행' || p.status === '기획' || p.status === 'NIC')
    .map(p => {
      const ts = tasks.filter(t => t.project_id === p.id)
      const done = ts.filter(t => t.status === '완료').length
      const late = ts.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length
      let elapsed: number | null = null
      if (p.start_date && p.end_date) {
        const span = Date.parse(p.end_date) - Date.parse(p.start_date)
        elapsed = span > 0 ? Math.max(0, Math.min(100, ((Date.parse(today) - Date.parse(p.start_date)) / span) * 100)) : today >= p.end_date ? 100 : 0
      }
      const progress = ts.length ? (done / ts.length) * 100 : null
      const next = ts.filter(t => t.status !== '완료' && t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0]
      const behind = elapsed != null && progress != null && progress + 15 < elapsed
      return { p, ts, done, late, elapsed, progress, next, behind }
    })
    .sort((a, b) => Number(b.behind) - Number(a.behind) || b.late - a.late || (a.p.end_date ?? '').localeCompare(b.p.end_date ?? ''))
  return (
    <section className="section" aria-label="프로젝트 진행 현황">
      <div className="section-h">
        <span className="t-bodyb">프로젝트 진행 현황</span>
        <span className="cap">파랑 막대 = 업무 완료율 · 회색 눈금 = 일정 경과율 (완료율이 15%p 이상 뒤지면 뒤처짐)</span>
      </div>
      {rows.length === 0 ? (
        <Empty>진행 · 기획 중인 프로젝트가 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>담당</th>
                <th style={{ minWidth: 190 }}>업무 완료 · 일정 경과</th>
                <th>다음 마감</th>
                <th className="num">지연</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.p.id}>
                  <td className="max">
                    <Link to={`/projects?view=schedule&project=${r.p.id}`} className="strong truncate" style={{ display: 'block' }} title={`${r.p.name} 일정표`}>
                      {r.p.name}
                    </Link>
                    <span className="t-cap">
                      {r.p.status} · {shortDate(r.p.start_date)}~{shortDate(r.p.end_date)}
                    </span>
                  </td>
                  <td className="nowrap">{profileName(r.p.owner_id)}</td>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Meter value={r.progress ?? 0} target={r.elapsed} red={r.behind} label={`${r.p.name} 업무 완료율`} />
                      <span className={`t-meta ${r.behind ? 't-red' : 't-blue'}`} style={{ width: 92, textAlign: 'right' }}>
                        {r.progress == null ? '할 일 없음' : `${Math.round(r.progress)}%`} / {r.elapsed == null ? '–' : `${Math.round(r.elapsed)}%`}
                      </span>
                      {r.behind && <Badge tone="red">뒤처짐</Badge>}
                    </span>
                  </td>
                  <td className="max truncate t-cap" title={r.next?.title}>
                    {r.next ? `${shortDate(r.next.due_date)} ${r.next.title}` : '–'}
                  </td>
                  <td className="num">{r.late ? <Badge tone="red">{r.late}건</Badge> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function OwnerProgress({ projects, tasks, money, today }: { projects: Project[]; tasks: Task[]; money: Map<string, ReturnType<typeof projectMoney>>; today: string }) {
  const { me, profiles } = useApp()
  const admin = me.role === 'admin'
  const rows = profiles
    .filter(p => p.active)
    .map(p => {
      const owned = projects.filter(x => x.owner_id === p.id)
      const mine = tasks.filter(t => t.assignee_id === p.id)
      const done = mine.filter(t => t.status === '완료').length
      return {
        p,
        진행: owned.filter(x => x.status === '진행').length,
        기획: owned.filter(x => x.status === '기획').length,
        완료: owned.filter(x => x.status === '완료').length,
        total: mine.length,
        done,
        late: mine.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length,
        contract: owned.filter(x => x.status !== '보류' && x.status !== 'NIC').reduce((n, x) => n + (money.get(x.id)?.contract ?? 0), 0),
      }
    })
    .filter(r => r.진행 + r.기획 + r.완료 + r.total > 0)
  return (
    <section className="section" aria-label="담당자별 진행상황">
      <div className="section-h">
        <span className="t-bodyb">담당자별 진행상황</span>
        <span className="cap">할 일 완료율 = 완료 ÷ 전체</span>
      </div>
      {rows.length === 0 ? (
        <Empty>담당 프로젝트나 할 일이 아직 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>담당</th>
                <th className="num">진행</th>
                <th className="num">기획</th>
                <th className="num">완료</th>
                <th style={{ minWidth: 150 }}>할 일 완료율</th>
                <th className="num">지연</th>
                {admin && <th className="num">담당 계약액</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const rate = r.total ? (r.done / r.total) * 100 : 0
                return (
                  <tr key={r.p.id}>
                    <td className="nowrap">
                      <span className="row" style={{ gap: 6 }}>
                        <Avatar name={r.p.name} size="xs" />
                        <Link to={`/work?user=${r.p.id}`} className="strong">
                          {r.p.name}
                        </Link>
                        {r.p.is_agent && <Badge tone="acid">AI</Badge>}
                      </span>
                    </td>
                    <td className="num">{r.진행}</td>
                    <td className="num">{r.기획}</td>
                    <td className="num">{r.완료}</td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Meter value={rate} label={`${r.p.name} 할 일 완료율`} />
                        <span className="t-meta t-blue" style={{ width: 70, textAlign: 'right' }}>
                          {r.total ? `${Math.round(rate)}% (${r.done}/${r.total})` : '–'}
                        </span>
                      </span>
                    </td>
                    <td className="num">{r.late ? <Badge tone="red">{r.late}건</Badge> : '0'}</td>
                    {admin && <td className="num">{r.contract ? manwon(r.contract) : '–'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Profitability({ projects, money }: { projects: Project[]; money: Map<string, ReturnType<typeof projectMoney>> }) {
  const { profileName } = useApp()
  const order: Record<Project['status'], number> = { 진행: 0, 기획: 1, NIC: 2, 완료: 3, 보류: 4 }
  const rows = projects
    .filter(p => money.get(p.id)?.contract != null && p.status !== '보류' && p.status !== 'NIC')
    .sort((a, b) => order[a.status] - order[b.status] || (a.end_date ?? '').localeCompare(b.end_date ?? ''))
  return (
    <section className="section" aria-label="프로젝트별 수익성">
      <div className="section-h">
        <span className="t-bodyb">프로젝트별 수익성</span>
        <span className="cap">마진 = 계약액 − 비용 (지급·예상 합계, 없으면 예산)</span>
      </div>
      {rows.length === 0 ? (
        <Empty>프로젝트 상세 › 재무에서 계약액과 목표 마진을 입력하면 여기에 나옵니다.</Empty>
      ) : (
        <>
          <HBarChart
            label="프로젝트별 마진율"
            data={rows.map(p => {
              const m = money.get(p.id)!
              return { key: p.id, label: p.name, value: m.marginRate ?? null, target: m.target, note: `계약 ${shortMan(m.contract ?? 0)} · 비용 ${shortMan(m.cost)}${m.byBudget ? ' (예산)' : ''} · 지급·결재 반영` }
            })}
          />
          <div className="legend">
            <span>
              <i style={{ background: 'var(--blue)' }} />
              목표 달성
            </span>
            <span>
              <i style={{ background: 'var(--pink)' }} />
              목표 미달
            </span>
            <span>
              <i style={{ background: 'var(--red)' }} />
              적자
            </span>
            <span>
              <i style={{ background: 'var(--green)', width: 3 }} />
              목표 마진
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>담당</th>
                  <th className="num">계약액</th>
                  <th className="num">비용</th>
                  <th style={{ minWidth: 200 }}>마진율 · 목표</th>
                  <th className="num">수금률</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const m = money.get(p.id)!
                  const ok = m.marginRate != null && m.target != null ? m.marginRate >= m.target : null
                  return (
                    <tr key={p.id}>
                      <td className="max">
                        <Link to={`/projects?id=${p.id}`} className="strong truncate" style={{ display: 'block' }} title={p.name}>
                          {p.name}
                        </Link>
                      </td>
                      <td className="nowrap">{profileName(p.owner_id)}</td>
                      <td className="num">{manwon(m.contract)}</td>
                      <td className="num" title={m.byBudget ? '아직 지급 내역이 없어 예산으로 계산' : `완료 ${manwon(m.paid)} · 미지급 ${manwon(m.payable)} · 예상 ${manwon(m.estimate)}`}>
                        {m.byBudget ? `예산 ${manwon(m.cost)}` : manwon(m.cost)}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <Meter value={Math.max(0, m.marginRate ?? 0)} max={50} target={m.target} red={(m.marginRate ?? 0) < 0} label={`${p.name} 마진율`} />
                          <span className={`t-meta ${(m.marginRate ?? 0) < 0 ? 't-red' : 't-blue'}`} style={{ width: 48, textAlign: 'right' }}>
                            {pct(m.marginRate)}
                          </span>
                          {ok != null && <Badge tone={ok ? 'acid' : 'yellow'}>{ok ? '달성' : '미달'}</Badge>}
                        </span>
                      </td>
                      <td className="num">{pct(m.collectRate, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <span className="t-cap">막대 = 마진율 (0–50%), 회색 눈금 = 목표 마진</span>
        </>
      )}
    </section>
  )
}

function BudgetAlerts({ projects, fin }: { projects: Project[]; fin: FinData }) {
  const rows = projects.flatMap(p => {
    const lines = fin.lines.filter(l => l.project_id === p.id)
    if (!lines.length) return []
    return budgetByCategory(lines, fin.payments.filter(x => x.project_id === p.id))
      .filter(r => r.over > 0)
      .map(r => ({ p, r }))
  })
  if (!fin.lines.length) return null
  return (
    <section className="section" aria-label="예산 초과 항목">
      <div className="section-h">
        <span className="t-bodyb">예산 초과 항목</span>
        {rows.length > 0 && <Badge tone="red">{rows.length}</Badge>}
        <span className="cap">공사 구분별 실행 예산 대비 · 예상 비용 포함</span>
      </div>
      {rows.length === 0 ? (
        <span className="t-cap">예산을 넘은 공사 구분이 없습니다.</span>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>공사 구분</th>
                <th className="num">예산</th>
                <th className="num">집행</th>
                <th className="num">초과</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map(({ p, r }) => (
                <tr key={`${p.id}-${r.category}`}>
                  <td className="max">
                    <Link to={`/projects?id=${p.id}`} className="strong truncate" style={{ display: 'block' }}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="nowrap">{r.category}</td>
                  <td className="num">{r.budget ? manwon(r.budget) : '예산 없음'}</td>
                  <td className="num">{manwon(r.spent)}</td>
                  <td className="num red">+{manwon(r.over)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const KIND_TONE: Record<string, Tone> = { 클라이언트: 'outline', 협력사: 'paper', 기타: 'paper' }

function Vendors({ payments, clients, today }: { payments: Payment[]; clients: Client[]; today: string }) {
  const rows = vendorSummary(payments, clients, today).slice(0, 8)
  return (
    <section className="section" aria-label="업체별 결제 현황">
      <div className="section-h">
        <span className="t-bodyb">업체별 결제 현황</span>
        <span className="cap">받을 돈 = 수금 미완료 · 줄 돈 = 지급 미완료</span>
      </div>
      {rows.length === 0 ? (
        <Empty>결제 내역이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>업체</th>
                <th>구분</th>
                <th className="num">받을 돈</th>
                <th className="num">받은 돈</th>
                <th className="num">줄 돈</th>
                <th className="num">준 돈</th>
                <th className="num">연체</th>
                <th className="num">다음 예정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="max">
                    <Link to={`/projects?view=payments&q=${encodeURIComponent(r.name)}`} className="strong truncate" style={{ display: 'block' }} title={r.name}>
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.kind ? <Badge tone={KIND_TONE[r.kind]}>{r.kind}</Badge> : <span className="t-cap">업체·개인</span>}</td>
                  <td className="num">{r.receivable ? manwon(r.receivable) : '–'}</td>
                  <td className="num">{r.received ? manwon(r.received) : '–'}</td>
                  <td className="num">{r.payable ? manwon(r.payable) : '–'}</td>
                  <td className="num">{r.paid ? manwon(r.paid) : '–'}</td>
                  <td className="num">{r.overdue ? <Badge tone="red">{r.overdue}건</Badge> : '–'}</td>
                  <td className="num">{r.next ? shortDate(r.next) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const PAY_TONE: Record<Payment['status'], Tone> = { 예정: 'outline', 청구: 'yellow', 대기: 'yellow', 완료: 'acid', 보류: 'paper', 취소: 'paper' }

function Upcoming({ payments, projects, today }: { payments: Payment[]; projects: Project[]; today: string }) {
  const rows = upcomingPayments(payments, today, 14).slice(0, 10)
  return (
    <section className="section" aria-label="다가오는 결제">
      <div className="section-h">
        <span className="t-bodyb">다가오는 결제</span>
        <span className="cap">14일 이내 · 연체 포함 · 실제 금액</span>
        <Link to="/projects?view=payments&st=open" className="t-cap">
          결제 대장 ›
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty>14일 안에 예정된 결제가 없습니다.</Empty>
      ) : (
        rows.map(p => {
          const late = isOverdue(p, today)
          const project = projects.find(x => x.id === p.project_id)
          return (
            <Link key={p.id} to={`/projects?view=payments&pid=${p.id}`} className="item-row" style={{ color: 'inherit' }}>
              <span className={`t-meta ${late ? 't-red' : ''}`} style={{ width: 40 }}>
                {shortDate(p.due_date)}
              </span>
              <Badge tone={p.direction === '수금' ? 'blue' : 'gray'}>{p.direction}</Badge>
              <span className="t-smallb truncate" style={{ maxWidth: 160 }}>
                {p.payee ?? '-'}
              </span>
              <span className="t-cap truncate grow" title={project?.name}>
                {p.title}
                {project ? ` · ${project.name}` : ''}
              </span>
              <span className="t-meta t-blue" style={{ whiteSpace: 'nowrap' }}>
                {manwon(p.amount)}
              </span>
              <Badge tone={late ? 'red' : PAY_TONE[p.status]}>{late ? '연체' : p.status}</Badge>
            </Link>
          )
        })
      )}
    </section>
  )
}

/** 관리자: 결제 점검 요약 + 이번 지급일 */
function CheckStrip({ fin, projects, today }: { fin: FinData; projects: Project[]; today: string }) {
  const checks = paymentChecks(fin.payments, fin.lines, projects, today)
  const monday = runMonday(today)
  const r = paymentRun(fin.payments, monday)
  const runTotal = r.groups.reduce((n, g) => n + g.total, 0)
  if (!checks.length && !r.groups.length) return null
  return (
    <div className={`note ${checks.some(c => c.level === 'high') ? 'warn' : ''}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
      {r.groups.length > 0 && (
        <Link to="/projects?view=payments&sub=run">
          {shortDate(monday)} 월요일 지급 {r.groups.reduce((n, g) => n + g.items.length, 0)}건 · {manwon(runTotal)} ›
        </Link>
      )}
      {checks.length > 0 && (
        <Link to="/projects?view=payments&sub=check">
          결제 점검 {checks.reduce((n, c) => n + c.items.length, 0)}건: {checks.slice(0, 4).map(c => `${c.title} ${c.items.length}`).join(' · ')} ›
        </Link>
      )}
    </div>
  )
}
