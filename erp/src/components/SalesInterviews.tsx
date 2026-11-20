import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { InterviewFormPanel } from './InterviewFormPanel'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { inquiryMailUrl } from '../lib/inquiryThreads'
import {
  ACTIVE_STAGES, INTERVIEW_QUESTIONS, INTERVIEW_STAGES, SALES_INFO_FIELDS, STAGE_TONE, answersFromPaste, byUpload, cleanDraft, daysBetween,
  draftOf, emptyInterview, fromLocalInput, mailSignal, materialStatus, mdWithDay, shortMd, toLocalInput, todayKst, uploadConflicts, validateInterview,
} from '../lib/interviews'
import { registerDraftNavigation } from '../lib/navigationGuard'
import { useRouter } from '../lib/router'
import type { InterviewSalesInfo, InterviewStage, MailFile, SalesInterview, SalesInterviewDraft } from '../lib/types'
import { Button, Field } from './ui'
import './SalesInterviews.css'

/**
 * 서면 인터뷰 · 팝업 큐레이션 (2026-11-18 대표 지시 '영업수주에서 인터뷰지와 인터뷰질문 데이터 관리하고 제작은 광고 컨텐츠에서'
 *  → '작업 환경에 맞게 인트라넷에 반영하고 현재 작업중인 자료도 이전해줘')
 * 구글 시트 '인터뷰피드 발송현황'의 탭을 그대로 화면으로: 진행 현황(답변 온 브랜드) · 업로드 일정 · 발송 전체 · 인터뷰 답(로우 데이터) · 영업 정보(1차 가공)
 * 연락처 메일로 오간 메일 · 첨부는 서버가 10분마다 확인(private.sales_interview_mail_tick). 메일은 보내지 않는다. 규칙은 lib/interviews.ts
 */
type View = 'active' | 'schedule' | 'all' | 'answers' | 'sales'
const VIEWS: [View, string][] = [['active', '진행 현황'], ['schedule', '업로드 일정'], ['all', '발송 전체'], ['answers', '인터뷰 답'], ['sales', '영업 정보']]
const CLOSED: InterviewStage[] = ['답장 없음', '불가', '보류']
const FILTERS: [string, (s: InterviewStage) => boolean][] = [
  ['전체', () => true],
  ['참여', s => ACTIVE_STAGES.includes(s) || s === '업로드 완료'],
  ['회신 기다림', s => s === '발송'],
  ['답장 없음', s => s === '답장 없음'],
  ['확인 필요', s => s === '확인 필요'],
  ['불가 · 보류', s => s === '불가' || s === '보류'],
]
type FileLink = Pick<MailFile, 'id' | 'name' | 'drive_url' | 'sent_at' | 'thread_id' | 'kind'>

