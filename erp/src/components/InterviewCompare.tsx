import { useEffect, useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { inquiryMailUrl } from '../lib/inquiryThreads'
import { INTERVIEW_QUESTIONS, SALES_INFO_FIELDS, STAGE_TONE, answersFor, compareLines, completeness, filterLines } from '../lib/interviews'
import type { AgentReport, SalesInterview } from '../lib/types'
import { InterviewFiles } from './InterviewFiles'
import { ReportBody } from './Reports'
import { Button } from './ui'

/**
 * 서면 인터뷰 › '한 화면 · 비교' (2026-11-21 대표 지시 '한 화면에서 모든 자료를 확인할 수 있도록 만들고 자유롭게 다른 인터뷰지와 비교할 수 있도록')
 *  - 브랜드를 하나 고르면 그 브랜드의 모든 자료(기본 정보 · 인터뷰 답 · 영업 정보 · 올린 자료 · 메일 · 콘텐츠 · AI 리포트 초안)
 *  - 두 곳 이상 고르면 나란히 비교 (다른 것만 · 답 있는 것만) / 문항별로 모아 보기
 */
const MAX = 4
type Mode = 'brand' | 'question'
export function InterviewCompare({ rows, onEdit }: { rows: SalesInterview[]; onEdit: (id: string) => void }) {
  const ordered = useMemo(() => [...rows].sort((a, b) => completeness(b).answers - completeness(a).answers || a.brand.localeCompare(b.brand, 'ko')), [rows])
  const [picked, setPicked] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('brand')
  const [lineMode, setLineMode] = useState<'all' | 'filled' | 'diff'>('filled')
  const [qno, setQno] = useState('Q1')
  const [onlyAnswered, setOnlyAnswered] = useState(true)
  useEffect(() => {
    if (!picked.length && ordered[0]) setPicked([ordered[0].id])
  }, [ordered, picked.length])
  const chosen = picked.map(id => rows.find(r => r.id === id)).filter((r): r is SalesInterview => !!r)
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX ? [...p.slice(1), id] : [...p, id]))
  const list = onlyAnswered ? ordered.filter(r => completeness(r).answers > 0) : ordered

  return (
    <div className="iv-cmp">
      <p className="sales-iv-note">브랜드를 고르면 그 브랜드의 자료를 한 화면에서 봅니다. 두 곳 이상(최대 {MAX}곳) 고르면 나란히 비교합니다. 영업용 문항(예산 · 파트너 기준)은 내부 참고용입니다.</p>
      <div className="iv-cmp-bar">
        <div className="chips" role="tablist" aria-label="보는 방법">
          <button type="button" role="tab" aria-selected={mode === 'brand'} className={`chip${mode === 'brand' ? ' active' : ''}`} onClick={() => setMode('brand')}>브랜드별</button>
          <button type="button" role="tab" aria-selected={mode === 'question'} className={`chip${mode === 'question' ? ' active' : ''}`} onClick={() => setMode('question')}>문항별로 모아 보기</button>
        </div>
        <label className="iv-cmp-check"><input type="checkbox" checked={onlyAnswered} onChange={e => setOnlyAnswered(e.target.checked)} /> 답 받은 곳만</label>
      </div>
      {mode === 'question' ? (
        <QuestionView rows={list} qno={qno} setQno={setQno} onPick={id => { setPicked([id]); setMode('brand') }} />
      ) : (
        <div className="iv-cmp-grid">
          <ul className="iv-cmp-pick" aria-label="비교할 브랜드 고르기">
            {list.map(r => {
              const c = completeness(r)
              const on = picked.includes(r.id)
              return (
                <li key={r.id}>
                  <label className={on ? 'on' : undefined}>
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)} />
                    <span className="iv-cmp-name">{r.brand}</span>
                    <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
                    <span className="t-cap">답 {c.answers}/10</span>
                  </label>
                </li>
              )
            })}
            {!list.length && <li className="sales-iv-note">답 받은 브랜드가 없습니다. &apos;답 받은 곳만&apos;을 끄면 전체가 보입니다.</li>}
          </ul>
          <div className="iv-cmp-main">
            {chosen.length === 0 ? <p className="sales-iv-note">왼쪽에서 브랜드를 고르세요.</p>
              : chosen.length === 1 ? <Dossier r={chosen[0]} onEdit={onEdit} />
              : <CompareTable rows={chosen} lineMode={lineMode} setLineMode={setLineMode} onDrop={id => toggle(id)} onEdit={onEdit} />}
          </div>
        </div>
      )}
    </div>
  )
}

