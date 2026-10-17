import { useState } from 'react'
import { CheckInCard, CheckinTag, useCheckins, WorkPlanSection } from '../components/CheckIn'
import { OrgSection } from '../components/Org'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, minutesLabel, timeLabel, todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { presenceOf, useAccessLog, useAttendance, useDesktopOnly, type Presence } from '../lib/attendance'
import { SOURCE_LABEL } from '../lib/desktop'
import type { Profile, WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { PersonName } from '../components/Person'
import { LeaveSection } from '../components/Leave'
import { Avatar, Badge, Button, Chip, Field, SectionHead, TodayBadge } from '../components/ui'

type Tab = 'org' | 'attendance' | 'leave' | 'me'
const TABS: [Tab, string][] = [
  ['org', '조직 · 프로젝트'],
  ['attendance', '근태'],
  ['leave', '휴가'],
  ['me', '내 정보'],
]

export default function Team() {
  const { api, me, profiles, version } = useApp()
  const today = todayKey()
  const { data: logs } = useAsync(() => api.listWorkLogs({ date: today }), [version, today], [] as WorkLog[])
  const active = profiles.filter(p => p.active)
  const inactive = profiles.filter(p => !p.active)
  const attendance = useAttendance(today)
  const { query, path, navigate } = useRouter()
  const tab = (TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'org') as Tab
  return (
    <Shell active="team">
      <div className="chips" role="tablist" aria-label="팀 메뉴">
        {TABS.map(([k, l]) => (
          <Chip key={k} active={tab === k} onClick={() => navigate(withQuery(path, query, { tab: k === 'org' ? null : k }))}>
            {l}
          </Chip>
        ))}
      </div>
      {tab === 'org' && (
        <>
          <OrgSection />
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
        </>
      )}
      {tab === 'attendance' && (
        <>
          <CheckInCard always />
          <WorkPlanSection />
          <AttendanceSection />
        </>
      )}
      {tab === 'leave' && <LeaveSection />}
      {tab === 'me' && <MySettings />}
    </Shell>
  )
}

/** 근태 관리: 하루 첫 접속 = 출근. 그날 접속 기록이 없으면 미출근 */
function AttendanceSection() {
  const { profiles } = useApp()
  const today = todayKey()
  const [day, setDay] = useState(today)
  const rows = useAttendance(day)
  const access = useAccessLog(day)
  const { data: desktopOnly } = useDesktopOnly()
  const checkins = useCheckins(day)
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
              <th>외부 접속 (휴대폰 · 브라우저)</th>
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
                  <td>
                    <span className="row wrap" style={{ gap: 4 }}>
                      <CheckinTag c={checkins.get(p.id)} />
                      {(access.get(p.id) ?? [])
                        .filter(x => x.source !== 'desktop')
                        .sort((x, y) => x.first_at.localeCompare(y.first_at))
                        .map(x => (
                          <span key={x.source} className="away-tag" title={`처음 ${timeLabel(x.first_at)} · 마지막 ${timeLabel(x.last_at)}`}>
                            {SOURCE_LABEL[x.source]} {timeLabel(x.first_at)}
                          </span>
                        ))}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <span className="t-cap">
        {desktopOnly ? (
          <>
            <b>PC 프로그램</b>으로 그날 처음 접속한 시각이 출근 시각입니다. 휴대폰 · 브라우저 접속은 '외부 접속'에만 남고, 외근 · 재택은 위의 <b>휴대폰 출근 체크</b>로 출근합니다 (전날 승인된 신청이 있으면 자동 인정).{' '}
          </>
        ) : (
          <>그날 처음 로그인 · 접속한 시각이 출근 시각입니다 (PC 프로그램 · 브라우저 · 휴대폰 모두). </>
        )}
        접속 기록이 없으면 미출근입니다. <Link to="/download">PC 프로그램 내려받기 ›</Link>
      </span>
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
        <Avatar name={p.name} />
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
        {!isMe && p.active && (
          <Link to={`/chat?dm=${p.id}`} className="t-meta t-blue" title={`${p.name}님과 1:1 대화`}>
            💬 1:1
          </Link>
        )}
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
