import { useState } from 'react'
import { MapPin, Smartphone } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, shortDate, timeLabel, todayKey, weekday } from '../lib/date'
import { useAttendance } from '../lib/attendance'
import { isDesktopApp } from '../lib/desktop'
import { WORK_PLAN_KINDS, type AccessInfo, type AttendanceCheckin, type AttendanceDevice, type AttendanceMonthRow, type DecideStatus, type WorkPlan, type WorkPlanKind } from '../lib/types'
import { Badge, Button, Chip, Empty, Field, SectionHead } from './ui'
import { ask } from './Ask'

const S_TONE: Record<DecideStatus, 'acid' | 'yellow' | 'red'> = { 승인: 'acid', 대기: 'yellow', 반려: 'red' }

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 })
  })
}

/** 오늘 내 휴대폰 출근 기록 + 오늘 승인된 사전 신청 */
function useMyToday() {
  const { api, me, version } = useApp()
  const today = todayKey()
  return useAsync(
    async () => {
      const [checkins, plans] = await Promise.all([api.listCheckins(today), api.listWorkPlans(today)])
      return { checkin: checkins.find(c => c.user_id === me.id) ?? null, plan: plans.find(p => p.user_id === me.id && p.day === today) ?? null }
    },
    [version, today],
    { checkin: null as AttendanceCheckin | null, plan: null as WorkPlan | null },
  )
}

