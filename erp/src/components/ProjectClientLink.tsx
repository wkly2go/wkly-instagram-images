import { useState } from 'react'
import { Mail, Phone } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { Link } from '../lib/router'
import type { Client, Contact, Project, ProjectContact, ResearchItem } from '../lib/types'
import { shortDate } from '../lib/date'
import { REPORT_KIND, ReportForm } from './Reports'
import { SectionHead } from './ui'

/**
 * 프로젝트 ↔ 거래처 담당자 연락처 · 거래처 보고서 바로 연결 (대표 지시 2026-11-10)
 *  - 거래처: 없으면 바로 고르기
 *  - 담당자 연락처: 연결된 사람(전화 · 메일 바로) / 그 거래처의 다른 담당자 '연결' / 새 담당자 바로 추가 → 연결
 *  - 거래처 보고서: 그 거래처 · 이 프로젝트 리서치 보고서 바로 열기 · 새로 쓰기
 */
export function ProjectClientLink({ project: p, clients, contacts }: { project: Project; clients: Client[]; contacts: Contact[] }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const { data: links } = useAsync(() => api.listProjectContacts({ projectId: p.id }), [version, p.id], [] as ProjectContact[])
  const { data: reports } = useAsync(() => api.listResearch().catch(() => [] as ResearchItem[]), [version], [] as ResearchItem[])
  const [adding, setAdding] = useState(false)
  const [nc, setNc] = useState({ name: '', title: '', phone: '', email: '' })
  const [writing, setWriting] = useState(false)
  const client = clients.find(c => c.id === p.client_id)
  const linked = links.map(l => ({ l, c: contacts.find(x => x.id === l.contact_id) })).filter((x): x is { l: ProjectContact; c: Contact } => !!x.c)
  const others = client ? contacts.filter(c => c.client_id === client.id && !links.some(l => l.contact_id === c.id)) : []
  const myReports = reports
    .filter(r => r.kind === REPORT_KIND && ((client && r.client_id === client.id) || r.project_id === p.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const addContact = async () => {
    if (!client || !nc.name.trim()) return
    const ok = await run(async () => {
      const c = await api.saveContact({ client_id: client.id, name: nc.name.trim(), title: nc.title.trim() || null, phone: nc.phone.trim() || null, email: nc.email.trim() || null, memo: null, is_primary: false } as Contact)
      await api.linkProjectContact(p.id, c.id)
    }, '담당자를 추가하고 이 프로젝트에 연결했습니다.')
    if (ok) {
      setNc({ name: '', title: '', phone: '', email: '' })
      setAdding(false)
    }
  }
  return (
    <div className="pcl">
      <SectionHead
        title="거래처 · 담당자 · 보고서"
        right={
          client ? (
            <Link to={`/clients?id=${client.id}`} className="t-cap">
              거래처 화면 ›
            </Link>
          ) : undefined
        }
      />
      <div className="pcl-grid">
        {/* 거래처 + 담당자 연락처 */}
        <div className="pcl-box">
          <div className="pcl-row">
            <span className="pcl-l">거래처</span>
            <select className="select pcl-client" value={p.client_id ?? ''} disabled={busy} onChange={e => run(() => api.saveProject({ id: p.id, client_id: e.target.value || null } as Project), '거래처를 연결했습니다.')} aria-label="거래처">
              <option value="">자체 (거래처 없음)</option>
              {[...clients]
                .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <span className="pcl-l">담당자 연락처</span>
          {linked.length === 0 && <span className="t-cap">아직 연결한 담당자가 없습니다.</span>}
          {linked.map(({ l, c }) => (
            <div key={c.id} className="pcl-person">
              <Link to={`/clients?view=people&pid=${c.id}`} className="t-smallb">
                {c.name}
              </Link>
              {c.title && <span className="t-cap">{c.title}</span>}
              {l.role && <span className="pcl-role">{l.role}</span>}
              <span className="grow" />
              {c.phone && (
                <a className="pcl-act" href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} title={`전화 ${c.phone}`}>
                  <Phone size={12} /> {c.phone}
                </a>
              )}
              {c.email && (
                <a className="pcl-act" href={`mailto:${c.email}`} title={`메일 ${c.email}`}>
                  <Mail size={12} /> {c.email}
                </a>
              )}
              <button type="button" className="link-btn t-meta" disabled={busy} onClick={() => run(() => api.unlinkProjectContact(p.id, c.id))}>
                빼기
              </button>
            </div>
          ))}
          {client && (
            <div className="pcl-row wrap">
              {others.length > 0 && (
                <select className="select" value="" disabled={busy} onChange={e => e.target.value && run(() => api.linkProjectContact(p.id, e.target.value), '담당자를 연결했습니다.')} aria-label={`${client.name} 담당자 연결`}>
                  <option value="">{client.name} 담당자 연결… ({others.length})</option>
                  {others.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.title ? ` · ${c.title}` : ''}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(v => !v)}>
                {adding ? '닫기' : '+ 새 담당자'}
              </button>
            </div>
          )}
          {!client && <span className="t-cap">거래처를 고르면 그 거래처 담당자를 바로 연결 · 추가할 수 있습니다.</span>}
          {adding && client && (
            <div className="pcl-new">
              <input className="input" placeholder="이름 *" value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} maxLength={60} />
              <input className="input" placeholder="직함" value={nc.title} onChange={e => setNc({ ...nc, title: e.target.value })} maxLength={60} />
              <input className="input" placeholder="전화" value={nc.phone} onChange={e => setNc({ ...nc, phone: e.target.value })} maxLength={40} inputMode="tel" />
              <input className="input" placeholder="메일" value={nc.email} onChange={e => setNc({ ...nc, email: e.target.value })} maxLength={120} inputMode="email" />
              <button type="button" className="btn btn-sm" disabled={busy || !nc.name.trim()} onClick={addContact}>
                추가 · 연결
              </button>
            </div>
          )}
        </div>
        {/* 거래처 보고서 */}
        <div className="pcl-box">
          <div className="pcl-row">
            <span className="pcl-l">거래처 보고서</span>
            <span className="grow" />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setWriting(true)} disabled={!client}>
              + 보고서 쓰기
            </button>
          </div>
          {myReports.length === 0 ? (
            <span className="t-cap">{client ? '이 거래처 보고서가 아직 없습니다.' : '거래처를 고르면 그 거래처 리서치 보고서가 여기 나옵니다.'}</span>
          ) : (
            myReports.slice(0, 6).map(r => (
              <Link key={r.id} to={`/library?id=${r.id}`} className="pcl-report" title={r.summary ?? r.title}>
                <span className="truncate grow">{r.title}</span>
                <span className="t-cap">{shortDate(r.created_at.slice(0, 10))}</span>
              </Link>
            ))
          )}
          {myReports.length > 6 && client && (
            <Link to={`/clients?id=${client.id}`} className="t-cap">
              보고서 {myReports.length - 6}건 더 ›
            </Link>
          )}
        </div>
      </div>
      {writing && <ReportForm item={null} clients={clients} presetClient={p.client_id} onClose={() => setWriting(false)} />}
    </div>
  )
}
