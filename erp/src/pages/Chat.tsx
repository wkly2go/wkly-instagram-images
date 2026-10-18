import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { roomTitle, useRoomMessages } from '../lib/chat'
import { relativeLabel } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import type { ChatRoomSummary, Project } from '../lib/types'
import { Shell } from '../components/Shell'
import { Badge, Button, Empty, Field, Modal } from '../components/ui'
import { AssignTaskButton } from '../components/AssignTask'
import { AgentTyping, AttachButton, DropHint, MessageList, useFileDrop } from '../components/ChatMessages'

export default function Chat() {
  const { api, me, version, profileName, toast, bump } = useApp()
  const { query, path, navigate } = useRouter()
  const [creating, setCreating] = useState(false)
  const [dmPicking, setDmPicking] = useState(false)
  const { data: rooms, loading } = useAsync(() => api.listRooms(), [version], [] as ChatRoomSummary[])
  const roomId = query.get('room')
  const room = rooms.find(r => r.id === roomId) ?? null

  // 팀·근태에서 '1:1 대화'로 들어온 경우: /chat?dm=팀원id → 그 사람과의 방
  const dm = query.get('dm')
  useEffect(() => {
    if (!dm) return
    api
      .openDm(dm)
      .then(id => {
        bump()
        navigate(`/chat?room=${id}`, { replace: true })
      })
      .catch(e => {
        toast(friendlyError(e))
        navigate('/chat', { replace: true })
      })
  }, [dm, api, navigate, toast, bump])

  // 방을 고르지 않았으면 PC 에서는 첫 방을 자동으로 연다
  useEffect(() => {
    if (dm) return
    if (!roomId && rooms.length && window.matchMedia('(min-width: 641px)').matches) navigate(withQuery(path, query, { room: rooms[0].id }), { replace: true })
  }, [dm, roomId, rooms, path, query, navigate])

  return (
    <Shell active="chat" flush>
      <div className={`split ${room ? 'has-detail' : ''}`}>
        <div className="pane-list chat-list">
          <div className="pane-head">
            <div className="row">
              <span className="t-bodyb grow">채팅</span>
              <button type="button" className="quick-btn" onClick={() => setDmPicking(true)} title="팀원과 둘이서만 보는 대화">
                1:1 대화
              </button>
            </div>
          </div>
          <div className="pane-body">
            {[
              ['채팅방', rooms.filter(r => !r.members)],
              ['1:1 대화', rooms.filter(r => r.members)],
            ].map(([label, list]) => (
              <div key={label as string}>
                <div className="room-group">
                  <span className="grow">{label as string}</span>
                  {label === '1:1 대화' ? (
                    <button type="button" className="icon-btn sm" onClick={() => setDmPicking(true)} aria-label="1:1 대화 시작" title="팀원과 1:1 대화 시작">
                      <Plus size={14} />
                    </button>
                  ) : (
                    <button type="button" className="icon-btn sm" onClick={() => setCreating(true)} aria-label="채팅방 만들기" title="채팅방 만들기">
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                {(list as ChatRoomSummary[]).map(r => (
                  <Link key={r.id} to={withQuery(path, query, { room: r.id })} className={`item ${r.id === roomId ? 'active' : ''} ${r.members ? 'dm' : ''}`}>
                    <div className="row">
                      <span className="t-smallb truncate grow">{r.members ? roomTitle(r, me.id, profileName).slice(2) : `# ${r.name}`}</span>
                      {r.last_at && <span className="t-meta">{relativeLabel(r.last_at)}</span>}
                    </div>
                    <div className="row">
                      <span className="t-cap truncate grow">{r.last_content ?? r.description ?? '대화를 시작해 보세요'}</span>
                      {r.unread > 0 && r.id !== roomId && <Badge tone="blue">{r.unread}</Badge>}
                    </div>
                  </Link>
                ))}
                {label === '1:1 대화' && !(list as ChatRoomSummary[]).length && (
                  <button type="button" className="item t-cap" onClick={() => setDmPicking(true)}>
                    + 팀원을 골라 1:1 대화를 시작하세요
                  </button>
                )}
              </div>
            ))}
            {!loading && rooms.length === 0 && <Empty>채팅방이 없습니다.</Empty>}
          </div>
        </div>
        {/* 채팅은 한 칸: 방 목록 옆에서 대화가 왼쪽→오른쪽으로 펼쳐짐 */}
        <div className="pane-detail expand-in" key={room?.id ?? 'none'}>{room ? <Room room={room} /> : <Empty>채팅방을 고르세요.</Empty>}</div>
      </div>
      {dmPicking && (
        <DmPicker
          onClose={() => setDmPicking(false)}
          onPick={async id => {
            setDmPicking(false)
            try {
              const room = await api.openDm(id)
              bump()
              navigate(withQuery(path, query, { room }))
            } catch (e) {
              toast(friendlyError(e))
            }
          }}
        />
      )}
      {creating && <NewRoom onClose={() => setCreating(false)} onCreated={id => navigate(withQuery(path, query, { room: id }))} />}
    </Shell>
  )
}

function Room({ room }: { room: ChatRoomSummary }) {
  const { api, me, version, profileName, profiles } = useApp()
  const { navigate } = useRouter()
  const { messages, reads, send: sendMessage, sendFile, remove, edit } = useRoomMessages(room.id)
  // 여러 파일은 차례로 보냄 (실패한 파일에서 멈춤)
  const sendFiles = async (files: File[]) => {
    stick.current = true
    for (const f of files) if (!(await sendFile(f))) break
  }
  const drop = useFileDrop(files => void sendFiles(files))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const { data: projects } = useAsync(() => api.listProjects(), [version], [] as Project[])
  const project = projects.find(p => p.id === room.project_id)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    if (await sendMessage(content)) {
      setText('')
      stick.current = true
    }
    setSending(false)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const dmPartner = room.members?.find(id => id !== me.id && !profiles.find(p => p.id === id)?.is_agent) ?? null
  // 채팅방 삭제: 만든 사람 · 관리자 · 1:1 대화 당사자 (두 번 눌러 확인, 팝업 없음)
  const { bump } = useApp()
  const { busy: deleting, run } = useAction()
  const [confirmDel, setConfirmDel] = useState(false)
  const canDelete = me.role === 'admin' || room.created_by === me.id || !!room.members?.includes(me.id)
  const removeRoom = async () => {
    if (await run(() => api.deleteRoom(room.id), '채팅방을 삭제했습니다.')) {
      bump()
      navigate('/chat', { replace: true })
    }
  }
  return (
    <div className={`chat-room ${drop.dragging ? 'chat-drop' : ''}`} {...drop.props}>
      {drop.dragging && <DropHint />}
      <div className="chat-head">
        <button type="button" className="icon-btn back-btn" onClick={() => navigate('/chat')} aria-label="채팅방 목록">
          <ArrowLeft size={18} />
        </button>
        <span className="t-bodyb truncate">{roomTitle(room, me.id, profileName)}</span>
        {room.members && (
          <span className="t-cap row" style={{ gap: 3 }} title="두 사람만 볼 수 있는 대화입니다 (관리자도 볼 수 없음)">
            둘만 보는 대화
          </span>
        )}
        {project && (
          <Link to={`/projects?id=${project.id}`}>
            <Badge>📁 {project.name}</Badge>
          </Link>
        )}
        <span className="grow" />
        {room.description && !confirmDel && <span className="t-cap truncate">{room.description}</span>}
        {canDelete &&
          (confirmDel ? (
            <span className="row room-del" style={{ gap: 4 }}>
              <span className="t-small t-red">대화 내용까지 모두 지울까요?</span>
              <button type="button" className="btn btn-sm room-del-yes" onClick={removeRoom} disabled={deleting}>
                삭제
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setConfirmDel(false)}>
                취소
              </button>
            </span>
          ) : (
            <button type="button" className="icon-btn sm" onClick={() => setConfirmDel(true)} aria-label="채팅방 삭제" title="채팅방 삭제">
              <Trash2 size={15} />
            </button>
          ))}
      </div>
      <div
        className="chat-body"
        ref={bodyRef}
        onScroll={e => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <MessageList messages={messages} reads={reads} members={room.members} onRemove={remove} onEdit={edit} />
        <AgentTyping messages={messages} members={room.members} />
      </div>
      <div className="composer">
        <div className="composer-tools">
          <AttachButton onFiles={sendFiles} />
          <AssignTaskButton assignee={dmPartner} className="assign-chip" label="업무 지시" title={dmPartner ? `${profileName(dmPartner)}님에게 업무 지시` : '업무 지시'} />
        </div>
        <textarea
          className="textarea"
          placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈) · 사진은 붙여넣기(Ctrl+V)나 끌어다 놓기도 돼요"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={e => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              sendFiles(files)
            }
          }}
          maxLength={4000}
          aria-label="메시지"
        />
        <button type="button" className="send-btn" onClick={send} disabled={!text.trim() || sending} aria-label="보내기">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

