// 질문 은행 (영업·수주 › 서면 인터뷰 › '질문 은행' · 2026-11-19) — 인터뷰지의 자리(Q1~Q10)마다 기본 문안과 다른 문안
//  {브랜드} · {팝업} · {기간} · {장소} 는 인터뷰지를 만들 때 채워진다. 여기서 고쳐도 이미 만든 인터뷰지는 바뀌지 않는다.
import { useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import type { BankQuestion, BankQuestionDraft } from '../lib/interviewForms'
import { Button, Field } from './ui'

const SLOTS = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`)
const strip = ({ id: _id, ...rest }: BankQuestion & { created_at?: string; created_by?: string | null; updated_at?: string }): BankQuestionDraft => {
  const { created_at: _c, created_by: _b, updated_at: _u, ...draft } = rest
  return draft
}

export function InterviewQuestionBank() {
  const { api, toast } = useApp()
  const state = useAsync(() => api.listInterviewQuestions(), [api], [] as BankQuestion[])
  const [edit, setEdit] = useState<{ id: string | null; d: BankQuestionDraft } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!edit) return
    const d = { ...edit.d, variant: edit.d.variant.trim(), title: edit.d.title.trim(), body: edit.d.body.trim(), options: edit.d.kind === 'choice' ? [...new Set(edit.d.options.map(x => x.trim()).filter(Boolean))] : [] }
    if (!d.variant || !d.title || d.body.length < 5) { toast('문안 이름 · 제목 · 질문 글을 적어 주세요.'); return }
    if (d.kind === 'choice' && d.options.length < 2) { toast('고르기 문항은 보기가 2개 이상 있어야 합니다.'); return }
    setBusy(true)
    try {
      await api.saveInterviewQuestion(edit.id, d)
      setEdit(null)
      state.reload()
      toast('질문 문안을 저장했습니다. 다음에 만드는 인터뷰지부터 쓰입니다.')
    } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const set = (p: Partial<BankQuestionDraft>) => edit && setEdit({ ...edit, d: { ...edit.d, ...p } })
  if (state.loading) return <p className="sales-iv-note" role="status">질문 은행을 불러오고 있습니다.</p>
  if (state.error) return <p className="sales-iv-note" role="alert">{state.error}</p>
  return (
    <div className="sales-iv-bank">
      <p className="sales-iv-note">인터뷰지를 만들 때 자리마다 '기본' 문안이 들어갑니다. 브랜드 유형(콜라보 · 전시형 · 식음료 등)에 맞는 다른 문안을 더해 두면 인터뷰지에서 골라 쓸 수 있습니다. 글 안의 {'{브랜드} {팝업} {기간} {장소}'} 는 만들 때 채워집니다.</p>
      {SLOTS.map(slot => {
        const list = state.data.filter(q => q.slot === slot)
        const base = list.find(q => q.is_default) ?? list[0]
        return (
          <section key={slot} className="slot">
            <h3>{slot} <small>{base?.section ?? '문안 없음'}</small></h3>
            <ul>
              {list.map(q => (
                <li key={q.id} className={q.active ? '' : 'off'}>
                  <div className="row">
                    <b>{q.title}</b>
                    <span className={`tag${q.is_default ? ' ok' : ''}`}>{q.is_default && q.variant !== '기본' ? `${q.variant} · 기본` : q.variant}</span>
                    {q.kind === 'choice' && <span className="tag">고르기 {q.options.length}</span>}
                    {q.required && <span className="tag hot">필수</span>}
                    {q.use === '영업' && <span className="tag sales">영업용</span>}
                    {!q.active && <span className="tag">안 씀</span>}
                    <Button size="sm" kind="ghost" onClick={() => setEdit({ id: q.id, d: strip(q) })}>고치기</Button>
                  </div>
                  {edit?.id !== q.id && <p>{q.body}</p>}
                  {edit?.id === q.id && form()}
                </li>
              ))}
            </ul>
            {edit && edit.id === null && edit.d.slot === slot ? form() : base && <Button size="sm" kind="ghost" onClick={() => setEdit({ id: null, d: { ...strip(base), variant: '', is_default: false, sort: base.sort } })}>+ {slot} 다른 문안 추가</Button>}
          </section>
        )
      })}
    </div>
  )
  function form() {
    if (!edit) return null
    const d = edit.d
    return (
      <div className="grid2 edit">
        <Field label="문안 이름"><input className="input" value={d.variant} maxLength={30} placeholder="예: 콜라보 팝업" onChange={e => set({ variant: e.target.value })} /></Field>
        <Field label="구역"><input className="input" value={d.section} onChange={e => set({ section: e.target.value })} /></Field>
        <Field label="제목" className="full"><input className="input" value={d.title} onChange={e => set({ title: e.target.value })} /></Field>
        <Field label="질문 글" className="full"><textarea className="textarea" rows={4} value={d.body} maxLength={2000} onChange={e => set({ body: e.target.value })} /></Field>
        <Field label="도움말 · 예시" className="full"><input className="input" value={d.help} onChange={e => set({ help: e.target.value })} /></Field>
        <Field label="답 방식">
          <select className="input" value={d.kind} onChange={e => set({ kind: e.target.value as BankQuestionDraft['kind'] })}><option value="long">서술형</option><option value="choice">하나 고르기</option></select>
        </Field>
        <Field label="쓰임">
          <select className="input" value={d.use} onChange={e => set({ use: e.target.value as BankQuestionDraft['use'] })}><option value="콘텐츠">콘텐츠</option><option value="영업">영업용 (콘텐츠에 안 실음)</option></select>
        </Field>
        {d.kind === 'choice' && <Field label="보기 (한 줄에 하나)" className="full"><textarea className="textarea" rows={Math.max(3, d.options.length)} value={d.options.join('\n')} onChange={e => set({ options: e.target.value.split('\n') })} /></Field>}
        <div className="checks full">
          <label><input type="checkbox" checked={d.required} onChange={e => set({ required: e.target.checked })} /> 필수 문항</label>
          <label><input type="checkbox" checked={d.is_default} onChange={e => set({ is_default: e.target.checked })} /> 이 자리의 기본 문안</label>
          <label><input type="checkbox" checked={d.active} onChange={e => set({ active: e.target.checked })} /> 사용</label>
        </div>
        <div className="sales-iv-actions full">
          <Button size="sm" disabled={busy} onClick={() => void save()}>저장</Button>
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => setEdit(null)}>취소</Button>
        </div>
      </div>
    )
  }
}
