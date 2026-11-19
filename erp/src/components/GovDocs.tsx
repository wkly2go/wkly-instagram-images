// 정부지원사업 › 자료 · 계획 — 사업계획서 가이드 · 선정 사례, 투자유치 계획, 월별 계획, 고도화 일정 (2026-11-19 대표 지시 '모든 요청사항과 지시는 인트라넷에')
// 본문은 운영 DB(gov_docs)에만 있다. 관리자가 그 자리에서 고친다.
// 2026-11-19 '자동업데이트를 담당할 전문 에이전트 · 비서와 협업': 위 현황(DB 계산) · 투자유치 전문 AI 의 수정 제안(반영 · 거절) · 이전 글 되돌리기 · 전문 AI 에게 맡기기.
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Loading } from './ui'
import { ReportBody } from './Reports'
import { useAction, useApp, useAsync } from '../lib/app'
import { ddayLabel, type GovDoc, type GovDocVersion, type GovOverview, type GovSuggestion } from '../lib/gov'

export function GovDocs() {
  const { api, version, bump } = useApp()
  const { run, busy } = useAction()
  const { data: docs, loading } = useAsync(() => api.listGovDocs(), [version], [] as GovDoc[])
  const { data: overview } = useAsync(() => api.govOverview().catch(() => null), [version], null as GovOverview | null)
  const { data: suggestions } = useAsync(() => api.listGovSuggestions().catch(() => []), [version], [] as GovSuggestion[])
  const [key, setKey] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const [history, setHistory] = useState(false)
  const doc = docs.find(d => d.key === key) ?? docs[0]
  useEffect(() => { setEdit(null); setHistory(false) }, [doc?.key])
  const pendingOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of suggestions) if (s.status === '대기') m.set(s.doc_key, (m.get(s.doc_key) ?? 0) + 1)
    return m
  }, [suggestions])
  if (loading) return <Loading />
  if (!doc) return <Empty>아직 자료가 없습니다.</Empty>
  const mine = suggestions.filter(s => s.doc_key === doc.key)
  const waiting = mine.filter(s => s.status === '대기')
  const done = mine.filter(s => s.status !== '대기').slice(0, 5)
  return (
    <div className="gov-docs">
      {overview && <GovStatus o={overview} />}
      <GovAsk docTitle={doc.title} />
      <div className="row wrap" role="tablist" aria-label="자료">
        {docs.map(d => (
          <button type="button" role="tab" aria-selected={d.key === doc.key} key={d.key} className={`chip${d.key === doc.key ? ' active' : ''}`} onClick={() => setKey(d.key)}>
            {d.title}{pendingOf.get(d.key) ? <span className="gov-chip-n" aria-label={`제안 ${pendingOf.get(d.key)}건`}>{pendingOf.get(d.key)}</span> : null}
          </button>
        ))}
        <span className="gov-grow" />
        <span className="t-cap">고친 날 {doc.updated_at.slice(0, 10)}</span>
        <Button kind="outline" size="sm" onClick={() => setHistory(h => !h)}>{history ? '이전 글 닫기' : '이전 글'}</Button>
        {edit === null
          ? <Button kind="outline" size="sm" onClick={() => setEdit(doc.body)}>고치기</Button>
          : <><Button size="sm" disabled={busy || edit === doc.body} onClick={() => void run(async () => { await api.saveGovDoc(doc.key, edit); bump(); setEdit(null) }, '저장했습니다')}>저장</Button><Button kind="outline" size="sm" onClick={() => setEdit(null)}>취소</Button></>}
      </div>
      {history && <GovHistory docKey={doc.key} onDone={() => setHistory(false)} />}
      {waiting.length > 0 && (
        <section className="gov-sugs" aria-label="전문 AI 수정 제안">
          <h3 className="tx-em">투자유치 전문 AI 수정 제안 {waiting.length}건 <span className="tx-sub">— 반영하면 문서가 바뀌고 이전 글은 보관됩니다</span></h3>
          {waiting.map(s => <GovSuggestionCard key={s.id} s={s} />)}
        </section>
      )}
      {edit === null
        ? <article className="gov-doc"><ReportBody body={doc.body} /></article>
        : <textarea className="input gov-doc-edit" value={edit} onChange={e => setEdit(e.target.value)} aria-label={`${doc.title} 본문`} />}
      {done.length > 0 && (
        <details className="gov-sug-done">
          <summary>처리한 제안 {done.length}건</summary>
          <ul>{done.map(s => <li key={s.id}><span className={`badge ${s.status === '반영' ? 'green' : 'gray'}`}>{s.status}</span> {s.title} <span className="tx-sub">{(s.decided_at ?? s.created_at).slice(0, 10)}</span></li>)}</ul>
        </details>
      )}
    </div>
  )
}