/** 한 브랜드의 모든 자료 */
function Dossier({ r, onEdit }: { r: SalesInterview; onEdit: (id: string) => void }) {
  const { api } = useApp()
  const reports = useAsync(async () => {
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const all = await api.listAgentReports(from, to)
    return all.filter(x => x.job_name.startsWith('IV') && x.title.includes(r.brand))
  }, [api, r.brand], [] as AgentReport[])
  const c = completeness(r)
  const facts: [string, string | null][] = [
    ['팝업 · 행사', r.event_name], ['장소', r.venue], ['연락처', r.contact], ['발송', [r.sent_on, r.send_channel].filter(Boolean).join(' · ') || null],
    ['답 받음', r.replied_at ? dateTimeLabel(r.replied_at) : r.answered_note], ['이미지 사용', r.image_use], ['인터뷰지', r.form_url],
    ['자료 수령 예정', [r.material_due, r.material_note].filter(Boolean).join(' · ') || null], ['업로드 예정', [r.upload_on, r.upload_note].filter(Boolean).join(' · ') || null],
    ['게시 링크', r.post_url], ['비고', r.note],
  ]
  return (
    <article className="iv-dossier">
      <header>
        <b className="tx-title">{r.brand}</b>
        <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
        <span className="t-cap">묶음 {r.batch || '없음'} · 답 {c.answers}/10 · 영업 정보 {c.sales}/{SALES_INFO_FIELDS.length}</span>
        <Button size="sm" kind="outline" onClick={() => onEdit(r.id)}>고치기</Button>
      </header>
      <section>
        <h4>기본 정보</h4>
        <dl className="iv-facts">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{/^https?:\/\//.test(v ?? '') ? <a href={v ?? ''} target="_blank" rel="noreferrer">{v}</a> : v}</dd></div>
          ))}
        </dl>
      </section>
      <section>
        <h4>인터뷰 답</h4>
        <dl className="iv-qa">
          {INTERVIEW_QUESTIONS.map(q => (
            <div key={q.no} className={r.answers[q.no] ? undefined : 'empty'}>
              <dt>{q.no} · {q.label}{q.use === '영업' && <span className="tag sales">영업용</span>}</dt>
              <dd>{r.answers[q.no] || '답 없음'}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h4>영업 정보</h4>
        <dl className="iv-facts">
          {SALES_INFO_FIELDS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{r.sales_info[k] || '–'}</dd></div>)}
        </dl>
      </section>
      <section>
        <h4>올린 자료 · 메일</h4>
        <InterviewFiles interviewId={r.id} />
        {r.mail_threads.length > 0 ? (
          <p className="t-cap">메일 대화 {r.mail_threads.length}개 · 최근 받은 메일 {r.mail_last_in_at ? dateTimeLabel(r.mail_last_in_at) : '없음'} · 보낸 메일 {r.mail_last_out_at ? dateTimeLabel(r.mail_last_out_at) : '없음'}
            {' '}{r.mail_threads.slice(0, 5).map((t, i) => <a key={t} href={inquiryMailUrl(t)} target="_blank" rel="noreferrer">대화 {i + 1} </a>)}
          </p>
        ) : <p className="t-cap">연락처 메일로 오간 메일 기록이 없습니다.</p>}
        {r.content_id && <p className="t-cap"><a href={`/ads?tab=content&item=${r.content_id}`}>만든 콘텐츠 열기</a></p>}
      </section>
      {reports.data.length > 0 && (
        <section>
          <h4>AI 리포트 초안</h4>
          {reports.data.map(x => (
            <details key={x.id} className="iv-report">
              <summary>{x.title} <span className="t-cap">{x.report_date}</span></summary>
              {x.body ? <ReportBody body={x.body} /> : <p>{x.summary}</p>}
            </details>
          ))}
        </section>
      )}
    </article>
  )
}

function CompareTable({ rows, lineMode, setLineMode, onDrop, onEdit }: { rows: SalesInterview[]; lineMode: 'all' | 'filled' | 'diff'; setLineMode: (m: 'all' | 'filled' | 'diff') => void; onDrop: (id: string) => void; onEdit: (id: string) => void }) {
  const lines = filterLines(compareLines(rows), lineMode)
  let group = ''
  return (
    <div className="iv-cmp-table-wrap">
      <div className="chips" aria-label="보일 줄">
        {([['filled', '답 있는 것만'], ['diff', '다른 것만'], ['all', '모든 줄']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip${lineMode === k ? ' active' : ''}`} aria-pressed={lineMode === k} onClick={() => setLineMode(k)}>{label}</button>
        ))}
      </div>
      <table className="table iv-cmp-table" style={{ ['--n' as string]: rows.length }}>
        <thead>
          <tr>
            <th>항목</th>
            {rows.map(r => (
              <th key={r.id}>
                <button type="button" className="linkish" onClick={() => onEdit(r.id)}>{r.brand}</button>
                <button type="button" className="icon-btn" title="비교에서 빼기" aria-label={`${r.brand} 비교에서 빼기`} onClick={() => onDrop(r.id)}>×</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(l => {
            const head = l.group !== group ? (group = l.group) : null
            return [
              head && <tr key={`g-${l.group}`} className="iv-cmp-group"><td colSpan={rows.length + 1}>{l.group}</td></tr>,
              <tr key={l.key}>
                <th scope="row">{l.label}{l.sales && <span className="tag sales">영업용</span>}</th>
                {l.values.map((v, i) => <td key={rows[i].id} className={v ? undefined : 'empty'}>{v || '–'}</td>)}
              </tr>,
            ]
          })}
          {!lines.length && <tr><td colSpan={rows.length + 1} className="sales-iv-note">보일 줄이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function QuestionView({ rows, qno, setQno, onPick }: { rows: SalesInterview[]; qno: string; setQno: (q: string) => void; onPick: (id: string) => void }) {
  const q = INTERVIEW_QUESTIONS.find(x => x.no === qno) ?? INTERVIEW_QUESTIONS[0]
  const items = answersFor(rows, q.no)
  return (
    <div className="iv-qview">
      <div className="chips" aria-label="문항 고르기">
        {INTERVIEW_QUESTIONS.map(x => (
          <button key={x.no} type="button" className={`chip${x.no === q.no ? ' active' : ''}`} aria-pressed={x.no === q.no} onClick={() => setQno(x.no)} title={x.label}>{x.no} {answersFor(rows, x.no).length}</button>
        ))}
      </div>
      <p className="tx-em">{q.no} · {q.label}{q.use === '영업' && <span className="tag sales">영업용</span>}</p>
      {items.length ? (
        <ul className="iv-qview-list">
          {items.map(({ row, text, chars }) => (
            <li key={row.id}>
              <button type="button" className="linkish" onClick={() => onPick(row.id)}>{row.brand}</button>
              <span className="t-cap">{chars}자</span>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      ) : <p className="sales-iv-note">이 문항에 답한 브랜드가 없습니다.</p>}
    </div>
  )
}
