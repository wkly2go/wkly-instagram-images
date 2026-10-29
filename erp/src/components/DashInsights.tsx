import { AlertTriangle, CalendarClock, CircleCheck, Coins, Gauge, Hourglass, PieChart, Users, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../lib/app'
import { addDays, manwon, shortDate } from '../lib/date'
import { isOpen, projectMoney, supply } from '../lib/finance'
import { Link } from '../lib/router'
import type { Client, Payment, Project, Task } from '../lib/types'

/**
 * 대시보드 인사이트 (대표 지시 2026-10-29 "대시보드의 인사이트를 더 고도화")
 *  숫자를 나열하는 대신 '지금 무엇을 봐야 하는지'를 규칙으로 뽑아 위험한 것부터 보여 줌
 *  - 4주 현금 흐름 전망 · 미수 연령 · 마진 미달 · 일정 지연 위험 · 업무 쏠림 · 거래처 집중도 · 영업 파이프라인
 *  금액은 모두 공급가액, 계산 근거를 한 줄로 함께 적음
 */
type Tone = 'bad' | 'warn' | 'good' | 'info'
interface Insight {
  key: string
  tone: Tone
  icon: LucideIcon
  title: string
  value: string
  detail: string
  to?: string
}
const RANK: Record<Tone, number> = { bad: 0, warn: 1, info: 2, good: 3 }
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)
const dateOf = (p: Payment) => p.due_date ?? p.requested_date

