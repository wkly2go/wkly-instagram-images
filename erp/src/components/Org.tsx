import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { AgentJob, Department, Project, Task } from '../lib/types'
import { Badge, Button, Chip, Empty, Field, Modal, SectionHead } from './ui'
import { ask } from './Ask'

const S_COLOR: Record<string, string> = { 진행: 'var(--blue)', 기획: 'var(--pink)', NIC: 'var(--green)', 보류: 'var(--gray)' }

interface Prog {
  p: Project
  total: number
  done: number
  doing: number
  people: string[]
}

/** 프로젝트 진행률 = 완료 업무 / 전체 업무 */
function progressOf(projects: Project[], tasks: Task[]): Prog[] {
  return projects
    .filter(p => p.status !== '완료')
    .map(p => {
      const list = tasks.filter(t => t.project_id === p.id)
      const people = [...new Set([p.owner_id, ...list.map(t => t.assignee_id)].filter((x): x is string => !!x))]
      return { p, total: list.length, done: list.filter(t => t.status === '완료').length, doing: list.filter(t => t.status === '진행 중').length, people }
    })
}

/** 진행 막대: 완료(진한색) + 진행 중(옅은색) */
function ProgBar({ g }: { g: Prog }) {
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0
  const doing = g.total ? (g.doing / g.total) * 100 : 0
  const color = S_COLOR[g.p.status] ?? 'var(--blue)'
  return (
    <span className="org-bar" title={`완료 ${g.done} · 진행 중 ${g.doing} · 전체 ${g.total}`}>
      <span className="track">
        <i style={{ width: `${pct}%`, background: color }} />
        <i style={{ width: `${doing}%`, background: color, opacity: 0.35 }} />
      </span>
      <span className="t-smallb num">{g.total ? `${pct}%` : '업무 없음'}</span>
    </span>
  )
}

function ProjectRow({ g }: { g: Prog }) {
  const { profileName } = useApp()
  const today = todayKey()
  const late = !!g.p.end_date && g.p.end_date < today
  return (
    <div className="org-prow">
      <Link to={`/projects?id=${g.p.id}`} className="t-small truncate org-pname" title={g.p.name}>
        <i className="ad-dot" style={{ background: S_COLOR[g.p.status] ?? 'var(--gray)' }} /> {g.p.name}
      </Link>
      <ProgBar g={g} />
      <span className={`t-meta org-pdue${late ? ' t-red' : ''}`}>{g.p.end_date ? `${late ? '지남 ' : '~'}${shortDate(g.p.end_date)}` : g.p.status}</span>
      <span className="org-people">
        {g.people.slice(0, 4).map(id => (
          <span key={id} className="t-cap">{profileName(id)}</span>
        ))}
      </span>
    </div>
  )
}

