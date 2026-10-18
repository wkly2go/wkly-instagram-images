import { useMemo, useRef, useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { shortDate, timeLabel, todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { Client, Contact, ExchangeFile, Project, ProjectContact, WorkLog } from '../lib/types'
import { Badge, Button, Chip, Field, KindBadge, SectionHead } from './ui'
import { Board, type BoardCol } from './Board'

const fmtSize = (n: number | null) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/**
 * 연락 이력 (업무 일지): 언제 · 무엇을 · 어떤 프로젝트로
 *  - 메일 상대 주소가 등록된 담당자면 서버가 자동으로 그 사람에게 연결하고, AI 총괄이 매일 아침 메일을 읽어 채움
 */
export function ContactTimeline({ logs, projects, showContact, contacts }: { logs: WorkLog[]; projects: Project[]; showContact?: boolean; contacts?: Contact[] }) {
  const { profileName } = useApp()
  const pname = (id: string | null) => (id ? projects.find(p => p.id === id)?.name : undefined)
  const cname = (l: WorkLog) => (l.contact_id ? contacts?.find(c => c.id === l.contact_id)?.name : undefined) ?? l.email_counterpart ?? undefined
  const cols: BoardCol<WorkLog>[] = [
    { key: 'when', label: '날짜', width: 100, cell: l => <span className="t-meta">{shortDate(l.log_date)} {timeLabel(l.created_at)}</span> },
    { key: 'kind', label: '구분', width: 76, cell: l => <KindBadge kind={l.kind} /> },
    ...(showContact ? [{ key: 'who', label: '상대', width: 110, cell: (l: WorkLog) => cname(l) ?? '-' } as BoardCol<WorkLog>] : []),
    {
      key: 'content',
      label: '내용',
      kind: 'title',
      cell: l => (
        <>
          {l.email_subject && <span className="t-smallb">{l.email_subject}</span>}
          <span className={`cell-pre t-small t-blue${l.email_subject ? ' cell-sub' : ''}`}>{l.content}</span>
        </>
      ),
    },
    { key: 'project', label: '프로젝트', width: 150, hideNarrow: true, cell: l => (l.project_id && pname(l.project_id) ? <Link to={`/projects?id=${l.project_id}`}>{pname(l.project_id)}</Link> : '-') },
    { key: 'user', label: '담당', width: 72, cell: l => profileName(l.user_id) },
  ]
  return <Board rows={logs} cols={cols} rowKey={l => l.id} compact empty="연락 기록이 아직 없습니다. 업무 일지에서 메일 · 전화 · 미팅을 기록하거나, 메일 상대 주소가 등록된 담당자면 AI 총괄이 매일 아침 자동으로 채웁니다." />
}

/** 주고받은 자료: 파일 또는 링크 · 받음/보냄 · 어느 사람 · 어느 프로젝트 */
export function ExchangeFilesSection({ clientId, contactId, projectId, contacts, projects, title = '주고받은 자료' }: { clientId: string | null; contactId?: string | null; projectId?: string | null; contacts: Contact[]; projects: Project[]; title?: string }) {
  const { api, me, version, profileName } = useApp()
  const { busy, run } = useAction()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ExchangeFile | null>(null)
  const { data: files } = useAsync(() => api.listExchangeFiles({ clientId: contactId || projectId ? undefined : clientId ?? undefined, contactId: contactId ?? undefined, projectId: projectId ?? undefined }), [version, clientId, contactId, projectId], [] as ExchangeFile[])
  const open = async (f: ExchangeFile) => {
    const url = await api.exchangeFileUrl(f)
    if (url) window.open(url, '_blank', 'noopener')
  }
  const byProject = (id: string | null) => (id ? projects.find(p => p.id === id)?.name : undefined)
  const byContact = (id: string | null) => (id ? contacts.find(c => c.id === id)?.name : undefined)
  return (
    <div className="col gap-6">
      <SectionHead
        title={title}
        count={files.length ? String(files.length) : undefined}
        right={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(v => !v)}>
            {adding ? '닫기' : '+ 자료'}
          </button>
        }
      />
      {editing && <ExchangeFileEdit key={editing.id} f={editing} projects={projects} onDone={() => setEditing(null)} />}
      {adding && <ExchangeFileForm clientId={clientId} contactId={contactId ?? null} projectId={projectId ?? null} contacts={contacts} projects={projects} onDone={() => setAdding(false)} />}
      <Board<ExchangeFile>
        rows={files}
        rowKey={f => f.id}
        compact
        empty="주고받은 자료가 없습니다. 메일 첨부는 AI 총괄이 매일 아침 자동으로 모으고, 직접 올리려면 + 자료."
        cols={[
          { key: 'date', label: '날짜', width: 70, cell: f => <span className="t-meta">{shortDate(f.file_date)}</span> },
          { key: 'dir', label: '구분', width: 56, cell: f => <Badge tone={f.direction === '받음' ? 'yellow' : 'outline'}>{f.direction}</Badge> },
          {
            key: 'name',
            label: '자료',
            kind: 'title',
            cell: f => (
              <>
                <button type="button" className="link-btn t-smallb" onClick={() => open(f)} title={f.name}>
                  {f.name}
                </button>
                {f.note && <span className="cell-sub">{f.note}</span>}
              </>
            ),
          },
          { key: 'size', label: '크기', width: 64, kind: 'num', hideNarrow: true, cell: f => fmtSize(f.size) || '-' },
          ...(!contactId ? [{ key: 'who', label: '상대', width: 90, cell: (f: ExchangeFile) => byContact(f.contact_id) ?? '-' } as BoardCol<ExchangeFile>] : []),
          ...(!projectId ? [{ key: 'proj', label: '프로젝트', width: 140, hideNarrow: true, cell: (f: ExchangeFile) => (f.project_id ? <Link to={`/projects?id=${f.project_id}`}>{byProject(f.project_id)}</Link> : '-') } as BoardCol<ExchangeFile>] : []),
          { key: 'src', label: '등록', width: 70, cell: f => (f.source === '직접' ? profileName(f.created_by) : f.source) },
          {
            key: 'act',
            label: '',
            width: 84,
            kind: 'center',
            cell: f =>
              f.created_by === me.id || me.role === 'admin' ? (
                <span className="row" style={{ gap: 6, justifyContent: 'center' }}>
                  <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => setEditing(f)}>
                    수정
                  </button>
                  <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => window.confirm(`'${f.name}' 자료 기록을 지울까요?`) && run(() => api.deleteExchangeFile(f.id), '지웠습니다.')}>
                    지우기
                  </button>
                </span>
              ) : null,
          },
        ]}
      />
    </div>
  )
}

