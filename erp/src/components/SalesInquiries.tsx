import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel, shortDate } from '../lib/date'
import { agoLabel, followupStage, inquiryComposeUrl, inquiryFollowup, inquiryGroup, inquiryMailUrl, urgency, waitDays, type InquiryGroup } from '../lib/inquiryThreads'
import { useRouter } from '../lib/router'
import type { InquiryThread, WebInquiry } from '../lib/types'
import { Button } from './ui'

/**
 * 웹 문의함 (2026-11-17 대표 지시 '영업수주 자동화도 개발 착수해 · 비용이 들지 않게')
 * 홈페이지 문의 · 리포트 신청 · 구독(표 web_inquiries)이 인트라넷 어디에도 보이지 않아 '신규'로 쌓이던 것을 영업 화면에 모음.
 *  - 2026-11-18 '영업 개발 디벨롭 더 고도화': 회사 메일과 10분마다 맞춰 본 대화 상태(RPC sales_inquiry_threads)로
 *    바로 응대(고객이 기다림 · 답장 기록 없음) / 회신 대기(후속 연락 3 · 7 · 14일)를 나눈다. 구분 규칙은 lib/inquiryThreads.ts
 *  - 답장은 메일 대화를 열거나 정해진 틀로 메일 창을 열 뿐 자동으로 보내지 않는다. AI 호출 · 외부 도구 없음.
 */
