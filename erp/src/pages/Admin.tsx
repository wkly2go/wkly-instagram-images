import { useState } from 'react'
import { Copy, Download, KeyRound, Plus } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { EXPORT_TABLES, type ExportTable } from '../lib/api'
import { downloadText, toCsv } from '../lib/csv'
import { relativeLabel, shortDate, timeLabel, toDateKey, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import { AGENT_SCOPES, APPROVAL_KINDS, type AdminOverview, type AgentScope, type AgentToken, type Approval, type ApprovalKind, type ApprovalRoute, type Profile, type ResearchItem } from '../lib/types'
import { Meter } from '../components/charts'
import { Shell } from '../components/Shell'
import { Avatar, Badge, Button, Empty, Field, Modal } from '../components/ui'

export const SCOPE_LABEL: Record<AgentScope, string> = { research: '리서치', contact: '브랜드 담당자', task: '할 일', daily_report: '일일 보고', notify: '알림', read: '현황 조회' }
const FREE_DB = 500 * 1024 * 1024
const BACKUP_KEY = 'wkly-erp-last-backup'

interface Data {
  overview: AdminOverview | null
  routes: ApprovalRoute[]
  tokens: AgentToken[]
  approvals: Approval[]
  research: ResearchItem[]
}

export default function Admin() {
  const { api, me, version } = useApp()
  const { data, error } = useAsync<Data>(
    async () => {
      if (me.role !== 'admin') return { overview: null, routes: [], tokens: [], approvals: [], research: [] }
      const [overview, routes, tokens, approvals, research] = await Promise.all([
        api.adminOverview().catch(() => null),
        api.listApprovalRoutes().catch(() => []),
        api.listAgentTokens().catch(() => []),
        api.listApprovals(),
        api.listResearch().catch(() => []),
      ])
      return { overview, routes, tokens, approvals, research }
    },
    [version, me.role],
    { overview: null, routes: [], tokens: [], approvals: [], research: [] },
  )
  if (me.role !== 'admin') {
    return (
      <Shell active="admin">
        <Empty>관리자만 볼 수 있습니다.</Empty>
      </Shell>
    )
  }
  let lastBackup: string | null = null
  try {
    lastBackup = localStorage.getItem(BACKUP_KEY)
  } catch {
    lastBackup = null
  }
  return (
    <Shell active="admin">
      <div className="row">
        <h2 className="t-title">관리자</h2>
        <Badge tone="blue">관리자만 보임</Badge>
        <span className="grow" />
        <span className="t-cap">{lastBackup ? `마지막 백업 ${shortDate(lastBackup)}` : '백업 기록 없음'}</span>
      </div>
      {error && <div className="err">{error}</div>}
      <SystemStatus overview={data.overview} />
      <Members />
      <Routes routes={data.routes} />
      <AgentKeys tokens={data.tokens} />
      <Backup />
      <Activity approvals={data.approvals} research={data.research} />
    </Shell>
  )
}

function SystemStatus({ overview }: { overview: AdminOverview | null }) {
  const { profiles } = useApp()
  const size = overview?.db_size_bytes ?? 0
  const used = (size / FREE_DB) * 100
  const since = profiles.reduce((min, p) => (p.created_at < min ? p.created_at : min), new Date().toISOString())
  const days = Math.max(30, (Date.now() - new Date(since).getTime()) / 86_400_000)
  const perDay = size / days
  const years = perDay > 0 ? (FREE_DB - size) / perDay / 365 : null
  const t = overview?.tables ?? {}
  const counts: [string, string][] = [
    ['work_logs', '업무 일지'],
    ['chat_messages', '채팅'],
    ['approvals', '승인'],
    ['clients', '거래처'],
    ['payments', '결제'],
    ['research_items', '리서치'],
    ['brand_contacts', '브랜드 담당자'],
  ]
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">시스템 현황</span>
        <span className="cap">Supabase 무료 플랜 기준</span>
      </div>
      {!overview ? (
        <div className="note">현황을 불러오지 못했습니다. (DB 0003 이후 파일을 실행했는지 확인하세요)</div>
      ) : (
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="kpi">
            <span className="t-cap">DB 사용량</span>
            <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <span className="v">{(size / 1024 / 1024).toFixed(1)}MB</span>
              <span className="t-cap">/ 500MB · {used.toFixed(1)}%</span>
            </span>
            <Meter value={used} red={used > 80} label="DB 사용량" />
            <span className="sub">{years != null ? (years > 50 ? '지금 속도면 한참 남았어요' : `이 속도면 약 ${Math.max(0, years).toFixed(years < 2 ? 1 : 0)}년 사용 가능`) : ' '}</span>
          </div>
          <div className="kpi">
            <span className="t-cap">데이터 수 · 활성 팀원 {overview.active_members}</span>
            <span className="row wrap" style={{ gap: '2px 12px' }}>
              {counts.map(([k, label]) => (
                <span key={k} className="t-cap">
                  {label} <b className="t-meta t-blue">{(t[k] ?? 0).toLocaleString('ko-KR')}</b>
                </span>
              ))}
            </span>
            <span className="sub">갱신 {timeLabel(overview.generated_at)}</span>
          </div>
        </div>
      )}
    </section>
  )
}

