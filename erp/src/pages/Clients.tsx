import { useState } from 'react'
import { ArrowLeft, Mail, Notebook, Pencil, Phone, Plus, Search, Star, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, timeLabel, todayKey } from '../lib/date'
import { isOverdue, sameName, vendorSummary } from '../lib/finance'
import { openGmail, telUrl } from '../lib/links'
import { Link, useRouter, withQuery } from '../lib/router'
import { CLIENT_CATEGORIES, type Client, type ClientCategory, type Contact, type Payment, type Project, type WorkLog } from '../lib/types'
import { Shell } from '../components/Shell'
import { Avatar, Badge, Button, Chip, Empty, Field, KindBadge, Modal, SectionHead, StatusBadge } from '../components/ui'

export default function Clients() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<ClientCategory | null>(null)
  const [editing, setEditing] = useState<Client | 'new' | null>(null)
  const { data: clients, loading } = useAsync(() => api.listClients(), [version], [] as Client[])
  const selectedId = query.get('id')
  const selected = clients.find(c => c.id === selectedId) ?? null
  const term = q.trim().toLowerCase()
  const list = clients.filter(c => (!cat || c.category === cat) && (!term || [c.name, c.memo, c.email, c.phone].some(v => v?.toLowerCase().includes(term))))
  const go = (id: string | null) => navigate(withQuery(path, query, { id }), { replace: true })

  return (
    <Shell active="clients" flush>
      <div className={`split ${selected ? 'has-detail' : ''}`}>
        <div className="pane-list">
          <div className="pane-head">
            <div className="row">
              <span className="t-bodyb grow">거래처 {clients.length}</span>
              <button type="button" className="icon-btn" onClick={() => setEditing('new')} aria-label="거래처 추가" title="거래처 추가">
                <Plus size={18} />
              </button>
            </div>
            <div className="search">
              <Search size={14} />
              <input className="input" placeholder="이름·메모 검색" value={q} onChange={e => setQ(e.target.value)} aria-label="거래처 검색" />
            </div>
            <div className="chips">
              <Chip active={!cat} onClick={() => setCat(null)}>
                전체
              </Chip>
              {CLIENT_CATEGORIES.map(c => (
                <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
          <div className="pane-body">
            {list.map(c => (
              <button key={c.id} type="button" className={`item ${c.id === selectedId ? 'active' : ''}`} onClick={() => go(c.id)}>
                <div className="row">
                  <Avatar name={c.name} size="sm" />
                  <span className="col gap-2 grow">
                    <span className="t-smallb truncate">{c.name}</span>
                    <span className="t-cap truncate">
                      {c.category}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </span>
                  </span>
                </div>
              </button>
            ))}
            {list.length === 0 && <Empty>{loading ? '불러오는 중…' : '거래처가 없습니다.'}</Empty>}
          </div>
        </div>
        <div className="pane-detail" style={{ overflow: 'auto' }}>
          {selected ? <ClientDetail key={selected.id} client={selected} onEdit={() => setEditing(selected)} onBack={() => go(null)} /> : <Empty>왼쪽에서 거래처를 고르세요.</Empty>}
        </div>
      </div>
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={id => go(id)} />}
    </Shell>
  )
}

function ClientDetail({ client: c, onEdit, onBack }: { client: Client; onEdit: () => void; onBack: () => void }) {
  const { api, me, version, profileName } = useApp()
  const { navigate } = useRouter()
  const { run } = useAction()
  const [contactForm, setContactForm] = useState<Contact | 'new' | null>(null)
  const { data } = useAsync(
    async () => {
      const [contacts, logs, projects] = await Promise.all([api.listContacts(c.id), api.listWorkLogs({ clientId: c.id, limit: 30 }), api.listProjects()])
      return { contacts, logs, projects: projects.filter(p => p.client_id === c.id) }
    },
    [c.id, version],
    { contacts: [] as Contact[], logs: [] as WorkLog[], projects: [] as Project[] },
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
        <Badge>{c.category}</Badge>
        <span className="grow" />
        {phone && (
          <a className="btn btn-outline btn-sm" href={telUrl(phone)}>
            <Phone size={13} /> 전화
          </a>
        )}
        {mailTo && (
          <Button kind="outline" size="sm" onClick={() => openGmail({ to: mailTo })}>
            <Mail size={13} /> 메일 쓰기
          </Button>
        )}
        <Button kind="yellow" size="sm" onClick={() => navigate(`/work?client=${c.id}`)}>
          <Notebook size={13} /> 업무 기록
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
          {me.role === 'admin' && <ClientPayments client={c} />}
        </div>
        <div className="col grow" style={{ flexBasis: 240 }}>
          <SectionHead title="커뮤니케이션 이력" right="업무 일지 연동" />
          {data.logs.map(l => (
            <div key={l.id} className="col gap-2 dashed" style={{ padding: '6px 0' }}>
              <div className="row">
                <span className="t-meta">
                  {shortDate(l.log_date)} {timeLabel(l.created_at)}
                </span>
                <KindBadge kind={l.kind} />
                <span className="t-cap">{profileName(l.user_id)}</span>
              </div>
              <span className="t-small t-blue pre">{l.content}</span>
              {l.email_subject && <span className="t-cap">✉ {l.email_subject}</span>}
            </div>
          ))}
          {data.logs.length === 0 && <span className="t-cap">업무 일지에서 이 거래처를 골라 기록하면 여기에 쌓입니다.</span>}
        </div>
      </div>
      {contactForm && <ContactForm clientId={c.id} contact={contactForm === 'new' ? null : contactForm} others={data.contacts} onClose={() => setContactForm(null)} />}
    </div>
  )
}

/** 거래처 상세의 결제 현황 (관리자) */
function ClientPayments({ client: c }: { client: Client }) {
  const { api, version } = useApp()
  const today = todayKey()
  const { data: list } = useAsync(async () => (await api.listPayments()).filter(p => p.client_id === c.id || (!p.client_id && sameName(p.payee, c.name))), [c.id, version], [] as Payment[])
  const v = vendorSummary(list, [c], today)[0]
  return (
    <>
      <SectionHead title="결제 현황" right={<Link to={`/projects?view=payments&q=${encodeURIComponent(c.name)}`}>결제 대장 ›</Link>} />
      {!v ? (
        <span className="t-cap">결제 내역이 없습니다.</span>
      ) : (
        <>
          <span className="t-cap">
            받을 돈 <b className="t-blue">{manwon(v.receivable) || '0'}</b> · 받은 돈 {manwon(v.received) || '0'} · 줄 돈 <b className="t-blue">{manwon(v.payable) || '0'}</b> · 준 돈 {manwon(v.paid) || '0'} (공급가액)
            {v.overdue > 0 && <span className="t-red"> · 연체 {v.overdue}건</span>}
          </span>
          {list
            .slice()
            .sort((a, b) => (b.due_date ?? b.paid_date ?? '').localeCompare(a.due_date ?? a.paid_date ?? ''))
            .slice(0, 6)
            .map(p => (
              <Link key={p.id} to={`/projects?view=payments&pid=${p.id}`} className="row t-small dashed" style={{ padding: '4px 0', color: 'inherit' }}>
                <Badge tone={p.direction === '수금' ? 'blue' : 'gray'}>{p.direction}</Badge>
                <span className="truncate grow">{p.title}</span>
                <span className="t-meta t-blue">{manwon(p.amount)}</span>
                <Badge tone={isOverdue(p, today) ? 'red' : p.status === '완료' ? 'acid' : 'outline'}>{isOverdue(p, today) ? '연체' : p.status}</Badge>
              </Link>
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

function ContactForm({ clientId, contact, others, onClose }: { clientId: string; contact: Contact | null; others: Contact[]; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Partial<Contact>>(() => contact ?? { client_id: clientId, name: '', is_primary: others.length === 0 })
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
          <Button disabled={busy || !f.name?.trim()} onClick={async () => (await run(save, '저장했습니다.')) && onClose()}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
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