/** 출근 기록이 없을 때: 사무실은 회사 인터넷 + 회사 PC 에서 자동 출근 / 외근 · 재택은 승인된 날만 노트북 · 휴대폰 체크 (없으면 긴급 신청) */
export function CheckInCard({ always = false }: { always?: boolean }) {
  const { api, me, version } = useApp()
  const attendance = useAttendance()
  const { data, reload } = useMyToday()
  const { data: access } = useAsync(() => api.getAccessInfo(), [version], null as AccessInfo | null)
  const { busy, run } = useAction()
  const [note, setNote] = useState('')
  const [withLoc, setWithLoc] = useState(true)
  const [locating, setLocating] = useState(false)
  const [req, setReq] = useState({ kind: '외근' as WorkPlanKind, place: '', reason: '' })
  if (me.is_agent) return null
  const checkedIn = attendance.has(me.id)
  if (data.checkin) {
    return (
      <div className="checkin-card done">
        <span className="grow t-small">
          오늘 외부 출근 {timeLabel(data.checkin.at)} · {data.checkin.kind}
        </span>
        <Badge tone={S_TONE[data.checkin.status]}>{data.checkin.status === '대기' ? '대표 확인 대기' : data.checkin.status}</Badge>
      </div>
    )
  }
  if (checkedIn && !always) return null
  const plan = data.plan
  const approved = plan?.status === '승인'
  const outside = access?.configured && !access.office
  const submit = async () => {
    setLocating(withLoc)
    const pos = withLoc ? await getPosition() : null
    setLocating(false)
    const ok = await run(() => api.mobileCheckIn({ kind: plan!.kind, note: note.trim() || null, lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null, accuracy: pos?.coords.accuracy ?? null }))
    if (ok) {
      setNote('')
      reload()
      window.alert(`출근 체크 완료 — 오늘 ${plan!.kind} 출근으로 인정됩니다.`)
    }
  }
  const requestToday = async () => {
    if (!req.reason.trim()) return window.alert('사유를 적어 주세요.')
    if (await run(() => api.requestWorkPlan({ day: todayKey(), kind: req.kind, place: req.place.trim() || null, reason: req.reason.trim() }), '긴급 신청했습니다. 대표가 승인하면 알림이 오고 바로 출근 체크할 수 있습니다.')) {
      setReq({ ...req, place: '', reason: '' })
      reload()
    }
  }
  return (
    <div className="checkin-card">
      <div className="row">
        <span className="t-bodyb grow">{checkedIn ? '외근 · 재택 출근 체크' : '아직 출근 기록이 없습니다'}</span>
        {plan && <Badge tone={S_TONE[plan.status]}>{`오늘 ${plan.kind} 신청 ${plan.status}`}</Badge>}
      </div>
      {access && (
        <span className="t-cap">
          {isDesktopApp() && access.office
            ? '회사 PC 프로그램 · 회사 인터넷으로 접속 중 — 왼쪽 TODAY IS 에서 출근을 고르고 확인을 누르면 출근으로 인정됩니다.'
            : outside
              ? '지금은 회사 인터넷이 아닙니다. 사무실 출근은 회사 PC 프로그램에서만 인정되고, 외부에서는 승인된 외근 · 재택만 체크할 수 있습니다.'
              : '사무실 출근은 회사에서 왼쪽 TODAY IS 출근 → 확인을 눌러야 인정됩니다. 외부에서는 전날 승인된 외근 · 재택만 체크할 수 있습니다.'}
        </span>
      )}
      {approved ? (
        <>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="어디서 · 무엇을 (예: 성수 현장 철수 확인)" maxLength={300} aria-label="메모" />
          <div className="row wrap">
            <label className="row t-small" style={{ gap: 4 }}>
              <input type="checkbox" checked={withLoc} onChange={e => setWithLoc(e.target.checked)} />
              현재 위치 함께 기록 (대표만 봄)
            </label>
            <span className="grow" />
            <Button onClick={submit} disabled={busy || locating}>
              {locating ? '위치 확인 중…' : `${plan!.kind} 출근 체크`}
            </Button>
          </div>
          <span className="t-cap">{plan!.place ? `승인된 신청: ${plan!.place}` : '승인된 신청이 있어 체크하면 바로 출근으로 인정됩니다.'}</span>
        </>
      ) : plan?.status === '대기' ? (
        <span className="t-small">오늘 {plan.kind} 신청이 대표 승인을 기다리고 있습니다. 승인되면 알림이 오고, 이 칸에서 바로 출근 체크할 수 있습니다.</span>
      ) : plan?.status === '반려' ? (
        <span className="t-small">오늘 {plan.kind} 신청이 반려되었습니다. 회사에 출근해 회사 PC 프로그램으로 접속해 주세요.</span>
      ) : me.role !== 'admin' ? (
        <span className="t-small">오늘 승인된 외근 · 재택이 없습니다. 외근 · 재택 · 연차는 <b>전날까지</b> 신청 · 승인되어야 인정됩니다. 급한 사정은 대표에게 직접 요청해 주세요.</span>
      ) : (
        <>
          <span className="t-smallb">오늘 승인된 외근 · 재택이 없습니다 — 당일 신청 (관리자만)</span>
          <div className="chips">
            {WORK_PLAN_KINDS.map(k => (
              <Chip key={k} active={req.kind === k} onClick={() => setReq({ ...req, kind: k })}>
                {k}
              </Chip>
            ))}
          </div>
          <input className="input" value={req.place} onChange={e => setReq({ ...req, place: e.target.value })} placeholder="장소 (예: 성수 현장)" maxLength={200} aria-label="장소" />
          <div className="row wrap">
            <input className="input grow" value={req.reason} onChange={e => setReq({ ...req, reason: e.target.value })} placeholder="사유 (예: 설치 일정이 당겨짐)" maxLength={300} aria-label="사유" />
            <Button onClick={requestToday} disabled={busy}>
              긴급 신청
            </Button>
          </div>
          <span className="t-cap">대표가 승인하면 노트북 · 휴대폰으로 출근 체크할 수 있습니다. 외근 · 재택은 전날까지 미리 신청하면 편합니다.</span>
        </>
      )}
    </div>
  )
}

