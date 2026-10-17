import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { isOverdue, sameName, vendorSummary } from '../lib/finance'
import { openGmail, telUrl } from '../lib/links'
import { Link, useRouter, withQuery } from '../lib/router'
import { CLIENT_CATEGORIES, type Client, type ClientCategory, type Contact, type ExchangeFile, type Payment, type Project, type ResearchItem, type WorkLog } from '../lib/types'
import { REPORT_KIND, ReportBody, ReportForm, clientCatLabel } from '../components/Reports'
import { ContactProjectsSection, ContactTimeline, ExchangeFilesSection } from '../components/ContactHistory'
import { Shell } from '../components/Shell'
import { Badge, Button, Chip, Empty, Field, Modal, SectionHead, StatusBadge } from '../components/ui'

export default function Clients() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<ClientCategory | null>(null)
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
  const { data: clients, loading } = useAsync(() => api.listClients(), [version], [] as Client[])
  // 검색: 거래처 정보 + 담당자(이름·메일·연락처) + 리서치 보고서 내용
  const { data: extra } = useAsync(
    async () => {
      const [contacts, research] = await Promise.all([api.listContacts().catch(() => [] as Contact[]), api.listResearch().catch(() => [] as ResearchItem[])])
      return { contacts, reports: research.filter(r => r.kind === REPORT_KIND && r.client_id) }
    },
    [version],
    { contacts: [] as Contact[], reports: [] as ResearchItem[] },
  )
  const selectedId = query.get('id')
  const selected = clients.find(c => c.id === selectedId) ?? null
  const haystack = useMemo(() => {
    const m = new Map<string, string>()
    const add = (id: string, ...v: (string | null | undefined)[]) => m.set(id, `${m.get(id) ?? ''} ${v.filter(Boolean).join(' ')}`)
    for (const c of clients) add(c.id, c.name, c.memo, c.email, c.phone, c.website, c.business_no, c.address)
    for (const x of extra.contacts) add(x.client_id, x.name, x.title, x.email, x.phone, x.memo)
    for (const r of extra.reports) add(r.client_id!, r.title, r.summary, r.tags.join(' '), r.body)
    for (const [k, v] of m) m.set(k, v.toLowerCase())
    return m
  }, [clients, extra])
  const reported = useMemo(() => new Set(extra.reports.map(r => r.client_id)), [extra.reports])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = clients.filter(c => (!cat || c.category === cat) && (!words.length || words.every(w => haystack.get(c.id)?.includes(w))))
  const go = (id: string | null) => navigate(withQuery(path, query, { id, view: null, pid: null }), { replace: true })
  const people = query.get('view') === 'people'
  const setView = (v: 'people' | null) => navigate(withQuery(path, query, { view: v, pid: null }), { replace: true })
  const pid = query.get('pid')
  const person = people ? extra.contacts.find(x => x.id === pid) ?? null : null
  const goPerson = (id: string | null) => navigate(withQuery(path, query, { pid: id }), { replace: true })

  return (
    <Shell active="clients" flush>
      <div className={`split ${(people ? person : selected) ? 'has-detail' : ''}`}>
        <div className="pane-list">
          <div className="seg" role="tablist" aria-label="보기">
            <button type="button" role="tab" aria-selected={!people} className={!people ? 'on' : ''} onClick={() => setView(null)}>
              거래처 {clients.length}
            </button>
            <button type="button" role="tab" aria-selected={people} className={people ? 'on' : ''} onClick={() => setView('people')}>
              연락처 {extra.contacts.length}
            </button>
          </div>
          {people ? (
            <PeopleList contacts={extra.contacts} clients={clients} selectedId={pid} onSelect={goPerson} />
          ) : (
          <>
          <div className="pane-head">
            <div className="row">
              <span className="t-bodyb grow">거래처 {clients.length}</span>
              <button type="button" className="icon-btn" onClick={() => setEditing('new')} aria-label="거래처 추가" title="거래처 추가">
                <Plus size={18} />
              </button>
            </div>
            <div className="search">
              <Search size={14} />
              <input className="input" placeholder="협력사·발주처 · 담당자 · 이메일 · 보고서 검색" value={q} onChange={e => setQ(e.target.value)} aria-label="거래처 검색" />
            </div>
            <div className="chips">
              <Chip active={!cat} onClick={() => setCat(null)}>
                전체
              </Chip>
              {CLIENT_CATEGORIES.map(c => (
                <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
                  {clientCatLabel(c)} {clients.filter(x => x.category === c).length}
                </Chip>
              ))}
            </div>
          </div>
          <div className="pane-body">
            {list.map(c => (
              <button key={c.id} type="button" className={`item ${c.id === selectedId ? 'active' : ''}`} onClick={() => go(c.id)}>
                <div className="row">
                  <span className="col gap-2 grow" style={{ minWidth: 0 }}>
                    <span className="t-smallb truncate">{c.name}</span>
                    <span className="t-cap truncate">
                      {clientCatLabel(c.category)}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </span>
                  </span>
                  {reported.has(c.id) && <span className="t-meta">보고서</span>}
                </div>
              </button>
            ))}
            {list.length === 0 && <Empty>{loading ? '불러오는 중…' : words.length ? '찾는 거래처가 없습니다.' : '거래처가 없습니다.'}</Empty>}
          </div>
          </>
          )}
        </div>
        <div className="pane-detail" style={{ overflow: 'auto' }}>
          {people ? (
            person ? (
              <ContactDetail key={person.id} contact={person} contacts={extra.contacts} clients={clients} onClient={go} onPerson={goPerson} />
            ) : (
              <Empty>왼쪽에서 사람을 고르세요.</Empty>
            )
          ) : selected ? (
            <ClientDetail key={selected.id} client={selected} clients={clients} onEdit={() => setEditing(selected)} onBack={() => go(null)} />
          ) : (
            <Empty>왼쪽에서 거래처를 고르세요.</Empty>
          )}
        </div>
      </div>
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={id => go(id)} />}
    </Shell>
  )
}

