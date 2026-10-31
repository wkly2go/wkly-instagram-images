// 개별 프로젝트 시각화 (대표 지시 2026-10-31 "제조 KPI 대시보드 참고, 개별 프로젝트의 완성도 있는 시각화 자료와 사용성")
//   1줄: 목표 대비 KPI 3칸 (수금 · 비용 · 마진율) — 큰 숫자 + 추이 미니 그래프 + 목표 + 차이 배지
//   2줄: 공사 구분별 예산 대 집행 (가로 막대) · 비용 구성 (도넛, 가운데 합계) · 월별 수금 · 지급
//   3줄: 업체별 지급률 · 일정 진행 (기간 경과 대 할 일 완료) · 앞으로 4주 지급 예정
//   금액은 공급가(VAT 별도) 기준. 마우스를 올리면 값, 누르면 그 업체 · 공사 구분 결제로
import { useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2 } from 'lucide-react'
import { Link } from '../lib/router'
import { useApp, useAsync } from '../lib/app'
import { addDays, addMonths, manwon, shortDate, todayKey, won } from '../lib/date'
import { budgetByCategory, contractRows, isDone, isOpen, monthlyFlow, projectMoney, supply } from '../lib/finance'
import type { BudgetLine, Payment, Project, ProjectFinance, Task } from '../lib/types'
import { FlowChart, shortMan } from './charts'

const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6']
const OTHER = '#a8a6a0'
const DARK = 'var(--blue)'
const LIGHT = '#9cc3a6'

/** 프로젝트 상세용: 스스로 불러옴 */
export function ProjectVizLoader({ project }: { project: Project }) {
  const { api, version } = useApp()
  const { data } = useAsync(
    async () => {
      const [payments, lines, finances, tasks] = await Promise.all([api.listPayments().catch(() => [] as Payment[]), api.listBudgetLines(project.id).catch(() => [] as BudgetLine[]), api.listFinances().catch(() => [] as ProjectFinance[]), api.listTasks().catch(() => [] as Task[])])
      return { payments: payments.filter(p => p.project_id === project.id), lines, finance: finances.find(f => f.project_id === project.id), tasks: tasks.filter(t => t.project_id === project.id) }
    },
    [project.id, version],
    { payments: [] as Payment[], lines: [] as BudgetLine[], finance: undefined as ProjectFinance | undefined, tasks: [] as Task[] },
  )
  const money = !!data.payments.length || data.finance?.contract_amount != null
  return (
    <div className="pviz-wrap">
      <ProjectHead project={project} payments={data.payments} lines={data.lines} finance={data.finance} tasks={data.tasks} />
      {money && <ProjectViz project={project} payments={data.payments} lines={data.lines} finance={data.finance} tasks={data.tasks} />}
    </div>
  )
}