/** 조직: 부서 · 주요 업무 · 구성원(사람 · AI 구분 없음) · 맡은 프로젝트 진행 그래프 */
export function OrgSection() {
  const { api, me, version, profiles, profileName } = useApp()
  const admin = me.role === 'admin'
  const { data } = useAsync(
    async () => {
      const [departments, projects, tasks, jobs] = await Promise.all([api.listDepartments(), api.listProjects(), api.listTasks(), admin ? api.listAgentJobs() : Promise.resolve([] as AgentJob[])])
      return { departments, projects, tasks, jobs: jobs.filter(j => !j.removed && j.enabled) }
    },
    [version, admin],
    { departments: [] as Department[], projects: [] as Project[], tasks: [] as Task[], jobs: [] as AgentJob[] },
  )
  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const progs = useMemo(() => progressOf(data.projects, data.tasks), [data.projects, data.tasks])
  const active = progs.filter(g => g.p.status !== '보류').sort((a, b) => (b.total ? b.done / b.total : -1) - (a.total ? a.done / a.total : -1))
  const today = todayKey()
  const openOf = (id: string) => data.tasks.filter(t => t.assignee_id === id && t.status !== '완료')
  const groups = [...new Set(data.jobs.map(j => j.group_name))]
  const counts = { 진행: progs.filter(g => g.p.status === '진행').length, 기획: progs.filter(g => g.p.status === '기획').length, NIC: progs.filter(g => g.p.status === 'NIC').length, 보류: progs.filter(g => g.p.status === '보류').length }
  const totalTasks = active.reduce((n, g) => n + g.total, 0)
  const doneTasks = active.reduce((n, g) => n + g.done, 0)

  return (
    <>
      <SectionHead title="진행 중인 프로젝트" count={active.length} right={<span className="t-cap">진행률 = 완료 업무 ÷ 전체 업무 · 옅은 부분은 진행 중</span>} />
      <div className="kpis kpis-4">
        <div className="kpi">
          <span className="t-cap">진행</span>
          <span className="v">{counts.진행}</span>
          <span className="sub">기획 {counts.기획} · NIC {counts.NIC}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">전체 업무 진행률</span>
          <span className="v">{totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0}%</span>
          <span className="sub">
            완료 {doneTasks} / {totalTasks}
          </span>
        </div>
        <div className="kpi">
          <span className="t-cap">남은 업무</span>
          <span className="v">{data.tasks.filter(t => t.status !== '완료').length}</span>
          <span className="sub">지연 {data.tasks.filter(t => t.status !== '완료' && t.due_date && t.due_date < today).length}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">보류</span>
          <span className="v">{counts.보류}</span>
          <span className="sub">담당자 없는 프로젝트 {progs.filter(g => !g.p.owner_id).length}</span>
        </div>
      </div>
      {active.length === 0 ? <Empty>진행 중인 프로젝트가 없습니다.</Empty> : <div className="org-plist">{active.map(g => <ProjectRow key={g.p.id} g={g} />)}</div>}

      <SectionHead
        title="부서 · 주요 업무"
        count={data.departments.length}
        right={
          admin ? (
            <Button kind="outline" size="sm" onClick={() => setEditing('new')}>
              부서 추가
            </Button>
          ) : undefined
        }
      />
      {data.departments.length === 0 && <Empty>아직 부서가 없습니다.</Empty>}
      <div className="org-depts">
        {data.departments.map(d => {
          const mine = progs.filter(g => g.people.some(id => d.member_ids.includes(id)))
          const jobs = data.jobs.filter(j => d.agent_groups.includes(j.group_name))
          const load = d.member_ids.map(id => ({ id, open: openOf(id) }))
          const maxLoad = Math.max(1, ...load.map(l => l.open.length))
          return (
            <section key={d.id} className="org-dept">
              <div className="row">
                <span className="t-bodyb grow">{d.name}</span>
                {d.lead_id && <span className="t-cap">책임 {profileName(d.lead_id)}</span>}
                {admin && (
                  <button type="button" className="icon-btn" onClick={() => setEditing(d)} aria-label={`${d.name} 고치기`}>
                    <Pencil size={13} />
                  </button>
                )}
              </div>
              {d.duties && (
                <ul className="org-duties">
                  {d.duties
                    .split('\n')
                    .filter(Boolean)
                    .map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                </ul>
              )}
              <span className="t-cap">구성원 · 남은 업무</span>
              <div className="col gap-2">
                {load.map(({ id, open }) => {
                  const late = open.filter(t => t.due_date && t.due_date < today).length
                  return (
                    <Link key={id} to={`/work?user=${id}`} className="org-load" title={`${profileName(id)} 남은 업무 ${open.length}${late ? ` · 지연 ${late}` : ''}`}>
                      <span className="t-small truncate">{profileName(id)}</span>
                      <span className="track">
                        <i style={{ width: `${(open.length / maxLoad) * 100}%` }} />
                        {late > 0 && <i className="late" style={{ width: `${(late / maxLoad) * 100}%` }} />}
                      </span>
                      <span className="t-meta num">{open.length}</span>
                    </Link>
                  )
                })}
                {jobs.map(j => (
                  <span key={j.trigger_id} className="org-load" title={j.last_summary ?? j.name}>
                    <span className="t-small truncate">{j.name.replace(/^WKLY\s*/, '')}</span>
                    <span className="t-meta">{j.schedule_label ?? ''}</span>
                  </span>
                ))}
                {load.length === 0 && jobs.length === 0 && <span className="t-cap">구성원 없음</span>}
              </div>
              <span className="t-cap">맡은 프로젝트 {mine.length}</span>
              {mine.length ? <div className="col gap-2">{mine.map(g => <ProjectRow key={g.p.id} g={g} />)}</div> : <span className="t-cap">없음</span>}
            </section>
          )
        })}
      </div>
      {editing && <DeptModal dept={editing === 'new' ? null : editing} groups={groups} profiles={profiles.filter(p => p.active)} onClose={() => setEditing(null)} />}
    </>
  )
}

function DeptModal({ dept, groups, profiles, onClose }: { dept: Department | null; groups: string[]; profiles: { id: string; name: string }[]; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: dept?.name ?? '', duties: dept?.duties ?? '', lead_id: dept?.lead_id ?? '', member_ids: dept?.member_ids ?? [], agent_groups: dept?.agent_groups ?? [], sort: dept?.sort ?? 9 })
  const toggle = (k: 'member_ids' | 'agent_groups', v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] })
  const save = async () => {
    if (await run(() => api.saveDepartment({ id: dept?.id, name: f.name.trim(), duties: f.duties.trim() || null, lead_id: f.lead_id || null, member_ids: f.member_ids, agent_groups: f.agent_groups, sort: Number(f.sort) || 0 }), '저장했습니다.')) onClose()
  }
  const remove = async () => {
    if (dept && (await ask(`'${dept.name}' 부서를 삭제할까요?`)) && (await run(() => api.deleteDepartment(dept.id), '삭제했습니다.'))) onClose()
  }
  return (
    <Modal
      title={dept ? '부서 고치기' : '부서 추가'}
      onClose={onClose}
      actions={
        <>
          {dept && (
            <Button kind="ghost" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
              삭제
            </Button>
          )}
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !f.name.trim()}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="부서 이름">
          <input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={40} autoFocus />
        </Field>
        <Field label="순서">
          <input className="input" type="number" value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} />
        </Field>
        <Field label="주요 업무 (한 줄에 하나)" className="full">
          <textarea className="textarea" rows={5} value={f.duties} onChange={e => setF({ ...f, duties: e.target.value })} />
        </Field>
        <Field label="책임자">
          <select className="select" value={f.lead_id} onChange={e => setF({ ...f, lead_id: e.target.value })}>
            <option value="">없음</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="label full" role="group" aria-label="구성원">
          <span>구성원</span>
          <div className="chips">
            {profiles.map(p => (
              <Chip key={p.id} active={f.member_ids.includes(p.id)} onClick={() => toggle('member_ids', p.id)}>
                {p.name}
              </Chip>
            ))}
          </div>
        </div>
        {groups.length > 0 && (
          <div className="label full" role="group" aria-label="자동 업무 묶음">
            <span>자동 업무 (예약 작업 묶음)</span>
            <div className="chips">
              {groups.map(g => (
                <Chip key={g} active={f.agent_groups.includes(g)} onClick={() => toggle('agent_groups', g)}>
                  {g}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
      {!dept && <Badge tone="paper">저장 후 팀 탭 조직에 바로 보입니다</Badge>}
    </Modal>
  )
}
