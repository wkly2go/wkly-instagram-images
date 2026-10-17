import { useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, dateTimeLabel, relativeLabel, shortDate, todayKey, weekday } from '../lib/date'
import { useRouter, withQuery } from '../lib/router'
import { AGENT_VERDICTS, type AgentAction, type AgentJob, type AgentJobRequest, type AgentReport, type Department } from '../lib/types'
import { Shell } from '../components/Shell'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import { Badge, Button, Chip, Empty, Field, Modal, SectionHead, type Tone } from '../components/ui'

const V_TONE: Record<string, Tone> = { 완료: 'acid', '변동 없음': 'outline', '일부 실패': 'yellow', 실패: 'red', 미실행: 'gray', '진행 중': 'blue' }
const R_TONE: Record<string, Tone> = { 대기: 'yellow', '처리 중': 'blue', 완료: 'acid', '수동 필요': 'red', 거절: 'gray' }
const MANAGER = 'WKLY 총괄 에이전트 관리'

type Tab = 'jobs' | 'org' | 'reports' | 'requests'

/** Claude AI 에이전트(예약 작업) 관리 · 일일 보고 (관리자) */
export default function Agents() {
  const { me } = useApp()
  const { query, path, navigate } = useRouter()
  const tab = (query.get('tab') as Tab | null) ?? (query.get('date') ? 'reports' : 'jobs')
  const go = (t: Tab) => navigate(withQuery(path, query, { tab: t === 'jobs' ? null : t }), { replace: true })
  if (me.role !== 'admin') {
    return (
      <Shell active="agents">
        <Empty>관리자만 볼 수 있습니다.</Empty>
      </Shell>
    )
  }
  return (
    <Shell active="agents">
      <div className="row wrap">
        <div className="chips">
          {(
            [
              ['jobs', '에이전트'],
              ['org', '조직도 · 관리자'],
              ['reports', '일일 보고'],
              ['requests', '관리 요청'],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <Chip key={k} active={tab === k} onClick={() => go(k)}>
              {l}
            </Chip>
          ))}
        </div>
        <span className="grow" />
        <span className="t-cap">Claude 예약 작업을 WKLY 총괄이 2시간마다 점검해 이곳에 기록합니다.</span>
      </div>
      <FailureBanner />
      {tab === 'jobs' ? <Jobs /> : tab === 'org' ? <AgentOrg /> : tab === 'reports' ? <Reports /> : <Requests />}
    </Shell>
  )
}

function duration(j: AgentJob) {
  if (!j.last_fired_at || !j.last_finished_at) return null
  const m = Math.round((Date.parse(j.last_finished_at) - Date.parse(j.last_fired_at)) / 60000)
  return m < 1 ? '1분 미만' : `${m}분`
}

