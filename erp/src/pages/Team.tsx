import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, minutesLabel, timeLabel, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import { presenceOf, useAttendance, type Presence } from '../lib/attendance'
import type { Profile, WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { PersonName } from '../components/Person'
import { LeaveSection } from '../components/Leave'
import { Avatar, Badge, Button, Field, SectionHead, TodayBadge } from '../components/ui'

export default function Team() {
  const { api, me, profiles, version } = useApp()
  const today = todayKey()
  const { data: logs } = useAsync(() => api.listWorkLogs({ date: today }), [version, today], [] as WorkLog[])
  const active = profiles.filter(p => p.active)
  const inactive = profiles.filter(p => !p.active)
  const attendance = useAttendance(today)
  return (
    <Shell active="team">
      <SectionHead
        title="우리 팀"
        count={`${active.length}명`}
        right={me.role === 'admin' ? <Link to="/admin">팀원 추가·권한은 관리 ›</Link> : undefined}
      />
      <div className="members">
        {[...active, ...inactive].map(p => (
          <MemberCard key={p.id} p={p} presence={presenceOf(p, attendance.get(p.id))} logs={logs.filter(l => l.user_id === p.id)} />
        ))}
      </div>
      <AttendanceSection />
      <LeaveSection />
      <MySettings />
    </Shell>
  )
}

/** 근태 관리: 하루 첫 접속 = 출근. 그날 접속 기록이 없으면 미출근 */
function AttendanceSection() {
  const { profiles } = useApp()
  const today = todayKey()
  const [day, setDay] = useState(today)
  const rows = useAttendance(day)
  const people = profiles.filter(p => p.active && !p.is_agent)
  const absent = people.filter(p => !rows.has(p.id)).length
  return (
    <>
      <SectionHead
        title="근태 관리"
        count={`출근 ${people.length - absent} · 미출근 ${absent}`}
        right={
          <span className="row gap-6">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDay(addDays(day, -1))} aria-label="전날">
              ‹
            </button>
            <input type="date" className="input" style={{ width: 150 }} value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} aria-label="날짜" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label="다음 날">
              ›
            </button>
          </span>
        }
      />
      <div className="table-wrap" style={{ flexShrink: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>상태</th>
              <th className="num">출근 (첫 접속)</th>
              <th className="num">마지막 접속</th>
            </tr>
          </thead>
          <tbody>
            {people.map(p => {
              const a = rows.get(p.id)
              const status: Presence = day === today ? presenceOf(p, a) : a ? '출근' : '미출근'
              return (
                <tr key={p.id} className={a ? '' : 'absent'}>
                  <td>
                    <PersonName id={p.id} />
                  </td>
                  <td>
                    <TodayBadge status={status} />
                  </td>
                  <td className="num">{a ? timeLabel(a.first_at) : '–'}</td>
                  <td className="num">{a ? timeLabel(a.last_at) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <span className="t-cap">ERP나 빠른 기록 창에 그날 처음 로그인·접속한 시각이 출근 시각입니다. 접속 기록이 없으면 미출근으로 표시됩니다.</span>
    </>
  )
}

function MemberCard({ p, presence, logs }: { p: Profile; presence: Presence; logs: WorkLog[] }) {
  const { me } = useApp()
  const mins = logs.reduce((s, l) => s + (l.minutes ?? 0), 0)
  const isMe = p.id === me.id
  return (
    <div className={`member ${p.active ? '' : 'off'}`}>
      <div className="row">
        <Avatar name={p.is_agent ? '🤖' : p.name} />
        <span className="col gap-2 grow">
          <span className="row" style={{ gap: 4 }}>
            <PersonName id={p.id} className="t-smallb truncate" />
            {p.title && <span className="t-cap">{p.title}</span>}
          </span>
          <span className="row" style={{ gap: 4 }}>
            <span className="t-meta">TODAY IS</span>
            <TodayBadge status={presence} />
          </span>
        </span>
      </div>
      <span className="t-cap pre">{p.status_message || ' '}</span>
      <div className="row">
        <Link to={isMe ? '/work' : `/work?user=${p.id}`} className="t-meta t-blue" title="오늘 업무 보기 (파도타기)">
          기록 {logs.length}
          {mins ? ` · ${minutesLabel(mins)}` : ''}
        </Link>
        <span className="grow" />
        {!isMe && !p.is_agent && p.active && (
          <Link to={`/chat?dm=${p.id}`} className="t-meta t-blue" title={`${p.name}님과 1:1 대화`}>
            💬 1:1
          </Link>
        )}
        {p.is_agent && <Badge tone="acid">🤖 AI 팀원</Badge>}
        {p.role === 'admin' && <Badge tone="blue">관리자</Badge>}
        {!p.active && <Badge tone="paper">비활성</Badge>}
      </div>
    </div>
  )
}

function MySettings() {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const [name, setName] = useState(me.name)
  const [title, setTitle] = useState(me.title ?? '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  return (
    <>
      <SectionHead title="내 정보" />
      <div className="row top wrap gap-12">
        <div className="col gap-6" style={{ flex: '1 1 220px' }}>
          <Field label="이름">
            <input className="input" value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="직함">
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 매니저" />
          </Field>
          <Button kind="outline" size="sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim() || (name === me.name && title === (me.title ?? ''))} onClick={() => run(() => api.updateProfile(me.id, { name: name.trim(), title: title.trim() || null }), '저장했습니다.')}>
            저장
          </Button>
        </div>
        <div className="col gap-6" style={{ flex: '1 1 220px' }}>
          <Field label="새 비밀번호">
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} minLength={8} />
          </Field>
          <Field label="새 비밀번호 확인">
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </Field>
          <Button
            kind="outline"
            size="sm"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy || pw.length < 8 || pw !== pw2}
            onClick={async () => {
              if (await run(() => api.changePassword(pw), api.mode === 'demo' ? '데모에서는 비밀번호가 저장되지 않습니다.' : '비밀번호를 바꿨습니다.')) {
                setPw('')
                setPw2('')
              }
            }}
          >
            비밀번호 변경
          </Button>
          <span className="t-cap">8자 이상. {me.email}</span>
        </div>
      </div>
      <div className="row">
        <span className="grow" />
        <Button kind="ghost" size="sm" onClick={() => api.signOut()}>
          로그아웃
        </Button>
      </div>
    </>
  )
}
