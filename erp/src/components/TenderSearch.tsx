import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { defaultTenderQuery, tenderCandidateDraft, validateTenderQuery, type TenderCandidate, type TenderSearchQuery, type TenderSearchResult } from '../lib/tenderSearch'
import type { GrowthDraft } from '../lib/growth'
import { Button, Field, Modal } from './ui'

export function TenderSearch({ onClose, onChoose }: { onClose: () => void; onChoose: (draft: GrowthDraft) => boolean }) {
  const { api, me } = useApp()
  const initial = useRef(defaultTenderQuery())
  const [query, setQuery] = useState(initial.current), [result, setResult] = useState<{ query: TenderSearchQuery; data: TenderSearchResult } | null>(null)
  const [failedQuery, setFailedQuery] = useState<TenderSearchQuery | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), choosing = useRef(false)
  const state = useRef({ dirty: false, busy: false })
  state.current = { dirty: JSON.stringify(query) !== JSON.stringify(initial.current), busy }
  useEffect(() => registerDraftNavigation(window, () => state.current, () => window.confirm('변경한 공고 조회 조건이 있습니다. 닫고 이동할까요?')), [])
  const close = () => { if (!lock.current && (!state.current.dirty || window.confirm('변경한 공고 조회 조건이 있습니다. 닫을까요?'))) onClose() }
  const change = (patch: Partial<TenderSearchQuery>) => { if (lock.current) return; setQuery(q => ({ ...q, ...patch, page: 1 })); setResult(null); setFailedQuery(null); setError('') }
  const search = async (page = 1, retry: TenderSearchQuery | null = null) => {
    if (lock.current) return
    const current = { ...query, keyword: query.keyword.trim(), page }
    // A retry is only for these unchanged criteria and the exact failed page.
    if (retry && JSON.stringify({ ...current, page: retry.page }) !== JSON.stringify(retry)) return
    const requested = retry ?? current, invalid = validateTenderQuery(requested)
    if (invalid) { setError(invalid); return }
    lock.current = true; state.current.busy = true; setBusy(true); setError(''); setFailedQuery(null)
    try { setResult({ query: requested, data: await api.searchTenders(requested) }) }
    catch (e) { setError(friendlyError(e)); setFailedQuery(requested) }
    finally { lock.current = false; state.current.busy = false; setBusy(false) }
  }
  const choose = (candidate: TenderCandidate) => {
    if (lock.current || choosing.current || !result) return
    choosing.current = true
    const previous = state.current
    // Transfer these criteria into the selected draft while preserving any other active guard.
    state.current = { dirty: false, busy: false }
    try { if (!onChoose(tenderCandidateDraft(candidate, me.id, result.query.category))) { state.current = previous; choosing.current = false } }
    catch (e) { state.current = previous; choosing.current = false; setError(friendlyError(e)) }
  }
  return <Modal title="나라장터 공식 공고 조회" onClose={close} wide actions={<Button kind="ghost" onClick={close} disabled={busy}>닫기</Button>}>
    <p className="growth-notice">공식 API 조회 후보입니다. 예약 수집·자동 저장·투찰은 하지 않습니다. 후보를 선택한 뒤 원문과 참가 조건을 검토하고 저장해 주세요.</p>
    <p className="t-cap">조회 서버는 배포되어 있습니다. 공공데이터포털 활용 승인·서버 키 설정·실제 응답은 별도 확인이 필요합니다.{api.mode === 'demo' && ' 체험 모드에서는 실제 나라장터 API를 호출하지 않습니다.'}</p>
    <div className="row wrap" aria-label="영업 분야별 공고 검색">{['SNS 홍보', '콘텐츠 제작', '행사 운영', '전시', '공간'].map(keyword => <Button key={keyword} kind="outline" disabled={busy} onClick={() => change({ keyword })}>{keyword}</Button>)}</div>
    <p className="t-cap">분야를 고르면 검색어만 바뀝니다. 공식 공고 조회를 눌러야 조회합니다. 공고명에 해당 문구가 없는 사업은 누락될 수 있습니다.</p>
    <fieldset className="growth-fieldset form-grid" disabled={busy}>
      <Field label="조회 업무"><select className="select" value={query.category} onChange={e => change({ category: e.target.value as TenderSearchQuery['category'] })}><option value="service">용역</option><option value="construction">공사</option></select></Field>
      <Field label="공고명 검색어"><input className="input" maxLength={100} value={query.keyword} onChange={e => change({ keyword: e.target.value })} placeholder="예: 전시, 행사, 공간" /></Field>
      <Field label="공고 게시 시작일 (한국시간)"><input className="input" type="date" value={query.startDate} onChange={e => change({ startDate: e.target.value })} /></Field>
      <Field label="공고 게시 종료일 (한국시간)"><input className="input" type="date" value={query.endDate} onChange={e => change({ endDate: e.target.value })} /></Field>
    </fieldset>
    <div className="row wrap"><Button disabled={busy} onClick={() => search()}>{busy ? '공고 조회 중…' : '공식 공고 조회'}</Button><span className="t-cap">기간 최대 7일 · 페이지당 30건 · 자동 재조회 없음</span></div>
    {error && <p role="alert" className="growth-error">{error}</p>}
    {failedQuery && <div className="row wrap"><Button kind="outline" disabled={busy} onClick={() => search(failedQuery.page, failedQuery)}>실패한 공고 페이지 다시 조회</Button><span className="t-cap">{failedQuery.page}페이지 · 자동 재시도 없음{result && ' · 아래에는 마지막으로 조회한 결과가 남아 있습니다.'}</span></div>}
    {result && <section aria-label="공식 공고 조회 결과" className="growth-list">
      <p role="status">{result.query.startDate} ~ {result.query.endDate} · {result.query.category === 'service' ? '용역' : '공사'}{result.query.keyword ? ` · ${result.query.keyword}` : ''} · 전체 {result.data.total.toLocaleString()}건 중 {result.data.page}페이지</p>
      {result.data.omitted > 0 && <p className="growth-notice">형식이 맞지 않거나 중복된 후보 {result.data.omitted}건은 제외했습니다. 이 목록이 전체 공고를 보장하지 않으므로 원문도 확인해 주세요.</p>}
      {!result.data.items.length && <p>표시할 공고가 없습니다. 조건을 바꿔 조회하거나 원문에서 직접 등록해 주세요.</p>}
      {result.data.items.map(item => <article key={`${item.number}:${item.round}`} className="growth-notice">
        <strong className="growth-copy">{item.title}</strong><p>{item.number} · 차수 {item.round} · {item.agency}</p>
        <p>마감: {item.deadline ? new Date(item.deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '확인 필요'} · 추정가격: {item.amount === null ? '확인 필요' : `${item.amount.toLocaleString()}원`}</p>
        {item.warnings.length > 0 && <p className="growth-copy">{item.warnings.join('\n')}</p>}
        <div className="row wrap">{item.source_url && <a className="btn btn-outline" href={item.source_url} target="_blank" rel="noreferrer">공고 원문</a>}<Button disabled={busy} onClick={() => choose(item)}>검토해 등록</Button></div>
      </article>)}
      <div className="row wrap"><Button kind="outline" disabled={busy || result.data.page === 1} onClick={() => search(result.data.page - 1)}>이전 공고 페이지</Button><span>{result.data.page}페이지</span><Button kind="outline" disabled={busy || !result.data.hasMore} onClick={() => search(result.data.page + 1)}>다음 공고 페이지</Button></div>
      {result.data.limited && <p>20페이지 조회 한도입니다. 기간이나 검색어를 좁혀 다시 조회해 주세요.</p>}
    </section>}
  </Modal>
}