function Members() {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: '', email: '', password: '', title: '', is_agent: false })
  const active = profiles.filter(p => p.active)
  const add = async () => {
    if (!f.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) || f.password.length < 8) return
    const ok = await run(() => api.createMember({ name: f.name.trim(), email: f.email.trim(), password: f.password, title: f.title.trim() || null, role: 'member', is_agent: f.is_agent }), `${f.name.trim()} 님을 추가했습니다. 임시 비밀번호를 전달해 주세요.`)
    if (ok) setF({ name: '', email: '', password: '', title: '', is_agent: false })
  }
  const update = (p: Profile, patch: Partial<Pick<Profile, 'role' | 'active' | 'is_agent'>>, msg: string) => run(() => api.updateProfile(p.id, patch), msg)
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">팀원 관리</span>
        <span className="cap">
          활성 {active.length} · AI 팀원 {active.filter(p => p.is_agent).length}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>직함</th>
              <th>권한</th>
              <th>구분</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const self = p.id === me.id
              return (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td className="nowrap">
                    <span className="row" style={{ gap: 6 }}>
                      <Avatar name={p.is_agent ? '🤖' : p.name} size="xs" />
                      <span className="strong">{p.name}</span>
                    </span>
                  </td>
                  <td className="nowrap">{p.email ?? '–'}</td>
                  <td className="max truncate">{p.title ?? '–'}</td>
                  <td>
                    <select className="select" style={{ padding: '2px 6px', fontSize: 12, width: 84 }} value={p.role} disabled={busy || self} onChange={e => update(p, { role: e.target.value as Profile['role'] }, '권한을 바꿨습니다.')} aria-label={`${p.name} 권한`}>
                      <option value="member">멤버</option>
                      <option value="admin">관리자</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" className={`badge ${p.is_agent ? 'blue' : 'outline'}`} style={{ cursor: 'pointer' }} disabled={busy || self} onClick={() => update(p, { is_agent: !p.is_agent }, p.is_agent ? '사람 팀원으로 바꿨습니다.' : 'AI 팀원으로 표시했습니다.')} title="눌러서 사람/AI 바꾸기">
                      {p.is_agent ? 'AI' : '사람'}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`badge ${p.active ? 'acid' : 'paper'}`}
                      style={{ cursor: self ? 'default' : 'pointer' }}
                      disabled={busy || self}
                      onClick={() => window.confirm(p.active ? `${p.name} 님을 비활성화할까요? 로그인해도 데이터를 볼 수 없게 됩니다.` : `${p.name} 님을 다시 활성화할까요?`) && update(p, { active: !p.active }, p.active ? '비활성화했습니다.' : '활성화했습니다.')}
                      title={self ? '본인은 바꿀 수 없어요' : '눌러서 활성/비활성'}
                    >
                      {p.active ? '활성' : '비활성'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        <input className="input" style={{ flex: '1 1 90px' }} placeholder="이름" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} aria-label="새 팀원 이름" />
        <input className="input" style={{ flex: '2 1 160px' }} placeholder="이메일" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} aria-label="새 팀원 이메일" />
        <input className="input" style={{ flex: '1 1 120px' }} placeholder="임시 비밀번호 (8자+)" type="text" autoComplete="off" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} aria-label="임시 비밀번호" />
        <input className="input" style={{ flex: '1 1 90px' }} placeholder="직함" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} aria-label="직함" />
        <select className="select" style={{ width: 80 }} value={f.is_agent ? 'ai' : 'human'} onChange={e => setF({ ...f, is_agent: e.target.value === 'ai' })} aria-label="구분">
          <option value="human">사람</option>
          <option value="ai">AI</option>
        </select>
        <Button onClick={add} disabled={busy || !f.name.trim() || !f.email.trim() || f.password.length < 8}>
          <Plus size={13} /> 팀원 추가
        </Button>
      </div>
      <span className="t-cap">AI 팀원(예: 프로젝트 총괄 매니저)은 로그인하지 않고 아래 '에이전트 연결 키'로 일일 보고·할 일 배정을 합니다. 계정은 이름 표시와 기록용입니다.</span>
    </section>
  )
}