/** 1:1 대화 상대 고르기 */
function DmPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { me, profiles } = useApp()
  const [q, setQ] = useState('')
  // AI 팀원을 맨 위에 (말을 걸면 바로 답하고 일을 처리함)
  const people = profiles
    .filter(p => p.active && p.id !== me.id && (!q.trim() || p.name.includes(q.trim())))
    .sort((a, b) => Number(b.is_agent) - Number(a.is_agent))
  return (
    <Modal title="1:1 대화" onClose={onClose}>
      <input className="input" autoFocus placeholder="이름 검색" value={q} onChange={e => setQ(e.target.value)} aria-label="이름 검색" />
      <div className="col gap-2">
        {people.map(p => (
          <button
            key={p.id}
            type="button"
            className="item row"
            onClick={() => onPick(p.id)}
          >
            <span className="t-smallb grow">{p.name}</span>
            {p.is_agent ? <Badge tone="acid">{p.title ? `${p.title} · 바로 답함` : 'AI 팀원 · 바로 답함'}</Badge> : p.title && <span className="t-cap">{p.title}</span>}
            {!p.is_agent && <span className="t-meta">{p.today_status}</span>}
          </button>
        ))}
        {people.length === 0 && <Empty>대화할 팀원이 없습니다.</Empty>}
      </div>
      <span className="t-cap">두 사람만 볼 수 있는 대화방이 열립니다. 이미 대화한 적이 있으면 그 방으로 이어집니다.</span>
    </Modal>
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
