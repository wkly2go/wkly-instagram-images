import { useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { newGrowth, safeWebUrl } from '../lib/growth'
import { inquiryMailUrl } from '../lib/inquiryThreads'
import { INTERVIEW_QUESTIONS, STAGE_TONE, byUpload, daysBetween, draftOf, interviewContentText, mdWithDay, todayKst, uploadConflicts } from '../lib/interviews'
import { Link, useRouter } from '../lib/router'
import type { MailFile, SalesInterview } from '../lib/types'
import { InterviewFiles } from './InterviewFiles'
import { InterviewSchedule } from './SalesInterviews'
import { Button } from './ui'
import './SalesInterviews.css'

/**
 * 광고·콘텐츠 › 인터뷰 피드 (2026-11-18 대표 지시 '영업수주에서 인터뷰지와 인터뷰질문 데이터 관리하고 제작은 광고 컨텐츠에서')
 * 영업·수주 '서면 인터뷰'에서 자료를 받은 브랜드가 제작 대기열로 넘어온다 (같은 표 sales_interviews · 복사 없음).
 *  - 콘텐츠 초안 만들기: 인터뷰 답을 옮겨 적은 초안(영업용 Q3 · Q10 제외)을 콘텐츠·배포(growth_items)에 만들고 단계 '제작'
 *  - 업로드 완료: 게시 링크와 함께 단계 '업로드 완료'
 * AI 호출 · 메일 발송 없음.
 */
type FileLink = Pick<MailFile, 'id' | 'name' | 'drive_url' | 'sent_at' | 'thread_id' | 'kind'>

export function InterviewFeed() {
  const { api, toast, me } = useApp()
  const { navigate } = useRouter()
  const state = useAsync(() => api.listInterviews(), [api], [] as SalesInterview[])
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [posts, setPosts] = useState<Record<string, string>>({})
  const today = todayKst()
  const rows = state.data
  const conflicts = useMemo(() => uploadConflicts(rows), [rows])
  const queue = useMemo(() => rows.filter(r => r.stage === '자료 수령' || r.stage === '제작').sort(byUpload), [rows])
  const coming = useMemo(() => rows.filter(r => r.stage === '인터뷰지 발송' || r.stage === '답변').sort(byUpload), [rows])
  const done = useMemo(() => rows.filter(r => r.stage === '업로드 완료').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 12), [rows])
  const put = (saved: SalesInterview) => state.setData(rows.map(r => (r.id === saved.id ? saved : r)))

  const startContent = async (r: SalesInterview) => {
    setBusy(r.id)
    try {
      const text = interviewContentText(r)
      const draft = newGrowth('content', me.id)
      draft.title = text.title
      draft.document = {
        ...draft.document,
        division: 'TW',
        source_url: r.form_url && safeWebUrl(r.form_url) ? r.form_url : '',
        note: [
          `서면 인터뷰에서 만든 초안 (${today}) · 영업용 답(예산 · 파트너 기준)은 넣지 않았습니다.`,
          r.image_use ? `이미지 사용: ${r.image_use}` : '',
          r.upload_on ? `인스타 업로드 예정: ${r.upload_on}${r.upload_note ? ` ${r.upload_note}` : ''}` : '',
        ].filter(Boolean).join('\n'),
        original: text.original,
        versions: (draft.document.versions ?? []).map(v =>
          v.channel === '인스타그램' ? { ...v, title: text.title, body: text.instagram, tags: text.tags }
            : v.channel === '네이버 블로그' || v.channel === '홈페이지' ? { ...v, title: `${r.brand} 팝업 인터뷰`.slice(0, 300), body: text.blog, tags: text.tags }
              : v),
      }
      const item = await api.saveGrowth(crypto.randomUUID(), draft, 0)
      const saved = await api.saveInterview(r.id, { ...draftOf(r), stage: r.stage === '자료 수령' ? '제작' : r.stage, content_id: item.id })
      put(saved)
      toast('콘텐츠 초안을 만들었습니다. 콘텐츠 열기에서 다듬어 주세요.')
    } catch (e) { toast(e instanceof Error ? e.message : '초안을 만들지 못했습니다.') }
    finally { setBusy('') }
  }
  const markUploaded = async (r: SalesInterview) => {
    const url = (posts[r.id] ?? r.post_url ?? '').trim()
    if (url && !/^https?:\/\/\S+$/i.test(url)) { toast('게시 링크는 https:// 로 시작하는 주소로 넣어 주세요.'); return }
    if (!url && !window.confirm('게시 링크 없이 업로드 완료로 바꿀까요?')) return
    setBusy(r.id)
    try {
      put(await api.saveInterview(r.id, { ...draftOf(r), stage: '업로드 완료', post_url: url || null }))
      toast('업로드 완료로 바꿨습니다.')
    } catch (e) { toast(e instanceof Error ? e.message : '바꾸지 못했습니다.') }
    finally { setBusy('') }
  }

  const card = (r: SalesInterview) => {
    const clash = r.upload_on ? conflicts.get(r.upload_on)?.length ?? 0 : 0
    const d = r.upload_on ? daysBetween(today, r.upload_on) : null
    const qa = INTERVIEW_QUESTIONS.filter(q => q.use === '콘텐츠' && r.answers[q.no])
    const tone = d != null && d < 0 ? ' hot' : clash > 1 ? ' warn' : d != null && d <= 2 ? ' soon' : ''
    return (
      <li key={r.id} id={`feed-${r.id}`} className={`sales-iv-feed${open === r.id ? ' open' : ''}`}>
        <div className="head">
          <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
          <b>{r.brand}</b>
          <span className="what">{r.event_name ?? ''}</span>
          {r.upload_on
            ? <span className={`tag${tone}`}>업로드 {mdWithDay(r.upload_on)}{r.upload_note ? ` ${r.upload_note}` : ''}{d === 0 ? ' · 오늘' : d != null && d < 0 ? ' · 지남' : ''}{clash > 1 ? ` · 같은 날 ${clash}곳` : ''}</span>
            : <span className="tag">업로드 미정</span>}
        </div>
        <dl className="facts">
          <div><dt>이미지 사용</dt><dd>{r.image_use || '미확인 — 게시 전에 확인'}</dd></div>
          <div><dt>인터뷰 답</dt><dd>{qa.length ? `${qa.length}개 문항 (영업용 제외)` : '아직 없음 — 영업·수주에서 답을 넣어 주세요'}</dd></div>
          {r.note && <div><dt>비고</dt><dd>{r.note}</dd></div>}
        </dl>
        <div className="sales-iv-actions">
          {r.content_id
            ? <Link to={`/ads?tab=content&item=${r.content_id}`} className="btn btn-sm">콘텐츠 열기</Link>
            : <Button size="sm" disabled={busy === r.id} onClick={() => void startContent(r)}>콘텐츠 초안 만들기</Button>}
          <Button size="sm" kind="outline" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '답 · 자료 접기' : '답 · 자료 보기'}</Button>
          <Link to={`/sales?interview=${r.id}`} className="btn btn-outline btn-sm">영업·수주에서 보기</Link>
          <input className="input post" type="url" placeholder="게시 링크 (업로드 후)" aria-label={`${r.brand} 게시 링크`} value={posts[r.id] ?? r.post_url ?? ''} onChange={e => setPosts({ ...posts, [r.id]: e.target.value })} />
          <Button size="sm" kind="outline" disabled={busy === r.id} onClick={() => void markUploaded(r)}>업로드 완료</Button>
        </div>
        {open === r.id && <FeedDetail r={r} />}
      </li>
    )
  }

  return (
    <div className="sales-iv-feedpage">
      <p className="sales-iv-note">영업·수주 &apos;서면 인터뷰&apos;에서 자료를 받은 브랜드가 여기로 넘어옵니다(같은 기록 · 복사 없음). 초안은 인터뷰 답을 옮겨 적어 만들며(AI 없음), 영업용 답(예산 · 파트너 기준)은 넣지 않습니다.</p>
      {state.error && <p role="alert">{state.error}</p>}
      <h3>제작 대기 <small>{queue.length}곳</small></h3>
      {state.loading ? <p role="status">불러오고 있습니다.</p> : queue.length ? <ul className="sales-iv-feedlist">{queue.map(card)}</ul> : <p className="sales-iv-note">자료를 받은 브랜드가 없습니다.</p>}
      <h3>업로드 일정</h3>
      <InterviewSchedule rows={rows} today={today} onPick={id => navigate(`/sales?interview=${id}`)} />
      <h3>자료 받을 예정 <small>{coming.length}곳</small></h3>
      <ul className="sales-iv-list">
        {coming.map(r => (
          <li key={r.id}>
            <Link to={`/sales?interview=${r.id}`} className="sales-iv-row">
              <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
              <b className="truncate">{r.brand}</b>
              <span className="what truncate">{r.event_name ?? ''}</span>
              {r.material_due && <span className={`tag${daysBetween(today, r.material_due) < 0 ? ' hot' : ''}`}>자료 {mdWithDay(r.material_due)}</span>}
              {r.upload_on && <span className="tag">업로드 {mdWithDay(r.upload_on)}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <h3>최근 업로드 <small>{done.length}곳</small></h3>
          <ul className="sales-iv-list">
            {done.map(r => (
              <li key={r.id} className="sales-iv-row static">
                <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
                <b className="truncate">{r.brand}</b>
                <span className="what truncate">{r.event_name ?? ''}</span>
                {r.post_url && <a className="tag" href={r.post_url} target="_blank" rel="noopener noreferrer">게시물</a>}
                {r.content_id && <Link to={`/ads?tab=content&item=${r.content_id}`} className="tag">콘텐츠</Link>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function FeedDetail({ r }: { r: SalesInterview }) {
  const { api } = useApp()
  const files = useAsync(() => (r.mail_threads.length ? api.listMailFilesByThreads(r.mail_threads) : Promise.resolve([] as FileLink[])), [api, r.id], [] as FileLink[])
  const qa = INTERVIEW_QUESTIONS.filter(q => q.use === '콘텐츠' && r.answers[q.no])
  return (
    <div className="sales-iv-feeddetail">
      {(files.data.length > 0 || r.mail_threads.length > 0) && (
        <div className="sales-iv-mail">
          <b>받은 자료 · 메일</b>
          <div className="links">
            {files.data.map(f => f.drive_url && <a key={f.id} className="file" href={f.drive_url} target="_blank" rel="noopener noreferrer">{f.name}</a>)}
            {r.mail_threads.slice(0, 6).map((t, i) => <a key={t} className="btn btn-outline btn-sm" href={inquiryMailUrl(t)} target="_blank" rel="noopener noreferrer">메일 대화 {i + 1}</a>)}
          </div>
          {r.mail_attach_at && <p className="sales-iv-note">마지막 첨부 메일 {dateTimeLabel(r.mail_attach_at)}</p>}
        </div>
      )}
      <InterviewFiles interviewId={r.id} />
      {qa.length ? (
        <dl className="sales-iv-qa-list">
          {qa.map(q => <div key={q.no}><dt>{q.no} · {q.label}</dt><dd>{r.answers[q.no]}</dd></div>)}
        </dl>
      ) : <p className="sales-iv-note">콘텐츠에 쓸 답이 아직 없습니다.</p>}
    </div>
  )
}