/** 주고받은 자료 고치기 (올린 사람 · 관리자) */
function ExchangeFileEdit({ f, projects, onDone }: { f: ExchangeFile; projects: Project[]; onDone: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [d, setD] = useState({ name: f.name, note: f.note ?? '', direction: f.direction, date: f.file_date, project: f.project_id ?? '' })
  const save = async () => {
    if (!d.name.trim()) return
    const ok = await run(() => api.updateExchangeFile(f.id, { name: d.name.trim(), note: d.note.trim() || null, direction: d.direction, file_date: d.date, project_id: d.project || null }), '고쳤습니다.')
    if (ok) onDone()
  }
  return (
    <div className="box col gap-8" style={{ background: 'var(--white)' }}>
      <div className="chips">
        {(['받음', '보냄'] as const).map(k => (
          <Chip key={k} active={d.direction === k} onClick={() => setD({ ...d, direction: k })}>
            {k}
          </Chip>
        ))}
      </div>
      <Field label="자료 이름">
        <input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="메모">
        <input className="input" value={d.note} onChange={e => setD({ ...d, note: e.target.value })} />
      </Field>
      <div className="row gap-8">
        <Field label="날짜" className="grow">
          <input className="input" type="date" value={d.date} onChange={e => e.target.value && setD({ ...d, date: e.target.value })} />
        </Field>
        <Field label="프로젝트" className="grow">
          <select className="select" value={d.project} onChange={e => setD({ ...d, project: e.target.value })}>
            <option value="">없음</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row gap-6" style={{ justifyContent: 'flex-end' }}>
        <Button kind="ghost" size="sm" onClick={onDone}>
          취소
        </Button>
        <Button size="sm" disabled={busy || !d.name.trim()} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  )
}

function ExchangeFileForm({ clientId, contactId, projectId, contacts, projects, onDone }: { clientId: string | null; contactId: string | null; projectId: string | null; contacts: Contact[]; projects: Project[]; onDone: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState({ direction: '받음' as '받음' | '보냄', url: '', name: '', note: '', date: todayKey(), contact: contactId ?? '', project: projectId ?? '' })
  const client = clientId ?? contacts.find(c => c.id === f.contact)?.client_id ?? projects.find(p => p.id === f.project)?.client_id ?? null
  const submit = async () => {
    const file = fileRef.current?.files?.[0]
    const ok = await run(() => api.addExchangeFile({ client_id: client, contact_id: f.contact || null, project_id: f.project || null, direction: f.direction, note: f.note, file_date: f.date, file, url: f.url, name: f.name }), '자료를 등록했습니다.')
    if (ok) onDone()
  }
  return (
    <div className="box col gap-8" style={{ background: 'var(--white)' }}>
      <div className="chips">
        {(['받음', '보냄'] as const).map(d => (
          <Chip key={d} active={f.direction === d} onClick={() => setF({ ...f, direction: d })}>
            {d}
          </Chip>
        ))}
        <input className="input" type="date" style={{ width: 150 }} value={f.date} onChange={e => e.target.value && setF({ ...f, date: e.target.value })} aria-label="날짜" />
      </div>
      <div className="form-grid">
        <Field label="파일 (50MB 까지)">
          <input ref={fileRef} className="input" type="file" />
        </Field>
        <Field label="또는 링크 (드라이브 · 위트랜스퍼 등)">
          <input className="input" type="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="자료 이름 (비우면 파일 이름)">
          <input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={200} />
        </Field>
        <Field label="메모">
          <input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} maxLength={1000} placeholder="예: 1차 도면 · 수정 요청 반영" />
        </Field>
        {!contactId && (
          <Field label="상대 담당자">
            <select className="input" value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })}>
              <option value="">선택 안 함</option>
              {contacts.filter(c => !clientId || c.client_id === clientId).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.title ?? ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!projectId && (
          <Field label="프로젝트">
            <select className="input" value={f.project} onChange={e => setF({ ...f, project: e.target.value })}>
              <option value="">선택 안 함</option>
              {projects.filter(p => !clientId || !p.client_id || p.client_id === clientId).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="row">
        <span className="grow" />
        <Button kind="ghost" size="sm" onClick={onDone}>
          취소
        </Button>
        <Button size="sm" disabled={busy} onClick={submit}>
          등록
        </Button>
      </div>
    </div>
  )
}

/** 프로젝트 상세: 참여 담당자(거래처 사람) 연결 · 역할 */
export function ProjectContactsSection({ project, clients, contacts }: { project: Project; clients: Client[]; contacts: Contact[] }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data: links } = useAsync(() => api.listProjectContacts({ projectId: project.id }), [version, project.id], [] as ProjectContact[])
  const [pick, setPick] = useState('')
  const [role, setRole] = useState('')
  const linked = new Set(links.map(l => l.contact_id))
  const candidates = useMemo(() => {
    const own = contacts.filter(c => c.client_id === project.client_id && !linked.has(c.id))
    const rest = contacts.filter(c => c.client_id !== project.client_id && !linked.has(c.id))
    return [...own, ...rest]
  }, [contacts, project.client_id, links])
  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? ''
  return (
    <div className="col gap-6">
      <SectionHead title="참여 담당자 (거래처)" count={links.length ? String(links.length) : undefined} />
      {links.map(l => {
        const c = contacts.find(x => x.id === l.contact_id)
        if (!c) return null
        return (
          <div key={l.contact_id} className="row wrap dashed" style={{ padding: '5px 0', gap: 6 }}>
            <Link to={`/clients?view=people&pid=${c.id}`} className="t-smallb">
              {c.name} {c.title ?? ''}
            </Link>
            <span className="t-cap">{clientName(c.client_id)}</span>
            {l.role && <Badge tone="outline">{l.role}</Badge>}
            <span className="grow" />
            <span className="t-cap">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
            <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => run(() => api.unlinkProjectContact(project.id, c.id))}>
              빼기
            </button>
          </div>
        )
      })}
      <div className="row wrap" style={{ gap: 6 }}>
        <select className="input" style={{ width: 220 }} value={pick} onChange={e => setPick(e.target.value)} aria-label="담당자 선택">
          <option value="">담당자 추가…</option>
          {candidates.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} {c.title ?? ''} · {clientName(c.client_id)}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 140 }} value={role} onChange={e => setRole(e.target.value)} placeholder="역할 (예: 발주 담당)" maxLength={60} aria-label="역할" />
        <Button size="sm" kind="outline" disabled={busy || !pick} onClick={async () => (await run(() => api.linkProjectContact(project.id, pick, role), '연결했습니다.')) && (setPick(''), setRole(''))}>
          연결
        </Button>
      </div>
    </div>
  )
}