function ClientDetail({ client: c, clients, onEdit, onBack }: { client: Client; clients: Client[]; onEdit: () => void; onBack: () => void }) {
  const { api, me, version } = useApp()
  const { navigate } = useRouter()
  const { run } = useAction()
  const [contactForm, setContactForm] = useState<Contact | 'new' | null>(null)
  const [reportForm, setReportForm] = useState<ResearchItem | 'new' | null>(null)
  const { data } = useAsync(
    async () => {
      const [contacts, logs, projects, research] = await Promise.all([api.listContacts(c.id), api.listWorkLogs({ clientId: c.id, limit: 100 }), api.listProjects(), api.listResearch()])
      return { contacts, logs, projects: projects.filter(p => p.client_id === c.id), allProjects: projects, reports: research.filter(r => r.client_id === c.id) }
    },
    [c.id, version],
    { contacts: [] as Contact[], logs: [] as WorkLog[], projects: [] as Project[], allProjects: [] as Project[], reports: [] as ResearchItem[] },
  )
  const setPrimary = async (contacts: Contact[], id: string) => {
    await Promise.all(contacts.filter(o => o.is_primary && o.id !== id).map(o => api.saveContact({ id: o.id, is_primary: false })))
    await api.saveContact({ id, is_primary: true })
  }
  const primary = data.contacts.find(x => x.is_primary) ?? data.contacts[0]
  const mailTo = primary?.email || c.email
  const phone = primary?.phone || c.phone

  return (
    <div className="col gap-10" style={{ padding: '14px 16px' }}>
      <div className="row wrap">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        <h2 className="t-title">{c.name}</h2>
        <Badge>{clientCatLabel(c.category)}</Badge>
        <span className="grow" />
        {phone && (
          <a className="btn btn-outline btn-sm" href={telUrl(phone)}>
            전화
          </a>
        )}
        {mailTo && (
          <Button kind="outline" size="sm" onClick={() => openGmail({ to: mailTo })}>
            메일 쓰기
          </Button>
        )}
        <Button kind="yellow" size="sm" onClick={() => navigate(`/work?client=${c.id}`)}>
          업무 기록
        </Button>
        <button type="button" className="icon-btn" onClick={onEdit} aria-label="거래처 수정" title="수정">
          <Pencil size={15} />
        </button>
        {me.role === 'admin' && (
          <button
            type="button"
            className="icon-btn"
            aria-label="거래처 삭제"
            title="삭제 (관리자)"
            onClick={async () => {
              if (window.confirm(`'${c.name}' 거래처와 담당자를 삭제할까요? 업무 기록은 남습니다.`) && (await run(() => api.deleteClient(c.id), '삭제했습니다.'))) onBack()
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="box">
        <dl className="kv">
          {(
            [
              ['사업자번호', c.business_no],
              ['대표 연락처', c.phone],
              ['이메일', c.email],
              ['주소', c.address],
              ['웹사이트', c.website],
              ['메모', c.memo],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd className="pre">{k === '웹사이트' ? <a href={/^https?:\/\//.test(v!) ? v! : `https://${v}`} target="_blank" rel="noreferrer">{v}</a> : v}</dd>
              </div>
            ))}
        </dl>
        {![c.business_no, c.phone, c.email, c.address, c.website, c.memo].some(Boolean) && <span className="t-cap">등록된 정보가 없습니다. 연필 버튼으로 채워 주세요.</span>}
      </div>
      <ClientReports reports={data.reports} onWrite={() => setReportForm('new')} onEdit={r => setReportForm(r)} />
      <div className="row top gap-12" style={{ flexWrap: 'wrap' }}>
        <div className="col grow" style={{ flexBasis: 220 }}>
          <SectionHead title="담당자" right={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setContactForm('new')}>+ 추가</button>} />
          {data.contacts.map(x => (
            <div key={x.id} className="col gap-2 dashed" style={{ padding: '6px 0' }}>
              <div className="row">
                <button type="button" className="t-smallb" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setContactForm(x)}>
                  {x.name} {x.title}
                </button>
                {x.is_primary && <Badge tone="yellow">대표</Badge>}
                <span className="grow" />
                {!x.is_primary && (
                  <button type="button" className="icon-btn sm" title="대표 담당자로" aria-label="대표 담당자로" onClick={() => run(() => setPrimary(data.contacts, x.id))}>
                    <Star size={13} />
                  </button>
                )}
              </div>
              <span className="t-cap">
                {x.phone && <a href={telUrl(x.phone)}>{x.phone}</a>}
                {x.phone && x.email && ' · '}
                {x.email && (
                  <button type="button" style={{ border: 0, background: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', font: 'inherit' }} onClick={() => openGmail({ to: x.email })}>
                    {x.email}
                  </button>
                )}
              </span>
            </div>
          ))}
          {data.contacts.length === 0 && <span className="t-cap">담당자를 추가하세요.</span>}
          <SectionHead title="프로젝트" />
          <div className="chips">
            {data.projects.map(p => (
              <Link key={p.id} to={`/projects?id=${p.id}`}>
                <span className="row" style={{ gap: 4 }}>
                  <StatusBadge status={p.status} />
                  <span className="t-small">{p.name}</span>
                </span>
              </Link>
            ))}
            {data.projects.length === 0 && <span className="t-cap">연결된 프로젝트가 없습니다.</span>}
          </div>
          {me.role === 'admin' && <ClientPayments client={c} projects={data.allProjects} />}
        </div>
        <div className="col grow" style={{ flexBasis: 240 }}>
          <SectionHead title="커뮤니케이션 이력" count={data.logs.length ? String(data.logs.length) : undefined} right="업무 일지 연동" />
          <ContactTimeline logs={data.logs} projects={data.allProjects} showContact contacts={data.contacts} />
          <ExchangeFilesSection clientId={c.id} contacts={data.contacts} projects={data.allProjects} />
        </div>
      </div>
      {reportForm && <ReportForm item={reportForm === 'new' ? null : reportForm} clients={clients} presetClient={c.id} onClose={() => setReportForm(null)} />}
      {contactForm && <ContactForm clientId={c.id} contact={contactForm === 'new' ? null : contactForm} others={data.contacts} onClose={() => setContactForm(null)} />}
    </div>
  )
}

/** 거래처 리서치 보고서: 최신 보고서는 펼쳐서, 이전 것은 목록으로 */
function ClientReports({ reports, onWrite, onEdit }: { reports: ResearchItem[]; onWrite: () => void; onEdit: (r: ResearchItem) => void }) {
  const { profileName, profileOf } = useApp()
  const list = reports.filter(r => r.kind === REPORT_KIND).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const others = reports.filter(r => r.kind !== REPORT_KIND)
  // 처음에는 최신 보고서를 펼침 (undefined = 자동)
  const [picked, setOpen] = useState<string | null | undefined>(undefined)
  const open = picked === undefined ? list[0]?.id ?? null : picked
  return (
    <div className="col gap-6">
      <SectionHead
        title="리서치 보고서"
        right={
          <button type="button" className="btn btn-ghost btn-sm" onClick={onWrite}>
            보고서 쓰기
          </button>
        }
      />
      {list.length === 0 && <span className="t-cap">아직 보고서가 없습니다. AI 팀원이 매일 아침 메일 온 거래처와 과거 거래처 순서로 작성합니다.</span>}
      {list.map(r => (
        <div key={r.id} className="box col gap-6">
          <button type="button" className="row report-toggle" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="t-smallb grow">{r.title}</span>
            <span className="t-cap">
              {r.collected_by_agent ? `🤖 ${(profileOf(r.collected_by_agent)?.name ?? r.collected_by_agent)}` : profileName(r.created_by)} · {shortDate(r.created_at.slice(0, 10))}
              {r.shared_to ? ` · ${profileName(r.shared_to)}님께 보고` : ''}
            </span>
          </button>
          {open === r.id && (
            <>
              {r.summary && <div className="note pre">{r.summary}</div>}
              {r.body && <ReportBody body={r.body} />}
              <div className="row" style={{ gap: 6 }}>
                <Link to={`/library?id=${r.id}`} className="btn btn-outline btn-sm">
                  자료실에서 보기
                </Link>
                <Button kind="ghost" size="sm" onClick={() => onEdit(r)}>
                  고치기
                </Button>
              </div>
            </>
          )}
        </div>
      ))}
      {others.length > 0 && (
        <span className="t-cap">
          관련 자료:{' '}
          {others.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ' · '}
              <Link to={`/library?id=${r.id}`}>{r.title}</Link>
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/** 거래처 상세의 결제 현황 (관리자): 전체 합계 + 프로젝트별 */
function ClientPayments({ client: c, projects }: { client: Client; projects: Project[] }) {
  const { api, version } = useApp()
  const today = todayKey()
  const { data: list } = useAsync(async () => (await api.listPayments()).filter(p => p.client_id === c.id || (!p.client_id && sameName(p.payee, c.name))), [c.id, version], [] as Payment[])
  const v = vendorSummary(list, [c], today)[0]
  const groups = useMemo(() => {
    const m = new Map<string, Payment[]>()
    for (const p of list) m.set(p.project_id ?? '', [...(m.get(p.project_id ?? '') ?? []), p])
    const name = (id: string) => (id ? projects.find(x => x.id === id)?.name ?? '프로젝트' : '프로젝트 미지정')
    return [...m.entries()]
      .map(([id, rows]) => ({ id, name: name(id), project: projects.find(x => x.id === id) ?? null, rows: rows.slice().sort((a, b) => (b.due_date ?? b.paid_date ?? '').localeCompare(a.due_date ?? a.paid_date ?? '')), sum: vendorSummary(rows, [c], today)[0] }))
      .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || (b.rows[0]?.due_date ?? '').localeCompare(a.rows[0]?.due_date ?? ''))
  }, [list, projects, c, today])
  const line = (s: NonNullable<typeof v>) => (
    <>
      받을 돈 <b className="t-blue">{manwon(s.receivable) || '0'}</b> · 받은 돈 {manwon(s.received) || '0'} · 줄 돈 <b className="t-blue">{manwon(s.payable) || '0'}</b> · 준 돈 {manwon(s.paid) || '0'}
      {s.overdue > 0 && <span className="t-red"> · 연체 {s.overdue}건</span>}
    </>
  )
  return (
    <>
      <SectionHead title="결제 현황 (프로젝트별)" right={<Link to={`/projects?view=payments&q=${encodeURIComponent(c.name)}`}>결제 대장 ›</Link>} />
      {!v ? (
        <span className="t-cap">결제 내역이 없습니다.</span>
      ) : (
        <>
          <span className="t-cap">전체 · {line(v)} (공급가액)</span>
          {groups.map(g => (
            <div key={g.id || 'none'} className="pay-group">
              <div className="row" style={{ gap: 6 }}>
                {g.project && <StatusBadge status={g.project.status} />}
                {g.id ? (
                  <Link to={`/projects?id=${g.id}`} className="t-smallb grow truncate">
                    {g.name}
                  </Link>
                ) : (
                  <span className="t-smallb grow">{g.name}</span>
                )}
                <span className="t-meta">{g.rows.length}건</span>
              </div>
              {g.sum && <span className="t-cap">{line(g.sum)}</span>}
              {g.rows.slice(0, 8).map(p => (
                <Link key={p.id} to={`/projects?view=payments&pid=${p.id}`} className="row t-small dashed" style={{ padding: '4px 0', color: 'inherit' }}>
                  <Badge tone={p.direction === '수금' ? 'blue' : 'gray'}>{p.direction}</Badge>
                  <span className="truncate grow">{p.title}</span>
                  <span className="t-meta t-blue">{manwon(p.amount)}</span>
                  <Badge tone={isOverdue(p, today) ? 'red' : p.status === '완료' ? 'acid' : 'outline'}>{isOverdue(p, today) ? '연체' : p.status}</Badge>
                </Link>
              ))}
              {g.rows.length > 8 && <span className="t-cap">외 {g.rows.length - 8}건 · 결제 대장에서 보기</span>}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function ClientForm({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Partial<Client>>(() => client ?? { name: '', category: '클라이언트' })
  const set = (p: Partial<Client>) => setF(prev => ({ ...prev, ...p }))
  const text = (k: keyof Client, label: string, full = false, type = 'text') => (
    <Field label={label} className={full ? 'full' : ''}>
      <input className="input" type={type} value={(f[k] as string) ?? ''} onChange={e => set({ [k]: e.target.value || null } as Partial<Client>)} />
    </Field>
  )
  const submit = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await api.saveClient({ ...f, name: (f.name ?? '').trim() })).id
    }, client ? '저장했습니다.' : '거래처를 추가했습니다.')
    if (ok) {
      onClose()
      onSaved(id)
    }
  }
  return (
    <Modal
      title={client ? '거래처 수정' : '거래처 추가'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !f.name?.trim()} onClick={submit}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="이름">
          <input className="input" autoFocus value={f.name ?? ''} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="구분">
          <select className="select" value={f.category} onChange={e => set({ category: e.target.value as ClientCategory })}>
            {CLIENT_CATEGORIES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {text('business_no', '사업자번호')}
        {text('phone', '대표 연락처', false, 'tel')}
        {text('email', '이메일', true, 'email')}
        {text('address', '주소', true)}
        {text('website', '웹사이트', true)}
        <Field label="메모" className="full">
          <textarea className="textarea" rows={3} value={f.memo ?? ''} onChange={e => set({ memo: e.target.value || null })} />
        </Field>
      </div>
    </Modal>
  )
}

/** 거래처 담당자를 사람 기준으로 모아 보기 · 검색 (이름 · 회사 · 직함 · 전화 · 이메일 · 메모) — 거래처 목록과 같은 구성 */
function PeopleList({ contacts, clients, selectedId, onSelect }: { contacts: Contact[]; clients: Client[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const byId = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const digits = q.replace(/\D/g, '')
  const list = contacts
    .filter(x => {
      if (!words.length) return true
      const hay = [x.name, x.title, x.email, x.phone, x.memo, byId.get(x.client_id)?.name].filter(Boolean).join(' ').toLowerCase()
      return words.every(w => hay.includes(w)) || (digits.length >= 3 && (x.phone ?? '').replace(/\D/g, '').includes(digits))
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return (
    <>
      <div className="pane-head">
        <div className="row">
          <span className="t-bodyb grow">연락처 {contacts.length}</span>
          <button type="button" className="icon-btn" onClick={() => setAdding(true)} aria-label="연락처 추가" title="연락처 추가">
            <Plus size={18} />
          </button>
        </div>
        <div className="search">
          <Search size={14} />
          <input className="input" placeholder="이름 · 회사 · 직함 · 전화 · 이메일 검색" value={q} onChange={e => setQ(e.target.value)} aria-label="연락처 검색" />
        </div>
      </div>
      <div className="pane-body">
        {list.map(x => (
          <button key={x.id} type="button" className={`item ${x.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(x.id)}>
            <span className="col gap-2" style={{ minWidth: 0 }}>
              <span className="t-smallb truncate">
                {x.name}
                {x.title ? ` ${x.title}` : ''}
              </span>
              <span className="t-cap truncate">
                {byId.get(x.client_id)?.name ?? ''}
                {x.phone ? ` · ${x.phone}` : ''}
              </span>
            </span>
          </button>
        ))}
        {list.length === 0 && <Empty>{words.length ? '찾는 사람이 없습니다.' : '연락처가 없습니다.'}</Empty>}
      </div>
      {adding && <ContactForm clientId={null} clients={clients} contact={null} others={[]} onClose={() => setAdding(false)} />}
    </>
  )
}

/** 연락처(사람) 상세: 회사 · 전화 · 메일 · 메모 + 같은 회사 다른 담당자 */
function ContactDetail({ contact: x, contacts, clients, onClient, onPerson }: { contact: Contact; contacts: Contact[]; clients: Client[]; onClient: (id: string) => void; onPerson: (id: string | null) => void }) {
  const { api, version } = useApp()
  const [editing, setEditing] = useState(false)
  const c = clients.find(k => k.id === x.client_id)
  const others = contacts.filter(o => o.client_id === x.client_id && o.id !== x.id)
  // 이 사람과의 모든 기록: 연락 이력(업무 일지) · 주고받은 자료 · 프로젝트
  const { data } = useAsync(
    async () => {
      const [logs, files, projects] = await Promise.all([api.listWorkLogs({ contactId: x.id, limit: 200 }), api.listExchangeFiles({ contactId: x.id }), api.listProjects()])
      return { logs, files, projects }
    },
    [x.id, version],
    { logs: [] as WorkLog[], files: [] as ExchangeFile[], projects: [] as Project[] },
  )
  const last = data.logs[0]
  return (
    <div className="col gap-10" style={{ padding: '14px 16px' }}>
      <div className="row wrap">
        <button type="button" className="icon-btn back-btn" onClick={() => onPerson(null)} aria-label="목록으로">
          <ArrowLeft size={18} />
        </button>
        <h2 className="t-title">{x.name}</h2>
        {x.title && <span className="t-small">{x.title}</span>}
        {x.is_primary && <Badge tone="yellow">대표 담당자</Badge>}
        <span className="grow" />
        {x.phone && (
          <a className="btn btn-outline btn-sm" href={telUrl(x.phone)}>
            전화
          </a>
        )}
        {x.email && (
          <Button kind="outline" size="sm" onClick={() => openGmail({ to: x.email })}>
            메일 쓰기
          </Button>
        )}
        <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="연락처 수정" title="수정">
          <Pencil size={15} />
        </button>
      </div>
      <dl className="kv">
        <dt>회사</dt>
        <dd>
          {c ? (
            <button type="button" className="link-btn" onClick={() => onClient(c.id)}>
              {c.name} ›
            </button>
          ) : (
            '-'
          )}
        </dd>
        <dt>전화</dt>
        <dd>{x.phone ? <a href={telUrl(x.phone)}>{x.phone}</a> : '-'}</dd>
        <dt>이메일</dt>
        <dd>{x.email ?? '-'}</dd>
        <dt>메모</dt>
        <dd>{x.memo ?? '-'}</dd>
        <dt>최근 연락</dt>
        <dd>{last ? `${shortDate(last.log_date)} · ${last.kind}${last.project_id ? ` · ${data.projects.find(p => p.id === last.project_id)?.name ?? ''}` : ''}` : '-'}</dd>
      </dl>
      <div className="row top gap-12" style={{ flexWrap: 'wrap' }}>
        <div className="col grow gap-10" style={{ flexBasis: 340 }}>
          <SectionHead title="연락 이력" count={data.logs.length ? String(data.logs.length) : undefined} right={<Link to={`/work?client=${x.client_id}`}>업무 일지 ›</Link>} />
          <ContactTimeline logs={data.logs} projects={data.projects} />
        </div>
        <div className="col grow gap-12" style={{ flexBasis: 300 }}>
          <ContactProjectsSection contact={x} projects={data.projects} logs={data.logs} files={data.files} />
          <ExchangeFilesSection clientId={x.client_id} contactId={x.id} contacts={contacts} projects={data.projects} />
        </div>
      </div>
      {others.length > 0 && (
        <>
          <SectionHead title={`${c?.name ?? ''} 다른 담당자`} />
          {others.map(o => (
            <button key={o.id} type="button" className="item-row link-row" onClick={() => onPerson(o.id)}>
              <span className="t-smallb">
                {o.name}
                {o.title ? ` ${o.title}` : ''}
              </span>
              <span className="t-cap grow">{o.phone ?? o.email ?? ''}</span>
            </button>
          ))}
        </>
      )}
      {editing && <ContactForm clientId={x.client_id} clients={clients} contact={x} others={contacts.filter(o => o.client_id === x.client_id)} onClose={() => setEditing(false)} />}
    </div>
  )
}

function ContactForm({ clientId, contact, others, onClose, clients }: { clientId: string | null; contact: Contact | null; others: Contact[]; onClose: () => void; clients?: Client[] }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Partial<Contact>>(() => contact ?? { client_id: clientId ?? undefined, name: '', is_primary: !!clientId && others.length === 0 })
  const set = (p: Partial<Contact>) => setF(prev => ({ ...prev, ...p }))
  const save = async () => {
    // 대표 담당자는 한 명만
    if (f.is_primary) await Promise.all(others.filter(o => o.is_primary && o.id !== f.id).map(o => api.saveContact({ id: o.id, is_primary: false })))
    await api.saveContact({ ...f, name: (f.name ?? '').trim() })
  }
  return (
    <Modal
      title={contact ? '담당자 수정' : '담당자 추가'}
      onClose={onClose}
      actions={
        <>
          {contact && (
            <Button kind="ghost" onClick={async () => window.confirm('이 담당자를 삭제할까요?') && (await run(() => api.deleteContact(contact.id), '삭제했습니다.')) && onClose()}>
              삭제
            </Button>
          )}
          <span className="grow" />
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !f.name?.trim() || !f.client_id} onClick={async () => (await run(save, '저장했습니다.')) && onClose()}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {clients && (
          <Field label="회사 (거래처)" className="full">
            <select className="input" value={f.client_id ?? ''} onChange={e => set({ client_id: e.target.value || undefined })}>
              <option value="">거래처 선택</option>
              {[...clients].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="이름">
          <input className="input" autoFocus value={f.name ?? ''} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label="직함">
          <input className="input" value={f.title ?? ''} onChange={e => set({ title: e.target.value || null })} />
        </Field>
        <Field label="전화">
          <input className="input" type="tel" value={f.phone ?? ''} onChange={e => set({ phone: e.target.value || null })} />
        </Field>
        <Field label="이메일">
          <input className="input" type="email" value={f.email ?? ''} onChange={e => set({ email: e.target.value || null })} />
        </Field>
        <Field label="메모" className="full">
          <input className="input" value={f.memo ?? ''} onChange={e => set({ memo: e.target.value || null })} />
        </Field>
        <label className="row t-small full">
          <input type="checkbox" checked={!!f.is_primary} onChange={e => set({ is_primary: e.target.checked })} /> 대표 담당자
        </label>
      </div>
    </Modal>
  )
}
