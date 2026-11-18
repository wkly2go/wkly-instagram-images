// 인터뷰지 만들기 (영업·수주 › 서면 인터뷰 › 브랜드 한 곳 · 2026-11-19) — 구글 폼을 브랜드마다 새로 만들던 일을 대신한다
//  질문 은행의 기본 문안에 브랜드 · 팝업 · 기간 · 장소를 채워 초안 → 고치기 → 링크 열기 → 브랜드가 /i/<토큰> 에서 답 → 답이 '인터뷰 답'에 자동으로 들어옴
//  링크 전달(메일 · DM)은 사람이 한다: 인트라넷은 외부로 보내지 않는다 (메일 발송은 대표 승인 묶음 규칙)
import { useEffect, useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { buildForm, contextOf, fillTemplate, formPath, formProblems, shareText, toFormQuestion, type BankQuestion, type FormContext, type FormQuestion, type InterviewForm } from '../lib/interviewForms'
import type { SalesInterview } from '../lib/types'
import { InterviewFormView } from './InterviewFormView'
import { Button, Field } from './ui'

type Draft = Pick<InterviewForm, 'title' | 'intro' | 'due_on' | 'upload_on' | 'questions'>
const draftOf = (f: InterviewForm): Draft => ({ title: f.title, intro: f.intro, due_on: f.due_on, upload_on: f.upload_on, questions: f.questions })
const CTX: [keyof FormContext, string, string][] = [['brand', '브랜드', ''], ['popup', '팝업 이름', '예: 미니무비 촬영소 팝업'], ['period', '기간', '예: 11월 6일~29일'], ['place', '장소', '예: 성수 프로타주 갤러리']]

export function InterviewFormPanel({ row, onLinked }: { row: SalesInterview; onLinked: (url: string) => void | Promise<void> }) {
  const { api, toast } = useApp()
  const state = useAsync(() => Promise.all([api.getInterviewForm(row.id), api.listInterviewQuestions()]), [api, row.id], [null, []] as [InterviewForm | null, BankQuestion[]])
  const [form, bank] = state.data
  const [ctx, setCtx] = useState<FormContext>(() => contextOf(row))
  const [dates, setDates] = useState({ due: row.material_due, upload: row.upload_on })
  const [d, setD] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  useEffect(() => { setD(form ? draftOf(form) : null) }, [form])

  const editable = !form || form.status === '작성 중'
  const dirty = !!form && !!d && JSON.stringify(d) !== JSON.stringify(draftOf(form))
  const problems = useMemo(() => (d ? formProblems(d) : []), [d])
  const url = form ? `${window.location.origin}${formPath(form.token)}` : ''
  const variants = (slot: string) => bank.filter(q => q.active && q.slot === slot)

  const run = async (work: () => Promise<InterviewForm>, done?: string) => {
    setBusy(true)
    try {
      const saved = await work()
      state.setData([saved, bank])
      if (done) toast(done)
      return saved
    } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.'); return null }
    finally { setBusy(false) }
  }
  const create = () => {
    if (!ctx.brand.trim()) { toast('브랜드 이름을 적어 주세요.'); return }
    if (!bank.length) { toast('질문 은행에 문안이 없습니다. 위 \'질문 은행\'에서 먼저 확인해 주세요.'); return }
    void run(() => api.saveInterviewForm(row.id, { ...buildForm(ctx, bank, { dueOn: dates.due, uploadOn: dates.upload }), status: '작성 중' }), '인터뷰지 초안을 만들었습니다. 질문을 이 팝업에 맞게 고쳐 주세요.')
  }
  const rebuild = () => {
    if (!d || !window.confirm('질문과 안내문을 질문 은행의 기본 문안으로 다시 채웁니다. 지금 고친 글은 사라집니다. 계속할까요?')) return
    setD({ ...d, ...buildForm(ctx, bank, { dueOn: d.due_on, uploadOn: d.upload_on }) })
  }
  const save = () => d && run(() => api.saveInterviewForm(row.id, d), '인터뷰지를 저장했습니다.')
  const open = async () => {
    if (!d) return
    if (problems.length) { toast(`열기 전에 고칠 곳이 있습니다: ${problems[0]}`); return }
    const saved = await run(() => api.saveInterviewForm(row.id, { ...d, status: '열림' }), '링크를 열었습니다. 링크를 복사해 브랜드 담당자에게 보내 주세요.')
    // 예전 구글 폼 링크가 적혀 있으면 그대로 두고, 비었거나 인트라넷 링크일 때만 이 링크로 바꾼다
    if (saved && (!row.form_url || row.form_url.includes('/i/'))) await onLinked(`${window.location.origin}${formPath(saved.token)}`)
  }
  const setStatus = (status: InterviewForm['status'], done: string, ask?: string) => { if (!ask || window.confirm(ask)) void run(() => api.saveInterviewForm(row.id, { status }), done) }
  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); toast(done) } catch { toast('자동 복사가 막혀 있습니다. 주소를 직접 골라 복사해 주세요.') }
  }
  const setQ = (i: number, p: Partial<FormQuestion>) => d && setD({ ...d, questions: d.questions.map((q, n) => (n === i ? { ...q, ...p } : q)) })

  if (state.loading) return <p className="sales-iv-note" role="status">인터뷰지를 불러오고 있습니다.</p>
  if (state.error) return <p className="sales-iv-note" role="alert">{state.error}</p>

  const context = (
    <div className="grid2">
      {CTX.map(([k, label, ph]) => (
        <Field key={k} label={label}><input className="input" value={ctx[k]} placeholder={ph} onChange={e => setCtx({ ...ctx, [k]: e.target.value })} /></Field>
      ))}
    </div>
  )

  if (!form || !d)
    return (
      <div className="sales-iv-form">
        <p className="sales-iv-note">구글 폼을 새로 만들지 않고, 질문 은행의 기본 문안(Q1~Q10)에 아래 내용을 채워 이 브랜드의 인터뷰지를 만듭니다. 만든 뒤 질문을 이 팝업에 맞게 고칠 수 있습니다.</p>
        {context}
        <div className="grid2">
          <Field label="답변 수령 희망일"><input className="input" type="date" value={dates.due ?? ''} onChange={e => setDates({ ...dates, due: e.target.value || null })} /></Field>
          <Field label="콘텐츠 업로드 예정일"><input className="input" type="date" value={dates.upload ?? ''} onChange={e => setDates({ ...dates, upload: e.target.value || null })} /></Field>
        </div>
        <div className="sales-iv-actions"><Button size="sm" disabled={busy} onClick={create}>인터뷰지 초안 만들기</Button></div>
      </div>
    )

  const answered = Object.keys(form.answers).length
  return (
    <div className="sales-iv-form">
      <div className="sales-iv-form-state">
        <span className={`tag ${form.status === '제출' ? 'ok' : form.status === '열림' ? 'soon' : ''}`}>{form.status === '제출' ? '답 받음' : form.status}</span>
        {form.status === '작성 중' && <span>아직 브랜드에게 보이지 않습니다. 고친 뒤 '링크 열기'를 누르면 답을 받을 수 있습니다.</span>}
        {form.status === '열림' && <span>{form.first_seen_at ? `브랜드가 ${dateTimeLabel(form.first_seen_at)} 에 처음 열어 봤습니다.` : '아직 아무도 열어 보지 않았습니다.'}</span>}
        {form.status === '제출' && <span>{dateTimeLabel(form.submitted_at ?? '')} · {answered}개 문항{form.respondent ? ` · ${form.respondent}` : ''}{form.respondent_contact ? ` · ${form.respondent_contact}` : ''}{form.image_consent ? ` · 이미지: ${form.image_consent}` : ''}</span>}
        {form.status === '닫힘' && <span>접수를 마감했습니다. 브랜드는 답을 볼 수만 있습니다.</span>}
      </div>
      {form.status !== '작성 중' && (
        <div className="sales-iv-form-link">
          <input className="input" readOnly value={url} aria-label="인터뷰지 링크" onFocus={e => e.currentTarget.select()} />
          <Button size="sm" kind="outline" onClick={() => void copy(url, '링크를 복사했습니다.')}>링크 복사</Button>
          <Button size="sm" kind="outline" onClick={() => void copy(shareText(form, url), '안내 글과 링크를 복사했습니다. 메일 · DM 에 붙여 보내 주세요.')}>안내 글 + 링크 복사</Button>
          <a className="btn btn-outline btn-sm" href={url} target="_blank" rel="noopener noreferrer">브랜드 화면 열기</a>
        </div>
      )}
      {form.status === '제출' && <p className="sales-iv-note">받은 답은 아래 '인터뷰 답'(Q1~Q10)에 자동으로 들어갔고, 단계가 '자료 수령'으로 바뀌었습니다. 브랜드가 고쳐 보내면 새 답으로 바뀝니다.</p>}

      {editable ? (
        <>
          <details className="sales-iv-sub">
            <summary>채울 내용 <span>문안을 바꾸거나 다시 채울 때 씁니다</span></summary>
            {context}
            <div className="sales-iv-actions"><Button size="sm" kind="ghost" disabled={busy} onClick={rebuild}>기본 문안으로 다시 채우기</Button></div>
          </details>
          <div className="grid2">
            <Field label="제목" className="full"><input className="input" value={d.title} maxLength={200} onChange={e => setD({ ...d, title: e.target.value })} /></Field>
            <Field label="답변 수령 희망일"><input className="input" type="date" value={d.due_on ?? ''} onChange={e => setD({ ...d, due_on: e.target.value || null })} /></Field>
            <Field label="콘텐츠 업로드 예정일"><input className="input" type="date" value={d.upload_on ?? ''} onChange={e => setD({ ...d, upload_on: e.target.value || null })} /></Field>
            <Field label="맨 위 안내문" className="full"><textarea className="textarea" rows={6} value={d.intro} onChange={e => setD({ ...d, intro: e.target.value })} /></Field>
          </div>
          <ol className="sales-iv-form-qs">
            {d.questions.map((q, i) => {
              const alts = variants(q.no)
              return (
                <li key={q.no}>
                  <div className="head">
                    <b>{q.no}</b>
                    <input className="input" value={q.title} aria-label={`${q.no} 제목`} onChange={e => setQ(i, { title: e.target.value })} />
                    {q.use === '영업' && <span className="tag sales">영업용</span>}
                    <label><input type="checkbox" checked={q.required} onChange={e => setQ(i, { required: e.target.checked })} /> 필수</label>
                    {alts.length > 1 && (
                      <select className="input" value="" aria-label={`${q.no} 문안 고르기`} onChange={e => { const b = alts.find(x => x.id === e.target.value); if (b) setQ(i, toFormQuestion(b, ctx)) }}>
                        <option value="">다른 문안…</option>
                        {alts.map(b => <option key={b.id} value={b.id}>{b.variant}{b.is_default ? ' (기본)' : ''}</option>)}
                      </select>
                    )}
                  </div>
                  <textarea className="textarea" rows={3} value={q.body} aria-label={`${q.no} 질문`} onChange={e => setQ(i, { body: e.target.value })} onBlur={e => setQ(i, { body: fillTemplate(e.target.value, ctx) })} />
                  {q.kind === 'choice'
                    ? <textarea className="textarea" rows={Math.max(3, q.options.length)} value={q.options.join('\n')} aria-label={`${q.no} 보기 (한 줄에 하나)`} onChange={e => setQ(i, { options: e.target.value.split('\n') })} onBlur={e => setQ(i, { options: [...new Set(e.target.value.split('\n').map(x => x.trim()).filter(Boolean))] })} />
                    : <input className="input" value={q.help} placeholder="도움말 · 예시 (선택)" aria-label={`${q.no} 도움말`} onChange={e => setQ(i, { help: e.target.value })} />}
                </li>
              )
            })}
          </ol>
          {problems.length > 0 && <ul className="sales-iv-form-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
        </>
      ) : (
        <p className="sales-iv-note">링크를 연 뒤에는 질문을 고치지 않습니다(브랜드가 보는 글이 도중에 바뀌지 않게). {form.submitted_at ? '답을 받은 인터뷰지는 질문을 고칠 수 없습니다.' : "고치려면 '작성 중으로 되돌리기'를 누르세요. 되돌린 동안에는 링크가 열리지 않습니다."}</p>
      )}

      <div className="sales-iv-actions">
        {editable && <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>인터뷰지 저장</Button>}
        {editable && <Button size="sm" kind="outline" disabled={busy} onClick={() => void open()}>링크 열기</Button>}
        <Button size="sm" kind="ghost" onClick={() => setPreview(!preview)}>{preview ? '미리보기 닫기' : '미리보기'}</Button>
        {form.status === '열림' && !form.submitted_at && <Button size="sm" kind="ghost" disabled={busy} onClick={() => setStatus('작성 중', '작성 중으로 되돌렸습니다. 링크는 다시 열 때까지 열리지 않습니다.')}>작성 중으로 되돌리기</Button>}
        {(form.status === '열림' || form.status === '제출') && <Button size="sm" kind="ghost" disabled={busy} onClick={() => setStatus('닫힘', '접수를 마감했습니다.', '접수를 마감하면 브랜드가 답을 더 고칠 수 없습니다. 마감할까요?')}>접수 마감</Button>}
        {form.status === '닫힘' && <Button size="sm" kind="ghost" disabled={busy} onClick={() => setStatus(form.submitted_at ? '제출' : '열림', '다시 열었습니다.')}>다시 열기</Button>}
      </div>
      {preview && (
        <div className="sales-iv-form-preview">
          <h4>{d.title}</h4>
          {d.intro.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
          <InterviewFormView questions={d.questions} answers={form.answers} showUse />
        </div>
      )}
    </div>
  )
}
