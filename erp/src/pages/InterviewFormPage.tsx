// 인터뷰지 — 브랜드 담당자 화면 /i/<토큰> (2026-11-19 · 구글 폼 대신)
//  - 로그인 없음 · 인트라넷 메뉴 없음 · 밝은 화면 · 휴대폰 우선. 그 인터뷰지 한 부만 보이고 닫히기 전까지 고쳐 낼 수 있다
//  - 쓰던 글은 이 브라우저에 임시 보관(창을 닫아도 남음) · 보내면 지운다
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { InterviewFormView } from '../components/InterviewFormView'
import { ANSWER_HINT_CHARS, checkAnswers, shortAnswers, SUBMIT_REASONS, type FormQuestion } from '../lib/interviewForms'
import { clearDraft, FORM_TOKEN_RE, getGuestForm, GUEST_FILE_ACCEPT, GUEST_FILE_LIMIT, GUEST_FILE_REASONS, loadDraft, removeGuestFile, saveDraft, submitGuestForm, uploadGuestFile, type GuestDraft, type GuestFile, type GuestForm } from '../lib/interviewFormGuest'
import './InterviewFormPage.css'

const CONSENTS = ['제공한 이미지를 더위클리 콘텐츠에 써도 됩니다', '쓰기 전에 확인이 필요합니다', '이미지는 제공하지 않습니다']
const md = (d: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? ''); return m ? `${Number(m[2])}월 ${Number(m[3])}일` : '' }
const emptyDraft = (): GuestDraft => ({ answers: {}, respondent: '', contact: '', consent: '' })

