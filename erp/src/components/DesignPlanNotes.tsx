// 평면 위 댓글 (피그마처럼 도면의 한 자리에 핀을 꽂고 이야기한다 · 2026-11-17)
// 핀은 평면 자료(notes)와 함께 저장된다. 여기는 목록과, 판 위에서 바로 쓰는 칸.
import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, RotateCcw, Trash2 } from 'lucide-react'
import type { PlanNote } from '../lib/designPlan'

const when = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 댓글 목록: 열린 것 먼저, 해결한 것은 아래에 흐리게. 번호는 평면의 핀 번호와 같다 */
export function DesignPlanNotes({ notes, active, me, onPick, onToggle, onRemove, onStart }: {
  notes: PlanNote[]; active: string | null; /** 내 이름 (내 댓글 표시) */ me: string
  onPick(id: string): void; onToggle(id: string): void; onRemove(id: string): void; /** 댓글 도구로 바꾼다 */ onStart(): void
}) {
  const sorted = [...notes].sort((a, b) => a.at.localeCompare(b.at)).map((n, i) => ({ n, no: i + 1 }))
  const list = [...sorted.filter(x => !x.n.done), ...sorted.filter(x => x.n.done)]
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => { if (active) ref.current?.querySelector(`[data-note="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])
  return (
    <div className="dpn">
      <div className="dpn-head">
        <span>열린 댓글 {sorted.filter(x => !x.n.done).length}개{sorted.some(x => x.n.done) ? ` · 해결 ${sorted.filter(x => x.n.done).length}개` : ''}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onStart}><MessageSquarePlus size={13} /> 댓글 남기기</button>
      </div>
      {list.length === 0 ? (
        <p className="dpn-empty">아직 댓글이 없습니다. <b>댓글 남기기</b>를 누른 뒤 평면의 한 자리를 누르면, 그 자리에 번호 핀이 꽂히고 글을 남길 수 있습니다. 같이 보는 사람에게도 보입니다.</p>
      ) : (
        <ol className="dpn-list" ref={ref}>
          {list.map(({ n, no }) => (
            <li key={n.id} data-note={n.id} className={`${n.done ? 'done' : ''}${active === n.id ? ' on' : ''}`}>
              <button type="button" className="dpn-no" onClick={() => onPick(n.id)} title="평면에서 이 댓글의 자리를 봅니다" aria-label={`${no}번 댓글 자리 보기`}>{no}</button>
              <div className="dpn-body">
                <p className="dpn-meta"><b>{n.by}</b>{n.by === me ? ' (나)' : ''} · {when(n.at)}{n.done ? ' · 해결함' : ''}</p>
                <p className="dpn-text">{n.text}</p>
                <div className="dpn-acts">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onToggle(n.id)}>{n.done ? <><RotateCcw size={12} /> 다시 열기</> : <><Check size={12} /> 해결</>}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(n.id)}><Trash2 size={12} /> 지우기</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** 판 위에서 바로 쓰는 칸: 핀을 꽂은 자리 옆에 뜬다. Enter 로 남기고, Shift+Enter 는 줄바꿈, Esc 는 그만두기 */
export function DesignPlanNoteComposer({ x, y, maxX, maxY, onSubmit, onCancel }: { x: number; y: number; maxX: number; maxY: number; onSubmit(text: string): void; onCancel(): void }) {
  const [text, setText] = useState('')
  const W = 250, H = 132
  const left = Math.max(6, Math.min(x + 14, maxX - W - 6)), top = Math.max(6, Math.min(y - 20, maxY - H - 6))
  return (
    <div className="dpn-compose" style={{ left, top, width: W }} role="group" aria-label="댓글 쓰기" onPointerDown={e => e.stopPropagation()}>
      <textarea className="input" rows={3} autoFocus value={text} placeholder="이 자리에 남길 말을 적어 주세요" aria-label="댓글 내용"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim()) onSubmit(text.trim()) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
        }} />
      <div className="dpn-compose-acts">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>그만두기</button>
        <button type="button" className="btn btn-blue btn-sm" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>남기기</button>
      </div>
    </div>
  )
}
