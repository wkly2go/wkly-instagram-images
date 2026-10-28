import { CardView } from './ChatCards'
import { Linkify } from './ui'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Bookmark, Check, Download, FileText, Loader2, MessageSquare, Paperclip, Pencil, Send, SmilePlus, Trash2, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { addDays, dateLabel, timeLabel, toDateKey, todayKey } from '../lib/date'
import type { ChatAttachment, ChatMessage, ChatRead } from '../lib/types'
import { CHAT_FILE_MAX, friendlyError, type AgentDraft } from '../lib/api'
import { Empty } from './ui'
import { ImageViewer } from './ImageViewer'
import { canView, FileViewer } from './FileViewer'
import { openLink } from './WebSearch'

/** 나중에 보기: 그냥 저장 · 1시간 뒤 · 내일 9시 · 다음 주 월 9시 (2026-10-23) */
function LaterMenu({ m, onDone }: { m: ChatMessage; onDone: () => void }) {
  const { api, toast, bump, profileName } = useApp()
  const at9 = (day: string) => new Date(`${day}T09:00:00+09:00`).toISOString()
  const dow = new Date(`${todayKey()}T00:00:00`).getDay()
  const options: [string, string | null][] = [
    ['그냥 저장', null],
    ['1시간 뒤', new Date(Date.now() + 60 * 60 * 1000).toISOString()],
    ['내일 9시', at9(addDays(todayKey(), 1))],
    ['다음 주 월 9시', at9(addDays(todayKey(), dow === 0 ? 1 : 8 - dow))],
  ]
  const save = async (remind: string | null, label: string) => {
    onDone()
    const who = m.user_id ? `${profileName(m.user_id)}: ` : ''
    try {
      await api.saveForLater({ message_id: m.id, room_id: m.room_id, preview: `${who}${m.attachment?.card?.title ?? m.content}`.slice(0, 300), remind_at: remind })
      bump()
      toast(remind ? `나중에 보기에 저장 · ${label} 다시 알려 드려요.` : '나중에 보기에 저장했습니다.')
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  return (
    <div className="react-pick later-pick" role="menu" aria-label="나중에 보기">
      {options.map(([label, at]) => (
        <button key={label} type="button" role="menuitem" onClick={() => void save(at, label)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export const REACTION_EMOJIS = ['👍', '✅', '👀', '🙏', '😂', '🎉']

type ListProps = {
  messages: ChatMessage[]
  reads?: ChatRead[]
  members?: string[] | null
  onRemove: (id: number) => void
  onEdit?: (id: number, content: string) => Promise<boolean>
  /** 스레드 답글 보내기 (없으면 답글 기능 숨김) */
  onReply?: (parentId: number, content: string) => Promise<boolean>
  onReact?: (id: number, emoji: string) => void
  /** 처음부터 펼쳐 둘 스레드 (알림에서 들어온 경우) */
  thread?: number | null
}

/** 말풍선 목록 (날짜 구분 · 3분 안 연속 메시지 묶음 · 읽음 표시 · 스레드 답글 · 이모지 반응 · 내 메시지/관리자 삭제) */
export function MessageList({ messages, reads = [], members, onRemove, onEdit, onReply, onReact, thread = null }: ListProps) {
  const { me, profiles, profileName } = useApp()
  const [openId, setOpenId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [pickId, setPickId] = useState<number | null>(null)
  const [laterId, setLaterId] = useState<number | null>(null)
  const [threads, setThreads] = useState<Set<number>>(() => new Set(thread ? [thread] : []))
  const [replyText, setReplyText] = useState<Record<number, string>>({})
  const [replying, setReplying] = useState<number | null>(null)
  // 알림에서 스레드로 들어오면 펼치고 그 메시지로 스크롤
  const scrolled = useRef<number | null>(null)
  useEffect(() => {
    if (!thread) return
    setThreads(prev => (prev.has(thread) ? prev : new Set(prev).add(thread)))
    if (scrolled.current === thread || !messages.some(m => m.id === thread)) return
    scrolled.current = thread
    window.setTimeout(() => document.getElementById(`msg-${thread}`)?.scrollIntoView({ block: 'center' }), 80)
  }, [thread, messages])
  const saveEdit = async (m: ChatMessage) => {
    const v = draft.trim()
    if (!v || v === m.content) return setEditId(null)
    if (onEdit && (await onEdit(m.id, v))) setEditId(null)
  }
  const toggleThread = (id: number) =>
    setThreads(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const sendReply = async (id: number) => {
    const v = (replyText[id] ?? '').trim()
    if (!v || !onReply || replying) return
    setReplying(id)
    if (await onReply(id, v)) setReplyText(prev => ({ ...prev, [id]: '' }))
    setReplying(null)
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
  // 스레드: 원래 메시지가 목록에 없으면(오래돼서 안 불러옴) 답글을 그냥 본문에 보여 줌
  const ids = new Set(messages.map(m => m.id))
  const replies = new Map<number, ChatMessage[]>()
  for (const m of messages) if (m.parent_id && ids.has(m.parent_id)) replies.set(m.parent_id, [...(replies.get(m.parent_id) ?? []), m])
  const top = messages.filter(m => !m.parent_id || !ids.has(m.parent_id))

  const row = (m: ChatMessage, prev: ChatMessage | undefined, inThread: boolean) => {
    const day = toDateKey(m.created_at)
    const newDay = !inThread && (!prev || toDateKey(prev.created_at) !== day)
    const mine = m.user_id === me.id
    const cont = !newDay && prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60 * 1000
    const { read, unread } = whoRead(m)
    const open = openId === m.id
    const names = (list: typeof read) => list.map(p => p.name).join(', ') || '없음'
    const reacts = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length)
    const sub = replies.get(m.id) ?? []
    const threadOpen = !inThread && threads.has(m.id)
    return (
      <div key={m.id} style={{ display: 'contents' }}>
        {newDay && <div className="chat-day">{dateLabel(day)}</div>}
        <div id={`msg-${m.id}`} className={`msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}${m.pending ? ' pending' : ''}`}>
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
                <div className={`bubble ${mine ? 'mine' : 'other'} ${m.attachment?.card ? 'has-card' : m.attachment ? 'has-file' : ''}`}>
                  {m.attachment?.card ? <span className="card-note"><Linkify text={m.content} /></span> : null}
                  {m.attachment?.card ? <CardView card={m.attachment.card} /> : m.attachment && <AttachmentView att={m.attachment} />}
                  {!m.attachment?.card && (!m.attachment || m.content !== `📎 ${m.attachment.name}`) && <span><Linkify text={m.content} /></span>}
                </div>
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
              {editId !== m.id && (
                <span className="msg-actions">
                  <button type="button" className="icon-btn sm del" onClick={() => setLaterId(laterId === m.id ? null : m.id)} aria-label="나중에 보기" title="나중에 보기 (다시 알림)">
                    <Bookmark size={13} />
                  </button>
                  {onReact && (
                    <button type="button" className="icon-btn sm del" onClick={() => setPickId(pickId === m.id ? null : m.id)} aria-label="반응 남기기" title="반응 남기기">
                      <SmilePlus size={13} />
                    </button>
                  )}
                  {onReply && !inThread && (
                    <button type="button" className="icon-btn sm del" onClick={() => toggleThread(m.id)} aria-label="답글 달기" title="스레드로 답글 달기">
                      <MessageSquare size={13} />
                    </button>
                  )}
                  {mine && onEdit && (
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
                  {(mine || me.role === 'admin') && (
                    <button type="button" className="icon-btn sm del" onClick={() => onRemove(m.id)} aria-label="메시지 삭제" title="삭제">
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
            {laterId === m.id && <LaterMenu m={m} onDone={() => setLaterId(null)} />}
            {pickId === m.id && onReact && (
              <div className="react-pick" role="menu">
                {REACTION_EMOJIS.map(e => (
                  <button
                    key={e}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPickId(null)
                      onReact(m.id, e)
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {reacts.length > 0 && (
              <div className="reacts">
                {reacts.map(([e, who]) => (
                  <button key={e} type="button" className={`react-chip ${who.includes(me.id) ? 'on' : ''}`} onClick={() => onReact?.(m.id, e)} disabled={!onReact} title={who.map(profileName).join(', ')}>
                    {e} <b>{who.length}</b>
                  </button>
                ))}
              </div>
            )}
            {!inThread && onReply && sub.length > 0 && !threadOpen && (
              <button type="button" className="thread-link" onClick={() => toggleThread(m.id)}>
                <MessageSquare size={12} /> 답글 {sub.length}개 · 마지막 {timeLabel(sub[sub.length - 1].created_at)}
              </button>
            )}
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
        {threadOpen && onReply && (
          <div className="thread">
            <div className="thread-head">
              <span className="t-cap">스레드 · 답글 {sub.length}</span>
              <button type="button" className="icon-btn sm" onClick={() => toggleThread(m.id)} aria-label="스레드 접기" title="접기">
                <X size={13} />
              </button>
            </div>
            {sub.map((r, j) => row(r, sub[j - 1], true))}
            <div className="thread-composer">
              <textarea
                className="textarea"
                autoFocus={thread !== m.id}
                placeholder="답글 입력 · Enter 전송"
                value={replyText[m.id] ?? ''}
                maxLength={4000}
                onChange={e => setReplyText(prev => ({ ...prev, [m.id]: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void sendReply(m.id)
                  } else if (e.key === 'Escape') toggleThread(m.id)
                }}
                aria-label="답글"
              />
              <button type="button" className="send-btn" onClick={() => void sendReply(m.id)} disabled={!(replyText[m.id] ?? '').trim() || replying === m.id} aria-label="답글 보내기">
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {messages.length === 0 && <Empty>첫 메시지를 남겨 보세요.</Empty>}
      {top.map((m, i) => row(m, top[i - 1], false))}
    </>
  )
}

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/** 말풍선 속 첨부: 사진은 미리보기(누르면 크게), 파일은 이름 · 크기 + 내려받기 */
function AttachmentView({ att }: { att: ChatAttachment }) {
  const { api, toast } = useApp()
  const isImage = att.type.startsWith('image/')
  const [src, setSrc] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isImage) return
    let alive = true
    api
      .fileUrl(att)
      .then(u => alive && setSrc(u))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, att, isImage])
  const open = async (download: boolean) => {
    try {
      const url = await api.fileUrl(att, download)
      if (download) {
        const a = document.createElement('a')
        a.href = url
        a.download = att.name
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else openLink(url)
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  if (isImage)
    return (
      <>
        <button type="button" className="att-img" onClick={() => (src ? setViewing(true) : open(false))} title={`${att.name} · 눌러서 크게 보기 (확대 한도 없음)`}>
          {src ? <img src={src} alt={att.name} loading="lazy" /> : <span className="t-cap">사진 불러오는 중…</span>}
        </button>
        {viewing && src && <ImageViewer src={src} name={att.name} onClose={() => setViewing(false)} onDownload={() => open(true)} />}
      </>
    )
  const viewable = canView(att.name, att.type)
  const view = async () => {
    try {
      setFileUrl(await api.fileUrl(att))
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  return (
    <>
      <span className="att-file">
        <button type="button" className="att-file-main" onClick={() => (viewable ? void view() : void open(true))} title={viewable ? '인트라넷에서 보기' : '내려받기'}>
          <FileText size={18} />
          <span className="col gap-2" style={{ minWidth: 0 }}>
            <span className="t-smallb truncate">{att.name}</span>
            <span className="t-cap">
              {sizeLabel(att.size)}
              {viewable ? ' · 눌러서 보기' : ''}
            </span>
          </span>
        </button>
        <button type="button" className="icon-btn sm" onClick={() => void open(true)} aria-label="내려받기" title="내려받기">
          <Download size={15} />
        </button>
      </span>
      {fileUrl && <FileViewer name={att.name} mime={att.type} url={fileUrl} onClose={() => setFileUrl(null)} onDownload={() => void open(true)} />}
    </>
  )
}

/** 📎 사진 · 파일 첨부 버튼 (여러 개 고르면 차례로 보냄) */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => Promise<void>; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (input.current) input.current.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      await onFiles(files)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="attach-btn" onClick={() => input.current?.click()} disabled={disabled || busy} aria-label="사진 · 파일 첨부" title={`사진 · 파일 첨부 (한 파일 ${CHAT_FILE_MAX / 1024 / 1024}MB 까지, 끌어다 놓거나 붙여넣기도 됩니다)`}>
        {busy ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}
      </button>
      <input ref={input} type="file" multiple hidden onChange={e => pick(e.target.files)} />
    </>
  )
}

/** 파일 끌어다 놓기: 감싼 영역 어디에 놓아도 첨부. dragging 이면 '여기에 놓으세요' 표시 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  return {
    dragging,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setDragging(true)
      },
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setDragging(false)
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setDragging(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(files)
      },
    },
  }
}

export function DropHint() {
  return (
    <div className="drop-hint" aria-hidden="true">
      <Paperclip size={22} /> 여기에 놓으면 첨부됩니다
    </div>
  )
}

/** AI 팀원이 답을 쓰는 중 표시: AI 가 있는 방에서 사람이 AI 에게 말을 건 뒤 아직 답이 없을 때 (최대 3분) */
export function AgentTyping({ messages, members, drafts }: { messages: ChatMessage[]; members?: string[] | null; drafts?: Record<string, AgentDraft & { at: number }> }) {
  const { profiles, profileName } = useApp()
  const [, tick] = useState(0)
  const agents = profiles.filter(p => p.is_agent && p.active)
  const last = messages.filter(m => !m.parent_id).at(-1)
  const lastIsHuman = !!last && !agents.some(a => a.id === last.user_id)
  const compact = last?.content.replace(/\s+/g, '') ?? ''
  const agent = last && lastIsHuman ? agents.find(a => (members ?? []).includes(a.id) || compact.includes(`@${a.name.replace(/\s+/g, '')}`)) : undefined
  const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity
  const waiting = !!agent && age < 3 * 60_000
  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => tick(t => t + 1), 5_000)
    return () => window.clearInterval(id)
  }, [waiting])
  // 실시간: 서버가 쓰는 대로 보내 주는 답 (2분 넘게 소식이 없으면 숨김)
  const live = Object.values(drafts ?? {}).filter(d => Date.now() - d.at < 120_000)
  useEffect(() => {
    if (!live.length) return
    const id = window.setInterval(() => tick(t => t + 1), 15_000)
    return () => window.clearInterval(id)
  }, [live.length])
  if (live.length)
    return (
      <>
        {live.map(d => (
          <div key={d.agent_id} className="msg agent-live" role="status" aria-live="polite">
            <div className="stack" style={{ alignItems: 'flex-start' }}>
              <span className="t-cap">{profileName(d.agent_id)}</span>
              <div className="line">
                <div className="bubble other">
                  {d.text ? <span className="pre">{d.text}</span> : null}
                  <span className="live-caret" aria-hidden="true" />
                </div>
              </div>
              {d.status && (
                <span className="agent-typing">
                  <span className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {d.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </>
    )
  if (!waiting || !agent) return null
  return (
    <div className="agent-typing" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {agent.name}이(가) 확인하고 처리하는 중…
    </div>
  )
}
