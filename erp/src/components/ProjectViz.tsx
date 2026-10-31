// 프로젝트 상세: 프로젝트 일정 · 입출금 알람 (재무 KPI · 그래프는 2026-10-31 대표 지시로 모두 뺌 — 재무 4칸 요약 · 협력업체 관리로)
import { useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, ListChecks, Plus } from 'lucide-react'
import { Link } from '../lib/router'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, manwon, shortDate, todayKey } from '../lib/date'
import { budgetByCategory, isOpen, projectMoney } from '../lib/finance'
import { TASK_STATUSES, type BudgetLine, type Payment, type Project, type ProjectFinance, type Task, type TaskStatus } from '../lib/types'
import { TaskAssignModal } from '../pages/Schedule'
import { QuickSchedule } from './ProjectBrief'
import { Button, Modal } from './ui'


/** 프로젝트 상세용: 스스로 불러옴 */
/** part: 'alarm' 입출금 알람만 · 'money' 재무 시각화(KPI · 예산 대 집행 · 업체 지급률)만 · 'schedule' 프로젝트 일정만 · 없으면 전부
 *  (대표 지시 2026-10-31 순서: ① 개요 + 입출금 알람 ② 재무 시각화 ③ 프로젝트 일정 ④ 업무일지 · 할 일) */
export function ProjectVizLoader({ project, part }: { project: Project; part?: 'alarm' | 'money' | 'schedule' }) {
  const { api, version } = useApp()
  const { data } = useAsync(
    async () => {
      const [payments, lines, finances, tasks] = await Promise.all([api.listPayments().catch(() => [] as Payment[]), api.listBudgetLines(project.id).catch(() => [] as BudgetLine[]), api.listFinances().catch(() => [] as ProjectFinance[]), api.listTasks().catch(() => [] as Task[])])
      return { payments: payments.filter(p => p.project_id === project.id), lines, finance: finances.find(f => f.project_id === project.id), tasks: tasks.filter(t => t.project_id === project.id) }
    },
    [project.id, version],
    { payments: [] as Payment[], lines: [] as BudgetLine[], finance: undefined as ProjectFinance | undefined, tasks: [] as Task[] },
  )
  // 재무 KPI · 그래프는 모두 뺌 (대표 지시 2026-10-31 "삭제") — 재무 4칸 요약만 재무 칸에
  if (part === 'money') return null
  if (part) return <ProjectHead project={project} payments={data.payments} lines={data.lines} finance={data.finance} tasks={data.tasks} only={part} />
  return (
    <div className="pviz-wrap">
      <ProjectHead project={project} payments={data.payments} lines={data.lines} finance={data.finance} tasks={data.tasks} />
    </div>
  )
}

/** 큰 숫자 + 추이 면 그래프 + 목표 + 차이 배지 */
export function ProjectHead({ project, payments, lines, finance, tasks, only }: { project: Project; payments: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; tasks: Task[]; only?: 'alarm' | 'schedule' }) {
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
  // 재무 세부 숫자도 알람으로 (대표 지시 2026-10-31 "이 내용들은 알람에 포함")
  const liveP = payments.filter(p => p.status !== '취소' && !p.is_estimate)
  const outP = liveP.filter(p => p.direction === '지급')
  const noInvOut = outP.filter(p => p.tax_invoice === '미발행')
  if (noInvOut.length) alarms.push({ key: 'nio', level: 'amber', text: `세금계산서 미수취 지급 ${noInvOut.length}건`, to: pay })
  const nextOut = outP.filter(p => isOpen(p) && p.due_date && p.due_date >= today).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0]
  if (nextOut) alarms.push({ key: 'nx', level: 'ok', text: `다음 지급 ${shortDate(nextOut.due_date)} ${nextOut.payee ?? nextOut.title} ${manwon(nextOut.amount)}`, to: pay })
  const vat = liveP.filter(p => p.direction === '수금').reduce((n, p) => n + p.vat, 0) - outP.reduce((n, p) => n + p.vat, 0)
  if (liveP.length) alarms.push({ key: 'vat', level: 'ok', text: `부가세 (매출 − 매입) ${manwon(vat) || '0'} · 매입 업체 ${new Set(outP.map(p => (p.payee ?? p.title).trim())).size}곳 · ${outP.length}건`, to: pay })

  const doneN = tasks.filter(t => t.status === '완료').length
  // 일정 고치기 (대표 지시 2026-10-31 "프로젝트 일정표는 각 프로젝트에서 업무일지로 수정 가능하게, 별도로도 수정 가능하게")
  //  - [일지로 편집]: 할 일을 업무일지처럼 한 줄씩 바로 고침 (제목 · 시작 · 마감 · 담당 · 상태) · 맨 아래 줄에 새 일정
  //  - 막대 · 이름을 누르면 수정 창 · 프로젝트 기간 줄을 누르면 기간 고치기 · [+ 일정]
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [logMode, setLogMode] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const scheduleCard = (
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
        {/* 한 줄로 일정 넣기 (예: 11/5 목공 마감 @박서연) */}
        <QuickSchedule project={project} />
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
  )
  const alarmCard = (
      <div className="pviz-card">
        <div className="pviz-h">
          <b>입출금 알람</b>
          <span className="t-cap">{alarms.filter(a => a.level !== 'ok').length ? `${alarms.filter(a => a.level !== 'ok').length}건` : ''}</span>
          <Link to={pay} className="t-cap" style={{ marginLeft: 'auto' }}>
            결제 대장 ›
          </Link>
        </div>
        {!alarms.some(a => a.level !== 'ok') && (
          <span className="pviz-alarm ok">
            <CheckCircle2 size={14} /> 연체 · 예산 초과 · 확인할 결제가 없습니다.
          </span>
        )}
        {alarms.length === 0 ? null : (
          <ul className="pviz-alarms">
            {alarms.slice(0, 12).map(a => (
              <li key={a.key}>
                <Link to={a.to} className={`pviz-alarm ${a.level}`}>
                  {a.level === 'red' ? <AlertTriangle size={13} /> : <BellRing size={13} />} {a.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
  )
  if (only === 'schedule') return scheduleCard
  if (only === 'alarm') return alarmCard
  return (
    <div className="pviz-row head">
      {scheduleCard}
      {alarmCard}
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
