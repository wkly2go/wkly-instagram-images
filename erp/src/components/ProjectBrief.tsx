// 현장 브리핑 (대표 지시 2026-10-31 "한두 번의 입력으로 다량의 분석 자료와 해석을 할 수 있는 보고서 형태, 스케줄 관리가 잘 되는 형태")
//   - 따로 적을 것 없음: 이미 기입한 할 일 · 협력업체 결제 · 현장 작업일지 · 계약을 읽어 규칙으로 분석하고 문장으로 해석
//   - 맨 위 한 줄 = 지금 가장 먼저 볼 것, 아래 칩 = 일정 · 할 일 · 돈 · 협력업체 · 현장 판정
//   - [보고서] 를 누르면 같은 자리에서 전체 보고서(인쇄 가능)로 펼침
//   - 일정 빠른 입력: "11/5 목공 마감 @박서연" · "11/5~11/8 설치" · "내일 실측" 처럼 한 줄 → 할 일 · 일정이 바로 생김
import { useMemo, useState } from 'react'
import { CalendarPlus, FileText, Printer } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, manwon, shortDate, todayKey, weekday } from '../lib/date'
import { isDone, isOpen, projectMoney, supply } from '../lib/finance'
import type { BudgetLine, MaterialMove, Payment, Project, ProjectFinance, SiteLog, Task } from '../lib/types'
import { Button } from './ui'

type Level = 'red' | 'amber' | 'green'
interface Finding {
  area: '일정' | '할 일' | '돈' | '협력업체' | '현장'
  level: Level
  title: string
  detail: string
}
const dd = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const pct = (n: number) => `${Math.round(n)}%`

