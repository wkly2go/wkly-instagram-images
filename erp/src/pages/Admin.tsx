import { useDesktopOnly } from '../lib/attendance'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { EXPORT_TABLES, type ExportTable } from '../lib/api'
import { downloadText, toCsv } from '../lib/csv'
import { relativeLabel, shortDate, timeLabel, toDateKey, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import { AGENT_SCOPES, APPROVAL_KINDS, type AdminOverview, type AgentScope, type AgentToken, type Approval, type ApprovalKind, type ApprovalRoute, type Department, type Profile, type ResearchItem } from '../lib/types'
import { Meter } from '../components/charts'
import { Shell } from '../components/Shell'
import { PersonName } from '../components/Person'
import { Badge, Button, Empty, Field, Modal } from '../components/ui'

export const SCOPE_LABEL: Record<AgentScope, string> = { read: '현황 조회', task: '할 일', daily_report: '일일 보고', notify: '알림', research: '리서치', contact: '브랜드 담당자', finance: '재무 요약(합계만)' }
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
      <PmAgent tokens={data.tokens} approvals={data.approvals} />
      <Members />
      <DesktopAttendance />
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
  const { api, me, profiles, version } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: '', email: '', password: '', title: '', is_agent: false, dept: '' })
  const active = profiles.filter(p => p.active)
  const { data: depts } = useAsync(() => api.listDepartments(), [version], [] as Department[])
  const deptOf = (id: string) => depts.find(d => d.member_ids.includes(id)) ?? null
  /** 부서 바꾸기: 다른 부서에서는 빼고 고른 부서에 넣음 (한 사람은 한 부서) */
  const moveTo = async (personId: string, deptId: string) => {
    for (const d of depts) {
      const has = d.member_ids.includes(personId)
      if (d.id === deptId && !has) await api.saveDepartment({ ...d, member_ids: [...d.member_ids, personId] })
      else if (d.id !== deptId && has) await api.saveDepartment({ ...d, member_ids: d.member_ids.filter(x => x !== personId) })
    }
  }
  const add = async () => {
    if (!f.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) || f.password.length < 8) return
    const email = f.email.trim()
    const ok = await run(async () => {
      await api.createMember({ name: f.name.trim(), email, password: f.password, title: f.title.trim() || null, role: 'member', is_agent: f.is_agent })
      if (f.dept) {
        const p = (await api.listProfiles()).find(x => (x.email ?? '').toLowerCase() === email.toLowerCase())
        if (p) await moveTo(p.id, f.dept)
      }
    }, `${f.name.trim()} 님을 추가했습니다. 임시 비밀번호를 전달해 주세요.`)
    if (ok) setF({ name: '', email: '', password: '', title: '', is_agent: false, dept: '' })
  }
  const update = (p: Profile, patch: Partial<Pick<Profile, 'role' | 'active' | 'is_agent'>>, msg: string) => run(() => api.updateProfile(p.id, patch), msg)
  const [resetFor, setResetFor] = useState<Profile | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <section className="section">
      {resetFor && <ResetPassword p={resetFor} onClose={() => setResetFor(null)} />}
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
              <th>부서</th>
              <th>직함</th>
              <th>권한</th>
              <th>구분</th>
              <th>상태</th>
              <th>비밀번호</th>
              <th>삭제</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const self = p.id === me.id
              return (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td className="nowrap">
                    <span className="row" style={{ gap: 6 }}>
                      {renaming === p.id ? (
                        <input
                          className="input"
                          style={{ width: 120, padding: '2px 6px' }}
                          autoFocus
                          defaultValue={p.name}
                          maxLength={40}
                          aria-label={`${p.name} 새 이름`}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur()
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            setRenaming(null)
                            if (v && v !== p.name) run(() => api.updateProfile(p.id, { name: v }), `이름을 '${v}'(으)로 바꿨습니다.`)
                          }}
                        />
                      ) : (
                        <>
                          <PersonName id={p.id} />
                          <button type="button" className="icon-btn sm" onClick={() => setRenaming(p.id)} disabled={busy} aria-label={`${p.name} 이름 바꾸기`} title="이름 바꾸기">
                            <Pencil size={12} />
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="nowrap">{p.email ?? '–'}</td>
                  <td>
                    <select
                      className="select"
                      style={{ padding: '2px 6px', fontSize: 12, width: 110 }}
                      value={deptOf(p.id)?.id ?? ''}
                      disabled={busy || !depts.length}
                      onChange={e => run(() => moveTo(p.id, e.target.value), e.target.value ? `${p.name} 님을 ${depts.find(d => d.id === e.target.value)?.name ?? ''} 부서로 옮겼습니다.` : `${p.name} 님을 부서에서 뺐습니다.`)}
                      aria-label={`${p.name} 부서`}
                      title={depts.length ? '부서 선택' : '프로젝트 › 조직 현황에서 부서를 먼저 만들어 주세요'}
                    >
                      <option value="">미지정</option>
                      {depts.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
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
                  <td>
                    {!p.is_agent && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setResetFor(p)}>
                        재설정
                      </button>
                    )}
                  </td>
                  <td>
                    {!self && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm del-btn"
                        disabled={busy || p.role === 'admin'}
                        title={p.role === 'admin' ? '관리자는 먼저 멤버로 바꾼 뒤 삭제할 수 있습니다' : '계정 삭제'}
                        onClick={() =>
                          window.confirm(`${p.name} 님 계정을 삭제할까요?\n\n로그인할 수 없게 되고 되돌릴 수 없습니다. 업무 기록·결제 등은 남고 작성자는 '알 수 없음'으로 표시됩니다.\n잠시 쉬는 경우에는 '활성'을 눌러 비활성화하세요.`) &&
                          run(() => api.deleteMember(p.id), `${p.name} 님 계정을 삭제했습니다.`)
                        }
                      >
                        삭제
                      </button>
                    )}
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
        <select className="select" style={{ flex: '1 1 110px' }} value={f.dept} onChange={e => setF({ ...f, dept: e.target.value })} aria-label="부서">
          <option value="">부서 (미지정)</option>
          {depts.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <input className="input" style={{ flex: '1 1 90px' }} placeholder="직함" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} aria-label="직함" />
        <select className="select" style={{ width: 80 }} value={f.is_agent ? 'ai' : 'human'} onChange={e => setF({ ...f, is_agent: e.target.value === 'ai' })} aria-label="구분">
          <option value="human">사람</option>
          <option value="ai">AI</option>
        </select>
        <Button onClick={add} disabled={busy || !f.name.trim() || !f.email.trim() || f.password.length < 8}>
          팀원 추가
        </Button>
      </div>
      <span className="t-cap">AI 팀원(예: WKLY 총괄)은 로그인하지 않고 아래 '에이전트 연결 키'로 일일 보고·할 일 배정을 합니다. 계정은 이름 표시와 기록용입니다.</span>
    </section>
  )
}