/** 연락처 상세: 이 사람이 참여한 프로젝트 (직접 연결 + 연락 이력 · 자료에서 나온 프로젝트) */
export function ContactProjectsSection({ contact, projects, logs, files }: { contact: Contact; projects: Project[]; logs: WorkLog[]; files: ExchangeFile[] }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data: links } = useAsync(() => api.listProjectContacts({ contactId: contact.id }), [version, contact.id], [] as ProjectContact[])
  const [pick, setPick] = useState('')
  const rows = useMemo(() => {
    const m = new Map<string, { role: string | null; linked: boolean; logs: number; files: number; last: string }>()
    const get = (id: string) => m.get(id) ?? { role: null, linked: false, logs: 0, files: 0, last: '' }
    for (const l of links) m.set(l.project_id, { ...get(l.project_id), role: l.role, linked: true })
    for (const l of logs) if (l.project_id) m.set(l.project_id, { ...get(l.project_id), logs: get(l.project_id).logs + 1, last: l.log_date > get(l.project_id).last ? l.log_date : get(l.project_id).last })
    for (const f of files) if (f.project_id) m.set(f.project_id, { ...get(f.project_id), files: get(f.project_id).files + 1, last: f.file_date > get(f.project_id).last ? f.file_date : get(f.project_id).last })
    return [...m].map(([id, v]) => ({ id, p: projects.find(p => p.id === id), ...v })).filter(r => r.p).sort((a, b) => b.last.localeCompare(a.last))
  }, [links, logs, files, projects])
  const candidates = projects.filter(p => !rows.some(r => r.id === p.id) && (p.client_id === contact.client_id || !p.client_id)).concat(projects.filter(p => !rows.some(r => r.id === p.id) && p.client_id && p.client_id !== contact.client_id))
  return (
    <div className="col gap-6">
      <SectionHead title="관련 프로젝트" count={rows.length ? String(rows.length) : undefined} />
      {rows.map(r => (
        <div key={r.id} className="row wrap dashed" style={{ padding: '5px 0', gap: 6 }}>
          <Link to={`/projects?id=${r.id}`} className="t-smallb">
            {r.p!.name}
          </Link>
          <Badge tone="outline">{r.p!.status}</Badge>
          {r.role && <Badge tone="yellow">{r.role}</Badge>}
          <span className="grow" />
          <span className="t-cap">
            {r.logs ? `연락 ${r.logs}건` : ''}
            {r.logs && r.files ? ' · ' : ''}
            {r.files ? `자료 ${r.files}건` : ''}
            {r.last ? ` · 최근 ${shortDate(r.last)}` : ''}
          </span>
          {r.linked ? (
            <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => run(() => api.unlinkProjectContact(r.id, contact.id))}>
              연결 해제
            </button>
          ) : (
            <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => run(() => api.linkProjectContact(r.id, contact.id), '참여 담당자로 연결했습니다.')}>
              참여 담당자로
            </button>
          )}
        </div>
      ))}
      {rows.length === 0 && <span className="t-cap">연결된 프로젝트가 없습니다.</span>}
      <div className="row wrap" style={{ gap: 6 }}>
        <select className="input" style={{ width: 240 }} value={pick} onChange={e => setPick(e.target.value)} aria-label="프로젝트 선택">
          <option value="">프로젝트에 연결…</option>
          {candidates.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button size="sm" kind="outline" disabled={busy || !pick} onClick={async () => (await run(() => api.linkProjectContact(pick, contact.id), '연결했습니다.')) && setPick('')}>
          연결
        </Button>
      </div>
    </div>
  )
}

