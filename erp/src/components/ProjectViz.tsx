// 개별 프로젝트 시각화 (대표 지시 2026-10-31 "제조 KPI 대시보드 참고, 개별 프로젝트의 완성도 있는 시각화 자료와 사용성")
//   1줄: 목표 대비 KPI 3칸 (수금 · 비용 · 마진율) — 큰 숫자 + 추이 미니 그래프 + 목표 + 차이 배지
//   2줄: 공사 구분별 예산 대 집행 (가로 막대) · 비용 구성 (도넛, 가운데 합계) · 월별 수금 · 지급
//   3줄: 업체별 지급률 · 앞으로 4주 지급 예정 (일정은 맨 위 '프로젝트 일정'에)
//   금액은 공급가(VAT 별도) 기준. 마우스를 올리면 값, 누르면 그 업체 · 공사 구분 결제로
import { useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, ListChecks, Plus } from 'lucide-react'
import { Link } from '../lib/router'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, addMonths, manwon, shortDate, todayKey, won } from '../lib/date'
import { budgetByCategory, contractRows, isOpen, monthlyFlow, projectMoney } from '../lib/finance'
import { TASK_STATUSES, type BudgetLine, type Payment, type Project, type ProjectFinance, type Task, type TaskStatus } from '../lib/types'
import { TaskAssignModal } from '../pages/Schedule'
import { Button, Modal } from './ui'
import { shortMan } from './charts'

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
      {money && <ProjectViz project={project} payments={data.payments} lines={data.lines} finance={data.finance} />}
    </div>
  )
}

