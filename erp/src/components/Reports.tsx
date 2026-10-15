import { Fragment, useState, type ReactNode } from 'react'
import { FileText, Plus } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { todayKey } from '../lib/date'
import { defaultTemplate, fillReport } from '../lib/reports'
import { CLIENT_CATEGORIES, type Client, type Draft, type ReportTemplate, type ResearchItem } from '../lib/types'
import { SearchPick } from './LogForm'
import { Badge, Button, Empty, Field, Modal } from './ui'

export const REPORT_KIND = '거래처 리포트'
const CAT_LABEL: Record<string, string> = { 클라이언트: '클라이언트 (발주처)', 협력사: '협력사', 기타: '기타' }
export const clientCatLabel = (c: string) => CAT_LABEL[c] ?? c

/** 보고서 본문: '# 제목' · '## 소제목' · '- 목록' · '키: 값' 줄을 읽기 좋게 */
export function ReportBody({ body }: { body: string }) {
  const out: ReactNode[] = []
  let kv: [string, string][] = []
  let list: string[] = []
  const flush = () => {
    if (kv.length) {
      out.push(
        <dl key={`kv${out.length}`} className="kv box">
          {kv.map(([k, v], i) => (
            <Fragment key={i}>
              <dt>{k}</dt>
              <dd>{linkify(v)}</dd>
            </Fragment>
          ))}
        </dl>,
      )
      kv = []
    }
    if (list.length) {
      out.push(
        <ul key={`ul${out.length}`} className="report-list">
          {list.map((t, i) => (
            <li key={i}>{linkify(t)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    const li = line.match(/^\s*[-*·•]\s*(.*)$/)
    const pair = line.match(/^([^:：#\-*]{1,12})[:：]\s*(.*)$/)
    if (h) {
      flush()
      // '# 제목' 은 화면 위 제목과 같아서 생략
      if (h[1].length > 1) out.push(<h3 key={out.length} className="report-h">{h[2]}</h3>)
    } else if (li) {
      if (kv.length) flush()
      if (li[1].trim()) list.push(li[1])
    } else if (pair && !/^https?$/i.test(pair[1].trim())) {
      if (list.length) flush()
      if (pair[2].trim()) kv.push([pair[1].trim(), pair[2].trim()])
    } else {
      flush()
      out.push(
        <p key={out.length} className="t-small pre" style={{ margin: 0 }}>
          {linkify(line)}
        </p>,
      )
    }
  }
  flush()
  return <div className="col gap-6 report">{out}</div>
}

function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener">
        {p.replace(/^https?:\/\//, '').slice(0, 60)}
      </a>
    ) : (
      p
    ),
  )
}

/** 거래처 리서치 보고서 쓰기 · 고치기 (공통 양식으로 시작) */
export function ReportForm({ item, clients, presetClient, onClose, onSaved }: { item: ResearchItem | null; clients: Client[]; presetClient?: string | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { api, me, profiles, version } = useApp()
  const { busy, run } = useAction()
  const { data: templates } = useAsync(() => api.listReportTemplates(), [version], [] as ReportTemplate[])
  const [f, setF] = useState<Draft<ResearchItem>>(
    () => item ?? { kind: REPORT_KIND, title: '', summary: null, body: null, source_url: null, source_name: null, brand_name: null, tags: [REPORT_KIND], status: '새 자료', client_id: presetClient ?? null, project_id: null, shared_to: null },
  )
  const set = (p: Draft<ResearchItem>) => setF(prev => ({ ...prev, ...p }))
  const client = clients.find(c => c.id === f.client_id) ?? null
  const useTemplate = (t: ReportTemplate | null) => {
    if (!t) return
    if (f.body?.trim() && !window.confirm('지금 본문을 양식으로 바꿀까요?')) return
    set({ body: fillReport(t.body, client, me.name, todayKey()) })
  }
  const save = async () => {
    let id = ''
    const title = f.title?.trim() || (client ? `${client.name} 리서치 보고서` : '')
    const tags = Array.from(new Set([REPORT_KIND, ...(client ? [client.category] : []), ...(f.tags ?? [])]))
    const ok = await run(async () => {
      // 담당자 알림은 DB 가 보냄 (research_items_share_notify)
      id = (await api.saveResearch({ ...f, kind: REPORT_KIND, title, brand_name: client?.name ?? f.brand_name ?? null, tags })).id
    }, '저장했습니다.')
    if (ok) {
      onClose()
      onSaved?.(id)
    }
  }
  const people = profiles.filter(p => p.active && !p.is_agent)
  return (
    <Modal
      wide
      title={item ? '보고서 수정' : '거래처 리서치 보고서'}
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !(f.title?.trim() || client) || !f.body?.trim()}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="거래처">
          <SearchPick
            label="거래처"
            placeholder="거래처 검색"
            value={f.client_id ?? ''}
            onChange={id => set({ client_id: id || null })}
            groups={CLIENT_CATEGORIES.map(clientCatLabel)}
            items={clients.map(c => ({ id: c.id, label: c.name, sub: c.email ?? undefined, group: clientCatLabel(c.category) }))}
          />
        </Field>
        <Field label="보고받을 담당자">
          <select className="select" value={f.shared_to ?? ''} onChange={e => set({ shared_to: e.target.value || null })}>
            <option value="">없음</option>
            {people.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? ` ${p.title}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="제목" className="full">
          <input className="input" value={f.title ?? ''} onChange={e => set({ title: e.target.value })} placeholder={client ? `${client.name} 리서치 보고서` : '거래처를 고르면 자동으로 채워집니다'} />
        </Field>
        <Field label="요약 (3줄)" className="full">
          <textarea className="textarea" rows={3} value={f.summary ?? ''} onChange={e => set({ summary: e.target.value || null })} />
        </Field>
        <div className="row full wrap" style={{ gap: 6 }}>
          <span className="t-cap grow">본문은 공통 양식으로 시작합니다. '## 소제목', '- 목록', '항목: 내용' 형식이 보기 좋게 정리됩니다.</span>
          {templates.map(t => (
            <Button key={t.id} kind="outline" size="sm" onClick={() => useTemplate(t)}>
              <FileText size={13} /> {t.name}
            </Button>
          ))}
        </div>
        <Field label="본문" className="full">
          <textarea className="textarea mono" rows={16} value={f.body ?? ''} onChange={e => set({ body: e.target.value || null })} onFocus={() => !f.body && useTemplate(defaultTemplate(templates))} />
        </Field>
        <Field label="주요 출처 URL">
          <input className="input" value={f.source_url ?? ''} onChange={e => set({ source_url: e.target.value || null })} placeholder="https://" />
        </Field>
        <Field label="태그 (쉼표로 구분)">
          <input className="input" value={(f.tags ?? []).filter(t => t !== REPORT_KIND).join(', ')} onChange={e => set({ tags: e.target.value.split(/[,#]+/).map(t => t.trim()).filter(Boolean) })} />
        </Field>
      </div>
    </Modal>
  )
}

/** 자료실 › 보고서 양식 */
export function ReportTemplates({ tabs }: { tabs: ReactNode }) {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const { data: list } = useAsync(() => api.listReportTemplates(), [version], [] as ReportTemplate[])
  const [cur, setCur] = useState<Draft<ReportTemplate> | null>(null)
  const set = (p: Draft<ReportTemplate>) => setCur(prev => ({ ...prev, ...p }))
  const canEdit = (t: ReportTemplate) => me.role === 'admin' || t.created_by === me.id
  const save = async () => {
    if (!cur) return
    if (await run(() => api.saveReportTemplate({ ...cur, name: (cur.name ?? '').trim() }), '저장했습니다.')) setCur(null)
  }
  return (
    <>
      <div className="row wrap">
        {tabs}
        <span className="grow" />
        <Button onClick={() => setCur({ name: '', body: list[0]?.body ?? '', is_default: false })}>
          <Plus size={13} /> 양식
        </Button>
      </div>
      <div className="note">
        거래처 리서치 보고서의 공통 양식입니다. 사람과 AI 팀원 모두 <b>기본 양식</b>으로 보고서를 씁니다. {'{{거래처}}'} · {'{{구분}}'} · {'{{작성일}}'} · {'{{작성자}}'} 는 쓸 때 자동으로 채워집니다.
      </div>
      {list.map(t => (
        <div key={t.id} className="item-row">
          <span className="col gap-2 grow">
            <span className="row" style={{ gap: 6 }}>
              <span className="t-smallb">{t.name}</span>
              {t.is_default && <Badge tone="yellow">기본 양식</Badge>}
            </span>
            <span className="t-cap truncate">{t.body.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3)).join(' · ')}</span>
          </span>
          <Button kind="outline" size="sm" onClick={() => setCur(t)}>
            {canEdit(t) ? '수정' : '보기'}
          </Button>
          {canEdit(t) && !t.is_default && (
            <Button kind="ghost" size="sm" disabled={busy} onClick={() => window.confirm(`'${t.name}' 양식을 삭제할까요?`) && run(() => api.deleteReportTemplate(t.id), '삭제했습니다.')}>
              삭제
            </Button>
          )}
        </div>
      ))}
      {list.length === 0 && <Empty>양식이 없습니다.</Empty>}
      {cur && (
        <Modal
          wide
          title={cur.id ? '보고서 양식' : '새 보고서 양식'}
          onClose={() => setCur(null)}
          actions={
            <>
              <Button kind="ghost" onClick={() => setCur(null)}>
                닫기
              </Button>
              {(!cur.id || canEdit(cur as ReportTemplate)) && (
                <Button onClick={save} disabled={busy || !cur.name?.trim() || !cur.body?.trim()}>
                  저장
                </Button>
              )}
            </>
          }
        >
          <div className="form-grid">
            <Field label="이름" className="full">
              <input className="input" value={cur.name ?? ''} onChange={e => set({ name: e.target.value })} />
            </Field>
            <Field label="본문" className="full">
              <textarea className="textarea mono" rows={18} value={cur.body ?? ''} onChange={e => set({ body: e.target.value })} />
            </Field>
            {me.role === 'admin' && (
              <label className="row t-cap full" style={{ gap: 6 }}>
                <input type="checkbox" checked={!!cur.is_default} onChange={e => set({ is_default: e.target.checked })} /> 기본 양식으로 (AI 팀원도 이 양식을 씁니다)
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