export function ProjectViz({ project, payments, lines, finance, tasks, onVendor }: { project: Project; payments: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; tasks?: Task[]; onVendor?: (name: string) => void }) {
  const { api, version } = useApp()
  // 결제 대장 쪽에서 부를 때는 할 일을 따로 불러옴
  const { data: loaded } = useAsync(async () => (tasks ? tasks : (await api.listTasks().catch(() => [] as Task[])).filter(t => t.project_id === project.id)), [project.id, version, !!tasks], [] as Task[])
  const ts = tasks ?? loaded
  const today = todayKey()
  const m = projectMoney(finance, payments, lines, today)
  const cats = budgetByCategory(lines, payments)
  const vendors = contractRows(payments, lines).sort((a, b) => b.scheduled - a.scheduled).slice(0, 8)

  // 달 목록: 첫 결제 달 ~ 이번 달 (최대 12개월, 최소 6개월)
  const firstMonth = [...payments.map(p => (p.paid_date ?? p.due_date ?? p.requested_date ?? '').slice(0, 7)).filter(Boolean), project.start_date?.slice(0, 7) ?? ''].filter(Boolean).sort()[0] ?? today.slice(0, 7)
  const endMonth = today.slice(0, 7)
  const months: string[] = []
  for (let mm = firstMonth < addMonths(endMonth, -11) ? addMonths(endMonth, -11) : firstMonth; mm <= endMonth; mm = addMonths(mm, 1)) months.push(mm)
  while (months.length < 6) months.unshift(addMonths(months[0] ?? endMonth, -1))
  const flow = monthlyFlow(payments, months)
  const cumIn: number[] = []
  const cumOut: number[] = []
  flow.reduce((acc, f) => (cumIn.push(acc + f.inflow), acc + f.inflow), 0)
  flow.reduce((acc, f) => (cumOut.push(acc + f.outflow), acc + f.outflow), 0)
  const cumRate = m.contract ? cumOut.map(o => ((m.contract! - o) / m.contract!) * 100) : []

  const costCap = m.contract != null && m.target != null ? Math.round(m.contract * (1 - m.target / 100)) : null
  const costGap = costCap != null ? m.cost - costCap : null

  // 비용 구성 (공사 구분)
  const costByCat = new Map<string, number>()
  for (const p of payments) if (p.direction === '지급' && p.status !== '취소') costByCat.set(p.category?.trim() || '미분류', (costByCat.get(p.category?.trim() || '미분류') ?? 0) + supply(p))
  const ranked = [...costByCat.entries()].filter(e => e[1] > 0).sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, ranked.length > 6 ? 5 : 6)
  const rest = ranked.slice(top.length).reduce((n, e) => n + e[1], 0)
  const donut = [...top.map(([k, v], i) => ({ key: k, value: v, color: SLOTS[i] })), ...(rest > 0 ? [{ key: '기타', value: rest, color: OTHER }] : [])]

  // 일정: 기간 경과 % 대 할 일 완료 %
  const start = project.start_date
  const end = project.end_date
  const elapsed = start && end && end > start ? Math.max(0, Math.min(100, ((Date.parse(today) - Date.parse(start)) / (Date.parse(end) - Date.parse(start))) * 100)) : null
  const doneTasks = ts.filter(t => t.status === '완료').length
  const lateTasks = ts.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length
  const taskRate = ts.length ? (doneTasks / ts.length) * 100 : null

  // 앞으로 4주 지급 예정 (주별)
  const weeks = Array.from({ length: 4 }, (_, i) => addDays(today, i * 7))
  const due = weeks.map((w, i) => {
    const wEnd = addDays(w, 6)
    const list = payments.filter(p => p.direction === '지급' && isOpen(p) && p.due_date && (i === 0 ? p.due_date <= wEnd : p.due_date >= w && p.due_date <= wEnd))
    return { w, wEnd, total: list.reduce((n, p) => n + p.amount, 0), n: list.length }
  })
  const dueMax = Math.max(1, ...due.map(d => d.total))

  return (
    <section className="pviz" aria-label="프로젝트 시각화">
      <div className="pviz-row three">
        <KpiSpark
          title="수금"
          sub="받은 돈 · 공급가"
          value={manwon(m.received) || '0'}
          series={cumIn}
          target={m.contract != null ? `계약 ${manwon(m.contract)}` : '계약액 미입력'}
          badge={m.collectRate != null ? { text: `${Math.round(m.collectRate)}% 수금`, good: m.collectRate >= (elapsed ?? 0) } : null}
          note={m.receivable ? `미수 ${manwon(m.receivable)}` : undefined}
        />
        <KpiSpark
          title="비용"
          sub={m.byBudget ? '예산 기준 (지급 없음)' : '지급 완료 + 미지급 + 예상'}
          value={manwon(m.cost) || '0'}
          series={cumOut}
          target={costCap != null ? `목표 한도 ${manwon(costCap)}` : `예산 ${m.budget != null ? manwon(m.budget) : '–'}`}
          badge={costGap != null ? { text: costGap > 0 ? `▲ ${manwon(costGap)} 초과` : `▼ ${manwon(-costGap)} 여유`, good: costGap <= 0 } : null}
          note={`지급 ${manwon(m.paid) || '0'} · 남은 지급 ${manwon(m.payable) || '0'}`}
        />
        <KpiSpark
          title="마진율"
          sub="(계약 − 비용) ÷ 계약"
          value={m.marginRate != null ? `${m.marginRate.toFixed(1)}%` : '–'}
          series={cumRate}
          target={m.target != null ? `목표 ${m.target}%` : '목표 미입력'}
          badge={m.marginRate != null && m.target != null ? { text: `${m.marginRate >= m.target ? '▲' : '▼'} ${Math.abs(m.marginRate - m.target).toFixed(1)}%p`, good: m.marginRate >= m.target } : null}
          note={m.margin != null ? `마진 ${manwon(m.margin)}` : undefined}
        />
      </div>

      <div className="pviz-row three">
        <div className="pviz-card">
          <div className="pviz-h">
            <b>공사 구분별 예산 대 집행</b>
            <span className="pviz-key">
              <i style={{ background: LIGHT }} />
              예산 <i style={{ background: DARK }} />
              집행
            </span>
          </div>
          {cats.length === 0 ? <span className="t-cap">예산 줄이나 지급이 없습니다.</span> : <BudgetBars rows={cats.slice(0, 7)} />}
        </div>
        <div className="pviz-card">
          <div className="pviz-h">
            <b>비용 구성</b>
            <span className="t-cap">공사 구분 · 공급가</span>
          </div>
          {donut.length === 0 ? <span className="t-cap">지급이 없습니다.</span> : <Donut parts={donut} />}
        </div>
        <div className="pviz-card">
          <div className="pviz-h">
            <b>월별 수금 · 지급</b>
            <span className="t-cap">완료 기준</span>
          </div>
          <FlowChart data={flow} height={190} />
        </div>
      </div>

      <div className="pviz-row three">
        <div className="pviz-card">
          <div className="pviz-h">
            <b>업체별 지급률</b>
            <span className="t-cap">계약(없으면 잡힌 지급) 대비</span>
          </div>
          {vendors.length === 0 ? (
            <span className="t-cap">지급이 없습니다.</span>
          ) : (
            <ul className="pviz-vendors">
              {vendors.map(v => (
                <li key={v.key}>
                  <button type="button" onClick={() => onVendor?.(v.payee)} disabled={!onVendor} title={`${v.payee} · 지급 ${won(v.paid)} / ${won(v.contract ?? v.scheduled)}`}>
                    <span className="pviz-vname">{v.payee}</span>
                    <span className="pviz-vbar">
                      <i style={{ width: `${Math.min(100, v.rate ?? 0)}%` }} />
                    </span>
                    <span className="mono pviz-vpct">{v.rate != null ? `${Math.round(v.rate)}%` : '–'}</span>
                    <span className="t-cap pviz-vrem">{v.remain > 0 ? `잔 ${manwon(v.remain)}` : '완료'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="pviz-card">
          <div className="pviz-h">
            <b>일정 진행</b>
            <span className="t-cap">
              {start ? shortDate(start) : '?'} ~ {end ? shortDate(end) : '?'}
            </span>
          </div>
          <div className="pviz-progress">
            <ProgressRow label="기간 경과" value={elapsed} color={LIGHT} />
            <ProgressRow label="할 일 완료" value={taskRate} color={DARK} note={ts.length ? `${doneTasks}/${ts.length}` : '할 일 없음'} />
            <ProgressRow label="수금" value={m.collectRate} color="#2a78d6" />
            <ProgressRow label="지급" value={m.paid + m.payable > 0 ? (m.paid / (m.paid + m.payable)) * 100 : null} color="#eb6834" />
          </div>
          <span className={`t-cap ${lateTasks ? 't-red' : ''}`}>
            {elapsed != null && taskRate != null ? (taskRate + 5 < elapsed ? `일정보다 할 일이 ${Math.round(elapsed - taskRate)}%p 늦습니다` : '일정대로 진행 중') : '시작 · 종료일을 넣으면 일정 대비 진행을 봅니다'}
            {lateTasks ? ` · 마감 지난 할 일 ${lateTasks}건` : ''}
          </span>
        </div>
        <div className="pviz-card">
          <div className="pviz-h">
            <b>앞으로 4주 지급 예정</b>
            <span className="t-cap">실제 금액 · 지난 예정 포함</span>
          </div>
          <ul className="pviz-weeks">
            {due.map((d, i) => (
              <li key={d.w} title={`${shortDate(d.w)} ~ ${shortDate(d.wEnd)} · ${d.n}건 · ${won(d.total)}`}>
                <span className="t-cap pviz-wk">{i === 0 ? '이번 주' : `${shortDate(d.w)}~`}</span>
                <span className="pviz-vbar">
                  <i style={{ width: `${(d.total / dueMax) * 100}%`, background: '#eb6834' }} />
                </span>
                <span className="mono">{d.total ? shortMan(d.total) : '–'}</span>
                <span className="t-cap">{d.n ? `${d.n}건` : ''}</span>
              </li>
            ))}
          </ul>
          <span className="t-cap">완료 {payments.filter(p => p.direction === '지급' && isDone(p)).length}건 · 미지급 {payments.filter(p => p.direction === '지급' && isOpen(p)).length}건</span>
        </div>
      </div>
    </section>
  )
}

/** 큰 숫자 + 추이 면 그래프 + 목표 + 차이 배지 */
function KpiSpark({ title, sub, value, series, target, badge, note }: { title: string; sub: string; value: string; series: number[]; target: string; badge: { text: string; good: boolean } | null; note?: string }) {
  const W = 150
  const H = 44
  const lo = Math.min(0, ...series)
  const hi = Math.max(1, ...series)
  const pts = series.map((v, i) => [series.length <= 1 ? W : (i / (series.length - 1)) * W, H - ((v - lo) / (hi - lo || 1)) * (H - 4) - 2])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  return (
    <div className="pviz-card pviz-kpi">
      <div className="pviz-h">
        <b>{title}</b>
        <span className="t-cap">{sub}</span>
      </div>
      <div className="pviz-kpi-body">
        <span className="pviz-big">{value}</span>
        {series.length > 1 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="pviz-spark" aria-hidden="true">
            <path d={`${d}L${W},${H}L0,${H}Z`} fill="var(--blue-tint)" />
            <path d={d} fill="none" stroke="var(--blue)" strokeWidth={2} />
          </svg>
        )}
      </div>
      <div className="pviz-kpi-foot">
        <span className="pviz-target">{target}</span>
        {badge && <span className={`pviz-badge ${badge.good ? 'good' : 'bad'}`}>{badge.text}</span>}
      </div>
      {note && <span className="t-cap">{note}</span>}
    </div>
  )
}

function BudgetBars({ rows }: { rows: ReturnType<typeof budgetByCategory> }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.budget, r.spent]))
  return (
    <ul className="pviz-budget">
      {rows.map(r => (
        <li key={r.category} title={`${r.category} · 예산 ${won(r.budget)} · 집행 ${won(r.spent)}${r.over ? ` · 초과 ${won(r.over)}` : ''}`}>
          <span className="pviz-bname">{r.category}</span>
          <span className="pviz-bpair">
            <i className="b" style={{ width: `${(r.budget / max) * 100}%` }} />
            <i className={`s${r.over && r.budget ? ' over' : ''}`} style={{ width: `${(r.spent / max) * 100}%` }} />
          </span>
          <span className={`mono t-cap ${r.over && r.budget ? 't-red' : ''}`}>{r.rate != null ? `${Math.round(r.rate)}%` : shortMan(r.spent)}</span>
        </li>
      ))}
    </ul>
  )
}

function Donut({ parts }: { parts: { key: string; value: number; color: string }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = parts.reduce((n, p) => n + p.value, 0)
  const R = 62
  const r = 40
  const C = 75
  let a0 = -Math.PI / 2
  const arcs = parts.map(p => {
    const a1 = a0 + (p.value / total) * Math.PI * 2
    const gap = parts.length > 1 ? 0.012 : 0
    const s = a0 + gap
    const e = Math.max(s, a1 - gap)
    const large = e - s > Math.PI ? 1 : 0
    const pt = (rad: number, ang: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`
    const d = parts.length === 1 ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}L${C - 0.01},${C - r}A${r},${r} 0 1 0 ${C},${C - r}Z` : `M${pt(R, s)}A${R},${R} 0 ${large} 1 ${pt(R, e)}L${pt(r, e)}A${r},${r} 0 ${large} 0 ${pt(r, s)}Z`
    a0 = a1
    return { ...p, d }
  })
  const h = hover != null ? parts[hover] : null
  return (
    <div className="pviz-donut">
      <svg width={150} height={150} viewBox="0 0 150 150" role="img" aria-label={`비용 구성: ${parts.map(p => `${p.key} ${Math.round((p.value / total) * 100)}%`).join(', ')}`}>
        {arcs.map((a, i) => (
          <path key={a.key} d={a.d} fill={a.color} opacity={hover == null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" fontSize={11} fill="var(--gray)">
          {h ? h.key : '비용 합계'}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize={15} fontWeight={800} fill="var(--blue)" fontFamily="var(--mono)">
          {shortMan(h ? h.value : total)}
        </text>
      </svg>
      <ul className="pviz-dlegend">
        {parts.map((p, i) => (
          <li key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'on' : ''}>
            <i style={{ background: p.color }} />
            <span className="grow">{p.key}</span>
            <span className="mono t-cap">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProgressRow({ label, value, color, note }: { label: string; value: number | null; color: string; note?: string }) {
  return (
    <div className="pviz-prow">
      <span className="t-cap pviz-plabel">{label}</span>
      <span className="pviz-vbar">
        <i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
      </span>
      <span className="mono t-cap" style={{ width: 70, textAlign: 'right' }}>
        {value != null ? `${Math.round(value)}%` : '–'}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  )
}

/** 맨 위: 일정(디데이 · 기간 막대 · 할 일 타임라인) + 입출금 알람 (대표 지시 2026-10-31 "상단에 대시보드, 스케줄 · 자금흐름 · 목표 달성 · 입출금 알람") */
export function ProjectHead({ project, payments, lines, finance, tasks }: { project: Project; payments: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; tasks: Task[] }) {
  const today = todayKey()
  const m = projectMoney(finance, payments, lines, today)
  const start = project.start_date
  const end = project.end_date ?? project.start_date
  const dd = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
  const dday = start && today < start ? { label: `시작 D-${dd(today, start)}`, tone: 'soon' } : end && today <= end ? { label: start && today >= start ? `진행 중 · 종료 D-${dd(today, end)}` : `종료 D-${dd(today, end)}`, tone: 'live' } : end ? { label: `종료 후 ${dd(end, today)}일`, tone: 'past' } : { label: '기간 미정', tone: 'past' }

  // 타임라인 범위: 프로젝트 기간 + 할 일 날짜 (앞뒤 여유)
  const withDates = tasks.filter(t => t.due_date || t.start_date)
  const allDates = [start, end, today, ...withDates.flatMap(t => [t.start_date ?? t.due_date!, t.due_date ?? t.start_date!])].filter((x): x is string => !!x).sort()
  const lo = addDays(allDates[0] ?? today, -2)
  const hi = addDays(allDates[allDates.length - 1] ?? today, 2)
  const span = Math.max(1, dd(lo, hi))
  const pos = (d: string) => (dd(lo, d) / span) * 100
  const rows = [...withDates]
    .sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0) || (a.due_date ?? a.start_date ?? '').localeCompare(b.due_date ?? b.start_date ?? ''))
    .slice(0, 7)
    .sort((a, b) => (a.start_date ?? a.due_date ?? '').localeCompare(b.start_date ?? b.due_date ?? ''))

  // 입출금 알람
  type Alarm = { key: string; level: 'red' | 'amber' | 'ok'; text: string; to: string }
  const pay = `/projects?view=payments&project=${project.id}`
  const alarms: Alarm[] = []
  const week = addDays(today, 7)
  const sumAmt = (l: Payment[]) => manwon(l.reduce((n, p) => n + p.amount, 0)) || '0'
  const lateIn = payments.filter(p => p.direction === '수금' && isOpen(p) && p.due_date && p.due_date < today)
  const lateOut = payments.filter(p => p.direction === '지급' && isOpen(p) && p.due_date && p.due_date < today)
  const soonIn = payments.filter(p => p.direction === '수금' && isOpen(p) && p.due_date && p.due_date >= today && p.due_date <= week)
  const soonOut = payments.filter(p => p.direction === '지급' && isOpen(p) && p.due_date && p.due_date >= today && p.due_date <= week)
  const noDate = payments.filter(p => isOpen(p) && !p.due_date)
  const noAcc = payments.filter(p => p.direction === '지급' && isOpen(p) && !p.account_no && p.contract_type !== '카드' && !p.advance_by)
  const noInvoice = payments.filter(p => p.direction === '수금' && p.status !== '취소' && !p.is_estimate && p.tax_invoice === '미발행')
  const overCats = budgetByCategory(lines, payments).filter(c => c.budget > 0 && c.over > 0)
  const lateTasks = tasks.filter(t => t.status !== '완료' && t.due_date && t.due_date < today)
  if (lateIn.length) alarms.push({ key: 'li', level: 'red', text: `수금 연체 ${lateIn.length}건 · ${sumAmt(lateIn)}`, to: pay })
  if (lateOut.length) alarms.push({ key: 'lo', level: 'red', text: `지급 연체 ${lateOut.length}건 · ${sumAmt(lateOut)}`, to: pay })
  if (m.marginRate != null && m.target != null && m.marginRate < m.target) alarms.push({ key: 'mg', level: 'red', text: `마진율 ${m.marginRate.toFixed(1)}% · 목표 ${m.target}%보다 ${(m.target - m.marginRate).toFixed(1)}%p 낮음`, to: pay })
  for (const c of overCats.slice(0, 3)) alarms.push({ key: `ov${c.category}`, level: 'red', text: `${c.category} 예산 초과 ${manwon(c.over)}`, to: pay })
  if (soonIn.length) alarms.push({ key: 'si', level: 'amber', text: `7일 안 수금 예정 ${soonIn.length}건 · ${sumAmt(soonIn)}`, to: pay })
  if (soonOut.length) alarms.push({ key: 'so', level: 'amber', text: `7일 안 지급 예정 ${soonOut.length}건 · ${sumAmt(soonOut)}`, to: pay })
  if (noInvoice.length) alarms.push({ key: 'ni', level: 'amber', text: `세금계산서 미발행 수금 ${noInvoice.length}건`, to: pay })
  if (noAcc.length) alarms.push({ key: 'na', level: 'amber', text: `계좌 없는 미지급 ${noAcc.length}건`, to: pay })
  if (noDate.length) alarms.push({ key: 'nd', level: 'amber', text: `예정일 없는 결제 ${noDate.length}건`, to: pay })
  if (lateTasks.length) alarms.push({ key: 'lt', level: 'red', text: `마감 지난 할 일 ${lateTasks.length}건`, to: '/projects?view=mine' })
  if (m.contract == null) alarms.push({ key: 'nc', level: 'amber', text: '계약액 미입력 — 수금률 · 마진을 계산할 수 없음', to: `/projects?id=${project.id}` })

  const doneN = tasks.filter(t => t.status === '완료').length
  return (
    <div className="pviz-row head">
      <div className="pviz-card">
        <div className="pviz-h">
          <b>프로젝트 일정</b>
          <span className={`pviz-dday ${dday.tone}`}>{dday.label}</span>
          <span className="t-cap" style={{ marginLeft: 'auto' }}>
            할 일 {doneN}/{tasks.length} 완료{lateTasks.length ? ` · 지연 ${lateTasks.length}` : ''}
          </span>
        </div>
        <div className="pviz-tl">
          <div className="pviz-tl-axis">
            <span>{shortDate(lo)}</span>
            <span>{shortDate(hi)}</span>
          </div>
          {start && end && (
            <div className="pviz-tl-row proj">
              <span className="pviz-tl-name">프로젝트 기간</span>
              <span className="pviz-tl-track">
                <i className="bar proj" style={{ left: `${pos(start)}%`, width: `${Math.max(1.5, pos(addDays(end, 1)) - pos(start))}%` }} title={`${shortDate(start)} ~ ${shortDate(end)}`} />
                <b className="now" style={{ left: `${pos(today)}%` }} title="오늘" />
              </span>
            </div>
          )}
          {rows.map(t => {
            const s0 = t.start_date ?? t.due_date!
            const e0 = t.due_date ?? t.start_date!
            const late = t.status !== '완료' && e0 < today
            return (
              <div key={t.id} className="pviz-tl-row">
                <span className="pviz-tl-name" title={t.title}>
                  {t.title}
                </span>
                <span className="pviz-tl-track">
                  <i className={`bar ${t.status === '완료' ? 'done' : late ? 'late' : ''}`} style={{ left: `${pos(s0)}%`, width: `${Math.max(1.5, pos(addDays(e0 > s0 ? e0 : s0, 1)) - pos(s0))}%` }} title={`${t.title} · ${shortDate(s0)}${e0 !== s0 ? ` ~ ${shortDate(e0)}` : ''} · ${t.status}`} />
                  <b className="now" style={{ left: `${pos(today)}%` }} />
                </span>
              </div>
            )
          })}
          {!rows.length && <span className="t-cap">날짜가 있는 할 일이 없습니다.</span>}
        </div>
      </div>
      <div className="pviz-card">
        <div className="pviz-h">
          <b>입출금 알람</b>
          <span className="t-cap">{alarms.length ? `${alarms.length}건` : ''}</span>
          <Link to={pay} className="t-cap" style={{ marginLeft: 'auto' }}>
            결제 대장 ›
          </Link>
        </div>
        {alarms.length === 0 ? (
          <span className="pviz-alarm ok">
            <CheckCircle2 size={14} /> 연체 · 예산 초과 · 확인할 결제가 없습니다.
          </span>
        ) : (
          <ul className="pviz-alarms">
            {alarms.slice(0, 8).map(a => (
              <li key={a.key}>
                <Link to={a.to} className={`pviz-alarm ${a.level}`}>
                  {a.level === 'red' ? <AlertTriangle size={13} /> : <BellRing size={13} />} {a.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="pviz-mini">
          <span>
            수금 <b>{m.collectRate != null ? `${Math.round(m.collectRate)}%` : '–'}</b>
          </span>
          <span>
            미수 <b>{manwon(m.receivable) || '0'}</b>
          </span>
          <span>
            남은 지급 <b>{manwon(m.payable) || '0'}</b>
          </span>
          <span>
            마진율 <b className={m.marginRate != null && m.target != null && m.marginRate < m.target ? 't-red' : ''}>{m.marginRate != null ? `${m.marginRate.toFixed(1)}%` : '–'}</b>
            {m.target != null ? ` / 목표 ${m.target}%` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
