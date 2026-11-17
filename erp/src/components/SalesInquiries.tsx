import { useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { shortDate } from '../lib/date'
import type { WebInquiry } from '../lib/types'
import { Button } from './ui'

/**
 * 웹 문의함 (2026-11-17 대표 지시 '영업수주 자동화도 개발 착수해 · 비용이 들지 않게')
 * 홈페이지 문의 · 리포트 신청 · 구독(표 web_inquiries)이 인트라넷 어디에도 보이지 않아 '신규'로 쌓이던 것을 영업 화면에 모음.
 *  - 바로 응대: 직접 문의 / 관심 신호: 리포트 신청 가운데 기획 · 준비 · 입지 검토 / 그 밖: 구독 · 자료 신청
 *  - 답장은 정해진 틀로 메일 창을 열 뿐 자동으로 보내지 않는다. AI 호출 · 외부 도구 없음.
 */
export type InquiryGroup = 'reply' | 'signal' | 'other' | 'done'
const SIGNAL = ['다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토']
const STATUSES = ['신규', '확인', '응대 완료', '제외']
export const inquiryGroup = (q: Pick<WebInquiry, 'kind' | 'category' | 'status'>): InquiryGroup =>
  (q.status ?? '신규') !== '신규' ? 'done' : q.kind === '문의' ? 'reply' : q.kind === '리포트 신청' && SIGNAL.includes(q.category ?? '') ? 'signal' : 'other'
const TABS: [InquiryGroup, string][] = [['reply', '바로 응대'], ['signal', '관심 신호'], ['other', '구독 · 자료 신청'], ['done', '처리한 것']]

/** 답장 틀: 문의 내용을 되짚고 빠진 것 세 가지를 묻는다 (자동 발송 아님) */
export function inquiryReply(q: WebInquiry): { subject: string; body: string } {
  const company = q.site === 'AR' ? '아트리어' : '더위클리'
  const what = (q.title || q.category || '문의').trim()
  const body = [
    `안녕하세요${q.brand ? `, ${q.brand} 담당자님` : ''}.`,
    `${company}에 문의해 주셔서 감사합니다.`,
    '',
    `보내 주신 내용(${what})을 확인했습니다. 정확한 안내를 위해 아래 세 가지만 알려 주시면 일정과 진행 방법을 정리해 드리겠습니다.`,
    '',
    '1. 희망 일정 (시작 시기와 기간)',
    '2. 규모 (장소 · 면적 또는 예상 방문객)',
    '3. 예산 범위 (대략이어도 괜찮습니다)',
    '',
    '통화가 편하시면 가능한 시간을 알려 주세요.',
    '',
    `${company} 드림`,
  ].join('\n')
  return { subject: `[${company}] 문의 주셔서 감사합니다 — ${what}`.slice(0, 120), body }
}
const mailto = (q: WebInquiry) => { const r = inquiryReply(q); return `mailto:${encodeURIComponent(q.email ?? '')}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.body)}` }

export function SalesInquiries() {
  const { api, toast } = useApp()
  const state = useAsync(() => api.listWebInquiries(), [api], [] as WebInquiry[])
  const [tab, setTab] = useState<InquiryGroup>('reply')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const groups = useMemo(() => {
    const g: Record<InquiryGroup, WebInquiry[]> = { reply: [], signal: [], other: [], done: [] }
    for (const q of state.data) g[inquiryGroup(q)].push(q)
    return g
  }, [state.data])
  const set = async (q: WebInquiry, status: string) => {
    setBusy(q.id)
    try { await api.updateWebInquiry(q.id, { status }); state.setData(state.data.map(x => (x.id === q.id ? { ...x, status } : x))) }
    catch (e) { toast(e instanceof Error ? e.message : '상태를 바꾸지 못했습니다.') }
    finally { setBusy('') }
  }
  if (!state.loading && !state.error && state.data.length === 0) return null
  const list = groups[tab]
  return (
    <details className="sales-inq" open={groups.reply.length > 0 || undefined}>
      <summary>
        <b>웹 문의함</b>
        <span className={groups.reply.length ? 'hot' : ''}>바로 응대 {groups.reply.length}</span>
        <span>관심 신호 {groups.signal.length}</span>
        <span>구독 · 자료 신청 {groups.other.length}</span>
        <small>홈페이지에서 들어온 문의입니다. 답장은 메일 창만 열고 자동으로 보내지 않습니다.</small>
      </summary>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="chips" role="tablist" aria-label="문의 구분">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label} {groups[k].length}</button>)}
      </div>
      {tab === 'signal' && <p className="sales-inq-note">리포트를 신청하며 기획 · 준비 · 입지 검토를 고른 분들입니다. 문의가 아니므로 영업 연락은 소식 수신에 동의한 분에게만 하세요.</p>}
      {state.loading ? <p role="status">문의를 불러오고 있습니다.</p> : list.length === 0 ? <p className="sales-inq-note">해당하는 문의가 없습니다.</p> : (
        <ul className="sales-inq-list">
          {list.slice(0, 60).map(q => (
            <li key={q.id} className={open === q.id ? 'open' : ''}>
              <button type="button" className="sales-inq-row" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)}>
                <span className="when">{q.submitted_at ? shortDate(q.submitted_at.slice(0, 10)) : '–'}</span>
                <span className="tag">{q.site_name ?? q.site}</span>
                <span className="tag">{q.kind}{q.category ? ` · ${q.category}` : ''}</span>
                <b className="truncate">{q.brand || q.email?.split('@')[1] || '이름 없음'}</b>
                <span className="what truncate">{q.title || q.detail || ''}</span>
                {q.is_ad && <span className="tag ad">광고 유입</span>}
                {q.newsletter && <span className="tag">소식 수신 동의</span>}
              </button>
              {open === q.id && (
                <div className="sales-inq-body">
                  {q.detail && <p className="sales-inq-detail">{q.detail}</p>}
                  <dl>
                    {q.email && <div><dt>메일</dt><dd>{q.email}</dd></div>}
                    {q.phone && <div><dt>전화</dt><dd>{q.phone}</dd></div>}
                    {q.org_type && <div><dt>소속 유형</dt><dd>{q.org_type}</dd></div>}
                    {(q.utm_source || q.utm_campaign) && <div><dt>유입</dt><dd>{[q.utm_source, q.utm_campaign].filter(Boolean).join(' · ')}</dd></div>}
                  </dl>
                  <div className="sales-inq-actions">
                    {q.kind === '문의' && q.email && <a className="btn btn-blue btn-sm" href={mailto(q)}>답장 쓰기</a>}
                    {STATUSES.filter(s => s !== (q.status ?? '신규')).map(s => <Button key={s} kind="outline" size="sm" disabled={busy === q.id} onClick={() => void set(q, s)}>{s === '신규' ? '신규로 되돌리기' : s}</Button>)}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 60 && <p className="sales-inq-note">최근 60건만 보여 줍니다. 처리하면 다음 건이 올라옵니다.</p>}
    </details>
  )
}
