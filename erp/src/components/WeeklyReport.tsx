import { useEffect, useMemo, useState } from 'react'
import { ProjectOptions } from './ProjectOptions'
import { createPortal } from 'react-dom'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, minutesLabel, shortDate, todayKey, weekday } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { DIVISIONS, type LeaveRecord, type Project, type Task, type WeeklyReport as Report, type WorkLog } from '../lib/types'
import { findWeeklyGaps, groupLogsByProject, mondayOf, taskDoneDay, weekDays } from '../lib/weekly'
import { Badge, Button, Chip, Empty, Field, KindBadge, Linkify, SectionHead } from './ui'

/**
 * 주간 보고 (대표 지시 2026-11-16) — 업무·근태 › '주간 보고'
 *  - 그 주(월~일) 업무 일지 · 끝낸 할 일을 구분 → 프로젝트별로 취합
 *  - 빠진 부분(기록 없는 평일 · 프로젝트 미지정 · 일지에 없는 완료 업무 · 기록 없는 담당 프로젝트)을 여기서 보완
 *  - 보완한 내용은 그 날짜의 업무 일지로 바로 들어감 (일간 업무와 같은 표라 자동 연동)
 */
export function WeeklyReportPane() {
  const { api, me, profiles, profileName, profileOf, version } = useApp()
  const { query, path, navigate } = useRouter()
  const { busy, run } = useAction()
  const today = todayKey()
  const monday = mondayOf(query.get('week') || today)
  const days = weekDays(monday)
  const sunday = days[6]
  const admin = me.role === 'admin'
  const uid = query.get('user') || me.id
  const own = uid === me.id
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const people = profiles.filter(p => p.active && !p.is_agent)

  const { data, loading } = useAsync(
    async () => {
      const [logs, tasks, projects, leaves, reports, teamLogs] = await Promise.all([
        api.listWorkLogs({ from: monday, to: sunday, userId: uid, limit: 2000 }),
        api.listTasks(),
        api.listProjects(),
        api.listLeave().catch(() => [] as LeaveRecord[]),
        api.listWeeklyReports(monday),
        admin ? api.listWorkLogs({ from: monday, to: sunday, limit: 5000 }) : Promise.resolve([] as WorkLog[]),
      ])
      return { logs, tasks, projects, leaves, reports, teamLogs }
    },
    [version, monday, uid, admin],
    { logs: [] as WorkLog[], tasks: [] as Task[], projects: [] as Project[], leaves: [] as LeaveRecord[], reports: [] as Report[], teamLogs: [] as WorkLog[] },
  )
  const report = data.reports.find(r => r.user_id === uid) ?? null
  const groups = useMemo(() => groupLogsByProject(data.logs, data.projects), [data.logs, data.projects])
  const gaps = useMemo(() => findWeeklyGaps({ monday, today, userId: uid, logs: data.logs, tasks: data.tasks, projects: data.projects, leaves: data.leaves }), [monday, today, uid, data])
  const gapCount = gaps.emptyDays.length + gaps.noProject.length + gaps.doneTasks.length + gaps.quietProjects.length
  const total = data.logs.reduce((n, l) => n + (l.minutes ?? 0), 0)
  const projCount = new Set(data.logs.map(l => l.project_id).filter(Boolean)).size
  const dayCount = new Set(data.logs.map(l => l.log_date)).size
  const doneThisWeek = data.tasks.filter(t => t.assignee_id === uid && t.status === '완료' && (taskDoneDay(t) ?? '') >= monday && (taskDoneDay(t) ?? '') <= sunday)

  // 총평 · 다음 주 계획
  const [summary, setSummary] = useState('')
  const [plan, setPlan] = useState('')
  useEffect(() => {
    setSummary(report?.summary ?? '')
    setPlan(report?.next_plan ?? '')
  }, [report?.id, report?.updated_at, monday, uid])
  const dirty = summary !== (report?.summary ?? '') || plan !== (report?.next_plan ?? '')
  const saveReport = (submit?: boolean) =>
    run(() => api.saveWeeklyReport({ week_start: monday, summary: summary.trim() || null, next_plan: plan.trim() || null, submit }), submit ? '주간 보고를 제출했습니다.' : submit === false ? '제출을 취소했습니다.' : '저장했습니다.')

  // 보완 입력 (그 날짜의 업무 일지로 들어감)
  const [fix, setFix] = useState<{ day: string; projectId: string; content: string; minutes: string }>({ day: '', projectId: '', content: '', minutes: '' })
  const fixDay = fix.day || gaps.emptyDays[0] || (today >= monday && today <= sunday ? today : days[4])
  const projectOpts = useMemo(() => [...data.projects].filter(p => p.status !== '완료' && p.status !== '보류').sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name)), [data.projects])
  const addLog = async () => {
    const content = fix.content.trim()
    if (!content) return
    const ok = await run(
      () => api.saveWorkLog({ log_date: fixDay, kind: '업무', content, project_id: fix.projectId || null, client_id: data.projects.find(p => p.id === fix.projectId)?.client_id ?? null, minutes: fix.minutes ? Number(fix.minutes) : null, memo: '주간 보고에서 보완' }),
      `${shortDate(fixDay)} 업무 일지에 넣었습니다.`,
    )
    if (ok) setFix({ day: '', projectId: fix.projectId, content: '', minutes: '' })
  }
  const taskToLog = (t: Task) =>
    run(() => api.saveWorkLog({ log_date: taskDoneDay(t)!, kind: '업무', content: `[완료] ${t.title}`, project_id: t.project_id ?? null, client_id: data.projects.find(p => p.id === t.project_id)?.client_id ?? null, minutes: null, memo: '주간 보고에서 보완 · 끝낸 할 일' }), '업무 일지에 넣었습니다.')
  const setProject = (l: WorkLog, projectId: string) => run(() => api.saveWorkLog({ id: l.id, project_id: projectId || null }), '프로젝트를 지정했습니다.')

  // 인쇄 · PDF: 화면과 별도로 A4 보고서 양식을 body 에 그려 두고 인쇄할 때만 보임
  const print = () => {
    document.body.classList.add('weekly-printing')
    const done = () => {
      document.body.classList.remove('weekly-printing')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
  }
  const writer = profileOf(uid)

  const projLabel = (p: Project) => `${p.code ? `${p.code} ` : ''}${p.name}`
  const projSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="input" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      <option value="">프로젝트 미지정 (공통 업무)</option>
      <ProjectOptions projects={projectOpts} />
    </select>
  )

  return (
    <div className="col gap-12 weekly">
      <div className="row wrap gap-6 weekly-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ week: addDays(monday, -7) })} aria-label="지난주">
          ‹
        </button>
        <span className="t-title nowrap">
          {shortDate(monday)} (월) ~ {shortDate(sunday)} (일)
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ week: addDays(monday, 7) })} disabled={addDays(monday, 7) > today} aria-label="다음 주">
          ›
        </button>
        {monday !== mondayOf(today) && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => go({ week: null })}>
            이번 주
          </button>
        )}
        <span className="grow" />
        <Button size="sm" kind="outline" onClick={print}>
          인쇄 · PDF
        </Button>
        {report?.submitted_at ? <Badge tone="acid">제출함 · {shortDate(report.submitted_at.slice(0, 10))}</Badge> : <Badge tone="yellow">아직 제출 전</Badge>}
      </div>

      {admin && (
        <div className="chips weekly-people" role="tablist" aria-label="팀원 주간 보고">
          {people.map(p => {
            const r = data.reports.find(x => x.user_id === p.id)
            const n = data.teamLogs.filter(l => l.user_id === p.id).length
            return (
              <Chip key={p.id} active={p.id === uid} onClick={() => go({ user: p.id === me.id ? null : p.id })}>
                {p.name} {n}건{r?.submitted_at ? ' ✓' : ''}
              </Chip>
            )
          })}
        </div>
      )}

      <div className="weekly-kpis">
        <span>
          <b>{data.logs.length}</b>업무 기록
        </span>
        <span>
          <b>{projCount}</b>프로젝트
        </span>
        <span>
          <b>{dayCount}</b>기록한 날
        </span>
        <span>
          <b>{doneThisWeek.length}</b>끝낸 할 일
        </span>
        <span>
          <b>{total ? minutesLabel(total) : '–'}</b>기록 시간
        </span>
        <span className={gapCount ? 'warn' : 'ok'}>
          <b>{gapCount}</b>보완할 곳
        </span>
      </div>

      {/* 빠진 부분 보완 */}
      <section className="weekly-box">
        <SectionHead title="빠진 부분 보완" count={gapCount} right={<span className="t-cap">여기서 넣으면 그 날짜의 업무 일지(일간 업무)에 바로 들어갑니다</span>} />
        {gapCount === 0 && <span className="t-cap">빠진 부분이 없습니다.{!own ? '' : ' 더 적을 내용이 있으면 아래에서 넣으세요.'}</span>}
        {gaps.emptyDays.length > 0 && (
          <div className="weekly-gap">
            <Badge tone="red">기록 없는 날</Badge>
            <span className="chips">
              {gaps.emptyDays.map(d => (
                <Chip key={d} active={own && fixDay === d} onClick={() => own && setFix({ ...fix, day: d })}>
                  {shortDate(d)} ({weekday(d)})
                </Chip>
              ))}
            </span>
          </div>
        )}
        {gaps.quietProjects.length > 0 && (
          <div className="weekly-gap">
            <Badge tone="yellow">기록 없는 담당 프로젝트</Badge>
            <span className="chips">
              {gaps.quietProjects.map(p => (
                <Chip key={p.id} active={own && fix.projectId === p.id} onClick={() => own && setFix({ ...fix, projectId: p.id })}>
                  {projLabel(p)}
                </Chip>
              ))}
            </span>
          </div>
        )}
        {gaps.doneTasks.map(t => (
          <div key={t.id} className="weekly-gap">
            <Badge tone="blue">일지에 없는 완료 업무</Badge>
            <span className="grow t-small">
              {shortDate(taskDoneDay(t))} · {t.title}
              {t.project_id && <span className="t-cap"> · {data.projects.find(p => p.id === t.project_id)?.name}</span>}
            </span>
            {own && (
              <Button size="sm" kind="outline" disabled={busy} onClick={() => taskToLog(t)}>
                일지에 넣기
              </Button>
            )}
          </div>
        ))}
        {gaps.noProject.map(l => (
          <div key={l.id} className="weekly-gap">
            <Badge tone="outline">프로젝트 미지정</Badge>
            <span className="grow t-small truncate" title={l.content}>
              {shortDate(l.log_date)} · {l.content.split('\n')[0]}
            </span>
            {(own || admin) && <span className="weekly-sel">{projSelect('', v => v && setProject(l, v), '프로젝트 지정')}</span>}
          </div>
        ))}
        {own && (
          <div className="weekly-fix">
            <div className="form-grid">
              <Field label="날짜">
                <select className="input" value={fixDay} onChange={e => setFix({ ...fix, day: e.target.value })}>
                  {days
                    .filter(d => d <= today)
                    .map(d => (
                      <option key={d} value={d}>
                        {shortDate(d)} ({weekday(d)}){gaps.emptyDays.includes(d) ? ' · 기록 없음' : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="프로젝트">{projSelect(fix.projectId, v => setFix({ ...fix, projectId: v }), '프로젝트')}</Field>
              <Field label="한 일" className="full">
                <textarea className="input" rows={2} value={fix.content} onChange={e => setFix({ ...fix, content: e.target.value })} placeholder="예) 시공사 견적 비교 · 발주처 수정 요청 반영" maxLength={2000} />
              </Field>
              <Field label="걸린 시간 (분 · 선택)">
                <input className="input" type="number" min={0} step={10} value={fix.minutes} onChange={e => setFix({ ...fix, minutes: e.target.value })} />
              </Field>
            </div>
            <div className="row">
              <span className="t-cap grow">
                {shortDate(fixDay)} ({weekday(fixDay)}) 업무 일지에 저장됩니다.
              </span>
              <Button size="sm" disabled={busy || !fix.content.trim() || days.filter(d => d <= today).length === 0} onClick={addLog}>
                일지에 넣기
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 구분 → 프로젝트별 취합 */}
      <section className="col gap-10">
        <SectionHead title="주간 활동 (구분 · 프로젝트별)" count={data.logs.length} right={<Link to={withQuery('/team', new URLSearchParams(), { date: monday })}>일간 업무 보기 ›</Link>} />
        {data.logs.length === 0 && <Empty>{loading ? '불러오는 중…' : `${own ? '이번 주' : profileName(uid) + ' 님의 이 주'} 업무 기록이 없습니다.`}</Empty>}
        {groups.map(g => (
          <div key={g.division ?? 'none'} className="weekly-div">
            <div className="weekly-div-head" style={{ borderColor: g.division ? DIVISIONS[g.division].color : 'var(--gray)' }}>
              <span className="t-bodyb" style={{ color: g.division ? DIVISIONS[g.division].color : undefined }}>
                {g.division ? DIVISIONS[g.division].full : '프로젝트 미지정 (공통 업무)'}
              </span>
              <span className="t-cap">
                {g.count}건{g.minutes ? ` · ${minutesLabel(g.minutes)}` : ''}
              </span>
            </div>
            {g.projects.map(b => (
              <div key={b.project?.id ?? 'none'} className="weekly-proj">
                <div className="row gap-6 weekly-proj-head">
                  {b.project ? (
                    <Link to={`/projects?id=${b.project.id}`} className="t-smallb">
                      {projLabel(b.project)}
                    </Link>
                  ) : (
                    <span className="t-smallb">프로젝트 없이 적은 기록</span>
                  )}
                  {b.project && <Badge tone="outline">{b.project.status}</Badge>}
                  <span className="t-cap">
                    {b.logs.length}건{b.minutes ? ` · ${minutesLabel(b.minutes)}` : ''}
                  </span>
                </div>
                <ul className="weekly-logs">
                  {b.logs.map(l => (
                    <li key={l.id}>
                      <button type="button" className="link-btn weekly-day" onClick={() => navigate(withQuery('/team', new URLSearchParams(), { date: l.log_date, user: own ? null : uid }))} title="이 날 업무 일지 보기">
                        {shortDate(l.log_date)} ({weekday(l.log_date)})
                      </button>
                      {l.kind !== '업무' && <KindBadge kind={l.kind} />}
                      <span className="weekly-text">
                        <Linkify text={l.content} />
                        {l.memo?.startsWith('주간 보고에서 보완') && <span className="weekly-fixed"> 보완</span>}
                        {l.task_id && <> <Badge tone="outline" title="할 일에서 자동으로 적힌 기록입니다">할 일</Badge></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </section>

      {/* 총평 · 다음 주 계획 · 제출 */}
      <section className="weekly-box">
        <SectionHead title="총평 · 다음 주 계획" right={report?.updated_at ? <span className="t-cap">마지막 저장 {shortDate(report.updated_at.slice(0, 10))}</span> : undefined} />
        {own ? (
          <>
            {report?.auto_draft_at && !report.submitted_at && (
              <div className="note">이번 주 기록 · 끝낸 할 일 · 다음 주 할 일로 초안을 채워 두었습니다. 읽어 보고 고칠 곳만 고친 뒤 <b>주간 보고 제출</b>을 눌러 주세요.</div>
            )}
            <Field label="이번 주 총평 (성과 · 문제 · 요청)">
              <textarea className="input" rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={4000} />
            </Field>
            <Field label="다음 주 계획">
              <textarea className="input" rows={3} value={plan} onChange={e => setPlan(e.target.value)} maxLength={4000} />
            </Field>
            <div className="row gap-6">
              <span className="t-cap grow">{gapCount ? `보완할 곳 ${gapCount}곳이 남아 있습니다. 그대로 제출할 수도 있습니다.` : '빠진 부분 없이 정리됐습니다.'}</span>
              <Button size="sm" kind="outline" disabled={busy || !dirty} onClick={() => saveReport()}>
                저장
              </Button>
              {report?.submitted_at ? (
                <Button size="sm" kind="ghost" disabled={busy} onClick={() => saveReport(false)}>
                  제출 취소
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => saveReport(true)}>
                  주간 보고 제출
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="col gap-6">
            <div>
              <span className="t-cap">이번 주 총평</span>
              <div className="weekly-read">{report?.summary ? <Linkify text={report.summary} /> : <span className="t-cap">아직 적지 않았습니다.</span>}</div>
            </div>
            <div>
              <span className="t-cap">다음 주 계획</span>
              <div className="weekly-read">{report?.next_plan ? <Linkify text={report.next_plan} /> : <span className="t-cap">아직 적지 않았습니다.</span>}</div>
            </div>
          </div>
        )}
      </section>
      {createPortal(
        <div className="weekly-print" aria-hidden="true">
          <div className="wp-top">
            <div>
              <h1>주간 업무 보고서</h1>
              <p>
                {monday.replace(/-/g, '.')} (월) ~ {sunday.replace(/-/g, '.')} (일)
              </p>
            </div>
            <table className="wp-sign">
              <tbody>
                <tr>
                  <th>작성</th>
                  <th>대표</th>
                </tr>
                <tr>
                  <td>{profileName(uid)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <table className="wp-meta">
            <tbody>
              <tr>
                <th>작성자</th>
                <td>
                  {profileName(uid)}
                  {writer?.title ? ` · ${writer.title}` : ''}
                </td>
                <th>제출일</th>
                <td>{report?.submitted_at ? report.submitted_at.slice(0, 10).replace(/-/g, '.') : '제출 전'}</td>
              </tr>
              <tr>
                <th>요약</th>
                <td colSpan={3}>
                  업무 기록 {data.logs.length}건 · 프로젝트 {projCount}개 · 기록한 날 {dayCount}일 · 끝낸 할 일 {doneThisWeek.length}건{total ? ` · 기록 시간 ${minutesLabel(total)}` : ''}
                </td>
              </tr>
            </tbody>
          </table>
          <h2>1. 주간 활동 (구분 · 프로젝트별)</h2>
          {data.logs.length === 0 && <p className="wp-empty">이 주의 업무 기록이 없습니다.</p>}
          {groups.map(g => (
            <div key={g.division ?? 'none'} className="wp-div">
              <h3>
                {g.division ? DIVISIONS[g.division].full : '프로젝트 미지정 (공통 업무)'} <span>{g.count}건</span>
              </h3>
              <table className="wp-table">
                <thead>
                  <tr>
                    <th style={{ width: '26%' }}>프로젝트</th>
                    <th style={{ width: '13%' }}>날짜</th>
                    <th>한 일</th>
                  </tr>
                </thead>
                <tbody>
                  {g.projects.flatMap(b =>
                    b.logs.map((l, i) => (
                      <tr key={l.id}>
                        {i === 0 && <td rowSpan={b.logs.length}>{b.project ? projLabel(b.project) : '프로젝트 없음'}</td>}
                        <td>
                          {shortDate(l.log_date)} ({weekday(l.log_date)})
                        </td>
                        <td className="wp-text">
                          {l.kind !== '업무' ? `[${l.kind}] ` : ''}
                          {l.content}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ))}
          {doneThisWeek.length > 0 && (
            <>
              <h2>2. 끝낸 할 일</h2>
              <table className="wp-table">
                <thead>
                  <tr>
                    <th style={{ width: '13%' }}>완료일</th>
                    <th style={{ width: '30%' }}>프로젝트</th>
                    <th>할 일</th>
                  </tr>
                </thead>
                <tbody>
                  {doneThisWeek.map(t => {
                    const p = data.projects.find(x => x.id === t.project_id)
                    return (
                      <tr key={t.id}>
                        <td>{shortDate(taskDoneDay(t))}</td>
                        <td>{p ? projLabel(p) : '–'}</td>
                        <td>{t.title}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          <h2>{doneThisWeek.length > 0 ? 3 : 2}. 이번 주 총평</h2>
          <div className="wp-box">{(own ? summary : report?.summary) || ' '}</div>
          <h2>{doneThisWeek.length > 0 ? 4 : 3}. 다음 주 계획</h2>
          <div className="wp-box">{(own ? plan : report?.next_plan) || ' '}</div>
          <p className="wp-foot">더위클리 사내 인트라넷 · 주간 보고 · 출력 {today.replace(/-/g, '.')}</p>
        </div>,
        document.body,
      )}
    </div>
  )
}
