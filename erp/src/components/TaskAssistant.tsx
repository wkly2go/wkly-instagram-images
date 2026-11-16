import { useMemo, useRef, useEffect, useState } from 'react'
import { Bot, CornerDownLeft, NotebookPen } from 'lucide-react'
import { useRoomMessages } from '../lib/chat'
import { Linkify } from './ui'

/**
 * 업무 창 안의 비서 대화 칸 (대표 지시 2026-11-16 '여기에 비서 넣어' — 업무 고치기 창 아래 빈 칸)
 * 이 업무의 내용(제목 · 프로젝트 · 기간 · 상태 · 메모 · 할 일 번호)을 함께 붙여 내 비서 1:1 방으로 보낸다.
 * 답은 같은 방에서 오고(agent-chat), 이 칸에는 창을 연 뒤의 대화만 보인다. 대화는 비서 대화방에도 그대로 남는다.
 */
const QUICK: string[] = ['할 일을 단계로 나눠 줘', '필요한 서류 · 준비물 정리해 줘', '마감까지 일정 짜 줘', '이 업무 맡아서 처리해 줘']
const ASK_MARK = '\n\n질문: '

export function TaskAssistant({ roomId, agentId, name, context, onMemo }: { roomId: string; agentId: string; name: string; context: string; onMemo: (text: string) => void }) {
  const { messages, drafts, send } = useRoomMessages(roomId)
  const [since] = useState(() => Date.now() - 2000)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => messages.filter(m => Date.parse(m.created_at) >= since && !m.parent_id), [messages, since])
  const draft = drafts[agentId]
  const waiting = sending || (shown.length > 0 && shown[shown.length - 1].user_id !== agentId) || !!draft

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [shown.length, draft?.text])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || sending) return
    setSending(true)
    const ok = await send(`${context}${ASK_MARK}${question}`)
    setSending(false)
    if (ok) setText('')
  }

  return (
    <section className="task-ai" aria-label={`${name}에게 묻기`}>
      <div className="task-ai-h">
        <Bot size={14} aria-hidden="true" />
        <b>{name}에게 묻기</b>
        <span className="t-cap">이 업무 내용을 함께 보냅니다 · 대화는 비서 대화방에도 남아요</span>
      </div>
      <div className="task-ai-quick">
        {QUICK.map(q => (
          <button key={q} type="button" className="chip" disabled={sending} onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>
      {(shown.length > 0 || draft) && (
        <div className="task-ai-list" ref={listRef} aria-live="polite">
          {shown.map(m => {
            const mine = m.user_id !== agentId
            const body = mine && m.content.includes(ASK_MARK) ? m.content.slice(m.content.indexOf(ASK_MARK) + ASK_MARK.length) : m.content
            return (
              <div key={m.id} className={`task-ai-msg${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}`}>
                <div className="task-ai-bubble">
                  <Linkify text={body} />
                </div>
                {!mine && (
                  <button type="button" className="task-ai-use" onClick={() => onMemo(body)} title="이 답을 아래 메모에 덧붙이기 (저장을 눌러야 반영)">
                    <NotebookPen size={12} aria-hidden="true" /> 메모에 넣기
                  </button>
                )}
              </div>
            )
          })}
          {draft && !draft.done && (
            <div className="task-ai-msg">
              <div className="task-ai-bubble typing">{draft.text || draft.status || '생각하는 중…'}</div>
            </div>
          )}
          {waiting && !draft && <div className="task-ai-wait t-cap">{name}이(가) 확인하고 있어요…</div>}
        </div>
      )}
      <form
        className="task-ai-input"
        onSubmit={e => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder={`${name}에게 이 업무에 대해 물어보세요 (예: 법무사에 보낼 서류 목록 정리해 줘)`} maxLength={1000} />
        <button type="submit" className="btn btn-blue" disabled={!text.trim() || sending} aria-label="보내기">
          <CornerDownLeft size={13} aria-hidden="true" /> 묻기
        </button>
      </form>
    </section>
  )
}