/** 현황 — DB 가 늘 계산 (AI 없음) */
function GovStatus({ o }: { o: GovOverview }) {
  const open = Object.entries(o.by_status).filter(([k]) => !['마감', '탈락'].includes(k)).reduce((n, [, v]) => n + v, 0)
  const pending = Object.values(o.pending).reduce((n, v) => n + v, 0)
  return (
    <section className="gov-ov" aria-label="현황 (자동)">
      <div className="gov-ov-nums">
        <div><b className="tx-title">{o.recommended}</b><span className="tx-sub">추천 공고</span></div>
        <div><b className="tx-title">{o.new_7d}</b><span className="tx-sub">이번 주 새 추천</span></div>
        <div><b className="tx-title">{open}</b><span className="tx-sub">진행 중 공고</span></div>
        <div><b className="tx-title">{pending}</b><span className="tx-sub">대기 제안</span></div>
      </div>
      {o.deadlines.length > 0 && (
        <ul className="gov-ov-dl">
          {o.deadlines.slice(0, 5).map(d => <li key={d.id}><span className={`badge ${d.d <= 3 ? 'red' : 'gray'}`}>{ddayLabel(d.d)}</span> {d.title}<span className="tx-sub"> · {d.org ?? ''} · {d.status}</span></li>)}
        </ul>
      )}
      {o.agent_last && (
        <p className="tx-sub gov-ov-agent">
          전문 AI 최근 작업 {o.agent_last.at.slice(5, 16).replace('T', ' ')} · {o.agent_last.status} — {o.agent_last.response ? o.agent_last.response.slice(0, 140) : o.agent_last.instruction.slice(0, 80)}
        </p>
      )}
    </section>
  )
}

/** 전문 AI 에게 점검 맡기기 (주 1회 자동 점검과 별도로) */
function GovAsk({ docTitle }: { docTitle: string }) {
  const { api, bump } = useApp()
  const { run, busy } = useAction()
  const [text, setText] = useState('')
  return (
    <form className="gov-ask row wrap" onSubmit={e => { e.preventDefault(); void run(async () => { await api.askGovAgent(text.trim() || `'${docTitle}' 문서를 최신 공고 · 일정 · 숫자로 점검해 수정 제안을 남겨 주세요.`); setText(''); bump() }, '전문 AI 에게 맡겼습니다 — 끝나면 알림이 갑니다') }}>
      <input className="input gov-grow" value={text} maxLength={1800} onChange={e => setText(e.target.value)} placeholder={`투자유치 전문 AI 에게 부탁 (비우면 '${docTitle}' 점검) — 비서 창에서 말해도 됩니다`} aria-label="전문 AI 에게 부탁" />
      <Button size="sm" type="submit" disabled={busy}>전문 AI 에게 맡기기</Button>
    </form>
  )
}

function GovSuggestionCard({ s }: { s: GovSuggestion }) {
  const { api, bump } = useApp()
  const { run, busy } = useAction()
  const decide = (accept: boolean) => run(async () => {
    const r = await api.decideGovSuggestion(s.id, accept)
    bump()
    if (r === '적용 불가') throw new Error('문서가 그 사이 바뀌어 이 제안을 적용할 수 없습니다. 전문 AI 에게 다시 맡겨 주세요.')
  }, accept ? '문서에 반영했습니다' : '거절했습니다')
  return (
    <article className="gov-sug">
      <header className="row wrap"><b className="tx-em">{s.title}</b><span className="gov-grow" /><span className="tx-sub">{s.created_at.slice(5, 16).replace('T', ' ')}</span></header>
      {s.reason && <p className="tx-body">{s.reason}</p>}
      <div className="gov-sug-diff">
        <div><span className="tx-sub">{s.before_text ? '지금' : '문서 끝에 덧붙임'}</span>{s.before_text && <pre className="gov-sug-before">{s.before_text}</pre>}</div>
        <div><span className="tx-sub">바뀐 글</span><pre className="gov-sug-after">{s.after_text}</pre></div>
      </div>
      {s.sources?.length > 0 && <p className="tx-sub gov-sug-src">출처 {s.sources.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer">[{i + 1}]</a>)}</p>}
      <div className="row"><Button size="sm" disabled={busy} onClick={() => void decide(true)}>반영</Button><Button kind="outline" size="sm" disabled={busy} onClick={() => void decide(false)}>거절</Button></div>
    </article>
  )
}

function GovHistory({ docKey, onDone }: { docKey: string; onDone: () => void }) {
  const { api, bump } = useApp()
  const { run, busy } = useAction()
  const { data: list, loading } = useAsync(() => api.listGovDocVersions(docKey), [docKey], [] as GovDocVersion[])
  if (loading) return <Loading />
  if (!list.length) return <p className="tx-sub">보관된 이전 글이 없습니다. 문서를 고치거나 제안을 반영하면 바뀌기 전 글이 여기에 남습니다.</p>
  return (
    <ul className="gov-history">
      {list.map(v => (
        <li key={v.id} className="row wrap">
          <span>{v.saved_at.slice(0, 16).replace('T', ' ')}</span><span className="tx-sub">{v.note} · {v.chars.toLocaleString()}자</span><span className="gov-grow" />
          <Button kind="outline" size="sm" disabled={busy} onClick={() => { if (confirm('이 글로 되돌릴까요? 지금 글은 이전 글로 보관됩니다.')) void run(async () => { await api.restoreGovDoc(v.id); bump(); onDone() }, '되돌렸습니다') }}>이 글로 되돌리기</Button>
        </li>
      ))}
    </ul>
  )
}
