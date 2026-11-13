import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, shortDate, timeLabel, todayKey, weekday } from '../lib/date'
import { useAttendance } from '../lib/attendance'
import { Link } from '../lib/router'
import type { AttendanceCheckin, LeaveRecord, WorkPlan } from '../lib/types'
import { Badge, Button } from './ui'

const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}일`
const range = (s: string, e: string) => `${shortDate(s)} (${weekday(s)})${e !== s ? ` ~ ${shortDate(e)} (${weekday(e)})` : ''}`

/** 외근은 지난 31일까지 신청할 수 있으므로 그만큼 거슬러 봄 */
export const PLAN_LOOKBACK = 31

/**
 * 직원 근태 관리를 대표 '내 업무'에 (대표 지시 2026-11-12)
 *  - 관리자에게만: 휴가 신청 · 외근/재택/현장 직출 신청 · 휴대폰 출근 확인을 그 자리에서 승인 · 반려
 *  - 오늘 근태(출근 시각 지난 뒤 미출근 · 지각) 한 줄 → 업무·근태
 */
export function useAttendanceTodo() {
  const { api, me, version } = useApp()
  const admin = me.role === 'admin'
  const today = todayKey()
  const { data } = useAsync(
    async () => {
      if (!admin) return { leaves: [] as LeaveRecord[], plans: [] as WorkPlan[], checkins: [] as AttendanceCheckin[], workStart: '10:00' }
      const [leaves, plans, checkins, rules] = await Promise.all([api.listLeave(), api.listWorkPlans(addDays(today, -PLAN_LOOKBACK)), api.listCheckins(today), api.getAttendanceRules()])
      return { leaves, plans, checkins, workStart: rules.workStart }
    },
    [version, today, admin],
    { leaves: [] as LeaveRecord[], plans: [] as WorkPlan[], checkins: [] as AttendanceCheckin[], workStart: '10:00' },
  )
  const leaves = data.leaves.filter(l => l.status === '신청' && !l.masked).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const plans = data.plans.filter(p => p.status === '대기').sort((a, b) => a.day.localeCompare(b.day))
  const checkins = data.checkins.filter(c => c.status === '대기')
  return { admin, leaves, plans, checkins, approvedLeave: data.leaves, approvedPlans: data.plans, todayCheckins: data.checkins, workStart: data.workStart, count: leaves.length + plans.length + checkins.length }
}

export function AttendanceTodo({ todo }: { todo: ReturnType<typeof useAttendanceTodo> }) {
  const { api, profileName } = useApp()
  const { busy, run } = useAction()
  if (!todo.admin) return null
  return (
    <>
      {todo.leaves.map(l => (
        <div key={l.id} className="today-row att-todo">
          <Badge tone="blue">휴가</Badge>
          <span className="today-title">
            {profileName(l.profile_id)} · {l.kind} {range(l.start_date, l.end_date)} · {days(Number(l.days))}
            {l.reason ? <span className="att-sub"> · {l.reason}</span> : null}
          </span>
          <span className="att-todo-btns">
            <Button size="sm" disabled={busy} onClick={() => run(() => api.decideLeave(l.id, '승인'), '휴가를 승인했습니다.')}>
              승인
            </Button>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.decideLeave(l.id, '반려'), '반려했습니다.')}>
              반려
            </Button>
          </span>
        </div>
      ))}
      {todo.plans.map(p => (
        <div key={p.id} className={`today-row att-todo${p.day < todayKey() ? ' late' : ''}`}>
          <Badge tone="yellow">{p.kind}</Badge>
          <span className="today-title">
            {profileName(p.user_id)} · {range(p.day, p.day)}
            {p.place ? ` · ${p.place}` : ''}
            {p.reason ? <span className="att-sub"> · {p.reason}</span> : null}
            {p.task_id ? <span className="att-sub"> · 현장 일정 자동</span> : null}
            {p.late ? <span className="att-sub t-red"> · 늦은 신청</span> : null}
          </span>
          <span className="att-todo-btns">
            <Button size="sm" disabled={busy} onClick={() => run(() => api.decideWorkPlan(p.id, '승인'), '승인했습니다.')}>
              승인
            </Button>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.decideWorkPlan(p.id, '반려'), '반려했습니다.')}>
              반려
            </Button>
          </span>
        </div>
      ))}
      {todo.checkins.map(c => (
        <div key={c.id} className="today-row att-todo">
          <Badge tone="yellow">휴대폰 출근</Badge>
          <span className="today-title">
            {profileName(c.user_id)} · {timeLabel(c.at)} {c.kind}
            <span className="att-sub"> · 사전 신청 없음{c.note ? ` · ${c.note}` : ''}</span>
          </span>
          <span className="att-todo-btns">
            <Button size="sm" disabled={busy} onClick={() => run(() => api.decideCheckin(c.id, '승인'), '출근으로 인정했습니다.')}>
              인정
            </Button>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.decideCheckin(c.id, '반려'), '반려했습니다.')}>
              반려
            </Button>
          </span>
        </div>
      ))}
      <AttendanceTodayLine todo={todo} />
    </>
  )
}

/** 오늘 근태 한 줄: 출근 시각이 지나면 미출근 · 지각한 사람 이름 (휴가 · 승인된 외근은 빼고) */
function AttendanceTodayLine({ todo }: { todo: ReturnType<typeof useAttendanceTodo> }) {
  const { profiles, profileName } = useApp()
  const today = todayKey()
  const rows = useAttendance(today)
  const nowHm = new Date(Date.now() + 9 * 3600_000).toISOString().slice(11, 16)
  const hm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16)
  const people = profiles.filter(p => p.active && !p.is_agent)
  const off = new Set(todo.approvedLeave.filter(l => l.status === '승인' && l.start_date <= today && today <= l.end_date).map(l => l.profile_id))
  const away = new Set(todo.approvedPlans.filter(p => p.status === '승인' && p.day === today).map(p => p.user_id))
  const okCheckin = new Set(todo.todayCheckins.filter(c => c.status === '승인').map(c => c.user_id))
  const started = nowHm > todo.workStart
  const absent = started ? people.filter(p => !rows.has(p.id) && !off.has(p.id) && !away.has(p.id)) : []
  const late = people.filter(p => {
    const a = rows.get(p.id)
    return a && hm(a.first_at) > todo.workStart && !okCheckin.has(p.id) && !away.has(p.id)
  })
  const names = (list: { id: string }[]) => list.slice(0, 4).map(p => profileName(p.id)).join(' · ') + (list.length > 4 ? ` 외 ${list.length - 4}명` : '')
  return (
    <div className="today-row att-todo">
      <Badge tone={absent.length + late.length ? 'red' : 'outline'}>근태</Badge>
      <span className="today-title">
        오늘 출근 {people.length - people.filter(p => !rows.has(p.id)).length}/{people.length}
        {off.size ? <span className="att-sub"> · 휴가 {off.size}</span> : null}
        {away.size ? <span className="att-sub"> · 외근 · 재택 {away.size}</span> : null}
        {absent.length ? <span className="att-sub t-red"> · 미출근 {names(absent)}</span> : null}
        {late.length ? <span className="att-sub t-red"> · 지각 {names(late)}</span> : null}
        {!started ? <span className="att-sub"> · 출근 시각 {todo.workStart} 전</span> : null}
      </span>
      <Link to="/team" className="today-proj">
        근태 관리 ›
      </Link>
    </div>
  )
}
