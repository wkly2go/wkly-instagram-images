import { Trash2 } from 'lucide-react'
import { useApp } from '../lib/app'
import { dateLabel, timeLabel, toDateKey } from '../lib/date'
import type { ChatMessage } from '../lib/types'
import { Avatar, Empty } from './ui'

/** 말풍선 목록 (날짜 구분 · 3분 안 연속 메시지 묶음 · 내 메시지/관리자 삭제) */
export function MessageList({ messages, onRemove }: { messages: ChatMessage[]; onRemove: (id: number) => void }) {
  const { me, profileName } = useApp()
  return (
    <>
      {messages.length === 0 && <Empty>첫 메시지를 남겨 보세요.</Empty>}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const day = toDateKey(m.created_at)
        const newDay = !prev || toDateKey(prev.created_at) !== day
        const mine = m.user_id === me.id
        const cont = !newDay && prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60 * 1000
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
                  <div className={`bubble ${mine ? 'mine' : 'other'}`}>{m.content}</div>
                  <span className="time">{timeLabel(m.created_at)}</span>
                  {(mine || me.role === 'admin') && (
                    <button type="button" className="icon-btn sm del" onClick={() => onRemove(m.id)} aria-label="메시지 삭제" title="삭제">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
