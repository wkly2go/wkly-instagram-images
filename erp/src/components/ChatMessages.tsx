import { useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { dateLabel, timeLabel, toDateKey } from '../lib/date'
import type { ChatMessage, ChatRead } from '../lib/types'
import { Avatar, Empty } from './ui'

/** 말풍선 목록 (날짜 구분 · 3분 안 연속 메시지 묶음 · 읽음 표시 · 내 메시지/관리자 삭제) */
export function MessageList({ messages, reads = [], members, onRemove, onEdit }: { messages: ChatMessage[]; reads?: ChatRead[]; members?: string[] | null; onRemove: (id: number) => void; onEdit?: (id: number, content: string) => Promise<boolean> }) {
  const { me, profiles, profileName } = useApp()
  const [openId, setOpenId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const saveEdit = async (m: ChatMessage) => {
    const v = draft.trim()
    if (!v || v === m.content) return setEditId(null)
    if (onEdit && (await onEdit(m.id, v))) setEditId(null)
  }
  // 읽을 사람: 활성 팀원 (AI 팀원 제외). 1:1 대화는 그 방 사람만
  const people = profiles.filter(p => p.active && !p.is_agent && (!members || members.includes(p.id)))
  const readAt = new Map(reads.map(r => [r.user_id, new Date(r.last_read_at).getTime()]))
  const whoRead = (m: ChatMessage) => {
    const at = new Date(m.created_at).getTime()
    const others = people.filter(p => p.id !== m.user_id)
    const read = others.filter(p => (readAt.get(p.id) ?? 0) >= at)
    return { read, unread: others.filter(p => !read.includes(p)) }
  }
  return (
    <>
      {messages.length === 0 && <Empty>첫 메시지를 남겨 보세요.</Empty>}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const day = toDateKey(m.created_at)
        const newDay = !prev || toDateKey(prev.created_at) !== day
        const mine = m.user_id === me.id
        const cont = !newDay && prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60 * 1000
        const { read, unread } = whoRead(m)
        const open = openId === m.id
        const names = (list: typeof read) => list.map(p => p.name).join(', ') || '없음'
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {newDay && <div className="chat-day">{dateLabel(day)}</div>}
            <div className={`msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}`}>
              {!mine && (
                <span className="avatar-slot">
                  <Avatar name={profileName(m.user_id)} size="sm" />
                </span>
              )}
              <div className="stack" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                {!mine && !cont && <span className="t-cap">{profileName(m.user_id)}</span>}
                <div className="line">
                  {editId === m.id ? (
                    <div className="bubble-edit">
                      <textarea
                        className="textarea"
                        autoFocus
                        value={draft}
                        maxLength={4000}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            saveEdit(m)
                          } else if (e.key === 'Escape') setEditId(null)
                        }}
                        aria-label="메시지 고치기"
                      />
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <button type="button" className="icon-btn sm" onClick={() => setEditId(null)} aria-label="취소" title="취소 (Esc)">
                          <X size={13} />
                        </button>
                        <button type="button" className="icon-btn sm" onClick={() => saveEdit(m)} aria-label="저장" title="저장 (Enter)">
                          <Check size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`bubble ${mine ? 'mine' : 'other'}`}>{m.content}</div>
                  )}
                  <span className="meta">
                    <button
                      type="button"
                      className={`read-mark ${unread.length ? 'unread' : 'all'}`}
                      onClick={() => setOpenId(open ? null : m.id)}
                      aria-expanded={open}
                      title={`읽음: ${names(read)}\n안 읽음: ${names(unread)}`}
                    >
                      {unread.length ? unread.length : '읽음'}
                    </button>
                    <span className="time">
                      {m.edited_at && <span title={`수정 ${timeLabel(m.edited_at)}`}>수정됨 · </span>}
                      {timeLabel(m.created_at)}
                    </span>
                  </span>
                  {mine && onEdit && editId !== m.id && (
                    <button
                      type="button"
                      className="icon-btn sm del"
                      onClick={() => {
                        setEditId(m.id)
                        setDraft(m.content)
                      }}
                      aria-label="메시지 고치기"
                      title="고치기"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {(mine || me.role === 'admin') && editId !== m.id && (
                    <button type="button" className="icon-btn sm del" onClick={() => onRemove(m.id)} aria-label="메시지 삭제" title="삭제">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="read-list">
                    <span>
                      <b>읽음 {read.length}</b> {names(read)}
                    </span>
                    <span>
                      <b>안 읽음 {unread.length}</b> {names(unread)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