export function ProjectViz({ project, payments, lines, finance, onVendor }: { project: Project; payments: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; onVendor?: (name: string) => void }) {
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

  // 일정: 기간 경과 % 대 할 일 완료 %
  const start = project.start_date
  const end = project.end_date
  const elapsed = start && end && end > start ? Math.max(0, Math.min(100, ((Date.parse(today) - Date.parse(start)) / (Date.parse(end) - Date.parse(start))) * 100)) : null

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

      {/* 비용 구성 · 월별 수금 · 지급 · 앞으로 4주 지급 예정은 뺌 (대표 지시 2026-10-31 "이것도 삭제") */}
      <div className="pviz-row">
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
      </div>

      <div className="pviz-row">
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
  // 일정 고치기 (대표 지시 2026-10-31 "프로젝트 일정표는 각 프로젝트에서 업무일지로 수정 가능하게, 별도로도 수정 가능하게")
  //  - [일지로 편집]: 할 일을 업무일지처럼 한 줄씩 바로 고침 (제목 · 시작 · 마감 · 담당 · 상태) · 맨 아래 줄에 새 일정
  //  - 막대 · 이름을 누르면 수정 창 · 프로젝트 기간 줄을 누르면 기간 고치기 · [+ 일정]
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [logMode, setLogMode] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  return (
    <div className="pviz-row head">
      <div className="pviz-card">
        <div className="pviz-h">
          <b>프로젝트 일정</b>
          <span className={`pviz-dday ${dday.tone}`}>{dday.label}</span>
          <span className="t-cap" style={{ marginLeft: 'auto' }}>
            할 일 {doneN}/{tasks.length} 완료{lateTasks.length ? ` · 지연 ${lateTasks.length}` : ''}
          </span>
          <button type="button" className={`chip ${logMode ? 'active' : ''}`} onClick={() => setLogMode(v => !v)} title="업무일지처럼 한 줄씩 바로 고치기">
            <ListChecks size={12} /> {logMode ? '타임라인' : '일지로 편집'}
          </button>
          <button type="button" className="chip" onClick={() => setEditing('new')} title="이 프로젝트에 일정 · 할 일 추가">
            <Plus size={12} /> 일정
          </button>
        </div>
        {logMode ? <ScheduleLog project={project} tasks={tasks} /> : (
        <div className="pviz-tl">
          <div className="pviz-tl-axis">
            <span>{shortDate(lo)}</span>
            <span>{shortDate(hi)}</span>
          </div>
          {(start || end) && (
            <div className="pviz-tl-row proj click" onClick={() => setPeriodOpen(true)} title="눌러서 프로젝트 기간 고치기">
              <span className="pviz-tl-name">프로젝트 기간</span>
              <span className="pviz-tl-track">
                {start && end && <i className="bar proj" style={{ left: `${pos(start)}%`, width: `${Math.max(1.5, pos(addDays(end, 1)) - pos(start))}%` }} title={`${shortDate(start)} ~ ${shortDate(end)} · 눌러서 고치기`} />}
                <b className="now" style={{ left: `${pos(today)}%` }} title="오늘" />
              </span>
            </div>
          )}
          {rows.map(t => {
            const s0 = t.start_date ?? t.due_date!
            const e0 = t.due_date ?? t.start_date!
            const late = t.status !== '완료' && e0 < today
            return (
              <div key={t.id} className="pviz-tl-row click" onClick={() => setEditing(t)} title="눌러서 고치기">
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
          {!rows.length && <span className="t-cap">날짜가 있는 할 일이 없습니다. [+ 일정] 또는 [일지로 편집]으로 넣어 주세요.</span>}
        </div>
        )}
        {editing && <TaskAssignModal task={editing === 'new' ? undefined : editing} projects={[project]} tasks={tasks} presetProject={project.id} onClose={() => setEditing(null)} />}
        {periodOpen && <PeriodModal project={project} onClose={() => setPeriodOpen(false)} />}
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
      </div>
    </div>
  )
}

/** 프로젝트 기간(시작 · 종료) 고치기 */
function PeriodModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [a, setA] = useState(project.start_date ?? '')
  const [b, setB] = useState(project.end_date ?? '')
  const save = async () => {
    if (a && b && a > b) return
    if (await run(() => api.saveProject({ id: project.id, start_date: a || null, end_date: b || null }), '프로젝트 기간을 바꿨습니다.')) onClose()
  }
  return (
    <Modal
      title="프로젝트 기간"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || (!!a && !!b && a > b)}>
            저장
          </Button>
        </>
      }
    >
      <div className="row gap-6">
        <label className="label grow">
          <span>시작일</span>
          <input className="input" type="date" value={a} onChange={e => setA(e.target.value)} />
        </label>
        <label className="label grow">
          <span>종료일</span>
          <input className="input" type="date" value={b} onChange={e => setB(e.target.value)} />
        </label>
      </div>
      {a && b && a > b && <span className="t-cap t-red">시작일이 종료일보다 늦습니다.</span>}
    </Modal>
  )
}

/** 업무일지처럼 한 줄씩 바로 고치는 일정 목록 · 칸을 바꾸면 바로 저장 · 맨 아래 줄에서 새 일정 */
function ScheduleLog({ project, tasks }: { project: Project; tasks: Task[] }) {
  const { api, profiles, toast, bump } = useApp()
  const people = profiles.filter(p => p.active !== false)
  const list = [...tasks].sort((x, y) => (x.start_date ?? x.due_date ?? '9999').localeCompare(y.start_date ?? y.due_date ?? '9999') || x.created_at.localeCompare(y.created_at))
  const [draft, setDraft] = useState({ title: '', start_date: '', due_date: '', assignee_id: '' })
  const save = async (t: Task, patch: Partial<Task>) => {
    try {
      await api.saveTask({ id: t.id, ...patch })
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    }
  }
  const add = async () => {
    const title = draft.title.trim()
    if (!title) return
    try {
      await api.saveTask({ project_id: project.id, title, start_date: draft.start_date || null, due_date: draft.due_date || draft.start_date || null, assignee_id: draft.assignee_id || null, status: '할 일' })
      setDraft({ title: '', start_date: '', due_date: '', assignee_id: '' })
      bump()
      toast('일정을 넣었습니다.')
    } catch (e) {
      toast(e instanceof Error ? e.message : '넣지 못했습니다.')
    }
  }
  return (
    <div className="sched-log">
      <div className="sched-log-row head">
        <span>할 일 · 일정</span>
        <span>시작</span>
        <span>마감</span>
        <span>담당</span>
        <span>상태</span>
      </div>
      {list.map(t => (
        <div key={t.id} className={`sched-log-row${t.status === '완료' ? ' done' : ''}`}>
          <input className="input" defaultValue={t.title} onBlur={e => e.target.value.trim() && e.target.value.trim() !== t.title && save(t, { title: e.target.value.trim() })} aria-label="할 일" />
          <input className="input" type="date" defaultValue={t.start_date ?? ''} onChange={e => save(t, { start_date: e.target.value || null })} aria-label="시작" />
          <input className="input" type="date" defaultValue={t.due_date ?? ''} onChange={e => save(t, { due_date: e.target.value || null })} aria-label="마감" />
          <select className="select" defaultValue={t.assignee_id ?? ''} onChange={e => save(t, { assignee_id: e.target.value || null })} aria-label="담당">
            <option value="">미정</option>
            {people.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="select" defaultValue={t.status} onChange={e => save(t, { status: e.target.value as TaskStatus })} aria-label="상태">
            {TASK_STATUSES.map(st => (
              <option key={st}>{st}</option>
            ))}
          </select>
        </div>
      ))}
      <div className="sched-log-row new">
        <input className="input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && void add()} placeholder="+ 새 일정 (Enter)" aria-label="새 일정" />
        <input className="input" type="date" value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} aria-label="새 일정 시작" />
        <input className="input" type="date" value={draft.due_date} onChange={e => setDraft({ ...draft, due_date: e.target.value })} aria-label="새 일정 마감" />
        <select className="select" value={draft.assignee_id} onChange={e => setDraft({ ...draft, assignee_id: e.target.value })} aria-label="새 일정 담당">
          <option value="">담당</option>
          {people.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" onClick={() => void add()} disabled={!draft.title.trim()}>
          넣기
        </button>
      </div>
    </div>
  )
}