export function SalesInterviews() {
  const { api } = useApp()
  const { query } = useRouter()
  const state = useAsync(() => api.listInterviews(), [api], [] as SalesInterview[])
  const [view, setView] = useState<View>('active')
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(0)
  const [pinned, setPinned] = useState(false)
  const today = todayKst()
  const rows = state.data
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => [r.brand, r.event_name, r.venue, r.contact, r.note].some(v => (v ?? '').toLowerCase().includes(q))) : rows
  }, [rows, search])
  const conflicts = useMemo(() => uploadConflicts(rows), [rows])
  const clashOf = (r: SalesInterview) => (r.upload_on ? conflicts.get(r.upload_on)?.length ?? 0 : 0)
  const active = useMemo(() => shown.filter(r => ACTIVE_STAGES.includes(r.stage)).sort(byUpload), [shown])
  const answered = useMemo(() => shown.filter(r => Object.keys(r.answers ?? {}).length > 0), [shown])
  const salesRows = useMemo(() => shown.filter(r => Object.keys(r.sales_info ?? {}).length > 0 || Object.keys(r.answers ?? {}).length > 0), [shown])
  const activeAll = rows.filter(r => ACTIVE_STAGES.includes(r.stage)).length
  const overdue = rows.filter(r => materialStatus(r, today)?.tone === 'hot').length
  const week = rows.filter(r => r.upload_on && r.stage !== '업로드 완료' && !CLOSED.includes(r.stage) && daysBetween(today, r.upload_on) >= 0 && daysBetween(today, r.upload_on) < 7).length
  const clashDays = [...conflicts.keys()].filter(d => d >= today).length
  const replace = (saved: SalesInterview) => state.setData(rows.some(r => r.id === saved.id) ? rows.map(r => (r.id === saved.id ? saved : r)) : [saved, ...rows])
  const counts: Partial<Record<View, number>> = { active: active.length, schedule: rows.filter(r => r.upload_on && !CLOSED.includes(r.stage)).length, all: shown.length, answers: answered.length, sales: salesRows.length }

  // 알림의 '/sales?interview=<id>' · 다른 보기에서 고르기 → 그 줄이 있는 보기로 가서 펼침
  const focusRow = (id: string, list: SalesInterview[] = rows) => {
    const r = list.find(x => x.id === id)
    if (!r) return
    setView(ACTIVE_STAGES.includes(r.stage) ? 'active' : 'all')
    setFilter(0)
    setSearch('')
    setOpen(id)
    setPinned(true)
    window.setTimeout(() => document.getElementById(`iv-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
  }
  const focus = query.get('interview')
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || focused.current === focus || state.loading || !rows.some(r => r.id === focus)) return
    focused.current = focus
    focusRow(focus, rows)
    // focusRow 는 상태 설정만 함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, state.loading, rows])

  const editor = (r: SalesInterview) => <Editor row={r} onSaved={replace} onClose={() => setOpen(null)} />
  const row = (r: SalesInterview, kind: 'active' | 'all') => (
    <Row key={r.id} r={r} kind={kind} today={today} clash={clashOf(r)} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}>
      {open === r.id && editor(r)}
    </Row>
  )
  const batches = [...new Set(shown.map(r => r.batch || '묶음 없음'))]
    .sort((a, b) => latest(shown, b).localeCompare(latest(shown, a)))

  return (
    <details className="sales-iv" open={pinned || activeAll > 0 || undefined}>
      <summary>
        <b>서면 인터뷰 · 팝업 큐레이션</b>
        <span>진행 {activeAll}</span>
        {overdue > 0 && <span className="hot">자료 수령 지남 {overdue}</span>}
        <span>이번 주 업로드 {week}</span>
        {clashDays > 0 && <span className="warn">업로드 겹치는 날 {clashDays}</span>}
        <small>더위클리 인터뷰 피드의 섭외부터 인터뷰지 · 자료 수령 · 업로드 일정까지 한 줄로 관리합니다(예전 &apos;인터뷰피드 발송현황&apos; 시트). 연락처 메일로 오간 메일은 10분마다 자동으로 확인하고, 인터뷰 답의 예산 · 파트너 기준은 영업 정보로 모입니다. 메일은 보내지 않습니다.</small>
      </summary>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="sales-iv-bar">
        <div className="chips" role="tablist" aria-label="서면 인터뷰 보기">
          {VIEWS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`chip${view === k ? ' active' : ''}`} onClick={() => setView(k)}>{label}{counts[k] === undefined ? '' : ` ${counts[k]}`}</button>)}
        </div>
        <input className="input" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="브랜드 · 행사 · 연락처 · 비고 검색" aria-label="서면 인터뷰 검색" />
        <Button size="sm" disabled={open === 'new'} onClick={() => { setOpen('new'); setPinned(true) }}>+ 섭외 추가</Button>
      </div>
      {open === 'new' && <Editor row={null} onSaved={saved => { replace(saved); focusRow(saved.id, [saved, ...rows]) }} onClose={() => setOpen(null)} />}
      {state.loading ? <p role="status">서면 인터뷰를 불러오고 있습니다.</p> : view === 'active' ? (
        <>
          <p className="sales-iv-note">참여하기로 한 브랜드입니다. 업로드 예정일 순이며, 자료 수령 예정일이 지나면 빨갛게 보입니다.</p>
          {active.length ? <ul className="sales-iv-list">{active.map(r => row(r, 'active'))}</ul> : <p className="sales-iv-note">진행 중인 인터뷰가 없습니다.</p>}
        </>
      ) : view === 'schedule' ? (
        <InterviewSchedule rows={shown} today={today} onPick={id => focusRow(id)} />
      ) : view === 'all' ? (
        <>
          <div className="chips" aria-label="단계로 거르기">
            {FILTERS.map(([label, test], i) => <button key={label} type="button" className={`chip${filter === i ? ' active' : ''}`} aria-pressed={filter === i} onClick={() => setFilter(i)}>{label} {shown.filter(r => test(r.stage)).length}</button>)}
          </div>
          {batches.map(b => {
            const part = shown.filter(r => (r.batch || '묶음 없음') === b && FILTERS[filter][1](r.stage))
              .sort((x, y) => (y.sent_on ?? '').localeCompare(x.sent_on ?? '') || x.brand.localeCompare(y.brand, 'ko'))
            if (!part.length) return null
            return (
              <div key={b} className="sales-iv-part">
                <h3>{b} <small>{part.length}곳</small></h3>
                <ul className="sales-iv-list">{part.map(r => row(r, 'all'))}</ul>
              </div>
            )
          })}
        </>
      ) : view === 'answers' ? (
        <Answers rows={answered} onEdit={id => focusRow(id)} />
      ) : (
        <SalesInfo rows={salesRows} onEdit={id => focusRow(id)} />
      )}
    </details>
  )
}
const latest = (rows: SalesInterview[], batch: string) => rows.filter(r => (r.batch || '묶음 없음') === batch).reduce((m, r) => ((r.sent_on ?? '') > m ? r.sent_on ?? '' : m), '')

function Row({ r, kind, today, clash, open, onToggle, children }: { r: SalesInterview; kind: 'active' | 'all'; today: string; clash: number; open: boolean; onToggle: () => void; children?: ReactNode }) {
  const ms = materialStatus(r, today)
  const mail = mailSignal(r)
  return (
    <li id={`iv-${r.id}`} className={open ? 'open' : ''}>
      <button type="button" className="sales-iv-row" aria-expanded={open} onClick={onToggle}>
        <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
        <b className="truncate">{r.brand}</b>
        <span className="what truncate">{r.event_name ?? ''}</span>
        {kind === 'all' && <span className="tag">{[r.send_channel, r.sent_on ? shortMd(r.sent_on) : null].filter(Boolean).join(' · ') || '발송 정보 없음'}</span>}
        {kind === 'all' && r.reply_channel && <span className="tag">답변 {r.reply_channel}</span>}
        {ms && kind === 'active' && <span className={`tag ${ms.tone}`}>{ms.label}</span>}
        {r.upload_on && (kind === 'active' || r.stage !== '답장 없음') && <span className={`tag${clash > 1 && r.stage !== '업로드 완료' ? ' warn' : ''}`}>업로드 {mdWithDay(r.upload_on)}{r.upload_note ? ` ${r.upload_note}` : ''}{clash > 1 ? ` · 같은 날 ${clash}곳` : ''}</span>}
        {mail && <span className={`tag ${mail.tone}`}>{mail.label}</span>}
        {r.content_id && <span className="tag ok">콘텐츠 초안 있음</span>}
      </button>
      {children}
    </li>
  )
}

/** 업로드 일정 (지난 2주 ~ 앞으로 · 같은 날 겹침) — 광고·콘텐츠 '인터뷰 피드'에서도 씀 */
export function InterviewSchedule({ rows, today, onPick }: { rows: SalesInterview[]; today: string; onPick: (id: string) => void }) {
  const dated = rows.filter(r => r.upload_on && !CLOSED.includes(r.stage) && daysBetween(today, r.upload_on) >= -14).sort(byUpload)
  const days = new Map<string, SalesInterview[]>()
  for (const r of dated) days.set(r.upload_on as string, [...(days.get(r.upload_on as string) ?? []), r])
  const undated = rows.filter(r => !r.upload_on && ACTIVE_STAGES.includes(r.stage)).sort(byUpload)
  const item = (r: SalesInterview, past: boolean) => (
    <li key={r.id}>
      <button type="button" onClick={() => onPick(r.id)}>
        <span className={`iv-stage ${STAGE_TONE[r.stage]}`}>{r.stage}</span>
        <b>{r.brand}</b>
        {r.upload_note && <span className="tag">{r.upload_note}</span>}
        {past && r.stage !== '업로드 완료' && <span className="tag hot">업로드 확인</span>}
      </button>
    </li>
  )
  return (
    <div className="sales-iv-cal">
      <p className="sales-iv-note">지난 2주부터 앞으로의 인스타 업로드 예정일입니다. 같은 날 둘 이상이면 겹침으로 표시합니다. 줄을 누르면 그 브랜드를 펼칩니다.</p>
      {[...days].map(([date, list]) => {
        const diff = daysBetween(today, date)
        const busy = list.filter(r => r.stage !== '업로드 완료').length
        return (
          <section key={date} className={`day${busy > 1 ? ' clash' : ''}${diff < 0 ? ' past' : ''}${diff === 0 ? ' today' : ''}`}>
            <h4>{mdWithDay(date)}{diff === 0 && <span className="tag ok">오늘</span>}{busy > 1 && <span className="tag warn">{busy}곳 겹침</span>}</h4>
            <ul>{list.map(r => item(r, diff < 0))}</ul>
          </section>
        )
      })}
      {undated.length > 0 && (
        <section className="day undated">
          <h4>업로드 일정 미정 <small>{undated.length}곳</small></h4>
          <ul>{undated.map(r => item(r, false))}</ul>
        </section>
      )}
      {!days.size && !undated.length && <p className="sales-iv-note">잡힌 업로드 일정이 없습니다.</p>}
    </div>
  )
}

function Answers({ rows, onEdit }: { rows: SalesInterview[]; onEdit: (id: string) => void }) {
  if (!rows.length) return <p className="sales-iv-note">받은 인터뷰 답이 없습니다. 브랜드 줄을 펼쳐 &apos;인터뷰 답&apos;에 붙여 넣으면 여기에 모입니다.</p>
  return (
    <div className="sales-iv-answers">
      <p className="sales-iv-note">브랜드가 보낸 인터뷰지 답입니다(예전 &apos;로우 데이터&apos;). 영업용 문항(예산 · 파트너 기준)은 내부 참고용입니다.</p>
      {rows.map(r => (
        <details key={r.id} className="sales-iv-qa">
          <summary>
            <b>{r.brand}</b>
            <span>{Object.keys(r.answers).length}/10 문항</span>
            <span>{r.answered_at ? dateTimeLabel(r.answered_at) : r.answered_note ?? ''}</span>
          </summary>
          <dl>
            {INTERVIEW_QUESTIONS.filter(q => r.answers[q.no]).map(q => (
              <div key={q.no}>
                <dt>{q.no} · {q.label}{q.use === '영업' && <span className="tag sales">영업용</span>}</dt>
                <dd>{r.answers[q.no]}</dd>
              </div>
            ))}
          </dl>
          <Button size="sm" kind="outline" onClick={() => onEdit(r.id)}>이 브랜드 고치기</Button>
        </details>
      ))}
    </div>
  )
}

function SalesInfo({ rows, onEdit }: { rows: SalesInterview[]; onEdit: (id: string) => void }) {
  if (!rows.length) return <p className="sales-iv-note">정리된 영업 정보가 없습니다.</p>
  return (
    <div className="sales-iv-sales">
      <p className="sales-iv-note">인터뷰 답에서 뽑은 영업 정보입니다(예전 &apos;1차 가공 데이터&apos;). 답을 받은 브랜드는 10분 안에 영업 후보(출처 &apos;서면 인터뷰&apos;)로 자동 등록됩니다. 브랜드를 누르면 고칠 수 있습니다.</p>
      <table className="table">
        <thead><tr><th>브랜드</th>{SALES_INFO_FIELDS.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><button type="button" className="linkish" onClick={() => onEdit(r.id)}>{r.brand}</button></td>
              {SALES_INFO_FIELDS.map(([k, label]) => <td key={label}>{r.sales_info[k] || (k === 'budget' && r.answers.Q3) || (k === 'partner' && r.answers.Q10 ? <span className="hint">Q10 답 정리 필요</span> : '–')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 고치기 창 맨 위 진행 띠: 단계와 그 단계의 날짜를 한 줄로 (2026-11-18 대표 지시 '한눈에 보고 파악할 수 있게') */
const FLOW: InterviewStage[] = ['발송', '답변', '인터뷰지 발송', '자료 수령', '제작', '업로드 완료']
const dayOf = (iso: string | null) => (iso ? shortMd(toLocalInput(iso).slice(0, 10)) : '')
function flowDate(stage: InterviewStage, d: SalesInterviewDraft): string {
  if (stage === '발송') return d.sent_on ? shortMd(d.sent_on) : ''
  if (stage === '답변') return dayOf(d.replied_at)
  if (stage === '인터뷰지 발송') return dayOf(d.form_sent_at)
  if (stage === '자료 수령') return d.material_due ? `${mdWithDay(d.material_due)} 예정` : ''
  if (stage === '업로드 완료') return d.upload_on ? `${mdWithDay(d.upload_on)}${d.post_url ? '' : ' 예정'}` : ''
  return ''
}

function Editor({ row, onSaved, onClose }: { row: SalesInterview | null; onSaved: (r: SalesInterview) => void; onClose: () => void }) {
  const { api, toast, profiles } = useApp()
  const [d, setD] = useState<SalesInterviewDraft>(() => (row ? draftOf(row) : emptyInterview()))
  const [busy, setBusy] = useState(false)
  const [paste, setPaste] = useState('')
  const base = useRef(JSON.stringify(d))
  const dirty = JSON.stringify(d) !== base.current
  const guard = useRef({ dirty, busy })
  guard.current = { dirty, busy }
  useEffect(() => registerDraftNavigation(window, () => guard.current, () => window.confirm('저장하지 않은 서면 인터뷰 내용이 있습니다. 이동할까요?')), [])
  const files = useAsync(() => (row?.mail_threads.length ? api.listMailFilesByThreads(row.mail_threads) : Promise.resolve([] as FileLink[])), [api, row?.id, row?.mail_threads.join()], [] as FileLink[])
  const people = profiles.filter(p => p.active && !p.is_agent)
  const set = (patch: Partial<SalesInterviewDraft>) => setD(x => ({ ...x, ...patch }))
  type TextKey = { [K in keyof SalesInterviewDraft]: SalesInterviewDraft[K] extends string | null ? K : never }[keyof SalesInterviewDraft]
  const text = (label: string, key: TextKey, opts: { full?: boolean; span2?: boolean; area?: number; type?: string; placeholder?: string } = {}) => (
    <Field label={label} className={opts.full ? 'full' : opts.span2 ? 'span2' : ''}>
      {opts.area
        ? <textarea className="textarea" rows={opts.area} value={(d[key] as string | null) ?? ''} placeholder={opts.placeholder} onChange={e => set({ [key]: e.target.value } as Partial<SalesInterviewDraft>)} />
        : <input className="input" type={opts.type ?? 'text'} value={(d[key] as string | null) ?? ''} placeholder={opts.placeholder} onChange={e => set({ [key]: e.target.value } as Partial<SalesInterviewDraft>)} />}
    </Field>
  )
  const save = async () => {
    const err = validateInterview(d)
    if (err) { toast(err); return }
    setBusy(true)
    try {
      const saved = await api.saveInterview(row?.id ?? null, cleanDraft(d))
      const next = draftOf(saved)
      base.current = JSON.stringify(next)
      setD(next)
      onSaved(saved)
      toast(row ? '저장했습니다.' : '섭외를 추가했습니다.')
    } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  // 인터뷰지 링크를 열면 '인터뷰지 링크' 칸에 자동으로 적는다 (저장된 줄 기준 · 지금 고치던 다른 칸은 건드리지 않음)
  const linkForm = async (url: string) => {
    if (!row) return
    try {
      const saved = await api.saveInterview(row.id, cleanDraft({ ...draftOf(row), form_url: url }))
      base.current = JSON.stringify({ ...(JSON.parse(base.current) as SalesInterviewDraft), form_url: url })
      set({ form_url: url })
      onSaved(saved)
    } catch { /* 링크 칸을 못 적어도 인터뷰지는 열려 있다 */ }
  }
  const close = () => { if (!dirty || window.confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) onClose() }
  const applyPaste = () => {
    const p = answersFromPaste(paste)
    const n = Object.keys(p.answers).length
    if (!n) { toast('붙여 넣은 칸에서 답을 찾지 못했습니다.'); return }
    set({ answers: { ...d.answers, ...p.answers }, answered_note: d.answered_note || p.stamp })
    setPaste('')
    toast(`${n}개 문항을 채웠습니다. 저장을 눌러 주세요.`)
  }
  const answerCount = Object.values(d.answers).filter(v => v && v.trim()).length
  const infoCount = Object.values(d.sales_info).filter(v => v && v.trim()).length
  const setInfo = (k: keyof InterviewSalesInfo, v: string) => set({ sales_info: { ...d.sales_info, [k]: v } })

  return (
    <div className={`sales-iv-edit${row ? '' : ' new'}`}>
      {!row && <h3>새 섭외</h3>}
      {row && (
        <ol className="sales-iv-flow" aria-label="진행 단계">
          {FLOW.map((s, i) => {
            const at = FLOW.indexOf(d.stage)
            const when = flowDate(s, d)
            return (
              <li key={s} className={at < 0 ? 'off' : i < at ? 'done' : i === at ? 'now' : ''}>
                <b>{s}</b>
                <span>{when || '–'}</span>
              </li>
            )
          })}
          {FLOW.indexOf(d.stage) < 0 && <li className="now side"><b>{d.stage}</b><span>진행 밖</span></li>}
        </ol>
      )}

      <section className="sales-iv-sec">
        <h4>기본</h4>
        <div className="grid4">
          {text('브랜드 *', 'brand')}
          {text('팝업 · 행사', 'event_name')}
          <Field label="단계">
            <select className="input" value={d.stage} onChange={e => set({ stage: e.target.value as InterviewStage })}>
              {INTERVIEW_STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="담당 (알림 받는 사람)">
            <select className="input" value={d.owner_id ?? ''} onChange={e => set({ owner_id: e.target.value || null })}>
              <option value="">정하지 않음</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {text('장소 · 일정', 'venue', { span2: true, placeholder: '예: 더현대 서울 B2 · 11/5~11/11' })}
          {text('연락처 (메일 · 담당자 · 참조)', 'contact', { span2: true, placeholder: '메일 주소를 적어 두면 오간 메일을 10분마다 자동으로 확인합니다' })}
        </div>
      </section>

      <section className="sales-iv-sec">
        <h4>발송 · 답변</h4>
        <div className="grid4">
          {text('발송 묶음', 'batch')}
          {text('발송 채널', 'send_channel', { placeholder: '이메일 · DM' })}
          {text('발송일', 'sent_on', { type: 'date' })}
          {text('답변 채널', 'reply_channel')}
          <Field label="답변 일시"><input className="input" type="datetime-local" value={toLocalInput(d.replied_at)} onChange={e => set({ replied_at: fromLocalInput(e.target.value) })} /></Field>
          {text('이미지 사용', 'image_use', { placeholder: '가능 · 미확인 · 조건' })}
          {text('서면 인터뷰', 'interview_ok', { placeholder: '가능 · 작성 완료 · 불가' })}
        </div>
      </section>

      <section className="sales-iv-sec">
        <h4>인터뷰지 · 자료 · 업로드</h4>
        <div className="grid4">
          <Field label="인터뷰지 발송"><input className="input" type="datetime-local" value={toLocalInput(d.form_sent_at)} onChange={e => set({ form_sent_at: fromLocalInput(e.target.value) })} /></Field>
          {text('인터뷰지 메모', 'form_note')}
          {text('인터뷰지 링크', 'form_url', { type: 'url', span2: true, placeholder: 'https://docs.google.com/forms/…' })}
          {text('자료 수령 예정일', 'material_due', { type: 'date' })}
          {text('자료 수령 메모', 'material_note', { placeholder: '예외 · 잠정 · 수령 완료' })}
          {text('인스타 업로드 예정일', 'upload_on', { type: 'date' })}
          {text('업로드 메모', 'upload_note', { placeholder: '오후 · 예외 · 잠정' })}
          {text('게시 링크', 'post_url', { type: 'url', full: true, placeholder: '업로드한 게시물 주소' })}
          {text('비고', 'note', { full: true, area: 2 })}
        </div>
      </section>

      {row && (
        <details className="sales-iv-sub" open={row.stage === '답변' || row.stage === '인터뷰지 발송'}>
          <summary>인터뷰지 (인트라넷) <span>구글 폼 대신 링크로 답 받기</span></summary>
          <InterviewFormPanel row={row} onLinked={linkForm} />
        </details>
      )}

      <details className="sales-iv-sub">
        <summary>인터뷰 답 <span>{answerCount}/10</span></summary>
        <p className="sales-iv-note">구글 폼 응답 시트에서 한 줄을 복사해 붙여 넣으면 Q1~Q10이 채워집니다(타임스탬프 · 브랜드 칸이 있어도 됩니다).</p>
        <div className="sales-iv-paste">
          <textarea className="textarea" rows={2} value={paste} onChange={e => setPaste(e.target.value)} placeholder="응답 한 줄 붙여 넣기" aria-label="인터뷰 답 붙여 넣기" />
          <Button size="sm" kind="outline" disabled={!paste.trim()} onClick={applyPaste}>붙여 넣은 답 채우기</Button>
        </div>
        <div className="grid2">
          {INTERVIEW_QUESTIONS.map(q => (
            <Field key={q.no} label={`${q.no} · ${q.label}${q.use === '영업' ? ' (영업용)' : ''}`} className="full">
              <textarea className="textarea" rows={3} value={d.answers[q.no] ?? ''} onChange={e => set({ answers: { ...d.answers, [q.no]: e.target.value } })} />
            </Field>
          ))}
          <Field label="답 받은 일시"><input className="input" type="datetime-local" value={toLocalInput(d.answered_at)} onChange={e => set({ answered_at: fromLocalInput(e.target.value) })} /></Field>
          {text('답 받은 메모', 'answered_note')}
        </div>
      </details>

      <details className="sales-iv-sub">
        <summary>영업 정보 <span>{infoCount}/5</span></summary>
        <p className="sales-iv-note">예산(Q3) · 파트너 선정 기준(Q10)처럼 영업에 쓸 내용을 정리합니다.</p>
        <div className="grid2">
          {SALES_INFO_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} className={k === 'partner' || k === 'next_plan' ? 'full' : ''}>
              {k === 'partner' || k === 'next_plan'
                ? <textarea className="textarea" rows={2} value={d.sales_info[k] ?? ''} onChange={e => setInfo(k, e.target.value)} />
                : <input className="input" value={d.sales_info[k] ?? ''} onChange={e => setInfo(k, e.target.value)} />}
            </Field>
          ))}
        </div>
      </details>

      {row && (row.mail_threads.length > 0 || files.data.length > 0) && (
        <div className="sales-iv-mail">
          <b>메일 · 받은 자료 (자동)</b>
          <p className="sales-iv-note">
            {row.mail_last_in_at ? `브랜드 메일 ${dateTimeLabel(row.mail_last_in_at)}` : '브랜드 메일 없음'}
            {row.mail_last_out_at ? ` · 우리 메일 ${dateTimeLabel(row.mail_last_out_at)}` : ''}
            {row.mail_attach_at ? ` · 첨부 ${dateTimeLabel(row.mail_attach_at)}` : ''}
          </p>
          <div className="links">
            {row.mail_threads.slice(0, 6).map((t, i) => <a key={t} className="btn btn-outline btn-sm" href={inquiryMailUrl(t)} target="_blank" rel="noopener noreferrer">메일 대화 {i + 1}</a>)}
            {files.data.map(f => f.drive_url && <a key={f.id} className="file" href={f.drive_url} target="_blank" rel="noopener noreferrer">{f.name}</a>)}
          </div>
        </div>
      )}

      <div className="sales-iv-actions">
        <Button size="sm" disabled={busy || (!dirty && !!row)} onClick={() => void save()}>{row ? '저장' : '추가'}</Button>
        <Button size="sm" kind="ghost" disabled={busy} onClick={close}>닫기</Button>
        {d.form_url && <a className="btn btn-outline btn-sm" href={d.form_url} target="_blank" rel="noopener noreferrer">인터뷰지 열기</a>}
        {d.post_url && <a className="btn btn-outline btn-sm" href={d.post_url} target="_blank" rel="noopener noreferrer">게시물 열기</a>}
        {row?.updated_at && <small>마지막 저장 {dateTimeLabel(row.updated_at)}</small>}
      </div>
    </div>
  )
}
