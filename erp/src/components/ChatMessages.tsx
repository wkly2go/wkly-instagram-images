import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Check, Download, FileText, Loader2, Paperclip, Pencil, Trash2, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { dateLabel, timeLabel, toDateKey } from '../lib/date'
import type { ChatAttachment, ChatMessage, ChatRead } from '../lib/types'
import { CHAT_FILE_MAX, friendlyError } from '../lib/api'
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
                    <div className={`bubble ${mine ? 'mine' : 'other'} ${m.attachment ? 'has-file' : ''}`}>
                      {m.attachment && <AttachmentView att={m.attachment} />}
                      {(!m.attachment || m.content !== `📎 ${m.attachment.name}`) && <span>{m.content}</span>}
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

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/** 말풍선 속 첨부: 사진은 미리보기(누르면 크게), 파일은 이름 · 크기 + 내려받기 */
function AttachmentView({ att }: { att: ChatAttachment }) {
  const { api, toast } = useApp()
  const isImage = att.type.startsWith('image/')
  const [src, setSrc] = useState<string | null>(null)
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
      } else window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  if (isImage)
    return (
      <button type="button" className="att-img" onClick={() => open(false)} title={`${att.name} · 눌러서 크게 보기`}>
        {src ? <img src={src} alt={att.name} loading="lazy" /> : <span className="t-cap">사진 불러오는 중…</span>}
      </button>
    )
  return (
    <button type="button" className="att-file" onClick={() => open(true)} title="내려받기">
      <FileText size={18} />
      <span className="col gap-2" style={{ minWidth: 0 }}>
        <span className="t-smallb truncate">{att.name}</span>
        <span className="t-cap">{sizeLabel(att.size)}</span>
      </span>
      <Download size={15} />
    </button>
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
export function AgentTyping({ messages, members }: { messages: ChatMessage[]; members?: string[] | null }) {
  const { profiles } = useApp()
  const [, tick] = useState(0)
  const agents = profiles.filter(p => p.is_agent && p.active)
  const last = messages[messages.length - 1]
  const lastIsHuman = !!last && !agents.some(a => a.id === last.user_id)
  const agent = last && lastIsHuman ? agents.find(a => (members ?? []).includes(a.id) || last.content.includes(`@${a.name}`)) : undefined
  const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity
  const waiting = !!agent && age < 3 * 60_000
  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => tick(t => t + 1), 5_000)
    return () => window.clearInterval(id)
  }, [waiting])
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
