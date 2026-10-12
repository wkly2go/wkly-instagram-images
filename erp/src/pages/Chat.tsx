import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { dateLabel, relativeLabel, timeLabel, toDateKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import type { ChatMessage, ChatRoomSummary, Project } from '../lib/types'
import { Shell } from '../components/Shell'
import { Avatar, Badge, Button, Empty, Field, Modal } from '../components/ui'

export default function Chat() {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const [creating, setCreating] = useState(false)
  const { data: rooms, loading } = useAsync(() => api.listRooms(), [version], [] as ChatRoomSummary[])
  const roomId = query.get('room')
  const room = rooms.find(r => r.id === roomId) ?? null

  // 방을 고르지 않았으면 PC 에서는 첫 방을 자동으로 연다
  useEffect(() => {
    if (!roomId && rooms.length && window.matchMedia('(min-width: 641px)').matches) navigate(withQuery(path, query, { room: rooms[0].id }), { replace: true })
  }, [roomId, rooms, path, query, navigate])

  return (
    <Shell active="chat" flush>
      <div className={`split ${room ? 'has-detail' : ''}`}>
        <div className="pane-list" style={{ width: 200 }}>
          <div className="pane-head">
            <div className="row">
              <span className="t-bodyb grow">채팅방</span>
              <button type="button" className="icon-btn" onClick={() => setCreating(true)} aria-label="채팅방 만들기" title="채팅방 만들기">
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="pane-body">
            {rooms.map(r => (
              <Link key={r.id} to={withQuery(path, query, { room: r.id })} className={`item ${r.id === roomId ? 'active' : ''}`}>
                <div className="row">
                  <span className="t-smallb truncate grow"># {r.name}</span>
                  {r.last_at && <span className="t-meta">{relativeLabel(r.last_at)}</span>}
                </div>
                <div className="row">
                  <span className="t-cap truncate grow">{r.last_content ?? r.description ?? '대화를 시작해 보세요'}</span>
                  {r.unread > 0 && r.id !== roomId && <Badge tone="blue">{r.unread}</Badge>}
                </div>
              </Link>
            ))}
            {!loading && rooms.length === 0 && <Empty>채팅방이 없습니다.</Empty>}
          </div>
        </div>
        <div className="pane-detail">{room ? <Room key={room.id} room={room} /> : <Empty>채팅방을 고르세요.</Empty>}</div>
      </div>
      {creating && <NewRoom onClose={() => setCreating(false)} onCreated={id => navigate(withQuery(path, query, { room: id }))} />}
    </Shell>
  )
}

function Room({ room }: { room: ChatRoomSummary }) {
  const { api, me, profileName, bump, toast, version } = useApp()
  const { navigate } = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const { data: projects } = useAsync(() => api.listProjects(), [version], [] as Project[])
  const project = projects.find(p => p.id === room.project_id)

  useEffect(() => {
    let alive = true
    api.listMessages(room.id).then(m => alive && setMessages(m)).catch(e => toast(friendlyError(e)))
    api.markRead(room.id).then(bump).catch(() => undefined)
    const off = api.subscribeMessages(room.id, ({ type, message }) => {
      setMessages(prev => {
        if (type === 'DELETE') return prev.filter(m => m.id !== message.id)
        if (type === 'UPDATE') return prev.map(m => (m.id === message.id ? message : m))
        return prev.some(m => m.id === message.id) ? prev : [...prev, message]
      })
      if (type === 'INSERT' && message.user_id !== me.id) api.markRead(room.id).catch(() => undefined)
    })
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const m = await api.sendMessage(room.id, content)
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      setText('')
      stick.current = true
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setSending(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const remove = async (id: number) => {
    if (!window.confirm('이 메시지를 삭제할까요?')) return
    try {
      await api.deleteMessage(id)
      setMessages(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <>
      <div className="chat-head">
        <button type="button" className="icon-btn back-btn" onClick={() => navigate('/chat')} aria-label="채팅방 목록">
          <ArrowLeft size={18} />
        </button>
        <span className="t-bodyb truncate"># {room.name}</span>
        {project && (
          <Link to={`/projects?id=${project.id}`}>
            <Badge>📁 {project.name}</Badge>
          </Link>
        )}
        <span className="grow" />
        {room.description && <span className="t-cap truncate">{room.description}</span>}
      </div>
      <div
        className="chat-body"
        ref={bodyRef}
        onScroll={e => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
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
                      <button type="button" className="icon-btn sm del" onClick={() => remove(m.id)} aria-label="메시지 삭제" title="삭제">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="composer">
        <textarea className="textarea" placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)" value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} maxLength={4000} aria-label="메시지" />
        <button type="button" className="send-btn" onClick={send} disabled={!text.trim() || sending} aria-label="보내기">
          <Send size={16} />
        </button>
      </div>
    </>
  )
}

function NewRoom({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const { data: projects } = useAsync(() => api.listProjects(), [version], [] as Project[])
  const submit = async () => {
    let id = ''
    const ok = await run(async () => {
      id = (await api.createRoom({ name: name.trim(), description: description.trim() || null, project_id: projectId || null })).id
    }, '채팅방을 만들었습니다.')
    if (ok) {
      onClose()
      onCreated(id)
    }
  }
  return (
    <Modal
      title="채팅방 만들기"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !name.trim()} onClick={submit}>
            만들기
          </Button>
        </>
      }
    >
      <Field label="이름">
        <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="예) 성수 팝업 오브제 위크" maxLength={40} />
      </Field>
      <Field label="설명 (선택)">
        <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
      </Field>
      <Field label="연결할 프로젝트 (선택)">
        <select className="select" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">없음</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <span className="t-cap">모든 팀원이 볼 수 있는 방입니다.</span>
    </Modal>
  )
}
