import { useEffect, useRef, useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
import { DEDUCTS, leaveBalance, weekdaysBetween } from '../lib/leave'
import { useRouter } from '../lib/router'
import { LEAVE_KINDS, type HrRecord, type LeaveKind, type LeaveRecord } from '../lib/types'
import { Badge, Button, Field, SectionHead } from './ui'
import { PersonName } from './Person'
import { ask } from './Ask'

const fullDate = (k: string) => k.replace(/-/g, '.')
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}일`

/** 연차 · 휴가: 입사일 기준 연차 자동 계산 · 휴가 신청 · 관리자 승인 */
export function LeaveSection() {
  const { api, me, profiles, version } = useApp()
  const { query } = useRouter()
  const admin = me.role === 'admin'
  const today = todayKey()
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useAsync(
    async () => {
      const [leaves, hr] = await Promise.all([api.listLeave(), api.listHrRecords()])
      return { leaves, hr }
    },
    [version],
    { leaves: [] as LeaveRecord[], hr: [] as HrRecord[] },
  )
  useEffect(() => {
    if (query.get('view') === 'leave') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [query])

  const joinedOf = (id: string) => data.hr.find(h => h.profile_id === id)?.joined_on ?? null
  const mine = data.leaves.filter(l => l.profile_id === me.id)
  const myJoined = joinedOf(me.id)
  const bal = myJoined ? leaveBalance(myJoined, today, mine) : null
  const pending = data.leaves.filter(l => l.status === '신청' && (admin || l.profile_id === me.id))
  const upcoming = data.leaves.filter(l => l.status === '승인' && l.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const people = profiles.filter(p => p.active && !p.is_agent)

  return (
    <div ref={ref} className="col gap-10" id="leave">
      <SectionHead title="연차 · 휴가" right={<span className="t-cap">근로기준법 기준 자동 계산 · 입사일 기준</span>} />
      {bal ? (
        <div className="leave-card">
          <div className="leave-nums">
            <span>
              <b>{days(bal.granted)}</b>발생
            </span>
            <span>
              <b>{days(bal.used)}</b>사용
            </span>
            {bal.pending > 0 && (
              <span>
                <b>{days(bal.pending)}</b>승인 대기
              </span>
            )}
            <span className={bal.remaining < 0 ? 'neg' : 'left'}>
              <b>{days(bal.remaining)}</b>남음
            </span>
          </div>
          <span className="t-cap">
            {fullDate(myJoined!)} 입사 · 이번 연차 기간 {fullDate(bal.periodStart)} ~ {fullDate(bal.periodEnd)}
          </span>
          <span className="t-cap">{bal.rule}</span>
        </div>
      ) : (
        <span className="note">인사기록에 입사일이 없어 연차를 계산할 수 없습니다. {admin ? '이름을 눌러 인사기록 › 수정에서 입사일을 넣어 주세요.' : '관리자에게 입사일 입력을 요청하세요.'}</span>
      )}
      <LeaveForm profileIds={admin ? people.map(p => p.id) : [me.id]} />

      {pending.length > 0 && (
        <div className="col gap-2">
          <span className="t-bodyb">승인 대기 {pending.length}건</span>
          {pending.map(l => (
            <LeaveRow key={l.id} l={l} />
          ))}
        </div>
      )}
      <div className="col gap-2">
        <span className="t-bodyb">다가오는 휴가</span>
        {upcoming.length ? upcoming.map(l => <LeaveRow key={l.id} l={l} />) : <span className="t-cap">예정된 휴가가 없습니다.</span>}
      </div>

      {admin && (
        <div className="col gap-6">
          <span className="t-bodyb">팀원 연차 현황</span>
          <div className="table-wrap" style={{ flexShrink: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>입사일</th>
                  <th className="num">근속</th>
                  <th className="num">발생</th>
                  <th className="num">사용</th>
                  <th className="num">대기</th>
                  <th className="num">남음</th>
                  <th>이번 연차 기간</th>
                </tr>
              </thead>
              <tbody>
                {people.map(p => {
                  const j = joinedOf(p.id)
                  const b = j ? leaveBalance(j, today, data.leaves.filter(l => l.profile_id === p.id)) : null
                  return (
                    <tr key={p.id}>
                      <td>
                        <PersonName id={p.id} />
                      </td>
                      <td className="nowrap">{j ? fullDate(j) : <span className="t-red">입사일 없음</span>}</td>
                      <td className="num">{b ? (b.years ? `${b.years}년` : '1년 미만') : '–'}</td>
                      <td className="num">{b ? days(b.granted) : '–'}</td>
                      <td className="num">{b ? days(b.used) : '–'}</td>
                      <td className="num">{b?.pending ? days(b.pending) : '–'}</td>
                      <td className={`num ${b && b.remaining < 0 ? 'red' : ''}`}>{b ? days(b.remaining) : '–'}</td>
                      <td className="nowrap t-cap">{b ? `${shortDate(b.periodStart)}~${shortDate(b.periodEnd)}` : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <span className="t-cap">
            1년 미만은 1개월 개근마다 1일(최대 11일), 1년 이상은 15일에 최초 1년을 넘는 2년마다 1일 가산(최대 25일). 출근율 80% 미만·결근은 반영하지 않으니 해당자는 직접 조정하세요. 병가·경조사·기타는 연차에서 차감하지 않습니다.
          </span>
        </div>
      )}
    </div>
  )
}

function LeaveForm({ profileIds }: { profileIds: string[] }) {
  const { api, me, profileName } = useApp()
  const { busy, run } = useAction()
  const admin = me.role === 'admin'
  const [who, setWho] = useState(me.id)
  const [kind, setKind] = useState<LeaveKind>('연차')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [n, setN] = useState('')
  const [reason, setReason] = useState('')
  const half = kind === '반차'
  const auto = start ? (half ? 0.5 : weekdaysBetween(start, end || start)) : 0
  const count = half ? 0.5 : Number(n || auto)
  const bad = !start || (!half && !!end && end < start) || !(count > 0) || (half ? false : count > 60)
  const submit = async () => {
    if (bad) return
    const self = who === me.id
    const ok = await run(
      () => api.createLeave({ profile_id: who, kind, start_date: start, end_date: half ? start : end || start, days: count, reason: reason.trim() || null, status: admin && !self ? '승인' : undefined }),
      admin && !self ? `${profileName(who)}님 휴가를 승인 상태로 등록했습니다.` : '휴가를 신청했습니다. 관리자 승인 후 연차에서 차감됩니다.',
    )
    if (ok) {
      setStart('')
      setEnd('')
      setN('')
      setReason('')
    }
  }
  return (
    <div className="box col gap-6">
      <div className="form-grid">
        {admin && profileIds.length > 1 && (
          <Field label="누구">
            <select className="select" value={who} onChange={e => setWho(e.target.value)}>
              {profileIds.map(id => (
                <option key={id} value={id}>
                  {profileName(id)}
                  {id === me.id ? ' (나)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="종류">
          <select className="select" value={kind} onChange={e => setKind(e.target.value as LeaveKind)}>
            {LEAVE_KINDS.map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label={half ? '날짜' : '시작일'}>
          <input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} />
        </Field>
        {!half && (
          <Field label="종료일">
            <input className="input" type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} />
          </Field>
        )}
        {!half && (
          <Field label={`일수 (평일 ${auto}일 자동, 공휴일은 직접)`}>
            <input className="input" type="number" min={0.5} step={0.5} max={60} value={n} placeholder={String(auto || '')} onChange={e => setN(e.target.value)} />
          </Field>
        )}
        <Field label="사유 (선택)" className="full">
          <input className="input" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <div className="row">
        <span className="t-cap grow">{start ? `${days(count)} · ${DEDUCTS(kind) ? '연차에서 차감' : '연차 차감 없음'}` : '날짜를 고르세요.'}</span>
        <Button onClick={submit} disabled={busy || bad}>
          {admin && who !== me.id ? '등록 (승인)' : '휴가 신청'}
        </Button>
      </div>
    </div>
  )
}

function LeaveRow({ l }: { l: LeaveRecord }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const admin = me.role === 'admin'
  const mine = l.profile_id === me.id
  return (
    <div className="item-row">
      <PersonName id={l.profile_id} />
      <Badge tone={l.kind === '연차' || l.kind === '반차' ? 'blue' : 'outline'}>{l.kind}</Badge>
      <span className="t-cap grow truncate">
        {shortDate(l.start_date)}
        {l.end_date !== l.start_date ? `~${shortDate(l.end_date)}` : ''} · {days(Number(l.days))}
        {l.reason ? ` · ${l.reason}` : ''}
      </span>
      <Badge tone={l.status === '승인' ? 'acid' : l.status === '반려' ? 'red' : 'yellow'}>{l.status}</Badge>
      {admin && l.status === '신청' && (
        <>
          <Button size="sm" disabled={busy} onClick={() => run(() => api.decideLeave(l.id, '승인'), '승인했습니다.')}>
            승인
          </Button>
          <Button size="sm" kind="outline" disabled={busy} onClick={() => run(() => api.decideLeave(l.id, '반려'), '반려했습니다.')}>
            반려
          </Button>
        </>
      )}
      {(admin || (mine && l.status === '신청')) && (
        <Button size="sm" kind="ghost" disabled={busy} onClick={async () => (await ask('이 휴가 기록을 지울까요?')) && run(() => api.deleteLeave(l.id), '지웠습니다.')}>
          {mine && l.status === '신청' ? '취소' : '삭제'}
        </Button>
      )}
    </div>
  )
}