export function DashInsights({
  projects,
  tasks,
  clients,
  fin,
  money,
  today,
}: {
  projects: Project[]
  tasks: Task[]
  clients: Client[]
  fin: { payments: Payment[] }
  money: Map<string, ReturnType<typeof projectMoney>>
  today: string
}) {
  const { profiles, profileName } = useApp()
  const cName = (p: Payment) => clients.find(c => c.id === p.client_id)?.name ?? p.payee ?? '거래처 미상'
  const open = fin.payments.filter(isOpen)
  const openIn = open.filter(p => p.direction === '수금')
  const openOut = open.filter(p => p.direction === '지급')

  // 1) 4주 현금 흐름 전망 (지난 미수 · 미지급은 '밀린 것'으로 따로)
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const from = addDays(today, i * 7)
    const to = addDays(today, i * 7 + 6)
    const within = (p: Payment) => {
      const d = dateOf(p)
      return !!d && d >= from && d <= to
    }
    const inn = openIn.filter(within).reduce((n, p) => n + supply(p), 0)
    const out = openOut.filter(within).reduce((n, p) => n + supply(p), 0)
    return { from, to, inn, out, net: inn - out }
  })
  const lateIn = openIn.filter(p => (dateOf(p) ?? '9') < today)
  const lateOut = openOut.filter(p => (dateOf(p) ?? '9') < today)
  const lateInSum = lateIn.reduce((n, p) => n + supply(p), 0)
  const lateOutSum = lateOut.reduce((n, p) => n + supply(p), 0)
  const net4 = weeks.reduce((n, w) => n + w.net, 0)
  const worst = weeks.reduce((a, w) => (w.net < a.net ? w : a), weeks[0])

  const out: Insight[] = []
  out.push({
    key: 'cash',
    tone: net4 < 0 || worst.net < 0 ? 'warn' : 'good',
    icon: Wallet,
    title: '4주 현금 흐름',
    value: `${net4 >= 0 ? '+' : ''}${manwon(net4)}`,
    detail:
      worst.net < 0
        ? `${shortDate(worst.from)} 주 지급이 입금보다 ${manwon(-worst.net)} 많음 · 수금 일정 당기기 검토`
        : `앞으로 4주 입금 ${manwon(weeks.reduce((n, w) => n + w.inn, 0))} · 지급 ${manwon(weeks.reduce((n, w) => n + w.out, 0))}`,
    to: '/payments?sub=run',
  })

  // 2) 미수 연령
  if (lateIn.length) {
    const aged = (min: number, max: number) => lateIn.filter(p => { const d = days(dateOf(p)!, today); return d >= min && d <= max }).reduce((n, p) => n + supply(p), 0)
    const a30 = aged(1, 30)
    const a60 = aged(31, 60)
    const a61 = aged(61, 99999)
    const byClient = new Map<string, number>()
    for (const p of lateIn) byClient.set(cName(p), (byClient.get(cName(p)) ?? 0) + supply(p))
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0]
    out.push({
      key: 'aging',
      tone: a61 > 0 ? 'bad' : 'warn',
      icon: Hourglass,
      title: '밀린 미수금',
      value: manwon(lateInSum),
      detail: `30일 이내 ${manwon(a30)} · 31~60일 ${manwon(a60)} · 60일 넘음 ${manwon(a61)} · 가장 큰 곳 ${top[0]} ${manwon(top[1])}`,
      to: '/payments?sub=check',
    })
  }
  if (lateOut.length)
    out.push({
      key: 'lateout',
      tone: 'warn',
      icon: AlertTriangle,
      title: '지급일 지난 미지급',
      value: `${lateOut.length}건 · ${manwon(lateOutSum)}`,
      detail: `가장 오래된 건 ${days(lateOut.map(p => dateOf(p)!).sort()[0], today)}일 지남 · 거래처 신뢰와 직결`,
      to: '/payments?sub=run',
    })

  // 3) 마진 미달
  const below = projects
    .filter(p => p.status !== '보류')
    .map(p => ({ p, m: money.get(p.id) }))
    .filter(x => x.m?.marginRate != null && ((x.m.target != null && x.m.marginRate < x.m.target) || x.m.marginRate < 0))
    .sort((a, b) => a.m!.marginRate! - (a.m!.target ?? 0) - (b.m!.marginRate! - (b.m!.target ?? 0)))
  if (below.length) {
    const w = below[0]
    out.push({
      key: 'margin',
      tone: below.some(x => x.m!.marginRate! < 0) ? 'bad' : 'warn',
      icon: Gauge,
      title: '목표 마진 미달',
      value: `${below.length}개 프로젝트`,
      detail: `가장 큰 차이: ${w.p.name} ${w.m!.marginRate!.toFixed(1)}%${w.m!.target != null ? ` (목표 ${w.m!.target}%)` : ''} · 남은 비용 · 추가 정산 확인`,
      to: `/projects?id=${w.p.id}`,
    })
  }

  // 4) 일정 지연 위험: 기간이 지난 만큼 업무가 끝나지 않은 진행 프로젝트
  const risky = projects
    .filter(p => p.status === '진행' && p.start_date && p.end_date && p.end_date > p.start_date)
    .map(p => {
      const ts = tasks.filter(t => t.project_id === p.id)
      const elapsed = Math.min(1, Math.max(0, days(p.start_date!, today) / days(p.start_date!, p.end_date!)))
      const done = ts.length ? ts.filter(t => t.status === '완료').length / ts.length : null
      return { p, elapsed, done, late: ts.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length }
    })
    .filter(x => (x.done != null && x.done < x.elapsed - 0.15) || x.late > 0)
    .sort((a, b) => b.late - a.late || (b.elapsed - (b.done ?? 0)) - (a.elapsed - (a.done ?? 0)))
  if (risky.length) {
    const r = risky[0]
    out.push({
      key: 'schedule',
      tone: risky.some(x => x.elapsed >= 0.8) ? 'bad' : 'warn',
      icon: CalendarClock,
      title: '일정 지연 위험',
      value: `${risky.length}개 프로젝트`,
      detail: `${r.p.name}: 기간 ${Math.round(r.elapsed * 100)}% 지남 · 업무 ${r.done == null ? '등록 없음' : `${Math.round(r.done * 100)}% 완료`}${r.late ? ` · 마감 지난 일 ${r.late}건` : ''}`,
      to: `/projects?id=${r.p.id}`,
    })
  }

  // 5) 업무 쏠림
  const people = profiles.filter(p => p.active && !p.is_agent)
  const load = people
    .map(p => ({ p, open: tasks.filter(t => t.assignee_id === p.id && t.status !== '완료').length, late: tasks.filter(t => t.assignee_id === p.id && t.status !== '완료' && t.due_date && t.due_date < today).length }))
    .filter(x => x.open > 0)
    .sort((a, b) => b.open - a.open)
  if (load.length >= 2) {
    const avg = load.reduce((n, x) => n + x.open, 0) / people.length
    const top = load[0]
    if (top.open >= avg * 1.6 && top.open >= 5)
      out.push({
        key: 'load',
        tone: top.late >= 3 ? 'bad' : 'warn',
        icon: Users,
        title: '업무 쏠림',
        value: `${profileName(top.p.id)} ${top.open}건`,
        detail: `팀 평균 ${avg.toFixed(1)}건의 ${(top.open / avg).toFixed(1)}배${top.late ? ` · 그중 지연 ${top.late}건` : ''} · 나눠 맡기기 검토`,
        to: `/work?user=${top.p.id}`,
      })
  }

  // 6) 거래처 집중도 (올해 시작 프로젝트 계약액 기준)
  const year = today.slice(0, 4)
  const byClient = new Map<string, number>()
  for (const p of projects) {
    const c = money.get(p.id)?.contract
    if (!c || !(p.start_date ?? '').startsWith(year)) continue
    const k = clients.find(x => x.id === p.client_id)?.name ?? '거래처 미지정'
    byClient.set(k, (byClient.get(k) ?? 0) + c)
  }
  const total = [...byClient.values()].reduce((n, v) => n + v, 0)
  if (total > 0 && byClient.size) {
    const [name, v] = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0]
    const share = (v / total) * 100
    out.push({
      key: 'concentration',
      tone: share >= 50 && byClient.size > 1 ? 'warn' : 'info',
      icon: PieChart,
      title: '거래처 집중도',
      value: `${share.toFixed(0)}%`,
      detail: `올해 계약 ${manwon(total)} 중 ${name} ${manwon(v)}${byClient.size > 1 ? ` · 거래처 ${byClient.size}곳` : ' · 한 곳에만 의존'}`,
      to: '/clients',
    })
  }

  // 7) 영업 파이프라인
  const plan = projects.filter(p => p.status === '기획')
  if (plan.length) {
    const planSum = plan.reduce((n, p) => n + (money.get(p.id)?.contract ?? 0), 0)
    out.push({
      key: 'pipeline',
      tone: 'info',
      icon: Coins,
      title: '기획 단계 파이프라인',
      value: `${plan.length}건${planSum ? ` · ${manwon(planSum)}` : ''}`,
      detail: `계약 전 프로젝트 · 오래된 순: ${plan.slice(0, 3).map(p => p.name).join(', ')}`,
      to: '/projects?view=list',
    })
  }

  out.sort((a, b) => RANK[a.tone] - RANK[b.tone])
  const bad = out.filter(i => i.tone === 'bad').length
  const warn = out.filter(i => i.tone === 'warn').length
  const peak = Math.max(1, ...weeks.map(w => Math.max(w.inn, w.out)))

  return (
    <section className="section" aria-label="인사이트">
      <div className="section-h">
        <span className="t-bodyb">인사이트</span>
        <span className="cap">{bad || warn ? `바로 볼 것 ${bad} · 살펴볼 것 ${warn}` : '큰 위험 없음'} · 공급가액 기준</span>
      </div>
      <div className="ins-grid">
        {out.map(i => (
          <Link key={i.key} to={i.to ?? '#'} className={`ins-card ${i.tone}`}>
            <span className="ins-icon">
              <i.icon size={15} aria-hidden="true" />
            </span>
            <span className="ins-body">
              <span className="ins-title">
                {i.title}
                <b>{i.value}</b>
              </span>
              <span className="ins-detail">{i.detail}</span>
            </span>
          </Link>
        ))}
        {!out.length && (
          <span className="ins-card good">
            <span className="ins-icon">
              <CircleCheck size={15} />
            </span>
            <span className="ins-body">
              <span className="ins-title">특이 사항 없음</span>
            </span>
          </span>
        )}
      </div>
      <div className="ins-cash" aria-label="앞으로 4주 입금 · 지급">
        <span className="ins-cash-h">
          앞으로 4주 입금 · 지급
          {(lateInSum > 0 || lateOutSum > 0) && <span className="cap"> · 밀린 미수 {manwon(lateInSum)} / 미지급 {manwon(lateOutSum)} 별도</span>}
        </span>
        {weeks.map(w => (
          <div key={w.from} className="ins-week">
            <span className="ins-wk">{shortDate(w.from)}~</span>
            <span className="ins-bars">
              <i className="in" style={{ width: `${(w.inn / peak) * 100}%` }} title={`입금 ${manwon(w.inn)}`} />
              <i className="out" style={{ width: `${(w.out / peak) * 100}%` }} title={`지급 ${manwon(w.out)}`} />
            </span>
            <span className={`ins-net${w.net < 0 ? ' neg' : ''}`}>
              {w.net >= 0 ? '+' : ''}
              {manwon(w.net)}
            </span>
          </div>
        ))}
        <span className="ins-legend">
          <i className="in" /> 입금 예정 <i className="out" /> 지급 예정 · 오른쪽 숫자 = 차액
        </span>
      </div>
    </section>
  )
}