/** 외근 · 재택 · 현장 직출 사전 신청 (전날) + 관리자 승인 · 휴대폰 출근 확인 */
export function WorkPlanSection() {
  const { api, me, version, profileName } = useApp()
  const { busy, run } = useAction()
  const admin = me.role === 'admin'
  const today = todayKey()
  const tomorrow = addDays(today, 1)
  const { data } = useAsync(
    async () => {
      const [plans, checkins, rules] = await Promise.all([api.listWorkPlans(addDays(today, -7)), api.listCheckins(today), api.getAttendanceRules()])
      return { plans, checkins, rules }
    },
    [version, today],
    { plans: [] as WorkPlan[], checkins: [] as AttendanceCheckin[], rules: { workStart: '10:00', planDeadline: '18:00' } },
  )
  const nowHm = new Date(Date.now() + 9 * 3600_000).toISOString().slice(11, 16)
  const late = (day: string) => day <= today || (day === tomorrow && nowHm > data.rules.planDeadline)
  const [f, setF] = useState({ day: tomorrow, kind: '외근' as WorkPlanKind, place: '', reason: '' })
  const mine = data.plans.filter(p => p.user_id === me.id && p.day >= today)
  const pending = data.plans.filter(p => p.status === '대기' && p.day >= today)
  const pendingCheckins = data.checkins.filter(c => c.status === '대기')
  const submit = async () => {
    if (await run(() => api.requestWorkPlan({ day: f.day, kind: f.kind, place: f.place.trim() || null, reason: f.reason.trim() || null }), f.day === today ? '당일 신청했습니다. 대표 승인 후 인정됩니다.' : '신청했습니다.')) setF({ ...f, place: '', reason: '' })
  }
  return (
    <>
      <SectionHead title="외근 · 재택 사전 신청" right={<span className="t-cap">전날까지 신청 · 승인된 날만 인정 · 그날 확인을 눌러야 출근</span>} />
      <div className="form-grid">
        <Field label="날짜">
          {/* 전날까지 신청 (2026-10-28 대표 지시), 관리자는 당일도 */}
          <input className="input" type="date" min={admin ? today : tomorrow} value={f.day} onChange={e => e.target.value && setF({ ...f, day: e.target.value })} />
        </Field>
        <div className="label" role="group" aria-label="구분">
          <span>구분</span>
          <div className="chips">
            {WORK_PLAN_KINDS.map(k => (
              <Chip key={k} active={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
                {k}
              </Chip>
            ))}
          </div>
        </div>
        <Field label="장소">
          <input className="input" value={f.place} onChange={e => setF({ ...f, place: e.target.value })} placeholder="예) 성수 팝업 현장" maxLength={100} />
        </Field>
        <Field label="사유">
          <input className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="예) 설치 감리 09:00~" maxLength={200} />
        </Field>
      </div>
      <div className="row">
        <span className="t-cap grow">
          {late(f.day) ? `⚠ 마감(전날 ${data.rules.planDeadline}) 지남 — 늦은 신청으로 표시되고 대표 승인이 필요합니다.` : `${shortDate(f.day)} (${weekday(f.day)}) ${f.kind} 신청 · 마감 전날 ${data.rules.planDeadline}`}
        </span>
        <Button size="sm" onClick={submit} disabled={busy}>
          신청
        </Button>
      </div>
      {mine.length > 0 && (
        <div className="col gap-2">
          {mine.map(p => (
            <div key={p.id} className="row todo-row">
              <Badge tone={S_TONE[p.status]}>{p.status}</Badge>
              <span className="grow t-small">
                {shortDate(p.day)} ({weekday(p.day)}) {p.kind}
                {p.place ? ` · ${p.place}` : ''}
                {p.task_id && <span className="t-meta"> · 현장 일정 자동</span>}
                {p.late && <span className="t-red"> · 늦은 신청</span>}
              </span>
              {p.status === '대기' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(() => api.cancelWorkPlan(p.id), '신청을 취소했습니다.')}>
                  취소
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {admin && (
        <>
          <SectionHead
            title="승인할 신청 · 휴대폰 출근 확인"
            count={pending.length + pendingCheckins.length}
            right={
              pending.filter(p => !p.late).length > 1 ? (
                <Button size="sm" kind="outline" disabled={busy} onClick={() => run(async () => { for (const p of pending.filter(x => !x.late)) await api.decideWorkPlan(p.id, '승인') }, '기한 내 신청을 모두 승인했습니다.')}>
                  기한 내 신청 모두 승인
                </Button>
              ) : undefined
            }
          />
          {pending.length + pendingCheckins.length === 0 && <Empty>확인할 것이 없습니다.</Empty>}
          {pending.map(p => (
            <div key={p.id} className="row todo-row">
              <Badge tone={p.task_id ? 'acid' : 'yellow'}>{p.task_id ? '현장 일정' : '신청'}</Badge>
              <span className="grow t-small">
                {profileName(p.user_id)} · {shortDate(p.day)} ({weekday(p.day)}) {p.kind}
                {p.place ? ` · ${p.place}` : ''}
                {p.reason ? ` · ${p.reason}` : ''}
                {p.late && <span className="t-red"> (늦은 신청)</span>}
              </span>
              <Button size="sm" onClick={() => run(() => api.decideWorkPlan(p.id, '승인'), '승인했습니다.')} disabled={busy}>
                승인
              </Button>
              <Button size="sm" kind="ghost" onClick={() => run(() => api.decideWorkPlan(p.id, '반려'), '반려했습니다.')} disabled={busy}>
                반려
              </Button>
            </div>
          ))}
          {pendingCheckins.map(c => (
            <div key={c.id} className="row todo-row">
              <Badge tone="yellow">휴대폰 출근</Badge>
              <span className="grow t-small">
                {profileName(c.user_id)} · {timeLabel(c.at)} {c.kind}
                {c.note ? ` · ${c.note}` : ''} · 사전 신청 없음
              </span>
              {c.lat != null && c.lng != null && (
                <a className="t-meta t-blue" href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">
                  <MapPin size={12} style={{ verticalAlign: -2 }} aria-hidden="true" /> 위치
                </a>
              )}
              <Button size="sm" onClick={() => run(() => api.decideCheckin(c.id, '승인'), '출근으로 인정했습니다.')} disabled={busy}>
                인정
              </Button>
              <Button size="sm" kind="ghost" onClick={() => run(() => api.decideCheckin(c.id, '반려'), '반려했습니다.')} disabled={busy}>
                반려
              </Button>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/** 근태 표의 휴대폰 출근 칸 (관리자 · 본인만 기록이 보임) */
export function useCheckins(day: string) {
  const { api, version } = useApp()
  const { data } = useAsync(() => api.listCheckins(day), [version, day], [] as AttendanceCheckin[])
  return new Map(data.map(c => [c.user_id, c]))
}

export function CheckinTag({ c }: { c: AttendanceCheckin | undefined }) {
  if (!c) return null
  return (
    <span className="away-tag" title={c.note ?? ''}>
      <Smartphone size={12} style={{ verticalAlign: -2 }} aria-hidden="true" /> {c.kind} {timeLabel(c.at)} · {c.status === '대기' ? '확인 대기' : c.status}
      {c.lat != null && c.lng != null && (
        <a href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" className="t-blue">
          {' '}
          <MapPin size={12} style={{ verticalAlign: -2 }} aria-hidden="true" />
        </a>
      )}
    </span>
  )
}

/** 근태 규칙 설정 (관리자): 출근 기준 시각 · 사전 신청 마감 */
export function AttendanceRulesPanel() {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data } = useAsync(() => api.getAttendanceRules(), [version], { workStart: '10:00', planDeadline: '18:00' })
  const [ws, setWs] = useState<string | null>(null)
  const [pd, setPd] = useState<string | null>(null)
  const w = ws ?? data.workStart
  const d = pd ?? data.planDeadline
  return (
    <div className="row wrap rules-row">
      <span className="t-smallb">근태 규칙</span>
      <label className="row t-small" style={{ gap: 4 }}>
        출근 기준
        <input className="input" type="time" style={{ width: 110 }} value={w} onChange={e => setWs(e.target.value)} />
      </label>
      <label className="row t-small" style={{ gap: 4 }}>
        사전 신청 마감 (전날)
        <input className="input" type="time" style={{ width: 110 }} value={d} onChange={e => setPd(e.target.value)} />
      </label>
      <Button
        size="sm"
        kind="outline"
        disabled={busy || (w === data.workStart && d === data.planDeadline)}
        onClick={() =>
          run(async () => {
            if (w !== data.workStart) await api.setAttendanceRule('work_start', w)
            if (d !== data.planDeadline) await api.setAttendanceRule('plan_deadline', d)
            setWs(null)
            setPd(null)
          }, '근태 규칙을 저장했습니다.')
        }
      >
        저장
      </Button>
      <span className="t-cap">출근 기준 + 30분까지 기록이 없으면 본인 · 대표에게 미출근 알림 (평일, 휴가자 제외)</span>
    </div>
  )
}

/** 월간 근태 요약 (관리자) — 매월 1일 지난달 리포트가 알림으로 옴 */
export function MonthSummary({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { api, version } = useApp()
  const { data, loading } = useAsync(() => api.attendanceMonthSummary(month), [version, month], [] as AttendanceMonthRow[])
  const max = Math.max(1, ...data.map(r => r.work_days + r.absent_days))
  return (
    <>
      <SectionHead
        title="월간 근태"
        right={<input className="input" type="month" style={{ width: 150 }} value={month} max={todayKey().slice(0, 7)} onChange={e => e.target.value && onMonth(e.target.value)} aria-label="월" />}
      />
      {data.length === 0 ? (
        <Empty>{loading ? '불러오는 중…' : '기록이 없습니다.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>이름</th>
                <th>출근 · 미출근</th>
                <th className="num">출근일</th>
                <th className="num">지각</th>
                <th className="num">외근 · 재택</th>
                <th className="num">휴대폰 출근</th>
                <th className="num">확인 대기</th>
                <th className="num">휴가</th>
                <th className="num">미출근</th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <tr key={r.user_id}>
                  <td>{r.name}</td>
                  <td style={{ minWidth: 140 }}>
                    <span className="month-bar" title={`출근 ${r.work_days} · 미출근 ${r.absent_days}`}>
                      <i style={{ width: `${(r.work_days / max) * 100}%` }} />
                      <i className="absent" style={{ width: `${(r.absent_days / max) * 100}%` }} />
                    </span>
                  </td>
                  <td className="num">{r.work_days}</td>
                  <td className={`num${r.late_days ? ' t-red' : ''}`}>{r.late_days}</td>
                  <td className="num">{r.field_days}</td>
                  <td className="num">{r.mobile_days}</td>
                  <td className={`num${r.pending ? ' t-red' : ''}`}>{r.pending}</td>
                  <td className="num">{r.leave_days}</td>
                  <td className={`num${r.absent_days ? ' t-red' : ''}`}>{r.absent_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="t-cap">지각 = 출근 기준 시각 이후 첫 접속 (승인된 외근 · 재택 · 현장 직출 날은 제외). 미출근 = 평일 중 출근 기록 · 승인 휴가가 없는 날 (인트라넷 사용 시작일부터).</span>
    </>
  )
}

/** 회사 인터넷(IP) · 회사 PC 관리 (관리자): 여기 등록된 IP + 각자 등록된 회사 PC 에서만 사무실 출근 인정 */
export function OfficeNetworkPanel() {
  const { api, version, profileName } = useApp()
  const { busy, run } = useAction()
  const { data } = useAsync(
    async () => {
      const [access, recent, devices] = await Promise.all([api.getAccessInfo(), api.listRecentDesktopIps(), api.listAttendanceDevices()])
      return { access, recent, devices }
    },
    [version],
    { access: null as AccessInfo | null, recent: [] as { ip: string; users: number; days: number; last: string }[], devices: [] as AttendanceDevice[] },
  )
  const [add, setAdd] = useState('')
  const ips = data.access?.officeIps ?? []
  const save = (next: string[], msg: string) => run(() => api.setOfficeIps(next), msg)
  return (
    <div className="office-net">
      <div className="row wrap">
        <span className="t-smallb grow">회사 인터넷 · 회사 PC</span>
        <span className="t-cap">지금 내 IP {data.access?.ip ?? '확인 불가'}</span>
      </div>
      {!ips.length && <div className="office-warn t-small">회사 IP가 아직 없어 어디서든 PC 프로그램 접속이 출근으로 기록됩니다. 사무실에서 아래 IP를 등록하면 그때부터 회사 인터넷에서만 인정됩니다.</div>}
      <div className="chips">
        {ips.map(ip => (
          <Chip key={ip} active onClick={async () => (await ask(`${ip} 를 회사 IP에서 뺄까요?`)) && save(ips.filter(x => x !== ip), '회사 IP에서 뺐습니다.')}>
            {ip} ✕
          </Chip>
        ))}
      </div>
      <div className="row wrap">
        <input className="input" style={{ width: 200 }} value={add} onChange={e => setAdd(e.target.value)} placeholder="IP 또는 대역 (예: 121.1.2.3)" aria-label="회사 IP" />
        <Button size="sm" kind="outline" disabled={busy || !add.trim()} onClick={async () => (await save([...new Set([...ips, add.trim()])], '회사 IP를 등록했습니다.')) && setAdd('')}>
          추가
        </Button>
        {data.access?.ip && !ips.includes(data.access.ip) && (
          <Button size="sm" disabled={busy} onClick={() => save([...ips, data.access!.ip!], '지금 IP를 회사 IP로 등록했습니다.')}>
            지금 IP를 회사 IP로 등록
          </Button>
        )}
      </div>
      {data.recent.length > 0 && (
        <>
          <span className="t-cap">최근 14일 PC 프로그램 접속 IP — 여러 사람이 같은 IP면 회사 인터넷일 가능성이 큽니다</span>
          <div className="office-list">
            {data.recent.slice(0, 6).map(r => (
              <div key={r.ip} className="row t-small">
                <span className="grow">
                  {r.ip} · {r.users}명 · {r.days}일
                </span>
                {ips.includes(r.ip) ? <Badge tone="acid">회사 IP</Badge> : <Button size="sm" kind="outline" disabled={busy} onClick={() => save([...ips, r.ip], '회사 IP로 등록했습니다.')}>회사 IP로 등록</Button>}
              </div>
            ))}
          </div>
        </>
      )}
      <span className="t-cap">회사 PC — 회사 인터넷에서 처음 출근한 PC가 자동 등록되고, 그 뒤로는 그 PC에서만 출근이 인정됩니다. PC를 바꾸면 초기화하세요.</span>
      <div className="office-list">
        {data.devices.length === 0 && <span className="t-cap">아직 등록된 PC가 없습니다.</span>}
        {data.devices.map(d => (
          <div key={d.user_id + d.device_id} className="row t-small">
            <span className="grow">
              {profileName(d.user_id)} · {d.label ?? '회사 PC'} · 마지막 {shortDate(d.last_seen.slice(0, 10))} {timeLabel(d.last_seen)}
            </span>
            <Button size="sm" kind="outline" disabled={busy} onClick={async () => (await ask(`${profileName(d.user_id)} 님의 회사 PC 등록을 초기화할까요? 다음에 회사에서 켠 PC가 새로 등록됩니다.`)) && run(() => api.deleteAttendanceDevice(d.user_id, d.device_id), '초기화했습니다.')}>
              초기화
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