function Routes({ routes }: { routes: ApprovalRoute[] }) {
  const { api, profiles } = useApp()
  const { busy, run } = useAction()
  const active = profiles.filter(p => p.active && !p.is_agent)
  const kinds = APPROVAL_KINDS.filter(k => k !== '기타')
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">승인 담당 설정</span>
        <span className="cap">요청할 때 승인자가 자동으로 지정됩니다 (비우면 관리자 누구나)</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {kinds.map(k => {
          const r = routes.find(x => x.kind === k)
          return (
            <label key={k} className="row" style={{ gap: 6, border: '1px solid var(--line)', padding: '3px 8px', borderRadius: 6, background: 'var(--white)' }}>
              <Badge>{k}</Badge>
              <span className="t-blue">→</span>
              <select className="select" style={{ padding: '2px 4px', fontSize: 12, width: 'auto', border: 0, fontWeight: 700 }} value={r?.approver_id ?? ''} disabled={busy} onChange={e => run(() => api.saveApprovalRoute(k as ApprovalKind, e.target.value || null), `${k} 승인 담당을 바꿨습니다.`)} aria-label={`${k} 승인 담당`}>
                <option value="">관리자 누구나</option>
                {active.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.title ? ` (${p.title})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function AgentKeys({ tokens }: { tokens: AgentToken[] }) {
  const { api, profileName } = useApp()
  const { busy, run } = useAction()
  const [creating, setCreating] = useState(false)
  const live = tokens.filter(t => !t.revoked_at)
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">AI 에이전트 연결 키</span>
        <span className="cap">키는 만들 때 한 번만 보여요</span>
      </div>
      {live.length === 0 ? (
        <Empty>연결된 에이전트가 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>팀원</th>
                <th>할 수 있는 일</th>
                <th>마지막 사용</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.map(t => (
                <tr key={t.id}>
                  <td className="strong nowrap">
                    {t.name} <span className="t-meta">…{t.token_hint}</span>
                  </td>
                  <td className="nowrap">{t.profile_id ? `🤖 ${profileName(t.profile_id)}` : '–'}</td>
                  <td>{t.scopes.map(s => SCOPE_LABEL[s] ?? s).join(' · ')}</td>
                  <td className="nowrap">{t.last_used_at ? relativeLabel(t.last_used_at) : '사용 전'}</td>
                  <td>
                    <Button kind="ghost" size="sm" disabled={busy} onClick={() => window.confirm(`'${t.name}' 키를 끊을까요? 이 키를 쓰는 에이전트는 더 이상 기록할 수 없습니다.`) && run(() => api.revokeAgentToken(t.id), '키를 끊었습니다.')}>
                      끊기
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row wrap">
        <Button kind="yellow" onClick={() => setCreating(true)}>
          <KeyRound size={13} /> 새 키 만들기
        </Button>
        <span className="t-cap">
          연동 방법: <Link to="/library?tab=agents">자료실 › 에이전트 연결 안내</Link>
        </span>
      </div>
      {creating && <NewKey onClose={() => setCreating(false)} />}
    </section>
  )
}

function NewKey({ onClose }: { onClose: () => void }) {
  const { api, profiles, toast } = useApp()
  const { busy, run } = useAction()
  const agents = profiles.filter(p => p.active && p.is_agent)
  const [name, setName] = useState('')
  const [profileId, setProfileId] = useState(agents[0]?.id ?? '')
  const [scopes, setScopes] = useState<AgentScope[]>(['read', 'research', 'contact', 'task', 'daily_report'])
  const [token, setToken] = useState<string | null>(null)
  const create = async () => {
    let raw = ''
    if (await run(async () => {
      raw = await api.createAgentToken(name.trim(), scopes, profileId || null)
    }, '키를 만들었습니다.'))
      setToken(raw)
  }
  const copy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      toast('복사했습니다. 에이전트 환경 변수 WKLY_ERP_AGENT_TOKEN 에 넣으세요.')
    } catch {
      toast('복사하지 못했습니다. 직접 선택해 복사하세요.')
    }
  }
  return (
    <Modal
      title={token ? '키가 만들어졌어요' : '에이전트 연결 키 만들기'}
      onClose={onClose}
      actions={
        token ? (
          <Button onClick={onClose}>닫기</Button>
        ) : (
          <>
            <Button kind="ghost" onClick={onClose}>
              취소
            </Button>
            <Button onClick={create} disabled={busy || !name.trim() || !scopes.length}>
              만들기
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="col gap-10">
          <div className="note warn">이 화면을 닫으면 키를 다시 볼 수 없습니다. 지금 복사해서 에이전트 쪽 비밀 설정(환경 변수)에 넣으세요. 채팅이나 메일로 보내지 마세요.</div>
          <div className="row">
            <input className="input grow" readOnly value={token} onFocus={e => e.target.select()} aria-label="새 키" style={{ fontFamily: 'var(--mono)' }} />
            <Button kind="outline" onClick={copy}>
              <Copy size={13} /> 복사
            </Button>
          </div>
          <span className="t-cap">
            필요한 값: WKLY_ERP_URL (Supabase 주소) · WKLY_ERP_ANON_KEY (공개 키) · WKLY_ERP_AGENT_TOKEN (이 키). 자세한 방법은 <Link to="/library?tab=agents">에이전트 연결 안내</Link>
          </span>
        </div>
      ) : (
        <div className="form-grid">
          <Field label="이름" className="full">
            <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="예) 프로젝트 총괄 매니저 · 팝업스케줄 리서치" />
          </Field>
          <Field label="연결할 AI 팀원" className="full">
            <select className="select" value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">연결 안 함 (리서치만 하는 에이전트)</option>
              {agents.map(p => (
                <option key={p.id} value={p.id}>
                  🤖 {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="full col gap-6">
            <span className="t-smallb">할 수 있는 일</span>
            <div className="row wrap" style={{ gap: 10 }}>
              {AGENT_SCOPES.map(s => (
                <label key={s} className="row t-cap" style={{ gap: 4 }}>
                  <input type="checkbox" checked={scopes.includes(s)} onChange={e => setScopes(e.target.checked ? [...scopes, s] : scopes.filter(x => x !== s))} />
                  {SCOPE_LABEL[s]}
                </label>
              ))}
            </div>
            {(scopes.includes('daily_report') || scopes.includes('task')) && !profileId && <span className="t-cap t-red">일일 보고·할 일 배정은 AI 팀원과 연결해야 이름으로 남습니다.</span>}
          </div>
        </div>
      )}
    </Modal>
  )
}

const BACKUP_GROUPS: [string, ExportTable[]][] = [
  ['업무 일지', ['work_logs']],
  ['프로젝트·할 일', ['projects', 'tasks']],
  ['거래처·담당자', ['clients', 'contacts']],
  ['결제', ['payments', 'project_finances', 'project_budget_lines']],
  ['승인', ['approvals']],
  ['리서치', ['research_items']],
  ['브랜드 담당자', ['brand_contacts']],
  ['채팅', ['chat_messages']],
]

function Backup() {
  const { api } = useApp()
  const { busy, run } = useAction()
  const stamp = () => {
    try {
      localStorage.setItem(BACKUP_KEY, todayKey())
    } catch {
      /* noop */
    }
  }
  const csv = (tables: ExportTable[]) =>
    run(async () => {
      for (const t of tables) {
        const rows = await api.exportTable(t)
        downloadText(`wkly-${t}-${todayKey()}.csv`, toCsv(rows))
        await new Promise(r => setTimeout(r, 300))
      }
      stamp()
    }, '내려받았습니다.')
  const all = () =>
    run(async () => {
      const out: Record<string, unknown> = { exported_at: new Date().toISOString() }
      for (const t of EXPORT_TABLES) out[t] = await api.exportTable(t).catch(() => [])
      downloadText(`wkly-erp-backup-${todayKey()}.json`, JSON.stringify(out, null, 1), 'application/json')
      stamp()
    }, '전체 백업 파일을 내려받았습니다.')
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">데이터 백업</span>
        <span className="cap">무료 플랜은 자동 백업이 없어요 · 월 1회 권장 · 내려받은 파일은 회사 드라이브에 보관</span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <Button onClick={all} disabled={busy}>
          <Download size={13} /> 전체 내려받기 (JSON)
        </Button>
        {BACKUP_GROUPS.map(([label, tables]) => (
          <Button key={label} kind="outline" onClick={() => csv(tables)} disabled={busy}>
            {label}
          </Button>
        ))}
      </div>
    </section>
  )
}

function Activity({ approvals, research }: { approvals: Approval[]; research: ResearchItem[] }) {
  const { profileName, profileOf } = useApp()
  const items = [
    ...approvals.map(a => ({ at: a.created_at, who: a.requested_by, text: `${a.kind === '일일 보고' ? '일일 보고 제출' : `${a.kind} 승인 요청`} · ${a.title}` })),
    ...approvals.filter(a => a.decided_at && a.decided_by).map(a => ({ at: a.decided_at!, who: a.decided_by, text: `${a.title} ${a.status}` })),
    ...research.map(r => ({ at: r.created_at, who: r.created_by, agent: r.collected_by_agent, text: `리서치 등록 · ${r.title}` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">최근 활동</span>
      </div>
      {items.length === 0 && <Empty>최근 활동이 없습니다.</Empty>}
      {items.map((it, i) => {
        const who = 'agent' in it && it.agent && !it.who ? `🤖 ${it.agent}` : profileOf(it.who)?.is_agent ? `🤖 ${profileName(it.who)}` : profileName(it.who)
        return (
          <div key={i} className="row t-small" style={{ padding: '2px 0' }}>
            <span className="t-meta" style={{ width: 70 }}>
              {toDateKey(it.at) === todayKey() ? timeLabel(it.at) : `${shortDate(toDateKey(it.at))} ${timeLabel(it.at)}`}
            </span>
            <span className="t-smallb" style={{ whiteSpace: 'nowrap' }}>
              {who}
            </span>
            <span className="truncate">{it.text}</span>
          </div>
        )
      })}
    </section>
  )
}
