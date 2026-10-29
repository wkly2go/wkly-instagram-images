import { useMemo, useRef, useState, type ReactNode } from 'react'
import { TextLinks } from '../components/ui'
import { ArrowLeft, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { parseCsv } from '../lib/csv'
import { relativeLabel, shortDate, toDateKey } from '../lib/date'
import { AD_FOOTER, openGmail } from '../lib/links'
import { Link, useRouter, withQuery } from '../lib/router'
import {
  CONTACT_SOURCES,
  LEAD_STATUSES,
  RESEARCH_KINDS,
  RESEARCH_STATUSES,
  type BrandContact,
  type Client,
  type ChatRoomSummary,
  type Draft,
  type EmailTemplate,
  type Project,
  type ResearchItem,
  type ResearchStatus,
} from '../lib/types'
import { Shell } from '../components/Shell'
import { Board } from '../components/Board'
import { usePanelWide, useRightPanel } from '../components/RightPanel'
import { REPORT_KIND, ReportBody, ReportForm, ReportTemplates, clientCatLabel } from '../components/Reports'
import { Badge, Button, Chip, Empty, Field, KindTag, Modal, type Tone } from '../components/ui'
import { ask } from '../components/Ask'

type Tab = 'research' | 'reports' | 'contacts' | 'templates' | 'agents'

export default function Library() {
  const { query, path, navigate } = useRouter()
  const tab = (query.get('tab') as Tab | null) ?? 'research'
  const go = (t: Tab) => navigate(withQuery(path, new URLSearchParams(), { tab: t === 'research' ? null : t }), { replace: true })
  // 자료실은 '보고서 결제' 탭 안으로 (대표 지시 2026-10-22 "자료실을 보고서 결제에 포함")
  const tabs = (
    <div className="chips one-line" role="tablist" aria-label="자료실 메뉴">
      <Chip onClick={() => navigate('/approvals')}>← 보고서 결제</Chip>
      {(
        [
          ['research', '리서치'],
          ['reports', '보고서 양식'],
          ['contacts', '브랜드 담당자'],
          ['templates', '메일 템플릿'],
          ['agents', '에이전트 연결 안내'],
        ] as [Tab, string][]
      ).map(([k, label]) => (
        <Chip key={k} active={tab === k} onClick={() => go(k)}>
          {label}
        </Chip>
      ))}
    </div>
  )
  return (
    <Shell active="approvals" flush={tab === 'research'}>
      {tab === 'research' ? <Research tabs={tabs} /> : tab === 'reports' ? <ReportTemplates tabs={tabs} /> : tab === 'contacts' ? <Contacts tabs={tabs} /> : tab === 'templates' ? <Templates tabs={tabs} /> : <AgentGuide tabs={tabs} />}
    </Shell>
  )
}

// ---------------------------------------------------------------- 리서치

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

/** 본문 '키: 값' 줄은 표로, 나머지는 문단으로 */
function splitBody(body: string | null): { kv: [string, string][]; text: string[] } {
  const kv: [string, string][] = []
  const text: string[] = []
  for (const line of (body ?? '').split('\n')) {
    const m = line.match(/^\s*([^:：]{1,10})[:：]\s*(.+)$/)
    if (m && !/^https?$/i.test(m[1].trim())) kv.push([m[1].trim(), m[2].trim()])
    else if (line.trim()) text.push(line.trim())
  }
  return { kv, text }
}

function Research({ tabs }: { tabs: ReactNode }) {
  const { api, version, profileOf } = useApp()
  const { query, path, navigate } = useRouter()
  const selectedId = query.get('id')
  const status = (query.get('status') as ResearchStatus | 'all' | null) ?? '새 자료'
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<ResearchItem | 'new' | 'report' | null>(null)
  const kind = query.get('kind')
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const { data, loading } = useAsync(
    async () => {
      const [items, projects, rooms, clients] = await Promise.all([api.listResearch(), api.listProjects(), api.listRooms(), api.listClients()])
      return { items, projects, rooms, clients }
    },
    [version],
    { items: [] as ResearchItem[], projects: [] as Project[], rooms: [] as ChatRoomSummary[], clients: [] as Client[] },
  )
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // 검색어가 있으면 상태와 관계없이 전체에서 찾음 (본문 포함)
  const list = data.items.filter(
    r =>
      (words.length > 0 || status === 'all' || r.status === status) &&
      (!kind || r.kind === kind) &&
      (!words.length || words.every(w => [r.title, r.summary, r.brand_name, r.tags.join(' '), r.source_name, r.body].join(' ').toLowerCase().includes(w))),
  )
  const selected = data.items.find(r => r.id === selectedId) ?? null
  // 상태: 기본 넷 + 실제 자료에 있는 것 (승인 대기 등 에이전트가 쓰는 상태도 빠짐없이). 숫자는 고른 종류 기준
  const STATUS_ORDER = ['새 자료', '승인 대기', '검토 완료', '활용', '승인', '반려', '보관']
  const inKind = data.items.filter(r => !kind || r.kind === kind)
  const statusTabs = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of inKind) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    const keys = [...new Set([...RESEARCH_STATUSES, ...m.keys()])].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))
    return [...keys.map(k => [k, m.get(k) ?? 0] as [string, number]), ['all', inKind.length] as [string, number]]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items, kind])
  // 종류: 고른 상태 안에서 있는 것만 (거래처 리포트 먼저, 그다음 많은 순). 고른 종류는 0건이어도 남김
  const inStatus = data.items.filter(r => words.length > 0 || status === 'all' || r.status === status)
  const kindTotal = inStatus.length
  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of inStatus) m.set(r.kind, (m.get(r.kind) ?? 0) + 1)
    if (kind && !m.has(kind)) m.set(kind, 0)
    return [...m.entries()].sort(([a, x], [b, y]) => (a === REPORT_KIND ? -1 : b === REPORT_KIND ? 1 : y - x || a.localeCompare(b, 'ko')))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items, status, kind, words.length])

  const wide = usePanelWide()
  useRightPanel(
    selected && wide ? `research:${selected.id}` : null,
    '자료 상세',
    selected ? <ResearchDetail r={selected} projects={data.projects} rooms={data.rooms} clients={data.clients} onBack={() => go({ id: null })} onEdit={() => setEditing(selected)} /> : null,
  )

  if (selected && !wide) {
    return (
      <div className="split has-detail">
        <div className="pane-detail">
          <ResearchDetail r={selected} projects={data.projects} rooms={data.rooms} clients={data.clients} onBack={() => go({ id: null })} onEdit={() => setEditing(selected)} />
        </div>
        {editing === 'report' || (editing && editing !== 'new' && editing.kind === REPORT_KIND) ? (
          <ReportForm key={editing === 'report' ? 'new' : (editing as ResearchItem).id} item={editing === 'report' ? null : (editing as ResearchItem)} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />
        ) : (
          editing && <ResearchForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} projects={data.projects} onClose={() => setEditing(null)} onSaved={id => go({ id })} />
        )}
      </div>
    )
  }
  return (
    <div className="split">
      <div className="pane-list" style={{ width: '100%', borderRight: 0, background: 'var(--white)' }}>
        <div className="pane-head">
          {tabs}
          <div className="row">
            <label className="search grow">
              <Search size={14} />
              <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="제목·거래처·본문 검색" aria-label="자료 검색" />
            </label>
            <Button kind="outline" size="sm" onClick={() => setEditing('report')} title="거래처 리서치 보고서 쓰기 (공통 양식)">
              <FileText size={13} /> 거래처 보고서
            </Button>
            <Button size="sm" onClick={() => setEditing('new')} title="자료 직접 추가">
              <Plus size={13} /> 자료
            </Button>
          </div>
          {/* 상태 · 종류 정리 (대표 지시 2026-10-29 "중복되는 것 정리, 사용성"):
              풀다운 + 같은 종류 칩이 겹치던 것을 → 상태 탭 한 줄 + 종류 칩 한 벌로. 숫자는 지금 보이는 목록 기준 */}
          <div className="lib-status" role="tablist" aria-label="상태">
            {statusTabs.map(([s, n]) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'on' : ''} onClick={() => go({ status: s === '새 자료' ? null : s })}>
                {s === 'all' ? '전체' : s} <b>{n}</b>
              </button>
            ))}
            <span className="grow" />
            <span className="t-cap">{words.length ? `검색 결과 ${list.length}건 (모든 상태)` : `${list.length}건`}</span>
          </div>
          <div className="lib-kinds" aria-label="종류">
            <Chip active={!kind} onClick={() => go({ kind: null })}>
              모든 종류 {kindTotal}
            </Chip>
            {kinds.map(([k, n]) => (
              <Chip key={k} active={kind === k} onClick={() => go({ kind: kind === k ? null : k })}>
                {k} {n}
              </Chip>
            ))}
          </div>
        </div>
        <div className="pane-body" style={{ padding: '0 12px 12px' }}>
          <Board<ResearchItem>
            rows={list}
            rowKey={r => r.id}
            onRow={r => go({ id: r.id })}
            selectedId={selectedId}
            empty={loading ? '불러오는 중…' : status === '새 자료' ? '새 자료가 없습니다. 에이전트가 모은 자료가 여기에 쌓입니다.' : '자료가 없습니다.'}
            cols={[
              { key: 'kind', label: '종류', width: 100, cell: r => <KindTag kind={r.kind} /> },
              {
                key: 'title',
                label: '제목',
                kind: 'title',
                cell: r => (
                  <>
                    <span className="t-smallb">{r.title}</span>
                    {r.summary && <span className="cell-sub">{r.summary}</span>}
                  </>
                ),
              },
              { key: 'client', label: '거래처 · 브랜드', width: 150, hideNarrow: true, cell: r => (r.client_id ? data.clients.find(c => c.id === r.client_id)?.name : r.brand_name) ?? '-' },
              { key: 'tags', label: '태그', width: 160, hideNarrow: true, cell: r => (r.tags.length ? r.tags.map(t => `#${t}`).join(' ') : '-') },
              { key: 'by', label: '작성', width: 90, cell: r => (r.collected_by_agent ? profileOf(r.collected_by_agent)?.name ?? 'AI' : profileOf(r.created_by)?.name ?? '-') },
              { key: 'when', label: '날짜', width: 90, cell: r => shortDate(toDateKey(r.created_at)) },
              { key: 'status', label: '상태', width: 72, cell: r => <Badge tone={r.status === '새 자료' ? 'yellow' : 'outline'}>{r.status}</Badge> },
            ]}
          />
        </div>
      </div>
      {editing === 'report' || (editing && editing !== 'new' && editing.kind === REPORT_KIND) ? (
        <ReportForm key={editing === 'report' ? 'new' : (editing as ResearchItem).id} item={editing === 'report' ? null : (editing as ResearchItem)} clients={data.clients} onClose={() => setEditing(null)} onSaved={id => go({ id })} />
      ) : (
        editing && <ResearchForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} projects={data.projects} onClose={() => setEditing(null)} onSaved={id => go({ id })} />
      )}
    </div>
  )
}

