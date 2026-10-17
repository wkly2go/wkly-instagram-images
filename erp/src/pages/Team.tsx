import { useState } from 'react'
import { AttendanceRulesPanel, CheckInCard, CheckinTag, MonthSummary, OfficeNetworkPanel, useCheckins, WorkPlanSection } from '../components/CheckIn'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, minutesLabel, shortDate, timeLabel, todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { presenceOf, useAccessLog, useAttendance, useDesktopOnly, type Presence } from '../lib/attendance'
import { SOURCE_LABEL } from '../lib/desktop'
import type { Attendance, AttendanceCheckin, LeaveRecord, Profile, Project, ResearchItem, Task, WorkLog, WorkPlan } from '../lib/types'
import { Shell } from '../components/Shell'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import { PersonName } from '../components/Person'
import { LeaveSection } from '../components/Leave'
import { Badge, Button, Chip, Field, KindBadge, SectionHead, StatusBadge, TodayBadge } from '../components/ui'
import { AssignTaskButton } from '../components/AssignTask'

type Tab = 'attendance' | 'leave' | 'me'
const TABS: [Tab, string][] = [
  ['attendance', '근태'],
  ['leave', '휴가'],
  ['me', '내 정보'],
]

/** 팀 · 근태: 근태만. 조직 · 프로젝트 현황은 프로젝트 › 조직 탭으로 옮김 */
export default function Team() {
  const { me, profiles } = useApp()
  const today = todayKey()
  const { query, path, navigate } = useRouter()
  const tab = (TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'attendance') as Tab
  const personId = query.get('user')
  const person = personId ? profiles.find(p => p.id === personId) ?? null : null
  const goPerson = (id: string | null) => navigate(withQuery(path, query, { user: id }), { replace: true })
  // 넓은 화면: 사람 목록과 근태는 가운데 한 단, 누른 사람의 허브는 오른쪽 칸
  const wide = usePanelWide()
  useRightPanel(wide && tab === 'attendance' && person ? `person:${person.id}` : null, '팀원 상세', person && <PersonHub key={person.id} p={person} onBack={() => goPerson(null)} />)
  return (
    <Shell active="team" flush={tab === 'attendance'}>
      {tab === 'attendance' ? (
        <div className={`split ${person && !wide ? 'has-detail' : ''}${wide ? ' team-one' : ''}`}>
          <div className="pane-list">
            <div className="pane-head">
              <div className="chips" role="tablist" aria-label="팀 메뉴">
                {TABS.map(([k, l]) => (
                  <Chip key={k} active={tab === k} onClick={() => navigate(withQuery(path, query, { tab: k === 'attendance' ? null : k, user: null }))}>
                    {l}
                  </Chip>
                ))}
              </div>
            </div>
            <PeopleList selectedId={personId} onSelect={goPerson} />
          </div>
          <div className="pane-detail" style={{ overflow: 'auto' }}>
            <div className="col gap-10" style={{ padding: '14px 16px' }}>
              {person && !wide ? (
                <PersonHub key={person.id} p={person} onBack={() => goPerson(null)} />
              ) : (
                <>
                  <CheckInCard always />
                  <WorkPlanSection />
                  <AttendanceSection />
                  {me.role === 'admin' && <MonthSummary month={query.get('month') ?? today.slice(0, 7)} onMonth={m => navigate(withQuery(path, query, { month: m }))} />}
                  {me.role === 'admin' && <AttendanceRulesPanel />}
                  {me.role === 'admin' && <OfficeNetworkPanel />}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="chips" role="tablist" aria-label="팀 메뉴">
            {TABS.map(([k, l]) => (
              <Chip key={k} active={tab === k} onClick={() => navigate(withQuery(path, query, { tab: k === 'attendance' ? null : k, user: null }))}>
                {l}
              </Chip>
            ))}
          </div>
          {tab === 'leave' && <LeaveSection />}
          {tab === 'me' && <MySettings />}
        </>
      )}
    </Shell>
  )
}

/** 왼쪽: 사람을 세로로 나열 (오늘 상태 · 출근 시각). 누르면 그 사람의 업무 · 자료 전부 */
function PeopleList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { profiles } = useApp()
  const today = todayKey()
  const attendance = useAttendance(today)
  const people = profiles.filter(p => p.active && !p.is_agent)
  const absent = people.filter(p => !attendance.has(p.id)).length
  return (
    <>
      <div className="pane-head" style={{ paddingTop: 0 }}>
        <span className="t-bodyb">
          오늘 출근 {people.length - absent} · 미출근 {absent}
        </span>
      </div>
      <div className="pane-body">
        {people.map(p => {
          const a = attendance.get(p.id)
          return (
            <button key={p.id} type="button" className={`item ${p.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(p.id)}>
              <span className="col gap-2" style={{ minWidth: 0 }}>
                <span className="row" style={{ gap: 6 }}>
                  <span className="t-smallb truncate">{p.name}</span>
                  {p.title && <span className="t-cap">{p.title}</span>}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <TodayBadge status={presenceOf(p, a)} />
                  <span className="t-cap">{a ? `출근 ${timeLabel(a.first_at)}` : '기록 없음'}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 사람을 누르면: 오늘 상태 · 최근 30일 근태 · 외근/재택 신청 · 휴가 · 할 일 · 프로젝트 · 업무 일지 · 올린 자료 */
function PersonHub({ p, onBack }: { p: Profile; onBack: () => void }) {
  const { api, me, version, profileName } = useApp()
  const today = todayKey()
  const from = addDays(today, -29)
  const attendance = useAttendance(today)
  const { data } = useAsync(
    async () => {
      const [days, tasks, projects, logs, plans, leave, research, checkins] = await Promise.all([
        api.listAttendanceFor(p.id, from),
        api.listTasks(),
        api.listProjects(),
        api.listWorkLogs({ userId: p.id, limit: 40 }),
        api.listWorkPlans(addDays(today, -30)),
        api.listLeave().catch(() => [] as LeaveRecord[]),
        api.listResearch().catch(() => [] as ResearchItem[]),
        api.listCheckins(today),
      ])
      return { days, tasks: tasks.filter(t => t.assignee_id === p.id), projects, logs, plans: plans.filter(x => x.user_id === p.id), leave: leave.filter(l => l.profile_id === p.id), research: research.filter(r => r.created_by === p.id), checkin: checkins.find(c => c.user_id === p.id) ?? null }
    },
    [p.id, version],
    { days: [] as Attendance[], tasks: [] as Task[], projects: [] as Project[], logs: [] as WorkLog[], plans: [] as WorkPlan[], leave: [] as LeaveRecord[], research: [] as ResearchItem[], checkin: null as AttendanceCheckin | null },
  )
  const todayRow = attendance.get(p.id)
  const open = data.tasks.filter(t => t.status !== '완료')
  const late = open.filter(t => t.due_date && t.due_date < today)
  const myProjects = data.projects.filter(pr => pr.owner_id === p.id || data.tasks.some(t => t.project_id === pr.id))
  const pname = (id: string | null) => (id ? data.projects.find(x => x.id === id)?.name : undefined)
  const isMe = p.id === me.id
  const mins = data.logs.filter(l => l.log_date === today).reduce((s, l) => s + (l.minutes ?? 0), 0)
  // 근태 30일: 날짜별 한 줄 (출근 · 마지막 접속 · 외근/재택 · 휴가)
  const dayRows = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).map(d => {
    const a = data.days.find(x => x.day === d)
    const plan = data.plans.find(x => x.day === d && x.status === '승인')
    const lv = data.leave.find(l => l.status === '승인' && l.start_date <= d && d >= l.start_date && d <= l.end_date)
    return { d, a, plan, lv }
  })
  const wd = (d: string) => new Date(`${d}T00:00:00+09:00`).getDay()
  return (
    <>
      <div className="row wrap">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="목록으로">
          ‹
        </button>
        <h2 className="t-title">{p.name}</h2>
        {p.title && <span className="t-small">{p.title}</span>}
        <TodayBadge status={presenceOf(p, todayRow)} />
        {todayRow && <span className="t-cap">출근 {timeLabel(todayRow.first_at)} · 마지막 {timeLabel(todayRow.last_at)}</span>}
        <CheckinTag c={data.checkin ?? undefined} />
        <span className="grow" />
        <PersonName id={p.id} className="btn btn-outline btn-sm" />
        <Link to={isMe ? '/work' : `/work?user=${p.id}`} className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
          업무 일지
        </Link>
        {!isMe && (
          <Link to={`/chat?dm=${p.id}`} className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
            1:1 대화
          </Link>
        )}
        {!isMe && <AssignTaskButton assignee={p.id} label="업무 지시" className="btn btn-yellow btn-sm" />}
      </div>
      {p.status_message && <span className="t-small pre">{p.status_message}</span>}
      <div className="kpis kpis-4">
        <div className="kpi">
          <span className="t-cap">남은 할 일</span>
          <span className="v">{open.length}</span>
          <span className="sub">지연 {late.length}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">참여 프로젝트</span>
          <span className="v">{myProjects.filter(x => x.status !== '완료').length}</span>
          <span className="sub">담당 {myProjects.filter(x => x.owner_id === p.id && x.status !== '완료').length}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">오늘 기록</span>
          <span className="v">{data.logs.filter(l => l.log_date === today).length}</span>
          <span className="sub">{mins ? minutesLabel(mins) : '시간 미기록'}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">30일 출근</span>
          <span className="v">{data.days.length}</span>
          <span className="sub">휴가 {data.leave.filter(l => l.status === '승인' && l.end_date >= from).reduce((n, l) => n + l.days, 0)}일</span>
        </div>
      </div>
      <div className="row top gap-12" style={{ flexWrap: 'wrap' }}>
        <div className="col grow gap-10" style={{ flexBasis: 320 }}>
          <SectionHead title="할 일" count={`${data.tasks.filter(t => t.status === '완료').length}/${data.tasks.length}`} right={<Link to={`/projects?view=tasks`}>팀 할 일 ›</Link>} />
          {open.slice(0, 20).map(t => (
            <div key={t.id} className="row wrap dashed" style={{ padding: '5px 0', gap: 6 }}>
              <StatusBadge status={t.due_date && t.due_date < today ? '지연' : t.status} />
              <Link to={t.project_id ? `/projects?id=${t.project_id}` : '/projects?view=tasks'} className="t-smallb truncate" style={{ maxWidth: 260 }}>
                {t.title}
              </Link>
              <span className="grow" />
              {t.project_id && <span className="t-cap truncate" style={{ maxWidth: 160 }}>{pname(t.project_id)}</span>}
              {t.due_date && <span className={`t-meta ${t.due_date < today ? 't-red' : ''}`}>{shortDate(t.due_date)}</span>}
            </div>
          ))}
          {open.length === 0 && <span className="t-cap">남은 할 일이 없습니다.</span>}
          <SectionHead title="프로젝트" count={myProjects.length ? String(myProjects.length) : undefined} />
          {myProjects.map(pr => (
            <div key={pr.id} className="row wrap dashed" style={{ padding: '5px 0', gap: 6 }}>
              <Link to={`/projects?id=${pr.id}`} className="t-smallb">
                {pr.name}
              </Link>
              <StatusBadge status={pr.status} />
              {pr.owner_id === p.id && <Badge tone="yellow">담당</Badge>}
              <span className="grow" />
              <span className="t-cap">할 일 {data.tasks.filter(t => t.project_id === pr.id && t.status !== '완료').length}건 남음</span>
            </div>
          ))}
          {myProjects.length === 0 && <span className="t-cap">맡은 프로젝트가 없습니다.</span>}
          <SectionHead title="업무 일지" count={data.logs.length ? String(data.logs.length) : undefined} right={<Link to={isMe ? '/work' : `/work?user=${p.id}`}>전체 보기 ›</Link>} />
          {data.logs.slice(0, 15).map(l => (
            <div key={l.id} className="col gap-2 dashed" style={{ padding: '6px 0' }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="t-meta">
                  {shortDate(l.log_date)} {timeLabel(l.created_at)}
                </span>
                <KindBadge kind={l.kind} />
                {l.email_counterpart && <span className="t-cap">{l.email_counterpart}</span>}
                <span className="grow" />
                {l.project_id && pname(l.project_id) && (
                  <Link to={`/projects?id=${l.project_id}`} className="t-cap">
                    {pname(l.project_id)} ›
                  </Link>
                )}
              </div>
              <span className="t-small t-blue pre">{l.content}</span>
            </div>
          ))}
          {data.logs.length === 0 && <span className="t-cap">업무 일지가 없습니다.</span>}
          {data.research.length > 0 && (
            <>
              <SectionHead title="올린 자료 · 보고서" count={String(data.research.length)} right={<Link to="/library">자료실 ›</Link>} />
              {data.research.slice(0, 10).map(r => (
                <div key={r.id} className="row wrap dashed" style={{ padding: '5px 0', gap: 6 }}>
                  <span className="t-meta">{shortDate(r.created_at.slice(0, 10))}</span>
                  <Badge tone="outline">{r.kind}</Badge>
                  <Link to={`/library?id=${r.id}`} className="t-smallb truncate" style={{ maxWidth: 300 }}>
                    {r.title}
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="col gap-10" style={{ flexBasis: 300, flexGrow: 1, maxWidth: 420 }}>
          <SectionHead title="근태 30일" right={<span className="t-cap">{profileName(p.id)} · {shortDate(from)}부터</span>} />
          <div className="col">
            {dayRows.map(({ d, a, plan, lv }) => (
              <div key={d} className={`row dashed att-day ${a || lv ? '' : wd(d) === 0 || wd(d) === 6 ? 'off' : 'absent'}`} style={{ padding: '3px 0', gap: 6 }}>
                <span className="t-meta" style={{ width: 64 }}>
                  {shortDate(d)} {['일', '월', '화', '수', '목', '금', '토'][wd(d)]}
                </span>
                {lv ? (
                  <Badge tone="paper">{lv.kind}</Badge>
                ) : a ? (
                  <span className="t-small">
                    {timeLabel(a.first_at)} – {timeLabel(a.last_at)}
                  </span>
                ) : wd(d) === 0 || wd(d) === 6 ? (
                  <span className="t-meta">주말</span>
                ) : (
                  <span className="t-meta t-red">미출근</span>
                )}
                <span className="grow" />
                {plan && <Badge tone="acid">{plan.kind}</Badge>}
              </div>
            ))}
          </div>
          <SectionHead title="외근 · 재택 신청 (30일)" count={data.plans.length ? String(data.plans.length) : undefined} />
          {data.plans.slice(0, 10).map(x => (
            <div key={x.id} className="row wrap dashed" style={{ padding: '4px 0', gap: 6 }}>
              <span className="t-meta">{shortDate(x.day)}</span>
              <Badge tone="outline">{x.kind}</Badge>
              <span className="t-cap truncate" style={{ maxWidth: 160 }}>{x.place ?? ''}</span>
              <span className="grow" />
              <Badge tone={x.status === '승인' ? 'acid' : x.status === '반려' ? 'red' : 'yellow'}>{x.status}</Badge>
            </div>
          ))}
          {data.plans.length === 0 && <span className="t-cap">신청이 없습니다.</span>}
          <SectionHead title="휴가" count={data.leave.length ? String(data.leave.length) : undefined} right={<Link to="/team?tab=leave">휴가 탭 ›</Link>} />
          {data.leave.slice(0, 8).map(l => (
            <div key={l.id} className="row wrap dashed" style={{ padding: '4px 0', gap: 6 }}>
              <span className="t-meta">
                {shortDate(l.start_date)}
                {l.end_date !== l.start_date ? ` – ${shortDate(l.end_date)}` : ''}
              </span>
              <Badge tone="outline">{l.kind}</Badge>
              <span className="t-cap">{l.days}일</span>
              <span className="grow" />
              <Badge tone={l.status === '승인' ? 'acid' : l.status === '반려' ? 'red' : 'yellow'}>{l.status}</Badge>
            </div>
          ))}
          {data.leave.length === 0 && <span className="t-cap">휴가 기록이 없습니다.</span>}
        </div>
      </div>
    </>
  )
}

/** 근태 관리: 하루 첫 접속 = 출근. 그날 접속 기록이 없으면 미출근 */
function AttendanceSection() {
  const { api, profiles, version } = useApp()
  const today = todayKey()
  const [day, setDay] = useState(today)
  const rows = useAttendance(day)
  const access = useAccessLog(day)
  const { data: desktopOnly } = useDesktopOnly()
  const checkins = useCheckins(day)
  const { data: rules } = useAsync(() => api.getAttendanceRules(), [version], { workStart: '10:00', planDeadline: '18:00' })
  const hm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16)
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
                  <td className="num">
                    {a ? timeLabel(a.first_at) : '–'}
                    {a && hm(a.first_at) > rules.workStart && checkins.get(p.id)?.status !== '승인' && <span className="t-red t-meta"> 지각</span>}
                  </td>
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
            <b>회사 인터넷</b>에서 <b>각자 등록된 회사 PC의 PC 프로그램</b>으로 그날 처음 접속한 시각이 출근 시각입니다. 휴대폰 · 브라우저 · 회사 밖 접속은 '외부 접속'에만 남고, 외근 · 재택은 <b>승인된 날만</b> 위 칸에서 노트북 · 휴대폰으로 출근 체크합니다 (승인이 없으면 긴급 신청 → 대표 승인).{' '}
          </>
        ) : (
          <>그날 처음 로그인 · 접속한 시각이 출근 시각입니다 (PC 프로그램 · 브라우저 · 휴대폰 모두). </>
        )}
        접속 기록이 없으면 미출근입니다. <Link to="/download">PC 프로그램 내려받기 ›</Link>
      </span>
    </>
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
