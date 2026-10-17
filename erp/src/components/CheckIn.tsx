import { useState } from 'react'
import { MapPin, Smartphone } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, shortDate, timeLabel, todayKey, weekday } from '../lib/date'
import { useAttendance } from '../lib/attendance'
import { CHECKIN_KINDS, WORK_PLAN_KINDS, type AttendanceCheckin, type CheckinKind, type DecideStatus, type WorkPlan, type WorkPlanKind } from '../lib/types'
import { Badge, Button, Chip, Empty, Field, SectionHead } from './ui'

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

/** 출근 기록이 없을 때 휴대폰으로 출근 체크 (외근 · 재택 · 현장 직출 포함) */
export function CheckInCard({ always = false }: { always?: boolean }) {
  const { api, me } = useApp()
  const attendance = useAttendance()
  const { data, reload } = useMyToday()
  const { busy, run } = useAction()
  const [kind, setKind] = useState<CheckinKind>(data.plan?.status === '승인' ? data.plan.kind : '외근')
  const [note, setNote] = useState('')
  const [withLoc, setWithLoc] = useState(true)
  const [locating, setLocating] = useState(false)
  if (me.is_agent) return null
  const checkedIn = attendance.has(me.id)
  if (data.checkin) {
    return (
      <div className="checkin-card done">
        <Smartphone size={16} />
        <span className="grow t-small">
          오늘 휴대폰 출근 {timeLabel(data.checkin.at)} · {data.checkin.kind}
        </span>
        <Badge tone={S_TONE[data.checkin.status]}>{data.checkin.status === '대기' ? '대표 확인 대기' : data.checkin.status}</Badge>
      </div>
    )
  }
  if (checkedIn && !always) return null
  const submit = async () => {
    setLocating(withLoc)
    const pos = withLoc ? await getPosition() : null
    setLocating(false)
    let status: DecideStatus | null = null
    const ok = await run(async () => {
      const r = await api.mobileCheckIn({ kind, note: note.trim() || null, lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null, accuracy: pos?.coords.accuracy ?? null })
      status = r.status
    })
    if (ok) {
      setNote('')
      reload()
      window.alert(status === '승인' ? '출근 체크 완료 — 사전 신청이 승인되어 바로 인정됩니다.' : '출근 체크 완료 — 사전 신청이 없어 대표 확인 후 인정됩니다.')
    }
  }
  const approved = data.plan?.status === '승인'
  return (
    <div className="checkin-card">
      <div className="row">
        <Smartphone size={16} />
        <span className="t-bodyb grow">{checkedIn ? '휴대폰 출근 체크' : '아직 출근 기록이 없습니다'}</span>
        {data.plan && <Badge tone={S_TONE[data.plan.status]}>{`오늘 ${data.plan.kind} 신청 ${data.plan.status}`}</Badge>}
      </div>
      <div className="chips">
        {CHECKIN_KINDS.map(k => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
            {k}
          </Chip>
        ))}
      </div>
      <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="어디서 · 무엇을 (예: 성수 현장 철수 확인)" maxLength={300} aria-label="메모" />
      <div className="row wrap">
        <label className="row t-small" style={{ gap: 4 }}>
          <input type="checkbox" checked={withLoc} onChange={e => setWithLoc(e.target.checked)} />
          <MapPin size={13} /> 현재 위치 함께 기록 (대표만 봄)
        </label>
        <span className="grow" />
        <Button onClick={submit} disabled={busy || locating}>
          {locating ? '위치 확인 중…' : '출근 체크'}
        </Button>
      </div>
      <span className="t-cap">{approved ? '전날 승인된 신청이 있어 체크하면 바로 출근으로 인정됩니다.' : '사전 신청 없이 체크하면 대표 확인 후 출근으로 인정됩니다. 외근 · 재택은 전날까지 아래에서 신청해 주세요.'}</span>
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
      const [plans, checkins] = await Promise.all([api.listWorkPlans(addDays(today, -7)), api.listCheckins(today)])
      return { plans, checkins }
    },
    [version, today],
    { plans: [] as WorkPlan[], checkins: [] as AttendanceCheckin[] },
  )
  const [f, setF] = useState({ day: tomorrow, kind: '외근' as WorkPlanKind, place: '', reason: '' })
  const mine = data.plans.filter(p => p.user_id === me.id && p.day >= today)
  const pending = data.plans.filter(p => p.status === '대기' && p.day >= today)
  const pendingCheckins = data.checkins.filter(c => c.status === '대기')
  const submit = async () => {
    if (await run(() => api.requestWorkPlan({ day: f.day, kind: f.kind, place: f.place.trim() || null, reason: f.reason.trim() || null }), f.day === today ? '당일 신청했습니다. 대표 승인 후 인정됩니다.' : '신청했습니다.')) setF({ ...f, place: '', reason: '' })
  }
  return (
    <>
      <SectionHead title="외근 · 재택 사전 신청" right={<span className="t-cap">전날 승인되면 그날 휴대폰 출근이 자동 인정</span>} />
      <div className="form-grid">
        <Field label="날짜">
          <input className="input" type="date" min={today} value={f.day} onChange={e => e.target.value && setF({ ...f, day: e.target.value })} />
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
        <span className="t-cap grow">{f.day === today ? '⚠ 당일 신청은 대표가 승인해야 인정됩니다.' : `${shortDate(f.day)} (${weekday(f.day)}) ${f.kind} 신청`}</span>
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
          <SectionHead title="승인할 신청 · 휴대폰 출근 확인" count={pending.length + pendingCheckins.length} />
          {pending.length + pendingCheckins.length === 0 && <Empty>확인할 것이 없습니다.</Empty>}
          {pending.map(p => (
            <div key={p.id} className="row todo-row">
              <Badge tone="yellow">신청</Badge>
              <span className="grow t-small">
                {profileName(p.user_id)} · {shortDate(p.day)} ({weekday(p.day)}) {p.kind}
                {p.place ? ` · ${p.place}` : ''}
                {p.reason ? ` · ${p.reason}` : ''}
                {p.created_at.slice(0, 10) >= p.day && <span className="t-red"> (당일 신청)</span>}
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
                  📍 위치
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
      📱 {c.kind} {timeLabel(c.at)} · {c.status === '대기' ? '확인 대기' : c.status}
      {c.lat != null && c.lng != null && (
        <a href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" className="t-blue">
          {' '}
          📍
        </a>
      )}
    </span>
  )
}