export function mountInterviewForm(el: HTMLElement) {
  const token = window.location.pathname.match(/^\/i\/([^/?#]+)\/?$/)?.[1] ?? ''
  for (const [name, content] of [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']]) {
    const tag = document.createElement('meta')
    tag.name = name
    tag.content = content
    document.head.appendChild(tag)
  }
  document.querySelector('link[rel="manifest"]')?.remove()
  document.title = '서면 인터뷰 · 더위클리'
  createRoot(el).render(<ErrorBoundary area="인터뷰지" full><InterviewFormPage token={FORM_TOKEN_RE.test(token) ? token : null} /></ErrorBoundary>)
}

type Phase = 'loading' | 'missing' | 'form' | 'done'

function InterviewFormPage({ token }: { token: string | null }) {
  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'missing')
  const [why, setWhy] = useState('not_found')
  const [form, setForm] = useState<GuestForm | null>(null)
  const [d, setD] = useState<GuestDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ no?: string; message: string } | null>(null)
  const [restored, setRestored] = useState(false)
  const touched = useRef(false)

  const load = async () => {
    if (!token) return
    setPhase('loading')
    const r = await getGuestForm(token)
    if (!r.ok) { setWhy(r.reason); setPhase('missing'); return }
    setForm(r)
    document.title = `${r.brand} 서면 인터뷰 · 더위클리`
    const kept = r.closed ? null : loadDraft(token)
    setRestored(!!kept)
    setD(kept ?? { answers: r.answers ?? {}, respondent: r.respondent ?? '', contact: '', consent: r.image_consent ?? '' })
    setPhase('form')
  }
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  // 쓰는 동안 0.6초마다 임시 보관 (손댄 뒤에만 · 닫힌 인터뷰지는 보관하지 않음)
  useEffect(() => {
    if (!token || !touched.current || form?.closed) return
    const t = window.setTimeout(() => saveDraft(token, d), 600)
    return () => window.clearTimeout(t)
  }, [d, token, form?.closed])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (busy) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const patch = (p: Partial<GuestDraft>) => { touched.current = true; setError(null); setD(x => ({ ...x, ...p })) }
  const fail = (message: string, no?: string) => {
    setError({ no, message })
    if (no) document.getElementById(`ivf-${no}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const submit = async () => {
    if (!token || !form) return
    const check = checkAnswers(form.questions as FormQuestion[], d.answers)
    if (!check.ok) { fail(check.message, check.no); return }
    setBusy(true)
    const r = await submitGuestForm(token, { ...d, answers: check.answers })
    setBusy(false)
    if (!r.ok) {
      fail(r.reason === 'network' || r.reason === 'server' || r.reason === 'offline' ? '보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요. 쓰신 글은 그대로 남아 있습니다.' : SUBMIT_REASONS[r.reason] ?? '보내지 못했습니다.', r.no)
      if (r.reason === 'closed') setForm({ ...form, closed: true })
      return
    }
    clearDraft(token)
    touched.current = false
    setForm({ ...form, answers: check.answers, submitted_at: new Date().toISOString(), respondent: d.respondent || null, image_consent: d.consent || null })
    setD({ ...d, answers: check.answers })
    setPhase('done')
    window.scrollTo({ top: 0 })
  }

  if (phase === 'loading') return <div className="ivp ivp-center"><p role="status">인터뷰지를 불러오고 있습니다.</p></div>
  if (phase === 'missing' || !form)
    return (
      <div className="ivp ivp-center">
        <div className="ivp-card ivp-msg">
          <span className="ivp-brand">THE WKLY</span>
          <h1>{why === 'network' || why === 'server' || why === 'offline' ? '인터뷰지를 불러오지 못했습니다' : '인터뷰지를 찾지 못했습니다'}</h1>
          <p>{why === 'network' || why === 'server' || why === 'offline' ? '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' : '주소가 잘렸을 수 있습니다. 받으신 링크를 다시 열거나 더위클리 담당자에게 알려 주세요.'}</p>
          {token && <button type="button" className="ivp-btn" onClick={() => void load()}>다시 시도</button>}
        </div>
      </div>
    )

  const answered = form.questions.filter(q => (d.answers[q.no] ?? '').trim()).length
  const short = shortAnswers(form.questions as FormQuestion[], d.answers)
  const dates = [form.due_on ? `답변 수령 희망일 ${md(form.due_on)}` : '', form.upload_on ? `콘텐츠 업로드 예정일 ${md(form.upload_on)}` : ''].filter(Boolean)

  if (phase === 'done')
    return (
      <div className="ivp">
        <main className="ivp-wrap">
          <div className="ivp-card ivp-msg">
            <span className="ivp-brand">THE WKLY</span>
            <h1>답변을 보냈습니다. 고맙습니다.</h1>
            <p>{form.brand} 담당자님이 보내 주신 {answered}개 문항의 답을 더위클리가 받았습니다. 콘텐츠 초안이 나오면 올리기 전에 확인을 부탁드리겠습니다.</p>
            <p>고칠 내용이 있으면 접수를 마감하기 전까지 이 링크에서 다시 고쳐 보낼 수 있습니다.</p>
            <button type="button" className="ivp-btn ghost" onClick={() => setPhase('form')}>답 고치기</button>
          </div>
          <InterviewFormView questions={form.questions} answers={form.answers} />
        </main>
      </div>
    )

  return (
    <div className="ivp">
      <main className="ivp-wrap">
        <header className="ivp-card ivp-head">
          <span className="ivp-brand">THE WKLY</span>
          <h1>{form.title}</h1>
          {dates.length > 0 && <p className="ivp-dates">{dates.map(x => <span key={x}>{x}</span>)}<small>일정은 검수 과정에서 바뀔 수 있습니다.</small></p>}
          {form.intro.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
        </header>
        {form.closed && <p className="ivp-banner">답변 접수가 끝난 인터뷰지입니다. 고칠 내용은 더위클리 담당자에게 알려 주세요.</p>}
        {!form.closed && form.submitted_at && <p className="ivp-banner ok">이미 보내 주신 답입니다. 고친 뒤 다시 보내면 새 답으로 바뀝니다.</p>}
        {!form.closed && restored && !form.submitted_at && <p className="ivp-banner ok">이 기기에서 쓰던 글을 이어서 불러왔습니다.</p>}
        <InterviewFormView questions={form.questions} answers={d.answers} errorNo={error?.no} errorText={error?.message} onAnswer={form.closed ? undefined : (no, v) => patch({ answers: { ...d.answers, [no]: v } })} />
        {!form.closed && <GuestFiles token={token!} initial={form.files ?? []} />}
        {!form.closed && (
          <section className="ivp-card ivp-end">
            <h2>보내는 분</h2>
            <div className="ivp-fields">
              <label><span>이름 · 직함</span><input value={d.respondent} maxLength={80} onChange={e => patch({ respondent: e.target.value })} placeholder="예: 홍길동 브랜드 매니저" autoComplete="name" /></label>
              <label><span>연락처 (선택)</span><input value={d.contact} maxLength={120} onChange={e => patch({ contact: e.target.value })} placeholder="확인이 필요할 때 연락드릴 메일 · 전화" autoComplete="email" /></label>
            </div>
            <fieldset className="ivp-consent">
              <legend>이미지 사용</legend>
              {CONSENTS.map(c => (
                <label key={c} className={d.consent === c ? 'on' : ''}>
                  <input type="radio" name="ivp-consent" checked={d.consent === c} onChange={() => patch({ consent: c })} />
                  <span>{c}</span>
                </label>
              ))}
            </fieldset>
            {short.length > 0 && <p className="ivp-note">{short.join(' · ')} 답이 {ANSWER_HINT_CHARS}자보다 짧습니다. 그대로 보내도 되지만, 짧으면 홈페이지 인터뷰에는 실리지 않을 수 있습니다.</p>}
            {error && <p className="ivp-error" role="alert">{error.message}</p>}
            <div className="ivp-send">
              <span>{answered} / {form.questions.length} 문항 작성</span>
              <button type="button" className="ivp-btn" disabled={busy} onClick={() => void submit()}>{busy ? '보내는 중…' : form.submitted_at ? '고친 답 보내기' : '답변 보내기'}</button>
            </div>
          </section>
        )}
        <footer className="ivp-foot">더위클리(THE WKLY) · 팝업 큐레이션 콘텐츠 서면 인터뷰</footer>
      </main>
    </div>
  )
}

const sizeLabel = (n: number | null) => (n == null ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/** 사진 · 자료 올리기 (2026-11-20 · 선택): 고르는 즉시 올라가고 목록에 남는다. 답 보내기와 따로 · 접수 마감 전까지 지울 수 있음 */
function GuestFiles({ token, initial }: { token: string; initial: GuestFile[] }) {
  const [files, setFiles] = useState<GuestFile[]>(initial)
  const [going, setGoing] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const add = async (list: FileList | null) => {
    if (!list?.length) return
    setErr(null)
    const all = [...list].slice(0, Math.max(0, GUEST_FILE_LIMIT - files.length))
    if (all.length < list.length) setErr(`자료는 ${GUEST_FILE_LIMIT}개까지 올릴 수 있습니다.`)
    for (const f of all) {
      setGoing(g => [...g, f.name])
      const r = await uploadGuestFile(token, f)
      setGoing(g => g.filter(x => x !== f.name))
      if (r.ok) setFiles(r.files)
      else setErr(`${f.name}: ${GUEST_FILE_REASONS[r.reason] ?? '올리지 못했습니다. 인터넷 연결을 확인하고 다시 올려 주세요.'}`)
    }
  }
  const remove = async (f: GuestFile) => {
    if (!window.confirm(`${f.name} 을(를) 지울까요?`)) return
    const r = await removeGuestFile(token, f)
    if (r.ok) setFiles(r.files)
    else setErr('지우지 못했습니다. 다시 시도해 주세요.')
  }
  return (
    <section className="ivp-card ivp-end ivp-files">
      <h2>사진 · 자료 올리기 <small>선택</small></h2>
      <p className="ivp-sub">팝업 현장 · 제품 사진, 소개서 PDF 같은 자료를 올려 주세요. 고르는 즉시 더위클리에 전달되고, 답 보내기와는 따로입니다. 파일 하나 30MB · 모두 {GUEST_FILE_LIMIT}개까지.</p>
      <div
        className="ivp-drop"
        onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault() }}
        onDrop={e => { e.preventDefault(); void add(e.dataTransfer.files) }}
      >
        <button type="button" className="ivp-btn ghost" disabled={going.length > 0 || files.length >= GUEST_FILE_LIMIT} onClick={() => pick.current?.click()}>
          {going.length ? `올리는 중 (${going.length})…` : '파일 고르기'}
        </button>
        <span>또는 여기에 끌어다 놓기</span>
        <input ref={pick} type="file" multiple hidden accept={GUEST_FILE_ACCEPT} onChange={e => { void add(e.target.files); e.target.value = '' }} />
      </div>
      {err && <p className="ivp-error" role="alert">{err}</p>}
      {files.length > 0 && (
        <ul className="ivp-file-list">
          {files.map(f => (
            <li key={f.id}>
              <span className="name">{f.name}</span>
              <span className="size">{sizeLabel(f.size)}</span>
              <button type="button" className="ivp-link" onClick={() => void remove(f)}>지우기</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