export type { InquiryGroup }
const STATUSES = ['신규', '확인', '응대 완료', '제외']
/** 소식 수신 동의: 홈페이지에서 동의했거나, 문의함에서 동의 받은 것을 기록한 경우 (메모의 '[수신 동의]' 표시) */
export const CONSENT_MARK = '[수신 동의]'
export const inquiryConsent = (q: Pick<WebInquiry, 'newsletter' | 'memo'>): boolean => q.newsletter === true || (q.memo ?? '').includes(CONSENT_MARK)
const FREE_MAIL = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'icloud.com', 'outlook.com', 'hotmail.com']
const who = (q: WebInquiry) => { const d = q.email?.split('@')[1]?.toLowerCase(); return q.brand?.trim() || (d && !FREE_MAIL.includes(d) ? d : '개인 신청자') }
const TABS: [InquiryGroup, string][] = [['reply', '바로 응대'], ['waiting', '회신 대기'], ['signal', '관심 신호'], ['other', '구독 · 자료 신청'], ['done', '처리한 것']]
const NOTES: Partial<Record<InquiryGroup, string>> = {
  reply: '고객이 답을 기다리는 대화와 아직 메일 답장 기록이 없는 직접 문의입니다. 오래 기다린 순서입니다.',
  waiting: '우리가 답한 뒤 고객 회신을 기다리는 대화입니다. 마지막 연락 뒤 3 · 7 · 14일째에 후속 연락 알림이 갑니다.',
  signal: '리포트를 신청하며 기획 · 준비 · 입지 검토를 고른 분들입니다. 문의가 아니므로 영업 연락은 수신 동의한 분에게만 합니다.',
}

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
  const { api, toast, me } = useApp()
  const { query } = useRouter()
  const state = useAsync(() => api.listWebInquiries(), [api], [] as WebInquiry[])
  // 대화 상태를 읽지 못해도 문의함은 예전 규칙으로 보인다
  const threads = useAsync(() => api.listInquiryThreads().catch(() => [] as InquiryThread[]), [api], [] as InquiryThread[])
  const [tab, setTab] = useState<InquiryGroup>('reply')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [pinned, setPinned] = useState(false)
  const byId = useMemo(() => new Map(threads.data.map(t => [t.inquiry_id, t])), [threads.data])
  const groups = useMemo(() => {
    const now = Date.now()
    const g: Record<InquiryGroup, WebInquiry[]> = { reply: [], waiting: [], signal: [], other: [], done: [] }
    for (const q of state.data) g[inquiryGroup(q, byId.get(q.id), now)].push(q)
    const at = (q: WebInquiry) => urgency(q, byId.get(q.id)) || 0
    const waitingOnUs = (q: WebInquiry) => (byId.get(q.id)?.state === '우리 답 필요' ? 0 : 1)
    g.reply.sort((a, b) => waitingOnUs(a) - waitingOnUs(b) || at(a) - at(b))
    g.waiting.sort((a, b) => at(a) - at(b))
    return g
  }, [state.data, byId])

  // 알림의 '/sales?inquiry=<id>' 로 들어오면 그 문의를 펼쳐 보여 줌
  const focus = query.get('inquiry')
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || focused.current === focus || state.loading || threads.loading) return
    const q = state.data.find(x => x.id === focus)
    if (!q) return
    focused.current = focus
    setTab(inquiryGroup(q, byId.get(q.id)))
    setOpen(q.id)
    setPinned(true)
    window.setTimeout(() => document.getElementById(`inq-${q.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
  }, [focus, state.loading, threads.loading, state.data, byId])

  const set = async (q: WebInquiry, status: string) => {
    setBusy(q.id)
    try { await api.updateWebInquiry(q.id, { status }); state.setData(state.data.map(x => (x.id === q.id ? { ...x, status } : x))) }
    catch (e) { toast(e instanceof Error ? e.message : '상태를 바꾸지 못했습니다.') }
    finally { setBusy('') }
  }
  // 고객의 마지막 메일이 '감사합니다'처럼 답할 필요가 없을 때 · 새 메일이 오면 서버가 다시 '우리 답 필요'로 올림
  const dismiss = async (q: WebInquiry) => {
    setBusy(q.id)
    try {
      await api.dismissInquiryThread(q.id)
      threads.setData(threads.data.map(t => (t.inquiry_id === q.id ? { ...t, state: '회신 대기' as const } : t)))
      toast('답장 필요 없음으로 넘겼습니다. 고객이 새 메일을 보내면 다시 바로 응대로 올라옵니다.')
    } catch (e) { toast(e instanceof Error ? e.message : '바꾸지 못했습니다.') }
    finally { setBusy('') }
  }
  // 동의를 받으면(전화 · 미팅 · 회신 등) 메모에 날짜와 함께 남긴다. 홈페이지에서 한 동의는 여기서 바꾸지 않는다.
  const consent = async (q: WebInquiry, on: boolean) => {
    const rest = (q.memo ?? '').split('\n').filter(l => !l.includes(CONSENT_MARK)).join('\n').trim()
    const memo = on ? [`${CONSENT_MARK} ${new Date().toISOString().slice(0, 10)} 기록 · ${me.name}`, rest].filter(Boolean).join('\n') : rest || null
    setBusy(q.id)
    try { await api.updateWebInquiry(q.id, { memo }); state.setData(state.data.map(x => (x.id === q.id ? { ...x, memo } : x))); toast(on ? '수신 동의로 표시했습니다. 관심 신호는 10분 안에 영업 대상으로 올라갑니다.' : '미동의로 되돌렸습니다.') }
    catch (e) { toast(e instanceof Error ? e.message : '동의 표시를 바꾸지 못했습니다.') }
    finally { setBusy('') }
  }
  if (!state.loading && !state.error && state.data.length === 0) return null
  const list = groups[tab]
  return (
    <details className="sales-inq" open={pinned || groups.reply.length > 0 || undefined}>
      <summary>
        <b>웹 문의함</b>
        <span className={groups.reply.length ? 'hot' : ''}>바로 응대 {groups.reply.length}</span>
        <span>회신 대기 {groups.waiting.length}</span>
        <span>관심 신호 {groups.signal.length}</span>
        <span>구독 · 자료 신청 {groups.other.length}</span>
        <small>홈페이지에서 들어온 문의입니다. 회사 메일과 10분마다 맞춰 보며, 메일로 답한 문의는 저절로 응대 완료가 되고 고객이 다시 메일을 보내면 바로 응대로 올라옵니다. 답이 늦거나 회신이 없으면 담당자에게 알림이 갑니다. 메일은 자동으로 보내지 않습니다.</small>
      </summary>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="chips" role="tablist" aria-label="문의 구분">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label} {groups[k].length}</button>)}
      </div>
      {NOTES[tab] && <p className="sales-inq-note">{NOTES[tab]}</p>}
      {state.loading ? <p role="status">문의를 불러오고 있습니다.</p> : list.length === 0 ? <p className="sales-inq-note">해당하는 문의가 없습니다.</p> : (
        <>
          {(tab === 'signal' || tab === 'other' ? [true, false] : [null]).map(side => {
            const part = side == null ? list : list.filter(q => inquiryConsent(q) === side)
            return (
              <div key={String(side)} className="sales-inq-part">
                {side != null && <h3 className={side ? 'yes' : 'no'}>{side ? '수신 동의' : '미동의'} {part.length}<small>{side ? (tab === 'signal' ? '영업 연락 가능 · 영업 대상으로 자동 등록됩니다' : '소식 · 자료 안내 가능') : '영업 연락을 하지 않습니다 · 동의를 받으면 줄을 열어 \'수신 동의로 표시\''}</small></h3>}
                {part.length === 0 ? <p className="sales-inq-note">없습니다.</p> : (
                  <ul className="sales-inq-list">
                    {part.slice(0, 60).map(q => {
                      const t = byId.get(q.id)
                      const days = t?.state === '회신 대기' ? waitDays(t) : null
                      const stage = followupStage(days)
                      const live = tab === 'reply' || tab === 'waiting'
                      return (
                        <li key={q.id} id={`inq-${q.id}`} className={open === q.id ? 'open' : ''}>
                          <button type="button" className="sales-inq-row" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)}>
                            <span className="when">{q.submitted_at ? shortDate(q.submitted_at.slice(0, 10)) : '–'}</span>
                            <span className="tag">{q.site_name ?? q.site}</span>
                            <span className="tag">{q.kind}{q.category ? ` · ${q.category}` : ''}</span>
                            <b className="truncate">{who(q)}</b>
                            <span className="what truncate">{q.title || q.detail || ''}</span>
                            {tab === 'reply' && t?.state === '우리 답 필요' && <span className="tag hot">고객 답장 {agoLabel(t.last_in_at)}</span>}
                            {tab === 'reply' && t?.state === '미응대' && <span className="tag hot">답장 기록 없음 · {agoLabel(q.submitted_at)} 문의</span>}
                            {tab === 'waiting' && days != null && <span className={`tag${stage ? ' due' : ''}`}>{stage ? `후속 연락 · ${days}일째` : days ? `회신 대기 ${days}일째` : '회신 대기 · 오늘 답장'}</span>}
                            {live && t?.quote_asked && <span className="tag quote">견적 요청</span>}
                            {tab === 'reply' && t?.unread && t.state === '우리 답 필요' && <span className="tag">읽지 않음</span>}
                            {q.is_ad && <span className="tag ad">광고 유입</span>}
                            {q.kind !== '문의' && <span className={`tag ${inquiryConsent(q) ? 'yes' : 'no'}`}>{inquiryConsent(q) ? '수신 동의' : '미동의'}</span>}
                          </button>
                          {open === q.id && (
                            <div className="sales-inq-body">
                              {t && (t.last_in_at || t.last_out_at) && (
                                <div className="sales-inq-mail">
                                  {t.last_in_at && <p><b>받은 메일</b> {dateTimeLabel(t.last_in_at)} · {t.last_in_subject || '제목 없음'}</p>}
                                  {t.last_in_snippet && <p className="snippet">{t.last_in_snippet}</p>}
                                  <p className="meta">우리 답장 {t.out_count}통{t.last_out_at ? ` · 마지막 ${dateTimeLabel(t.last_out_at)}` : ''} · 받은 메일 {t.in_count}통</p>
                                </div>
                              )}
                              {q.detail && <p className="sales-inq-detail">{q.detail}</p>}
                              <dl>
                                {q.email && <div><dt>메일</dt><dd>{q.email}</dd></div>}
                                {q.phone && <div><dt>전화</dt><dd>{q.phone}</dd></div>}
                                {q.org_type && <div><dt>소속 유형</dt><dd>{q.org_type}</dd></div>}
                                {(q.utm_source || q.utm_campaign) && <div><dt>유입</dt><dd>{[q.utm_source, q.utm_campaign].filter(Boolean).join(' · ')}</dd></div>}
                              </dl>
                              <div className="sales-inq-actions">
                                {t?.thread_id && <a className="btn btn-blue btn-sm" href={inquiryMailUrl(t.thread_id)} target="_blank" rel="noopener noreferrer">메일 대화 열기</a>}
                                {t?.state === '우리 답 필요' && <Button kind="outline" size="sm" disabled={busy === q.id} onClick={() => void dismiss(q)} title="고객의 마지막 메일이 '감사합니다'처럼 답할 필요가 없을 때 누르세요. 새 메일이 오면 다시 올라옵니다.">답장 필요 없음</Button>}
                                {stage && q.email && (() => { const f = inquiryFollowup(q, stage, t?.last_in_subject); return <a className="btn btn-blue btn-sm" href={inquiryComposeUrl(q.email, f.subject, f.body)} target="_blank" rel="noopener noreferrer" title="회사 메일함에 초안이 열립니다. 고쳐서 직접 보내 주세요.">후속 메일 쓰기 ({stage}일째 틀)</a> })()}
                                {q.kind === '문의' && q.email && !t?.out_count && <a className={`btn btn-sm ${t?.thread_id ? 'btn-outline' : 'btn-blue'}`} href={mailto(q)}>답장 쓰기</a>}
                                {q.kind !== '문의' && !inquiryConsent(q) && <Button size="sm" disabled={busy === q.id} onClick={() => void consent(q, true)} title="전화 · 미팅 · 회신 등으로 동의를 받았을 때만 누르세요">수신 동의로 표시</Button>}
                                {q.kind !== '문의' && q.newsletter !== true && (q.memo ?? '').includes(CONSENT_MARK) && <Button kind="ghost" size="sm" disabled={busy === q.id} onClick={() => void consent(q, false)}>미동의로 되돌리기</Button>}
                                {STATUSES.filter(s => s !== (q.status ?? '신규')).map(s => <Button key={s} kind="outline" size="sm" disabled={busy === q.id} onClick={() => void set(q, s)}>{s === '신규' ? '신규로 되돌리기' : s}</Button>)}
                              </div>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </>
      )}
      {list.length > 60 && <p className="sales-inq-note">최근 60건만 보여 줍니다. 처리하면 다음 건이 올라옵니다.</p>}
    </details>
  )
}