export function ProjectBrief({ project }: { project: Project }) {
  const { api, version, profileName } = useApp()
  const today = todayKey()
  const [open, setOpen] = useState(false)
  const { data } = useAsync(
    async () => {
      const [payments, lines, finances, tasks, logs, moves] = await Promise.all([
        api.listPayments().catch(() => [] as Payment[]),
        api.listBudgetLines(project.id).catch(() => [] as BudgetLine[]),
        api.listFinances().catch(() => [] as ProjectFinance[]),
        api.listTasks().catch(() => [] as Task[]),
        api.listSiteLogs(project.id).catch(() => [] as SiteLog[]),
        api.listMaterialMoves(project.id).catch(() => [] as MaterialMove[]),
      ])
      return { payments: payments.filter(p => p.project_id === project.id), lines, finance: finances.find(f => f.project_id === project.id), tasks: tasks.filter(t => t.project_id === project.id), logs, moves }
    },
    [project.id, version],
    { payments: [] as Payment[], lines: [] as BudgetLine[], finance: undefined as ProjectFinance | undefined, tasks: [] as Task[], logs: [] as SiteLog[], moves: [] as MaterialMove[] },
  )

  const r = useMemo(() => {
    const { payments, lines, finance, tasks, logs, moves } = data
    const m = projectMoney(finance, payments, lines, today)
    const start = project.start_date
    const end = project.end_date ?? project.start_date
    const elapsed = start && end && end > start ? Math.max(0, Math.min(100, (dd(start, today) / Math.max(1, dd(start, end))) * 100)) : null
    const open = tasks.filter(t => t.status !== '완료')
    const done = tasks.length - open.length
    const doneRate = tasks.length ? (done / tasks.length) * 100 : null
    const late = open.filter(t => t.due_date && t.due_date < today)
    const week = open.filter(t => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7))
    const noDate = open.filter(t => !t.due_date)
    const noOwner = open.filter(t => !t.assignee_id)
    const live = payments.filter(p => p.status !== '취소' && !p.is_estimate)
    const out = live.filter(p => p.direction === '지급')
    const lateOut = out.filter(p => isOpen(p) && p.due_date && p.due_date < today)
    const lateIn = live.filter(p => p.direction === '수금' && isOpen(p) && p.due_date && p.due_date < today)
    const payWeek = out.filter(p => isOpen(p) && p.due_date && p.due_date >= today && p.due_date <= addDays(today, 7))
    const vendors = new Set(out.map(p => (p.payee ?? p.title).trim()))
    const noAcc = new Set(out.filter(p => isOpen(p) && !p.account_no && p.contract_type !== '카드').map(p => p.payee ?? p.title))
    const contractSum = lines.reduce((n, l) => n + (l.contract_amount ?? 0), 0)
    const paidOut = out.filter(isDone).reduce((n, p) => n + supply(p), 0)
    const crew = logs.reduce((n, l) => n + l.labor.reduce((a, x) => a + (x.day || 0) + (x.night || 0), 0), 0)
    const matIn = moves.filter(x => x.status !== '취소' && x.kind !== '출고').reduce((n, x) => n + (x.kind === '반품' ? -1 : 1) * x.qty * x.unit_price, 0)
    const lastLog = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date))[0]
    const inSite = start && end && today >= start && today <= end

    const f: Finding[] = []
    // 일정
    if (!start || !end) f.push({ area: '일정', level: 'amber', title: '기간 미정', detail: '시작 · 종료일을 넣으면 진행률과 지연을 계산합니다.' })
    else if (today < start) f.push({ area: '일정', level: 'green', title: `시작 D-${dd(today, start)}`, detail: `${shortDate(start)} 시작 · ${shortDate(end)} 종료 (${dd(start, end) + 1}일)` })
    else if (today > end) f.push({ area: '일정', level: open.length ? 'red' : 'green', title: `종료 후 ${dd(end, today)}일`, detail: open.length ? `끝나지 않은 할 일 ${open.length}건이 남아 있습니다.` : '모든 할 일이 끝났습니다.' })
    else if (elapsed != null && doneRate != null && doneRate + 15 < elapsed) f.push({ area: '일정', level: 'red', title: `기간 ${pct(elapsed)} 지남 · 할 일 ${pct(doneRate)} 완료`, detail: `진행보다 ${Math.round(elapsed - doneRate)}%p 늦습니다. 종료까지 ${dd(today, end)}일.` })
    else f.push({ area: '일정', level: 'green', title: `진행 중 · 종료 D-${dd(today, end)}`, detail: elapsed != null ? `기간 ${pct(elapsed)} 지남${doneRate != null ? ` · 할 일 ${pct(doneRate)} 완료` : ''}` : '' })
    // 할 일
    if (late.length) f.push({ area: '할 일', level: 'red', title: `마감 지난 할 일 ${late.length}건`, detail: late.slice(0, 3).map(t => `${t.title}(${shortDate(t.due_date!)} · ${profileName(t.assignee_id) || '담당 없음'})`).join(', ') })
    if (week.length) f.push({ area: '할 일', level: 'amber', title: `7일 안 마감 ${week.length}건`, detail: week.slice(0, 3).map(t => `${shortDate(t.due_date!)} ${t.title}`).join(', ') })
    if (noDate.length || noOwner.length) f.push({ area: '할 일', level: 'amber', title: [noDate.length && `날짜 없는 할 일 ${noDate.length}`, noOwner.length && `담당 없는 할 일 ${noOwner.length}`].filter(Boolean).join(' · '), detail: '날짜 · 담당을 정해야 일정표와 알람에 잡힙니다.' })
    if (!late.length && !week.length && tasks.length && !open.length) f.push({ area: '할 일', level: 'green', title: '할 일 모두 완료', detail: `${tasks.length}건 완료` })
    // 돈
    if (m.contract == null) f.push({ area: '돈', level: 'amber', title: '계약 금액 없음', detail: '협력업체 관리 위 계약 칸에 넣으면 수금률 · 마진을 계산합니다.' })
    else {
      if (lateIn.length) f.push({ area: '돈', level: 'red', title: `수금 연체 ${lateIn.length}건 · ${manwon(lateIn.reduce((n, p) => n + p.amount, 0))}`, detail: '발주처에 입금 일정을 확인하세요.' })
      if (m.marginRate != null && m.target != null && m.marginRate < m.target) f.push({ area: '돈', level: 'red', title: `예상 마진 ${m.marginRate.toFixed(1)}% · 목표보다 ${(m.target - m.marginRate).toFixed(1)}%p 낮음`, detail: `비용 ${manwon(m.cost)} / 계약 ${manwon(m.contract)}. 남은 지급 ${manwon(m.payable) || '0'}을 줄일 곳을 보세요.` })
      else if (m.marginRate != null) f.push({ area: '돈', level: 'green', title: `예상 마진 ${m.marginRate.toFixed(1)}%${m.target != null ? ` (목표 ${m.target}%)` : ''}`, detail: `계약 ${manwon(m.contract)} · 비용 ${manwon(m.cost) || '0'}` })
      if (m.collectRate != null) f.push({ area: '돈', level: inSite && m.collectRate < 30 ? 'amber' : 'green', title: `수금 ${pct(m.collectRate)}`, detail: `받은 돈 ${manwon(m.received) || '0'} · 남은 ${manwon(Math.max(0, m.contract - m.received)) || '0'}${inSite && m.collectRate < 30 ? ' — 현장 진행 중인데 수금이 낮습니다.' : ''}` })
    }
    // 협력업체
    if (lateOut.length) f.push({ area: '협력업체', level: 'red', title: `지급 연체 ${lateOut.length}건 · ${manwon(lateOut.reduce((n, p) => n + p.amount, 0))}`, detail: [...new Set(lateOut.map(p => p.payee ?? p.title))].slice(0, 3).join(', ') })
    if (payWeek.length) f.push({ area: '협력업체', level: 'amber', title: `7일 안 지급 ${payWeek.length}건 · ${manwon(payWeek.reduce((n, p) => n + p.amount, 0))}`, detail: payWeek.slice(0, 3).map(p => `${shortDate(p.due_date!)} ${p.payee ?? p.title}`).join(', ') })
    if (noAcc.size) f.push({ area: '협력업체', level: 'amber', title: `계좌 없는 업체 ${noAcc.size}곳`, detail: [...noAcc].slice(0, 3).join(', ') })
    if (vendors.size && !lateOut.length) f.push({ area: '협력업체', level: 'green', title: `업체 ${vendors.size}곳${contractSum ? ` · 계약 대비 ${pct((paidOut / contractSum) * 100)} 지급` : ''}`, detail: `지급 완료 ${manwon(paidOut) || '0'} (공급가)` })
    // 현장
    if (inSite && (!lastLog || dd(lastLog.log_date, today) >= 2)) f.push({ area: '현장', level: 'amber', title: lastLog ? `작업일지 ${dd(lastLog.log_date, today)}일째 없음` : '작업일지 없음', detail: '현장 작업일지에 오늘 작업 · 인원을 한 건씩 기록하세요.' })
    if (logs.length) f.push({ area: '현장', level: 'green', title: `작업일지 ${logs.length}일 · 연인원 ${crew}명`, detail: `자재 ${manwon(matIn) || '0'} (공급가)${lastLog ? ` · 마지막 ${shortDate(lastLog.log_date)}` : ''}` })

    const order: Record<Level, number> = { red: 0, amber: 1, green: 2 }
    f.sort((a, b) => order[a.level] - order[b.level])
    const reds = f.filter(x => x.level === 'red')
    const headline = reds.length ? `${reds[0].area}: ${reds[0].title} — 이것부터 처리하세요.` : f.some(x => x.level === 'amber') ? `큰 문제는 없습니다. 확인할 것 ${f.filter(x => x.level === 'amber').length}가지가 있습니다.` : '모든 항목이 정상입니다.'
    return { f, headline, m, open, late, week, elapsed, doneRate, logs, crew, matIn, vendors, paidOut, contractSum, payWeek }
  }, [data, project, today, profileName])

  const areas: Finding['area'][] = ['일정', '할 일', '돈', '협력업체', '현장']
  const worst = (a: Finding['area']) => r.f.filter(x => x.area === a).sort((x, y) => (x.level === 'red' ? 0 : x.level === 'amber' ? 1 : 2) - (y.level === 'red' ? 0 : y.level === 'amber' ? 1 : 2))[0]

  return (
    <section className={`brief ${r.f.some(x => x.level === 'red') ? 'has-red' : ''}`} aria-label="현장 브리핑">
      <div className="brief-top">
        <p className="brief-head">{r.headline}</p>
        <Button kind={open ? 'blue' : 'outline'} size="sm" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          <FileText size={12} /> {open ? '보고서 접기' : '보고서'}
        </Button>
      </div>
      <div className="brief-chips">
        {areas.map(a => {
          const w = worst(a)
          if (!w) return null
          return (
            <span key={a} className={`brief-chip ${w.level}`} title={w.detail}>
              <b>{a}</b> {w.title}
            </span>
          )
        })}
      </div>
      {open && (
        <div className="brief-report">
          <div className="brief-report-bar no-print">
            <span className="t-cap">
              {today} ({weekday(today)}) 기준 · 할 일 · 협력업체 관리 · 작업일지에서 자동 작성
            </span>
            <Button kind="ghost" size="sm" onClick={() => window.print()}>
              <Printer size={12} /> 인쇄
            </Button>
          </div>
          <h3 className="brief-title">
            {[project.code, project.name].filter(Boolean).join(' ')} 현장 보고
          </h3>
          {areas.map(a => {
            const items = r.f.filter(x => x.area === a)
            if (!items.length) return null
            return (
              <div key={a} className="brief-sec">
                <h4>{a}</h4>
                <ul>
                  {items.map((x, i) => (
                    <li key={i} className={x.level}>
                      <b>{x.title}</b>
                      {x.detail && <span> {x.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <div className="brief-sec">
            <h4>숫자 요약</h4>
            <table className="brief-nums">
              <tbody>
                <tr>
                  <th>계약</th>
                  <td>{r.m.contract != null ? manwon(r.m.contract) : '–'}</td>
                  <th>수금</th>
                  <td>{manwon(r.m.received) || '0'}</td>
                  <th>지급</th>
                  <td>{manwon(r.m.paid) || '0'}</td>
                  <th>예상 마진</th>
                  <td>{r.m.marginRate != null ? `${r.m.marginRate.toFixed(1)}%` : '–'}</td>
                </tr>
                <tr>
                  <th>할 일</th>
                  <td>{r.open.length}건 남음</td>
                  <th>지연</th>
                  <td>{r.late.length}건</td>
                  <th>작업일지</th>
                  <td>{r.logs.length}일</td>
                  <th>연인원</th>
                  <td>{r.crew}명</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

/** 일정 빠른 입력: 한 줄 → 할 일 · 일정
 *  "11/5 목공 마감 @박서연" · "11.5~11.8 설치" · "내일 실측" · "모레 자재 반입" · "다음주 월 미팅" */
export function QuickSchedule({ project }: { project: Project }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [v, setV] = useState('')
  const parse = (raw: string) => {
    let t = ` ${raw.trim()} `
    const today = todayKey()
    const y = today.slice(0, 4)
    const ymd = (m: string, d: string) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    let start: string | null = null
    let due: string | null = null
    const range = /\s(\d{1,2})[./](\d{1,2})\s*[~\-–]\s*(?:(\d{1,2})[./])?(\d{1,2})\s/.exec(t)
    const one = /\s(\d{1,2})[./](\d{1,2})\s/.exec(t)
    if (range) {
      start = ymd(range[1], range[2])
      due = ymd(range[3] ?? range[1], range[4])
      t = t.replace(range[0], ' ')
    } else if (one) {
      due = ymd(one[1], one[2])
      t = t.replace(one[0], ' ')
    } else if (/\s오늘\s/.test(t)) (due = today), (t = t.replace(/\s오늘\s/, ' '))
    else if (/\s내일\s/.test(t)) (due = addDays(today, 1)), (t = t.replace(/\s내일\s/, ' '))
    else if (/\s모레\s/.test(t)) (due = addDays(today, 2)), (t = t.replace(/\s모레\s/, ' '))
    else {
      const nw = /\s다음\s?주\s?([월화수목금토일])(요일)?\s/.exec(t)
      if (nw) {
        const target = '일월화수목금토'.indexOf(nw[1])
        const cur = new Date(`${today}T00:00:00`).getDay()
        due = addDays(today, 7 - cur + target)
        t = t.replace(nw[0], ' ')
      }
    }
    let assignee: string | null = null
    const at = /@(\S+)/.exec(t)
    if (at) {
      const who = profiles.find(p => p.name === at[1] || p.name.includes(at[1]))
      assignee = who?.id ?? null
      t = t.replace(at[0], ' ')
    }
    return { title: t.replace(/\s+/g, ' ').trim(), start, due, assignee }
  }
  const p = parse(v)
  const save = async () => {
    if (!p.title) return
    const ok = await run(
      () => api.saveTask({ project_id: project.id, title: p.title, start_date: p.start, due_date: p.due, assignee_id: p.assignee ?? me.id, status: '할 일', memo: null, remind_at: null }),
      `일정을 넣었습니다: ${p.due ? shortDate(p.due) : '날짜 없음'} ${p.title}`,
    )
    if (ok) setV('')
  }
  return (
    <div className="quick-sched">
      <CalendarPlus size={14} aria-hidden />
      <input
        className="input"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.preventDefault(), void save())}
        placeholder="한 줄로 일정 넣기 — 예) 11/5 목공 마감 @박서연 · 11/5~11/8 설치 · 내일 실측"
        aria-label="일정 빠른 입력"
      />
      {v.trim() && (
        <span className="t-cap qs-preview">
          {p.start ? `${shortDate(p.start)}~` : ''}
          {p.due ? shortDate(p.due) : '날짜 없음'} · {p.title || '제목'}
          {p.assignee ? ` · ${profiles.find(x => x.id === p.assignee)?.name}` : ''}
        </span>
      )}
      <Button size="sm" disabled={busy || !p.title} onClick={() => void save()}>
        넣기
      </Button>
    </div>
  )
}