function ResearchDetail({ r, projects, rooms, clients, onBack, onEdit }: { r: ResearchItem; projects: Project[]; rooms: ChatRoomSummary[]; clients: Client[]; onBack: () => void; onEdit: () => void }) {
  const { api, me, profileName, profileOf } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const [modal, setModal] = useState<'task' | 'project' | 'chat' | 'contact' | null>(null)
  const { kv, text } = splitBody(r.body)
  const email = (r.body ?? '').match(EMAIL_RE)?.[0] ?? null
  const setStatus = (status: ResearchStatus, msg: string) => run(() => api.saveResearch({ id: r.id, status }), msg)
  return (
    <div className="col gap-10" style={{ padding: '14px 16px', overflow: 'auto', flex: 1 }}>
      <div className="row wrap">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        {/* 종류 · 상태는 여기서 바로 바꿈 */}
        {me.role === 'admin' || r.created_by === me.id ? (
          <select className="select sm-select" value={r.kind} disabled={busy} onChange={e => run(() => api.saveResearch({ id: r.id, kind: e.target.value as ResearchItem['kind'] }), '종류를 바꿨습니다.')} aria-label="종류 바꾸기" title="종류 바꾸기">
            {[...new Set([...RESEARCH_KINDS, r.kind])].map(k => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        ) : (
          <Badge>{r.kind}</Badge>
        )}
        <select className="select sm-select" value={r.status} disabled={busy} onChange={e => setStatus(e.target.value as ResearchStatus, `${e.target.value}(으)로 바꿨습니다.`)} aria-label="상태 바꾸기" title="상태 바꾸기">
          {[...new Set<string>([r.status, ...RESEARCH_STATUSES])].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="grow" />
        <span className="t-cap">
          {r.collected_by_agent ? `🤖 ${(profileOf(r.collected_by_agent)?.name ?? r.collected_by_agent)}` : profileName(r.created_by)} · {shortDate(toDateKey(r.created_at))} {relativeLabel(r.created_at)}
        </span>
        {(me.role === 'admin' || r.created_by === me.id) && (
          <>
            <button type="button" className="icon-btn sm" onClick={onEdit} aria-label="자료 수정">
              <Pencil size={13} />
            </button>
            <button type="button" className="icon-btn sm" aria-label="자료 삭제" onClick={async () => (await ask('이 자료를 삭제할까요?')) && (await run(() => api.deleteResearch(r.id), '삭제했습니다.')) && onBack()}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      <h2 className="t-title">{r.title}</h2>
      {(r.source_url || r.source_name) && (
        <span className="t-cap">
          출처:{' '}
          {r.source_url && /^https?:\/\//i.test(r.source_url) ? (
            <a href={r.source_url} target="_blank" rel="noreferrer noopener">
              {r.source_url.replace(/^https?:\/\//, '')}
            </a>
          ) : null}
          {r.source_name ? ` · ${r.source_name}` : ''}
        </span>
      )}
      {r.kind === REPORT_KIND && (
        <span className="t-cap">
          {r.client_id && (
            <>
              거래처: <Link to={`/clients?id=${r.client_id}`}>{clients.find(c => c.id === r.client_id)?.name ?? r.brand_name ?? '거래처'}</Link>
              {clients.find(c => c.id === r.client_id) && ` (${clientCatLabel(clients.find(c => c.id === r.client_id)!.category)})`}
            </>
          )}
          {r.shared_to && <> · 보고받는 사람: <b>{profileName(r.shared_to)}</b></>}
        </span>
      )}
      {r.kind === REPORT_KIND ? (
        <>
          {r.summary && <div className="note pre">{r.summary}</div>}
          {r.body && <ReportBody body={r.body} />}
        </>
      ) : (
      <>
      {(kv.length > 0 || r.brand_name) && (
        <div className="box">
          <dl className="kv">
            {r.brand_name && (
              <>
                <dt>브랜드</dt>
                <dd>{r.brand_name}</dd>
              </>
            )}
            {kv.map(([k, v], i) => (
              <span key={i} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </span>
            ))}
          </dl>
        </div>
      )}
      {r.summary && <p className="t-small pre" style={{ margin: 0 }}>{r.summary}</p>}
      {text.map((t, i) => (
        <p key={i} className="t-small pre" style={{ margin: 0 }}>
          {t}
        </p>
      ))}
      </>
      )}
      {r.tags.length > 0 && <span className="t-cap t-blue">{r.tags.map(t => `#${t}`).join(' ')}</span>}
      {r.project_id && (
        <span className="t-cap">
          연결된 프로젝트: <Link to={`/projects?id=${r.project_id}`}>{projects.find(p => p.id === r.project_id)?.name ?? '프로젝트'}</Link>
        </span>
      )}
      <span className="grow" />
      <div className="row wrap" style={{ gap: 6 }}>
        {r.status === '새 자료' && (
          <Button kind="yellow" disabled={busy} onClick={() => setStatus('검토 완료', '검토 완료로 표시했습니다.')}>
            검토 완료
          </Button>
        )}
        <Button disabled={busy} onClick={() => setModal('task')}>
          할 일 만들기
        </Button>
        <Button kind="outline" disabled={busy} onClick={() => setModal('project')}>
          프로젝트 연결
        </Button>
        <Button kind="outline" disabled={busy} onClick={() => setModal('chat')}>
          채팅 공유
        </Button>
        <Button kind="outline" disabled={busy} onClick={() => setModal('contact')}>
          브랜드 담당자 저장
        </Button>
        {r.status !== '보관' && (
          <Button kind="ghost" disabled={busy} onClick={() => setStatus('보관', '보관했습니다.')}>
            보관
          </Button>
        )}
      </div>
      {modal === 'task' && <TaskFromResearch r={r} projects={projects} onClose={() => setModal(null)} />}
      {modal === 'project' && (
        <PickModal
          title="프로젝트 연결"
          options={projects.filter(p => p.status !== '완료').map(p => ({ id: p.id, label: p.name }))}
          current={r.project_id}
          onClose={() => setModal(null)}
          onPick={id => run(() => api.saveResearch({ id: r.id, project_id: id, status: r.status === '새 자료' ? '검토 완료' : r.status }), id ? '프로젝트에 연결했습니다.' : '연결을 해제했습니다.')}
        />
      )}
      {modal === 'chat' && (
        <PickModal
          title="채팅방에 공유"
          options={rooms.map(x => ({ id: x.id, label: x.name }))}
          current={null}
          onClose={() => setModal(null)}
          onPick={async id => {
            if (!id) return
            const msg = [`📚 자료 공유 · ${r.title}`, r.summary, r.source_url, `${window.location.origin}/library?id=${r.id}`].filter(Boolean).join('\n')
            if (await run(() => api.sendMessage(id, msg), '채팅방에 공유했습니다.')) navigate(`/chat?room=${id}`)
          }}
        />
      )}
      {modal === 'contact' && (
        <ContactForm
          contact={null}
          preset={{
            brand_name: r.brand_name ?? '',
            email: email ?? '',
            source_type: r.collected_by_agent ? '에이전트 리서치' : r.source_name?.includes('보도') ? '보도자료' : '기타',
            source_url: r.source_url,
            source_note: `자료실: ${r.title}`,
            research_item_id: r.id,
            client_id: r.client_id,
          }}
          onClose={() => setModal(null)}
          onSaved={() => r.status === '새 자료' && api.saveResearch({ id: r.id, status: '활용' })}
        />
      )}
    </div>
  )
}

function TaskFromResearch({ r, projects, onClose }: { r: ResearchItem; projects: Project[]; onClose: () => void }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const [title, setTitle] = useState(r.brand_name ? `${r.brand_name} 협업 제안 메일` : r.title)
  const [assignee, setAssignee] = useState(me.id)
  const [projectId, setProjectId] = useState(r.project_id ?? '')
  const [due, setDue] = useState('')
  const [alarm, setAlarm] = useState('')
  const save = async () => {
    const ok = await run(async () => {
      await api.saveTask({ title: title.trim(), assignee_id: assignee || null, project_id: projectId || null, due_date: due || null, remind_at: alarm ? new Date(alarm).toISOString() : null, source_research_id: r.id, memo: r.source_url })
      if (r.status === '새 자료' || r.status === '검토 완료') await api.saveResearch({ id: r.id, status: '활용' })
    }, '할 일을 만들었습니다.')
    if (ok) onClose()
  }
  return (
    <Modal
      title="리서치로 할 일 만들기"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !title.trim()}>
            만들기
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="할 일" className="full">
          <input className="input" autoFocus value={title} onChange={e => setTitle(e.target.value)} />
        </Field>
        <Field label="담당">
          <select className="select" value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">담당 없음</option>
            {profiles
              .filter(p => p.active && !p.is_agent)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="프로젝트">
          <select className="select" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">없음</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="마감일">
          <input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} />
        </Field>
        <Field label="알람">
          <input className="input" type="datetime-local" value={alarm} onChange={e => setAlarm(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function PickModal({ title, options, current, onPick, onClose }: { title: string; options: { id: string; label: string }[]; current: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="col gap-2">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            className={`item ${o.id === current ? 'active' : ''}`}
            onClick={() => {
              onPick(o.id)
              onClose()
            }}
          >
            <span className="t-smallb">{o.label}</span>
          </button>
        ))}
        {current && (
          <Button
            kind="ghost"
            onClick={() => {
              onPick(null)
              onClose()
            }}
          >
            연결 해제
          </Button>
        )}
        {options.length === 0 && <Empty>고를 항목이 없습니다.</Empty>}
      </div>
    </Modal>
  )
}

function ResearchForm({ item, projects, onClose, onSaved }: { item: ResearchItem | null; projects: Project[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Draft<ResearchItem>>(() => item ?? { kind: '팝업', title: '', summary: null, body: null, source_url: null, source_name: null, brand_name: null, tags: [], status: '새 자료', project_id: null })
  const [tags, setTags] = useState((item?.tags ?? []).join(', '))
  const set = (p: Draft<ResearchItem>) => setF(prev => ({ ...prev, ...p }))
  const save = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await api.saveResearch({ ...f, title: (f.title ?? '').trim(), tags: tags.split(/[,#\s]+/).map(t => t.trim()).filter(Boolean) })).id
    }, '저장했습니다.')
    if (ok) {
      onClose()
      onSaved(id)
    }
  }
  return (
    <Modal
      wide
      title={item ? '자료 수정' : '자료 추가'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !f.title?.trim()}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="종류">
          <select className="select" value={f.kind} onChange={e => set({ kind: e.target.value as ResearchItem['kind'] })}>
            {RESEARCH_KINDS.map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="브랜드">
          <input className="input" value={f.brand_name ?? ''} onChange={e => set({ brand_name: e.target.value || null })} />
        </Field>
        <Field label="제목" className="full">
          <input className="input" autoFocus value={f.title ?? ''} onChange={e => set({ title: e.target.value })} />
        </Field>
        <Field label="요약" className="full">
          <textarea className="textarea" rows={2} value={f.summary ?? ''} onChange={e => set({ summary: e.target.value || null })} />
        </Field>
        <Field label="본문 ('기간: …' 처럼 쓰면 표로 보여요)" className="full">
          <textarea className="textarea" rows={5} value={f.body ?? ''} onChange={e => set({ body: e.target.value || null })} placeholder={'기간: 2026.10.18 – 11.02\n장소: 서울 성동구\n공개 연락처: collab@brand.com'} />
        </Field>
        <Field label="출처 URL">
          <input className="input" value={f.source_url ?? ''} onChange={e => set({ source_url: e.target.value || null })} placeholder="https://" />
        </Field>
        <Field label="출처 이름">
          <input className="input" value={f.source_name ?? ''} onChange={e => set({ source_name: e.target.value || null })} placeholder="공식 보도자료 · 인스타그램 …" />
        </Field>
        <Field label="태그 (쉼표로 구분)">
          <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="성수, 라이프스타일" />
        </Field>
        <Field label="프로젝트">
          <select className="select" value={f.project_id ?? ''} onChange={e => set({ project_id: e.target.value || null })}>
            <option value="">없음</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- 브랜드 담당자

const L_TONE: Record<string, Tone> = { 신규: 'outline', 연락함: 'blue', 회신: 'acid', 미팅: 'yellow', '거래 전환': 'acid', 보류: 'paper', 수신거부: 'gray' }

export function fillTemplate(text: string, c: Partial<BrandContact> | null, sender: string): string {
  return text
    .replace(/\{\{브랜드\}\}/g, c?.brand_name || '브랜드')
    .replace(/\{\{담당자\}\}/g, c?.contact_name?.replace(/\s*(님)$/, '') || '담당자')
    .replace(/\{\{보내는사람\}\}/g, sender)
}

function Contacts({ tabs }: { tabs: ReactNode }) {
  const { api, version, toast, bump } = useApp()
  const { query, path, navigate } = useRouter()
  const filter = query.get('status') ?? 'all'
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<BrandContact | 'new' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const { data } = useAsync(
    async () => {
      const [contacts, templates] = await Promise.all([api.listBrandContacts(), api.listTemplates()])
      return { contacts, templates }
    },
    [version],
    { contacts: [] as BrandContact[], templates: [] as EmailTemplate[] },
  )
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = data.contacts.filter(c => (filter === 'all' ? true : filter === '수신거부' ? c.opt_out : c.status === filter && !c.opt_out) && (!words.length || words.every(w => [c.brand_name, c.contact_name, c.email, c.tags.join(' '), c.memo].join(' ').toLowerCase().includes(w))))
  const selected = data.contacts.find(c => c.id === sel) ?? null

  const importCsv = async (file: File) => {
    const text = await file.text()
    const table = parseCsv(text)
    if (table.length < 2) return toast('CSV에 내용이 없습니다.')
    const head = table[0].map(h => h.replace(/\s/g, ''))
    // 정확히 같은 머리글을 먼저 찾고, 없으면 포함 여부로 (brand_name 이 'name' 에 걸리지 않게)
    const col = (...names: string[]) => {
      const lower = head.map(h => h.toLowerCase())
      const exact = lower.findIndex(h => names.some(n => h === n.toLowerCase()))
      return exact >= 0 ? exact : lower.findIndex(h => names.some(n => h.includes(n.toLowerCase())))
    }
    const ix = { brand: col('브랜드', 'brand_name', 'brand'), name: col('담당자', 'contact_name', '이름'), title: col('직함', 'title'), email: col('이메일', 'email'), phone: col('전화', 'phone'), source: col('출처', 'source'), url: col('URL', 'url', '링크'), memo: col('메모', 'memo') }
    if (ix.email < 0 || ix.brand < 0) return toast("'브랜드'와 '이메일' 열이 필요합니다.")
    const get = (r: string[], i: number) => (i >= 0 ? r[i]?.trim() || null : null)
    const drafts = table.slice(1).map(r => {
      const src = get(r, ix.source)
      return {
        brand_name: get(r, ix.brand) ?? '',
        contact_name: get(r, ix.name),
        title: get(r, ix.title),
        email: get(r, ix.email) ?? '',
        phone: get(r, ix.phone),
        source_type: (CONTACT_SOURCES.find(s => src && s.includes(src)) ?? '기타') as BrandContact['source_type'],
        source_url: get(r, ix.url),
        source_note: src && !CONTACT_SOURCES.some(s => s.includes(src)) ? src : `CSV 가져오기 (${file.name})`,
        memo: get(r, ix.memo),
      }
    })
    try {
      const res = await api.importBrandContacts(drafts)
      toast(`새로 ${res.created}명 · 합침 ${res.merged}명 · 건너뜀 ${res.skipped}명`)
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div className="row wrap">
        {tabs}
        <span className="grow" />
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && importCsv(e.target.files[0]).finally(() => (e.target.value = ''))} />
        <Button kind="outline" onClick={() => fileRef.current?.click()} title="열: 브랜드, 담당자, 직함, 이메일, 전화, 출처, URL, 메모 (같은 이메일은 합침)">
          CSV 가져오기
        </Button>
        <Button onClick={() => setEditing('new')}>
          담당자
        </Button>
      </div>
      <div className="row wrap">
        <div className="chips">
          <Chip active={filter === 'all'} onClick={() => go({ status: null })}>
            전체 {data.contacts.length}
          </Chip>
          {LEAD_STATUSES.map(s => (
            <Chip key={s} active={filter === s} onClick={() => go({ status: s })}>
              {s} {data.contacts.filter(c => c.status === s && !c.opt_out).length}
            </Chip>
          ))}
          <Chip active={filter === '수신거부'} onClick={() => go({ status: '수신거부' })}>
            수신거부 {data.contacts.filter(c => c.opt_out).length}
          </Chip>
        </div>
        <label className="search" style={{ flex: '1 1 180px' }}>
          <Search size={14} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="브랜드·이름·이메일" aria-label="담당자 검색" />
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty>담당자가 없습니다. 리서치에서 '브랜드 담당자 저장'을 누르거나 CSV로 가져오세요.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>브랜드</th>
                <th>담당자</th>
                <th>이메일</th>
                <th>출처</th>
                <th>상태</th>
                <th className="num">최근 연락</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className={`click ${c.id === sel ? 'sel' : ''}`} onClick={() => setSel(c.id === sel ? null : c.id)}>
                  <td className="strong nowrap">{c.brand_name}</td>
                  <td className="max truncate">{c.contact_name ?? '–'}</td>
                  <td className="max truncate">{c.email}</td>
                  <td className="nowrap">
                    <Badge>{c.collected_by_agent || c.source_type === '에이전트 리서치' ? '🤖 리서치' : c.source_type}</Badge>
                  </td>
                  <td className="nowrap">{c.opt_out ? <Badge tone="gray">수신거부</Badge> : <Badge tone={L_TONE[c.status]}>{c.status}</Badge>}</td>
                  <td className="num">{c.last_contacted_at ? shortDate(toDateKey(c.last_contacted_at)) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row top wrap gap-12">
        <Compose contact={selected} templates={data.templates} onEdit={() => selected && setEditing(selected)} />
        <div className="box col gap-6" style={{ flex: '1 1 220px', maxWidth: 300, background: 'var(--white)' }}>
          <span className="t-smallb">수집 방법</span>
          <span className="t-cap">① 직접 입력 · 명함</span>
          <span className="t-cap">② CSV 가져오기 (같은 이메일은 자동 합침)</span>
          <span className="t-cap">③ 리서치에서 "브랜드 담당자 저장"</span>
          <span className="t-cap">④ 받은 메일 → 에이전트가 등록</span>
          <span className="t-cap">⑤ 🤖 리서치 에이전트 자동 수집 (공개된 협업 연락처만)</span>
          <div className="dashed" />
          <span className="t-smallb">안전장치</span>
          <span className="t-cap">· 출처 기록 필수 (어디서 알게 됐는지)</span>
          <span className="t-cap">· 1:1 발송만 (대량 발송 없음)</span>
          <span className="t-cap">· 수신거부는 발송 버튼 잠금 (해제는 관리자만)</span>
          <span className="t-cap">· 광고성 메일은 제목 (광고) 표기 · 수신거부 안내 자동 포함</span>
        </div>
      </div>
      {editing && <ContactForm key={editing === 'new' ? 'new' : editing.id} contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function Compose({ contact, templates, onEdit }: { contact: BrandContact | null; templates: EmailTemplate[]; onEdit: () => void }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const [tplId, setTplId] = useState('')
  const tpl = templates.find(t => t.id === tplId) ?? templates[0] ?? null
  const base = useMemo(() => {
    if (!tpl) return { subject: '', body: '' }
    const subject = fillTemplate(tpl.subject, contact, me.name)
    return { subject: tpl.is_ad && !subject.startsWith('(광고)') ? `(광고) ${subject}` : subject, body: fillTemplate(tpl.body, contact, me.name) + (tpl.is_ad ? AD_FOOTER : '') }
  }, [tpl, contact, me.name])
  const [edit, setEdit] = useState<{ key: string; subject: string; body: string } | null>(null)
  const key = `${contact?.id}-${tpl?.id}`
  const subject = edit?.key === key ? edit.subject : base.subject
  const body = edit?.key === key ? edit.body : base.body
  const locked = !!contact?.opt_out
  const logSend = async () => {
    if (!contact) return
    await api.saveWorkLog({ kind: '메일 발신', content: `${contact.brand_name} 메일: ${subject}`, email_counterpart: contact.email, email_subject: subject, client_id: contact.client_id })
    await api.saveBrandContact({ id: contact.id, last_contacted_at: new Date().toISOString(), ...(contact.status === '신규' ? { status: '연락함' } : {}) })
  }
  return (
    <div className="box col gap-6" style={{ flex: '2 1 320px' }}>
      <div className="row">
        <span className="t-smallb grow">메일 쓰기</span>
        <select className="select" style={{ width: 'auto', padding: '3px 6px', fontWeight: 700 }} value={tpl?.id ?? ''} onChange={e => setTplId(e.target.value)} aria-label="템플릿">
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              템플릿: {t.name}
            </option>
          ))}
        </select>
      </div>
      {!contact ? (
        <span className="t-cap">위 목록에서 담당자를 고르면 템플릿이 채워집니다.</span>
      ) : (
        <>
          <div className="row t-cap">
            <span style={{ width: 56 }}>받는 사람</span>
            <span className="t-smallb truncate grow">
              {contact.brand_name} · {contact.email}
            </span>
            <button type="button" className="icon-btn sm" onClick={onEdit} aria-label="담당자 수정">
              <Pencil size={12} />
            </button>
          </div>
          {locked ? (
            <div className="note warn">수신거부한 담당자입니다. 메일을 보낼 수 없어요. (해제는 관리자만)</div>
          ) : (
            <>
              <div className="row t-cap">
                <span style={{ width: 56 }}>제목</span>
                <input className="input grow" value={subject} onChange={e => setEdit({ key, subject: e.target.value, body })} aria-label="제목" />
              </div>
              <textarea className="textarea" rows={7} value={body} onChange={e => setEdit({ key, subject, body: e.target.value })} aria-label="본문" />
              <div className="row wrap">
                <span className="t-cap grow">보내면 업무 일지(메일 발신)와 최근 연락이 자동 기록됩니다</span>
                <Button
                  kind="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => api.createApproval({ kind: '메일 발송', title: subject, content: null, target_id: contact.client_id, payload: { to: contact.email, subject, body } }), '메일 발송 승인을 요청했습니다.')
                  }
                >
                  승인 요청
                </Button>
                <Button
                  kind="yellow"
                  disabled={busy}
                  onClick={() => {
                    openGmail({ to: contact.email, subject, body })
                    run(logSend, 'Gmail 작성창을 열고 기록했습니다.')
                  }}
                >
                  Gmail로 작성
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function ContactForm({ contact, preset, onClose, onSaved }: { contact: BrandContact | null; preset?: Draft<BrandContact>; onClose: () => void; onSaved?: () => void }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Draft<BrandContact>>(() => contact ?? { brand_name: '', contact_name: null, title: null, email: '', phone: null, source_type: '기타', source_url: null, source_note: null, status: '신규', memo: null, tags: [], ...preset })
  const set = (p: Draft<BrandContact>) => setF(prev => ({ ...prev, ...p }))
  const hasSource = !!(f.source_url?.trim() || f.source_note?.trim()) || f.source_type === '명함·미팅' || f.source_type === '받은 메일'
  const save = async () => {
    const ok = await run(() => api.saveBrandContact({ ...f, brand_name: (f.brand_name ?? '').trim(), email: (f.email ?? '').trim() }), contact ? '저장했습니다.' : '브랜드 담당자를 저장했습니다.')
    if (ok) {
      onSaved?.()
      onClose()
    }
  }
  return (
    <Modal
      wide
      title={contact ? '브랜드 담당자 수정' : '브랜드 담당자 저장'}
      onClose={onClose}
      actions={
        <>
          {contact && me.role === 'admin' && (
            <Button kind="ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={async () => (await ask('이 담당자를 삭제할까요?')) && (await run(() => api.deleteBrandContact(contact.id), '삭제했습니다.')) && onClose()}>
              삭제
            </Button>
          )}
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !f.brand_name?.trim() || !EMAIL_RE.test(f.email ?? '') || !hasSource}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="브랜드">
          <input className="input" autoFocus value={f.brand_name ?? ''} onChange={e => set({ brand_name: e.target.value })} />
        </Field>
        <Field label="이메일">
          <input className="input" type="email" value={f.email ?? ''} onChange={e => set({ email: e.target.value })} />
        </Field>
        <Field label="담당자">
          <input className="input" value={f.contact_name ?? ''} onChange={e => set({ contact_name: e.target.value || null })} placeholder="예) 김소라 매니저" />
        </Field>
        <Field label="전화">
          <input className="input" value={f.phone ?? ''} onChange={e => set({ phone: e.target.value || null })} />
        </Field>
        <Field label="출처 (필수)">
          <select className="select" value={f.source_type} onChange={e => set({ source_type: e.target.value as BrandContact['source_type'] })}>
            {CONTACT_SOURCES.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <select className="select" value={f.status} onChange={e => set({ status: e.target.value as BrandContact['status'] })}>
            {LEAD_STATUSES.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="출처 URL">
          <input className="input" value={f.source_url ?? ''} onChange={e => set({ source_url: e.target.value || null })} placeholder="공개된 연락처가 있는 페이지" />
        </Field>
        <Field label="출처 메모">
          <input className="input" value={f.source_note ?? ''} onChange={e => set({ source_note: e.target.value || null })} placeholder="예) 10.09 협업 문의 메일 수신" />
        </Field>
        <Field label="메모" className="full">
          <textarea className="textarea" rows={2} value={f.memo ?? ''} onChange={e => set({ memo: e.target.value || null })} />
          <TextLinks text={f.memo} />
        </Field>
        <label className="row t-cap full" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!f.opt_out} disabled={!!contact?.opt_out && me.role !== 'admin'} onChange={e => set({ opt_out: e.target.checked })} />
          수신거부 (체크하면 메일 버튼이 잠깁니다{contact?.opt_out && me.role !== 'admin' ? ' · 해제는 관리자만' : ''})
        </label>
        {!hasSource && <span className="t-cap t-red full">어디서 알게 된 연락처인지 출처 URL이나 메모를 남겨 주세요.</span>}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- 메일 템플릿

function Templates({ tabs }: { tabs: ReactNode }) {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const { data: list } = useAsync(() => api.listTemplates(), [version], [] as EmailTemplate[])
  const [cur, setCur] = useState<Draft<EmailTemplate> | null>(null)
  const set = (p: Draft<EmailTemplate>) => setCur(prev => ({ ...prev, ...p }))
  const save = async () => {
    if (!cur) return
    if (await run(() => api.saveTemplate({ ...cur, name: (cur.name ?? '').trim() }), '저장했습니다.')) setCur(null)
  }
  return (
    <>
      <div className="row wrap">
        {tabs}
        <span className="grow" />
        <Button onClick={() => setCur({ name: '', subject: '', body: '', is_ad: true })}>
          템플릿
        </Button>
      </div>
      <div className="note">
        본문에 {'{{브랜드}}'} · {'{{담당자}}'} · {'{{보내는사람}}'} 을 쓰면 보낼 때 채워집니다. 광고성 메일로 표시하면 제목 앞 (광고)와 수신거부 안내가 자동으로 붙습니다.
      </div>
      {list.map(t => (
        <div key={t.id} className="item-row">
          <span className="col gap-2 grow">
            <span className="row" style={{ gap: 6 }}>
              <span className="t-smallb">{t.name}</span>
              {t.is_ad && <Badge tone="yellow">광고성</Badge>}
            </span>
            <span className="t-cap truncate">{t.subject}</span>
          </span>
          <Button kind="outline" size="sm" onClick={() => setCur(t)}>
            수정
          </Button>
          {(me.role === 'admin' || t.created_by === me.id) && (
            <Button kind="ghost" size="sm" disabled={busy} onClick={async () => (await ask(`'${t.name}' 템플릿을 삭제할까요?`)) && run(() => api.deleteTemplate(t.id), '삭제했습니다.')}>
              삭제
            </Button>
          )}
        </div>
      ))}
      {list.length === 0 && <Empty>템플릿이 없습니다.</Empty>}
      {cur && (
        <Modal
          wide
          title={cur.id ? '템플릿 수정' : '새 템플릿'}
          onClose={() => setCur(null)}
          actions={
            <>
              <Button kind="ghost" onClick={() => setCur(null)}>
                취소
              </Button>
              <Button onClick={save} disabled={busy || !cur.name?.trim() || !cur.subject?.trim() || !cur.body?.trim()}>
                저장
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="이름" className="full">
              <input className="input" autoFocus value={cur.name ?? ''} onChange={e => set({ name: e.target.value })} />
            </Field>
            <Field label="제목" className="full">
              <input className="input" value={cur.subject ?? ''} onChange={e => set({ subject: e.target.value })} />
            </Field>
            <Field label="본문" className="full">
              <textarea className="textarea" rows={8} value={cur.body ?? ''} onChange={e => set({ body: e.target.value })} />
            </Field>
            <label className="row t-cap full" style={{ gap: 6 }}>
              <input type="checkbox" checked={!!cur.is_ad} onChange={e => set({ is_ad: e.target.checked })} /> 광고성 메일 (협업·영업 제안 등)
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 에이전트 연결 안내

function Code({ children }: { children: string }) {
  return (
    <pre className="box" style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 'var(--fs-cap)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--blue)', background: 'var(--white)' }}>
      {children}
    </pre>
  )
}

function AgentGuide({ tabs }: { tabs: ReactNode }) {
  const { api, me } = useApp()
  const url = api.mode === 'supabase' ? (import.meta.env.VITE_SUPABASE_URL as string) : 'https://<프로젝트>.supabase.co'
  const call = (kind: string, payload: string) =>
    `curl -s "$WKLY_ERP_URL/rest/v1/rpc/agent_submit" \\\n  -H "apikey: $WKLY_ERP_ANON_KEY" -H "Authorization: Bearer $WKLY_ERP_ANON_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"p_token":"'"$WKLY_ERP_AGENT_TOKEN"'","p_kind":"${kind}","p_payload":${payload}}'`
  return (
    <>
      <div className="row wrap">{tabs}</div>
      <div className="note">
        리서치 에이전트·WKLY 총괄 같은 AI 팀원은 로그인 대신 <b>연결 키</b>로 ERP에 기록합니다. 키마다 할 수 있는 일(리서치·브랜드 담당자·할 일·일일 보고·알림·현황 조회·재무 요약)이 정해져 있고, 언제든 관리 화면에서 끊을 수 있어요.
      </div>
      <section className="section">
        <div className="section-h">
          <span className="t-bodyb">1. 키 만들기</span>
        </div>
        <span className="t-small">
          {me.role === 'admin' ? <Link to="/admin">관리 › AI 에이전트 연결 키</Link> : '관리자에게 요청: 관리 › AI 에이전트 연결 키'} 에서 키를 만들고, 일일 보고를 할 에이전트는 AI 팀원(예: WKLY 총괄)과 연결합니다. 관리 화면의 'WKLY 총괄' 칸에서 계정과 키를 한 번에 만들 수 있어요.
        </span>
      </section>
      <section className="section">
        <div className="section-h">
          <span className="t-bodyb">2. 에이전트 쪽 비밀 설정 (환경 변수)</span>
        </div>
        <Code>{`WKLY_ERP_URL=${url}\nWKLY_ERP_ANON_KEY=<Supabase 공개(anon) 키>\nWKLY_ERP_AGENT_TOKEN=<관리 화면에서 한 번만 보여 준 키>`}</Code>
        <span className="t-cap">키는 채팅·메일·문서에 붙여 넣지 말고 에이전트 실행 환경의 비밀 설정에만 넣으세요. service_role 키는 절대 쓰지 않습니다.</span>
      </section>
      <section className="section">
        <div className="section-h">
          <span className="t-bodyb">3. 기록하기 (예시)</span>
        </div>
        <span className="t-smallb">리서치 등록 → 자료실 '새 자료'</span>
        <Code>{call('research', '{"kind":"팝업","title":"성수 플랜트 하우스 팝업 오픈","summary":"체험형 팝업, 주말 예약제","body":"기간: 10.18 – 11.02\\n공개 연락처: collab@brand.com","source_url":"https://…","source_name":"공식 보도자료","brand_name":"플랜트 하우스","tags":["성수"]}')}</Code>
        <span className="t-smallb">브랜드 담당자 (같은 이메일은 빈 칸만 채움, 수신거부는 그대로)</span>
        <Code>{call('contact', '{"brand_name":"플랜트 하우스","email":"collab@brand.com","contact_name":"협업 담당","source_type":"에이전트 리서치","source_url":"https://…"}')}</Code>
        <span className="t-smallb">할 일 배정 (알람 포함)</span>
        <Code>{call('task', '{"title":"플랜트 하우스 협업 제안 메일","assignee_id":"<현황 읽기의 work_logs_today[].user_id>","due_date":"2026-10-14","remind_at":"2026-10-14T09:30"}')}</Code>
        <span className="t-cap">remind_at 에 시간대를 안 쓰면 한국 시간으로 봅니다.</span>
        <span className="t-smallb">일일 보고 (승인 › 일일 보고로 도착)</span>
        <Code>{call('daily_report', '{"date":"2026-10-12","title":"10/12 프로젝트 일일 보고","stats":{"active_projects":2,"done_today":4,"overdue":1,"new_research":3},"content":"■ 오늘 요약\\n…\\n■ 이슈 · 리스크\\n…\\n■ 내일 할 일\\n…"}')}</Code>
        <span className="t-smallb">현황 읽기 (프로젝트·할 일·승인 대기 요약)</span>
        <Code>{`curl -s "$WKLY_ERP_URL/rest/v1/rpc/agent_snapshot" \\\n  -H "apikey: $WKLY_ERP_ANON_KEY" -H "Authorization: Bearer $WKLY_ERP_ANON_KEY" \\\n  -H "Content-Type: application/json" -d '{"p_token":"'"$WKLY_ERP_AGENT_TOKEN"'"}'`}</Code>
        <span className="t-cap">
          '재무 요약' 권한도 있는 키는 결과에 finance 가 붙습니다: 프로젝트별 계약·예산·비용·마진율·미수금·연체, 예산 넘은 공사 구분, 다음 월요일 이체 건수·금액. 합계와 비율만 있고 업체·계좌·사람 이름은 없습니다.
        </span>
      </section>
      <section className="section">
        <div className="section-h">
          <span className="t-bodyb">4. WKLY 총괄의 하루</span>
        </div>
        <span className="t-small">· 08:30 현황 읽기 → 오늘 할 일을 팀원에게 배정 (알람 포함)</span>
        <span className="t-small">· 낮 동안 리서치 에이전트가 모은 자료 검토 → 활용 제안을 할 일로</span>
        <span className="t-small">· 18:00 일일 보고 제출: 오늘 요약 · 프로젝트별 현황 · 이슈/리스크(연체·예산 초과·마진) · 내일 할 일 · 자료 활용 제안</span>
        <span className="t-small">· 월요일 아침에는 이번 주 이체 건수·금액과 대기·보류 건을 관리자에게 알림</span>
        <span className="t-cap">사람 매니저가 총괄을 맡으면 승인 › 요청 › '일일 보고'로 같은 형식을 제출하면 됩니다. 자세한 설정은 저장소의 docs/AGENTS.md 를 참고하세요.</span>
      </section>
    </>
  )
}