function Jobs() {
  const { api, version } = useApp()
  const { data, loading } = useAsync(
    async () => {
      const [jobs, requests] = await Promise.all([api.listAgentJobs(), api.listAgentJobRequests()])
      return { jobs, requests }
    },
    [version],
    { jobs: [] as AgentJob[], requests: [] as AgentJobRequest[] },
  )
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'problem' | 'off'>('all')
  const [acting, setActing] = useState<{ job: AgentJob; action: AgentAction } | null>(null)
  const today = todayKey()
  const problem = (j: AgentJob) => j.enabled && (j.last_verdict === '실패' || j.last_verdict === '일부 실패' || (j.last_status ?? '').includes('실패'))
  const list = data.jobs.filter(j => (only === 'all' || (only === 'problem' ? problem(j) : !j.enabled)) && (!q.trim() || `${j.name} ${j.group_name} ${j.last_summary ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const groups = useMemo(() => {
    const m = new Map<string, AgentJob[]>()
    for (const j of list) m.set(j.group_name, [...(m.get(j.group_name) ?? []), j])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [list])
  const pending = (id: string) => data.requests.filter(r => r.trigger_id === id && (r.status === '대기' || r.status === '처리 중'))
  const ranToday = data.jobs.filter(j => j.last_fired_at && j.last_fired_at.slice(0, 10) >= addDays(today, -1) && new Date(j.last_fired_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today).length
  const synced = data.jobs.reduce<string | null>((a, j) => (!a || j.synced_at > a ? j.synced_at : a), null)

  return (
    <div className="col gap-10">
      <div className="kpis kpis-4">
        <div className="kpi">
          <span className="t-cap">AI 에이전트</span>
          <span className="v">{data.jobs.length}</span>
          <span className="sub">사용 중 {data.jobs.filter(j => j.enabled).length} · 꺼짐 {data.jobs.filter(j => !j.enabled).length}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">오늘 실행</span>
          <span className="v">{ranToday}</span>
          <span className="sub">{synced ? `점검 ${relativeLabel(synced)}` : '아직 점검 전'}</span>
        </div>
        <button type="button" className="kpi" onClick={() => setOnly(only === 'problem' ? 'all' : 'problem')}>
          <span className="t-cap">확인 필요</span>
          <span className={`v${data.jobs.some(problem) ? ' t-red' : ''}`}>{data.jobs.filter(problem).length}</span>
          <span className="sub">최근 실행 실패 · 일부 실패</span>
        </button>
        <div className="kpi">
          <span className="t-cap">처리 대기 요청</span>
          <span className="v">{data.requests.filter(r => r.status === '대기' || r.status === '처리 중').length}</span>
          <span className="sub">다음 점검 때 WKLY 총괄이 처리</span>
        </div>
      </div>
      <div className="row wrap">
        <label className="search grow" style={{ maxWidth: 360 }}>
          <Search size={14} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="에이전트 · 결과 검색" aria-label="에이전트 검색" />
        </label>
        <div className="chips">
          <Chip active={only === 'all'} onClick={() => setOnly('all')}>
            전체
          </Chip>
          <Chip active={only === 'problem'} onClick={() => setOnly('problem')}>
            확인 필요
          </Chip>
          <Chip active={only === 'off'} onClick={() => setOnly('off')}>
            꺼짐
          </Chip>
        </div>
      </div>
      {data.jobs.length === 0 && <Empty>{loading ? '불러오는 중…' : '아직 동기화된 에이전트가 없습니다. WKLY 총괄의 첫 점검 후 나타납니다.'}</Empty>}
      {groups.map(([g, jobs]) => (
        <div key={g} className="col gap-6">
          <SectionHead title={g} count={jobs.length} />
          {jobs.map(j => {
            const pend = pending(j.trigger_id)
            return (
              <div key={j.trigger_id} className={`agent-job${j.enabled ? '' : ' off'}`}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <Badge tone={j.enabled ? (j.last_verdict ? V_TONE[j.last_verdict] ?? 'outline' : 'outline') : 'gray'}>{j.enabled ? j.last_verdict ?? j.last_status ?? '기록 없음' : '꺼짐'}</Badge>
                  <span className="t-smallb grow">{j.name}</span>
                  {pend.map(r => (
                    <Badge key={r.id} tone="yellow" title={r.detail ?? undefined}>
                      요청: {r.action} · {r.status}
                    </Badge>
                  ))}
                </div>
                <span className="t-cap">
                  ⏱ {j.schedule_label ?? j.cron ?? '일정 없음'}
                  {j.last_fired_at && ` · 최근 ${dateTimeLabel(j.last_fired_at)}${duration(j) ? ` (${duration(j)})` : ''}`}
                  {j.enabled && j.next_run_at && ` · 다음 ${dateTimeLabel(j.next_run_at)}`}
                  {j.model && ` · ${j.model.replace(/^claude-/, '')}`}
                </span>
                {j.last_summary && <span className="t-small pre agent-sum">{j.last_summary}</span>}
                <div className="row wrap" style={{ gap: 4 }}>
                  <Button kind="outline" size="sm" onClick={() => setActing({ job: j, action: '지금 실행' })}>
                    지금 실행
                  </Button>
                  {j.enabled ? (
                    <Button kind="ghost" size="sm" onClick={() => setActing({ job: j, action: '일시정지' })}>
                      일시정지
                    </Button>
                  ) : (
                    <Button kind="ghost" size="sm" onClick={() => setActing({ job: j, action: '재개' })}>
                      다시 켜기
                    </Button>
                  )}
                  <Button kind="ghost" size="sm" onClick={() => setActing({ job: j, action: '시간 변경' })}>
                    시간 변경
                  </Button>
                  <Button kind="ghost" size="sm" onClick={() => setActing({ job: j, action: '지시 수정' })}>
                    지시 수정
                  </Button>
                  {j.session_url && (
                    <a className="btn btn-ghost btn-sm" href={j.session_url} target="_blank" rel="noreferrer">
                      실행 기록
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {acting && <RequestModal job={acting.job} action={acting.action} onClose={() => setActing(null)} />}
    </div>
  )
}

const ACTION_HELP: Record<AgentAction, string> = {
  '지금 실행': '다음 점검(최대 2시간 안) 때 WKLY 총괄이 이 에이전트를 바로 한 번 실행합니다. 추가로 전할 말이 있으면 적어 주세요.',
  일시정지: '이 에이전트의 자동 실행을 멈춥니다. 기록과 설정은 그대로 남습니다.',
  재개: '멈춘 에이전트를 다시 켭니다.',
  '시간 변경': "원하는 실행 시간을 적어 주세요. 예: '평일 오전 9시 반', '매일 8시 · 14시'",
  '지시 수정': '이 에이전트가 하는 일에서 바꿀 점을 적어 주세요. WKLY 총괄이 기존 지시에 반영합니다. 메일 발송 · 게시 · 결제처럼 위험한 일은 대표 확인 후 반영합니다.',
}

function RequestModal({ job, action, onClose }: { job: AgentJob; action: AgentAction; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [detail, setDetail] = useState('')
  const need = action === '시간 변경' || action === '지시 수정'
  return (
    <Modal
      title={`${action} · ${job.name}`}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || (need && !detail.trim())} onClick={async () => (await run(() => api.requestAgentJob({ trigger_id: job.trigger_id, action, detail: detail.trim() || null }), 'WKLY 총괄에게 요청했습니다.')) && onClose()}>
            요청하기
          </Button>
        </>
      }
    >
      <div className="col gap-8">
        <span className="t-small">{ACTION_HELP[action]}</span>
        <Field label={need ? '내용' : '전할 말 (선택)'}>
          <textarea className="textarea" rows={need ? 5 : 3} value={detail} onChange={e => setDetail(e.target.value)} autoFocus />
        </Field>
        <span className="t-cap">현재 일정: {job.schedule_label ?? job.cron ?? '없음'}</span>
      </div>
    </Modal>
  )
}

function Reports() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const today = todayKey()
  const date = query.get('date') ?? today
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('day')
  const [q, setQ] = useState('')
  const [verdict, setVerdict] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const from = mode === 'day' ? date : mode === 'week' ? addDays(date, -6) : `${date.slice(0, 7)}-01`
  const { data: reports, loading } = useAsync(() => api.listAgentReports(from, date), [from, date, version], [] as AgentReport[])
  const setDate = (d: string) => navigate(withQuery(path, query, { date: d, tab: 'reports' }), { replace: true })
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = reports
    .filter(r => (!verdict || r.verdict === verdict) && (!words.length || words.every(w => `${r.job_name} ${r.title} ${r.summary ?? ''} ${r.body ?? ''}`.toLowerCase().includes(w))))
    .sort((a, b) => (a.job_name === MANAGER ? -1 : b.job_name === MANAGER ? 1 : 0) || b.report_date.localeCompare(a.report_date) || AGENT_VERDICTS.indexOf(b.verdict) - AGENT_VERDICTS.indexOf(a.verdict) || (b.run_at ?? '').localeCompare(a.run_at ?? ''))
  // 넓은 화면: 누른 보고의 본문은 오른쪽 칸
  const wide = usePanelWide()
  const sel = list.find(r => (open ? r.id === open : r.job_name === MANAGER && open === null)) ?? null
  useRightPanel(wide && sel ? `agent-report:${sel.id}` : null, 'AI 보고', sel && <AgentReportDetail r={sel} head />)
  const count = (v: string) => reports.filter(r => r.verdict === v).length
  return (
    <div className="col gap-10">
      <div className="row wrap">
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, mode === 'month' ? -30 : mode === 'week' ? -7 : -1))} aria-label="이전">
          <ChevronLeft size={16} />
        </button>
        <span className="t-title">{mode === 'month' ? `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월` : mode === 'week' ? `${shortDate(from)} – ${shortDate(date)}` : `${shortDate(date)} (${weekday(date)})`}</span>
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, mode === 'month' ? 30 : mode === 'week' ? 7 : 1))} aria-label="다음" disabled={date >= today}>
          <ChevronRight size={16} />
        </button>
        {date !== today && (
          <Button kind="ghost" size="sm" onClick={() => setDate(today)}>
            오늘
          </Button>
        )}
        <input className="input" type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 150 }} aria-label="날짜" />
        <div className="chips">
          {(
            [
              ['day', '하루'],
              ['week', '7일'],
              ['month', '한 달'],
            ] as const
          ).map(([k, l]) => (
            <Chip key={k} active={mode === k} onClick={() => setMode(k)}>
              {l}
            </Chip>
          ))}
        </div>
        <span className="grow" />
        <label className="search" style={{ minWidth: 220 }}>
          <Search size={14} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="보고 내용 검색" aria-label="보고 검색" />
        </label>
      </div>
      <div className="chips">
        <Chip active={!verdict} onClick={() => setVerdict(null)}>
          전체 {reports.length}
        </Chip>
        {AGENT_VERDICTS.filter(v => count(v)).map(v => (
          <Chip key={v} active={verdict === v} onClick={() => setVerdict(verdict === v ? null : v)}>
            {v} {count(v)}
          </Chip>
        ))}
      </div>
      {list.length === 0 && <Empty>{loading ? '불러오는 중…' : '이 기간의 보고가 없습니다.'}</Empty>}
      {list.map(r => {
        const picked = open === r.id || (r.job_name === MANAGER && open === null)
        const isOpen = !wide && picked
        return (
          <div key={r.id} className={`agent-report${r.job_name === MANAGER ? ' lead' : ''}${wide && picked ? ' picked' : ''}`}>
            <button type="button" className="row report-toggle" onClick={() => setOpen(wide ? r.id : isOpen ? '' : r.id)} aria-expanded={wide ? picked : isOpen}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Badge tone={V_TONE[r.verdict] ?? 'outline'}>{r.verdict}</Badge>
              <span className="t-smallb grow">{r.job_name === MANAGER ? `🤖 ${r.title}` : r.job_name}</span>
              <span className="t-meta">{r.run_at ? dateTimeLabel(r.run_at) : shortDate(r.report_date)}</span>
            </button>
            {!isOpen && r.summary && <span className="t-cap agent-sum">{r.summary}</span>}
            {isOpen && (
              <AgentReportDetail r={r} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function AgentReportDetail({ r, head }: { r: AgentReport; head?: boolean }) {
  return (
    <div className="col gap-6">
      {head && <span className="t-bodyb">{r.job_name === MANAGER ? `🤖 ${r.title}` : r.job_name}</span>}
      {r.job_name !== MANAGER && r.title !== r.job_name && <span className="t-cap">{r.title}</span>}
      {r.summary && <div className="note pre">{r.summary}</div>}
      {r.body && <div className="t-small pre agent-body">{r.body}</div>}
      {r.link && /^https?:\/\//.test(r.link) && (
        <a href={r.link} target="_blank" rel="noreferrer" className="t-cap">
          원본 보기 ›
        </a>
      )}
    </div>
  )
}

function Requests() {
  const { api, version, profileName } = useApp()
  const { run } = useAction()
  const { data } = useAsync(
    async () => {
      const [requests, jobs] = await Promise.all([api.listAgentJobRequests(), api.listAgentJobs()])
      return { requests, jobs }
    },
    [version],
    { requests: [] as AgentJobRequest[], jobs: [] as AgentJob[] },
  )
  const name = (id: string) => data.jobs.find(j => j.trigger_id === id)?.name ?? id
  return (
    <div className="col gap-6">
      <span className="t-cap">관리 요청은 WKLY 총괄이 2시간마다 처리합니다. Claude 권한상 자동으로 바꿀 수 없는 요청은 '수동 필요'로 표시되고, 대표님께 처리 방법을 알려 드립니다.</span>
      {data.requests.length === 0 && <Empty>요청이 없습니다. 에이전트 탭에서 실행 · 일시정지 · 시간 변경 · 지시 수정을 요청할 수 있습니다.</Empty>}
      {data.requests.map(r => (
        <div key={r.id} className="item-row">
          <span className="col gap-2 grow">
            <span className="row" style={{ gap: 6 }}>
              <Badge tone={R_TONE[r.status] ?? 'outline'}>{r.status}</Badge>
              <span className="t-smallb">
                {r.action} · {name(r.trigger_id)}
              </span>
            </span>
            {r.detail && <span className="t-cap pre">{r.detail}</span>}
            {r.result && <span className="t-small pre t-blue">→ {r.result}</span>}
            <span className="t-meta">
              {profileName(r.requested_by)} · {dateTimeLabel(r.created_at)}
              {r.handled_at ? ` · 처리 ${dateTimeLabel(r.handled_at)}` : ''}
            </span>
          </span>
          {r.status === '대기' && (
            <Button kind="ghost" size="sm" onClick={() => run(() => api.cancelAgentJobRequest(r.id), '요청을 취소했습니다.')}>
              취소
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

/** 최근 24시간 실패 · 일부 실패 · 미실행 경고 (맨 위 빨간 상자) */
function FailureBanner() {
  const { api, version } = useApp()
  const today = todayKey()
  const { data } = useAsync(() => api.listAgentReports(addDays(today, -1), today), [version, today], [] as AgentReport[])
  const bad = data.filter(r => r.verdict === '실패' || r.verdict === '일부 실패' || r.verdict === '미실행')
  if (!bad.length) return null
  return (
    <div className="fail-banner">
      <b>⚠ 최근 24시간 확인 필요 {bad.length}건</b>
      {bad.slice(0, 8).map(r => (
        <div key={r.id} className="t-small">
          · {r.job_name} — {r.verdict}
          {r.summary ? ` · ${r.summary.slice(0, 120)}` : ''}
        </div>
      ))}
      <span className="t-cap">WKLY 총괄이 정기 점검 때 실패한 작업을 한 번 다시 실행합니다. 같은 작업이 두 번 실패하면 '관리 요청'에서 확인해 주세요.</span>
    </div>
  )
}

/** AI 팀 조직도: 대표 → 부서(책임자 · 사람 · AI 팀원 · 예약 작업 묶음) + AI 팀원별 사람 관리자 지정 */
function AgentOrg() {
  const { api, version, profiles, profileName } = useApp()
  const { busy, run } = useAction()
  const { data } = useAsync(
    async () => {
      const [departments, jobs] = await Promise.all([api.listDepartments(), api.listAgentJobs()])
      return { departments, jobs: jobs.filter(j => !j.removed) }
    },
    [version],
    { departments: [] as Department[], jobs: [] as AgentJob[] },
  )
  const active = profiles.filter(p => p.active)
  const humans = active.filter(p => !p.is_agent)
  const agents = active.filter(p => p.is_agent)
  const heads = humans.filter(p => p.role === 'admin')
  const deptOf = (id: string) => data.departments.find(d => d.member_ids.includes(id)) ?? null
  const groups = [...new Set(data.jobs.map(j => j.group_name))]
  const groupDept = (g: string) => data.departments.find(d => d.agent_groups.includes(g)) ?? null
  const unassigned = groups.filter(g => !groupDept(g))
  return (
    <div className="col gap-10">
      <SectionHead title="조직도" right={<span className="t-cap">부서 · 구성원 편집은 프로젝트 › 조직 현황, 소속 부서는 관리 › 팀원 관리에서</span>} />
      <div className="aorg">
        <div className="aorg-top">
          <span className="aorg-node head">
            <b>대표</b> {heads.map(h => h.name).join(' · ') || '–'}
          </span>
        </div>
        <div className="aorg-depts">
          {data.departments.map(d => {
            const ppl = d.member_ids.map(id => active.find(p => p.id === id)).filter((p): p is (typeof active)[number] => !!p)
            const jobGroups = d.agent_groups.filter(g => groups.includes(g))
            return (
              <section key={d.id} className="aorg-dept">
                <span className="t-bodyb">{d.name}</span>
                <span className="t-cap">책임 {d.lead_id ? profileName(d.lead_id) : '미지정'}</span>
                <div className="aorg-list">
                  {ppl.filter(p => !p.is_agent).map(p => (
                    <span key={p.id} className="aorg-node">
                      {p.name}
                      {p.title && <i>{p.title}</i>}
                    </span>
                  ))}
                  {ppl.filter(p => p.is_agent).map(p => (
                    <span key={p.id} className="aorg-node ai">
                      <b>AI</b> {p.name}
                      <i>관리 {p.manager_id ? profileName(p.manager_id) : '미지정'}</i>
                    </span>
                  ))}
                  {jobGroups.map(g => (
                    <span key={g} className="aorg-node job" title={data.jobs.filter(j => j.group_name === g).map(j => j.name).join('\n')}>
                      <b>예약</b> {g} <i>{data.jobs.filter(j => j.group_name === g).length}개 · 관리 {d.lead_id ? profileName(d.lead_id) : '미지정'}</i>
                    </span>
                  ))}
                  {ppl.length === 0 && jobGroups.length === 0 && <span className="t-cap">구성원 없음</span>}
                </div>
              </section>
            )
          })}
          {unassigned.length > 0 && (
            <section className="aorg-dept none">
              <span className="t-bodyb">부서 미지정 예약 작업</span>
              <div className="aorg-list">
                {unassigned.map(g => (
                  <span key={g} className="aorg-node job">
                    <b>예약</b> {g} <i>{data.jobs.filter(j => j.group_name === g).length}개</i>
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <SectionHead title="AI 팀원 · 사람 관리자" count={agents.length} right={<span className="t-cap">관리자는 AI 팀원의 보고 · 요청을 확인하고 지시합니다</span>} />
      {agents.length === 0 ? (
        <Empty>AI 팀원이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>AI 팀원</th>
                <th>부서</th>
                <th>사람 관리자</th>
                <th>부서 책임자</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => {
                const d = deptOf(a.id)
                return (
                  <tr key={a.id}>
                    <td className="nowrap">
                      <Badge tone="blue">AI</Badge> {a.name}
                    </td>
                    <td>{d?.name ?? '미지정'}</td>
                    <td>
                      <select
                        className="select"
                        style={{ padding: '2px 6px', fontSize: 12, width: 130 }}
                        value={a.manager_id ?? ''}
                        disabled={busy}
                        onChange={e => run(() => api.updateProfile(a.id, { manager_id: e.target.value || null }), e.target.value ? `${a.name} 관리자를 ${profileName(e.target.value)} 님으로 정했습니다.` : `${a.name} 관리자를 비웠습니다.`)}
                        aria-label={`${a.name} 사람 관리자`}
                      >
                        <option value="">미지정</option>
                        {humans.map(h => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                            {h.title ? ` · ${h.title}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="t-cap">{d?.lead_id ? profileName(d.lead_id) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