/** 로그인 못 하는 팀원: 관리자가 임시 비밀번호를 정해 본인에게 전달 → 본인은 팀 › 내 정보에서 바꿈 */
function ResetPassword({ p, onClose }: { p: Profile; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [pw, setPw] = useState(tempPassword)
  const [done, setDone] = useState(false)
  const submit = async () => {
    if (await run(() => api.resetMemberPassword(p.id, pw), `${p.name} 님 비밀번호를 바꿨습니다.`)) setDone(true)
  }
  return (
    <Modal
      title={`${p.name} 님 비밀번호 재설정`}
      onClose={onClose}
      actions={
        done ? (
          <Button onClick={onClose}>닫기</Button>
        ) : (
          <>
            <Button kind="ghost" onClick={onClose}>
              취소
            </Button>
            <Button disabled={busy || pw.length < 8} onClick={submit}>
              재설정
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="col gap-6">
          <span className="t-body">아래 내용을 {p.name} 님에게만 전달하세요.</span>
          <div className="note">
            이메일 <b className="t-blue">{p.email}</b>
            <br />
            임시 비밀번호 <b className="t-blue">{pw}</b>
          </div>
          <span className="t-cap">로그인한 뒤 팀·근태 › 내 정보에서 본인 비밀번호로 바꾸도록 안내해 주세요.</span>
        </div>
      ) : (
        <>
          <Field label="로그인 이메일">
            <input className="input" value={p.email ?? ''} readOnly />
          </Field>
          <Field label="임시 비밀번호 (8자 이상)">
            <input className="input" type="text" autoComplete="off" value={pw} onChange={e => setPw(e.target.value)} />
          </Field>
          <span className="t-cap">지금 비밀번호는 바로 바뀝니다. 이 사람의 다른 기기 로그인은 유지됩니다.</span>
        </>
      )}
    </Modal>
  )
}

/** 읽고 전달하기 쉬운 임시 비밀번호: wkly- + 헷갈리는 글자(0/o, 1/l) 뺀 8자 */
function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return 'wkly-' + Array.from(b, x => chars[x % chars.length]).join('')
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
          새 키 만들기
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
  const { api, profiles } = useApp()
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
        <TokenReveal token={token} />
      ) : (
        <div className="form-grid">
          <Field label="이름" className="full">
            <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="예) WKLY 총괄 · 팝업스케줄 리서치" />
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

/** 한 번만 보이는 키 + 에이전트 쪽 설정값 */
function TokenReveal({ token }: { token: string }) {
  const { api, toast } = useApp()
  const url = api.mode === 'supabase' ? (import.meta.env.VITE_SUPABASE_URL as string) : 'https://<프로젝트>.supabase.co'
  const anon = api.mode === 'supabase' ? (import.meta.env.VITE_SUPABASE_ANON_KEY as string) : '<Supabase 공개 키>'
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} 복사했습니다.`)
    } catch {
      toast('복사하지 못했습니다. 직접 선택해 복사하세요.')
    }
  }
  const rows: [string, string, boolean][] = [
    ['WKLY_ERP_AGENT_TOKEN', token, true],
    ['WKLY_ERP_URL', url, false],
    ['WKLY_ERP_ANON_KEY', anon, false],
  ]
  // Claude 환경 설정의 '환경 변수' 칸에 그대로 붙여 넣는 세 줄 (.env 형식)
  const envBlock = `WKLY_ERP_URL=${url}\nWKLY_ERP_ANON_KEY=${anon}\nWKLY_ERP_AGENT_TOKEN=${token}`
  return (
    <div className="col gap-10">
      <div className="note warn">이 화면을 닫으면 키를 다시 볼 수 없습니다. 지금 복사해서 에이전트 실행 환경의 비밀값에만 넣으세요. 채팅·메일·문서에 붙여 넣지 마세요.</div>
      <div className="box col gap-6" style={{ background: 'var(--white)' }}>
        <span className="t-smallb">가장 쉬운 방법: 세 줄을 한 번에 복사</span>
        <Button onClick={() => copy(envBlock, '환경 변수 세 줄을')}>
          환경 변수 세 줄 한 번에 복사
        </Button>
        <span className="t-cap">Claude 클라우드 환경 › Edit › '환경 변수' 칸의 내용을 모두 지우고 그대로 붙여 넣은 뒤 저장하세요. 따로 고칠 것은 없습니다.</span>
      </div>
      {rows.map(([k, v, secret]) => (
        <div key={k} className="col gap-2">
          <span className="t-meta">
            {k}
            {secret ? ' · 비밀' : ' · 공개 값'}
          </span>
          <div className="row">
            <input className="input grow" readOnly value={v} onFocus={e => e.target.select()} aria-label={k} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
            <Button kind="outline" size="sm" onClick={() => copy(v, k)}>
              복사
            </Button>
          </div>
        </div>
      ))}
      <div className="box col gap-2" style={{ background: 'var(--white)' }}>
        <span className="t-smallb">에이전트 쪽에서 할 일</span>
        <span className="t-cap">1. 에이전트가 도는 Claude 클라우드 환경 설정(세션 제목줄의 환경 메뉴 › Edit)에서 위 세 값을 이름 그대로 환경 변수로 넣습니다.</span>
        <span className="t-cap">2. 같은 화면 Network access 를 Limited 로 두고 Allowed domains 에 {host} 를 추가합니다 (Allow package managers 체크는 그대로).</span>
        <span className="t-cap">
          3. Claude에게 "WKLY 총괄 ERP 루틴 만들어줘"라고 요청하면 아침 배정·저녁 일일 보고 예약 작업을 만듭니다. 형식은 <Link to="/library?tab=agents">에이전트 연결 안내</Link>
        </span>
      </div>
    </div>
  )
}

const PM_SCOPES: AgentScope[] = ['read', 'task', 'daily_report', 'notify', 'research', 'finance']

function randomPassword(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return `${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, '').slice(0, 26)}Aa9!`
}

/** WKLY 총괄(AI 프로젝트 총괄) 등록: AI 팀원 계정 + 연결 키를 한 번에 */
function PmAgent({ tokens, approvals }: { tokens: AgentToken[]; approvals: Approval[] }) {
  const { api, profiles } = useApp()
  const { busy, run } = useAction()
  const agent = profiles.find(p => p.is_agent && p.active && /총괄/.test(`${p.name} ${p.title ?? ''}`))
  const keys = agent ? tokens.filter(t => t.profile_id === agent.id && !t.revoked_at) : []
  const lastUsed = keys
    .map(k => k.last_used_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop()
  const lastReport = agent ? approvals.filter(a => a.kind === '일일 보고' && a.requested_by === agent.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : undefined
  const [name, setName] = useState('WKLY 총괄')
  const [email, setEmail] = useState('agent@thewklyn.com')
  const [token, setToken] = useState<string | null>(null)
  const register = async () => {
    let raw = ''
    const mail = email.trim().toLowerCase()
    const ok = await run(async () => {
      let list = await api.listProfiles()
      let p = list.find(x => x.email?.toLowerCase() === mail)
      if (p) await api.updateProfile(p.id, { is_agent: true, name: name.trim(), title: '프로젝트 총괄 (AI)' })
      else {
        await api.createMember({ email: mail, password: randomPassword(), name: name.trim(), title: '프로젝트 총괄 (AI)', role: 'member', is_agent: true })
        list = await api.listProfiles()
        p = list.find(x => x.email?.toLowerCase() === mail)
        if (!p) throw new Error('계정은 만들었지만 프로필을 찾지 못했습니다. 새로 고침 후 다시 눌러 주세요.')
      }
      raw = await api.createAgentToken(`${name.trim()} · ERP`, PM_SCOPES, p.id)
    }, `${name.trim()}을(를) AI 팀원으로 등록하고 연결 키를 만들었습니다.`)
    if (ok) setToken(raw)
  }
  const newKey = async () => {
    if (!agent) return
    let raw = ''
    if (await run(async () => {
      raw = await api.createAgentToken(`${agent.name} · ERP`, PM_SCOPES, agent.id)
    }, '새 연결 키를 만들었습니다. 예전 키는 아래 목록에서 끊어 주세요.'))
      setToken(raw)
  }
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">WKLY 총괄 (AI 프로젝트 총괄)</span>
        <span className="cap">아침에 할 일 배정 · 저녁 일일 보고 · 재무 위험 요약</span>
      </div>
      {agent ? (
        <div className="box row wrap" style={{ background: 'var(--white)', gap: 10 }}>
          <span className="col gap-2 grow">
            <span className="row" style={{ gap: 6 }}>
              <span className="t-bodyb">{agent.name}</span>
              <Badge tone="acid">AI 팀원</Badge>
              {keys.length === 0 ? <Badge tone="red">키 없음</Badge> : lastUsed ? <Badge tone="acid">연결됨</Badge> : <Badge tone="yellow">연결 대기</Badge>}
            </span>
            <span className="t-cap">
              {agent.title ?? ''} · {agent.email ?? ''} · 키 {keys.length}개{lastUsed ? ` · 마지막 사용 ${relativeLabel(lastUsed)}` : ''}
              {lastReport ? ` · 마지막 일일 보고 ${relativeLabel(lastReport.created_at)}` : ' · 일일 보고 아직 없음'}
            </span>
          </span>
          <Button kind={keys.length ? 'outline' : 'yellow'} disabled={busy} onClick={newKey}>
            {keys.length ? '키 새로 만들기' : '연결 키 만들기'}
          </Button>
        </div>
      ) : (
        <div className="box col gap-6" style={{ background: 'var(--white)' }}>
          <span className="t-small">
            로그인하지 않는 AI 팀원 계정을 만들고 연결 키를 함께 발급합니다. 할 수 있는 일: {PM_SCOPES.map(s => SCOPE_LABEL[s]).join(' · ')} (계좌·개인 이름은 보지 못함)
          </span>
          <div className="row wrap">
            <input className="input" style={{ flex: '1 1 120px' }} value={name} onChange={e => setName(e.target.value)} aria-label="AI 팀원 이름" />
            <input className="input" style={{ flex: '2 1 200px' }} type="email" value={email} onChange={e => setEmail(e.target.value)} aria-label="AI 팀원 이메일 (로그인용 아님)" />
            <Button kind="yellow" disabled={busy || !name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} onClick={register}>
              등록하기
            </Button>
          </div>
          <span className="t-cap">이메일은 계정 구분용입니다(메일을 받지 않아도 됨). 팀원 추가 기능(Edge Function)이 꺼져 있으면, Supabase › Authentication › Add user 로 같은 이메일 계정을 먼저 만든 뒤 다시 누르세요.</span>
        </div>
      )}
      {token && (
        <Modal title="WKLY 총괄 연결 키" onClose={() => setToken(null)} actions={<Button onClick={() => setToken(null)}>닫기</Button>}>
          <TokenReveal token={token} />
        </Modal>
      )}
    </section>
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

/** 근태: 출근을 PC 프로그램 접속으로만 인정할지 */
function DesktopAttendance() {
  const { api, bump } = useApp()
  const { busy, run } = useAction()
  const { data: on, reload } = useDesktopOnly()
  const toggle = () =>
    run(async () => {
      await api.setDesktopOnly(!on)
      reload()
      bump()
    }, !on ? '이제 PC 프로그램으로 접속해야 출근으로 기록됩니다.' : '브라우저 · 휴대폰 접속도 출근으로 기록됩니다.')
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">출근 기록 방식</span>
        <span className="cap">휴대폰 · 브라우저 접속은 어느 쪽이든 근태 화면에 '외부 접속'으로 따로 보입니다</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone={on ? 'blue' : 'outline'}>{on ? 'PC 프로그램 접속만 출근' : '모든 접속을 출근으로'}</Badge>
        <Button kind={on ? 'outline' : 'blue'} size="sm" onClick={toggle} disabled={busy}>
          {on ? '모든 접속을 출근으로 바꾸기' : 'PC 프로그램 접속만 출근으로 바꾸기'}
        </Button>
        <Link to="/download" className="t-cap">
          PC 프로그램 내려받기 ›
        </Link>
      </div>
      <span className="t-cap">팀원 모두 PC 프로그램을 설치한 뒤 'PC 프로그램 접속만 출근'으로 바꾸세요. 설치 전에 바꾸면 모두 미출근으로 보입니다.</span>
    </section>
  )
}

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
          전체 내려받기 (JSON)
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
