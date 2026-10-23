import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, AtSign, BellOff, ChevronDown, ChevronRight, Plus, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { countedUnread, roomTitle, useRoomMessages } from '../lib/chat'
import { parseSlash, parseTaskText, remindIso, slashMenu } from '../lib/slash'
import { approvalKindOf, ROOM_LEVEL_LABEL, type RoomLevel } from '../lib/types'
import { leadAgent } from '../components/AgentDesk'
import { relativeLabel, todayKey } from '../lib/date'
import { Link, normalizePath, useRouter, withQuery } from '../lib/router'
import type { AppNotification, ChatRoomSummary, NotificationKind, Project } from '../lib/types'
import { Shell } from '../components/Shell'
import { Badge, Button, Empty, Field, Modal } from '../components/ui'
import { AssignTaskButton } from '../components/AssignTask'
import { CardDataProvider } from '../components/ChatCards'
import { AgentTyping, AttachButton, DropHint, MessageList, useFileDrop } from '../components/ChatMessages'

const ACTIVITY_KINDS: NotificationKind[] = ['멘션', '승인', '할 일', '알람']
const ACTIVITY_FILTERS: [string, NotificationKind[]][] = [
  ['전체', ACTIVITY_KINDS],
  ['멘션 · 답글', ['멘션']],
  ['결재', ['승인']],
  ['할 일', ['할 일', '알람']],
]

/** 방 한 줄: 알림 단계에 따라 숫자 · 굵기 · 흐리게 */
function RoomItem({ r, active, to }: { r: ChatRoomSummary; active: boolean; to: string }) {
  const { me, profileName } = useApp()
  const counted = countedUnread(r)
  const quiet = r.unread > 0 && !counted && r.level !== 'mute' // 멘션만인 방에 새 글 (숫자 없이 굵게)
  return (
    <Link to={to} className={`item ${active ? 'active' : ''} ${r.members ? 'dm' : ''} ${r.level === 'mute' ? 'muted' : ''} ${(counted || quiet) && !active ? 'has-new' : ''}`}>
      <div className="row">
        <span className="t-smallb truncate grow">{r.members ? roomTitle(r, me.id, profileName).slice(2) : `# ${r.name}`}</span>
        {r.level === 'mute' && <BellOff size={11} aria-label="알림 끔" />}
        {r.last_at && <span className="t-meta">{relativeLabel(r.last_at)}</span>}
      </div>
      <div className="row">
        <span className="t-cap truncate grow">{r.last_content ?? r.description ?? '대화를 시작해 보세요'}</span>
        {counted > 0 && !active && <Badge tone={r.level === 'mention' ? 'red' : 'blue'}>{r.level === 'mention' ? `@${counted}` : counted}</Badge>}
      </div>
    </Link>
  )
}

export default function Chat() {
  const { api, version, toast, bump } = useApp()
  const { query, path, navigate } = useRouter()
  const [creating, setCreating] = useState(false)
  const [dmPicking, setDmPicking] = useState(false)
  const { data: rooms, loading } = useAsync(() => api.listRooms(), [version], [] as ChatRoomSummary[])
  const roomId = query.get('room')
  const room = rooms.find(r => r.id === roomId) ?? null
  // 멘션 · 답글 모아 보기 (슬랙의 '활동')
  const activity = query.get('view') === 'activity'
  const { data: notes } = useAsync(() => api.listNotifications(100), [version], [] as AppNotification[])
  // 활동: 멘션 · 답글 + 결재 · 할 일 알림 (2026-10-23)
  const mentions = notes.filter(n => ACTIVITY_KINDS.includes(n.kind))
  const unreadMentions = mentions.filter(n => !n.read_at).length
  // 프로젝트 방: 내 방(알림 전체이거나 나를 부름)만 펼치고 나머지는 접어 둠
  const [showOther, setShowOther] = useState(() => {
    try {
      return localStorage.getItem('wkly-chat-other') === '1'
    } catch {
      return false
    }
  })
  const projRooms = rooms.filter(r => !r.members && r.project_id)
  const myProj = projRooms.filter(r => r.level === 'all' || (r.mentions ?? 0) > 0 || r.id === roomId)
  const otherProj = projRooms.filter(r => !myProj.includes(r))
  const groups: [string, ChatRoomSummary[]][] = [
    ['프로젝트 대화', showOther ? [...myProj, ...otherProj] : myProj],
    ['채팅방', rooms.filter(r => !r.members && !r.project_id)],
    ['1:1 대화', rooms.filter(r => r.members)],
  ]
  // Alt+↑↓ 방 이동 · Alt+Shift+↑↓ 안 읽은 방
  const order = groups.flatMap(([, l]) => l)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const at = order.findIndex(r => r.id === roomId)
      for (let i = 1; i <= order.length; i++) {
        const r = order[(at + step * i + order.length * 2) % order.length]
        if (!r) return
        if (!e.shiftKey || (r.unread > 0 && r.level !== 'mute')) return navigate(withQuery(path, query, { room: r.id, view: null, thread: null }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, roomId, navigate, path, query])

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
    if (!roomId && !activity && rooms.length && window.matchMedia('(min-width: 641px)').matches) navigate(withQuery(path, query, { room: rooms[0].id }), { replace: true })
  }, [dm, roomId, activity, rooms, path, query, navigate])

  return (
    <Shell active="chat" flush>
      <div className={`split ${room || activity ? 'has-detail' : ''}`}>
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
            <Link to="/chat?view=activity" className={`item activity-item ${activity ? 'active' : ''}`}>
              <div className="row">
                <AtSign size={14} />
                <span className="t-smallb grow" title="멘션 · 답글 · 결재 · 할 일">활동</span>
                {unreadMentions > 0 && <Badge tone="red">{unreadMentions}</Badge>}
              </div>
            </Link>
            {groups.map(([label, list]) => (
              <div key={label}>
                <div className="room-group">
                  <span className="grow">{label}</span>
                  {label === '1:1 대화' ? (
                    <button type="button" className="icon-btn sm" onClick={() => setDmPicking(true)} aria-label="1:1 대화 시작" title="팀원과 1:1 대화 시작">
                      <Plus size={14} />
                    </button>
                  ) : label === '채팅방' ? (
                    <button type="button" className="icon-btn sm" onClick={() => setCreating(true)} aria-label="채팅방 만들기" title="채팅방 만들기">
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>
                {list.map(r => (
                  <RoomItem key={r.id} r={r} active={r.id === roomId} to={withQuery(path, query, { room: r.id, view: null, thread: null })} />
                ))}
                {label === '프로젝트 대화' && otherProj.length > 0 && (
                  <button
                    type="button"
                    className="item t-cap room-more"
                    onClick={() => {
                      setShowOther(v => {
                        try {
                          localStorage.setItem('wkly-chat-other', v ? '0' : '1')
                        } catch {
                          /* 저장 못 해도 화면은 그대로 */
                        }
                        return !v
                      })
                    }}
                  >
                    {showOther ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showOther ? '다른 프로젝트 접기' : `다른 프로젝트 ${otherProj.length}개`}
                  </button>
                )}
                {label === '프로젝트 대화' && !projRooms.length && <span className="item t-cap">기획 · 진행 중인 프로젝트마다 대화방이 생깁니다.</span>}
                {label === '1:1 대화' && !list.length && (
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
        <div className="pane-detail expand-in" key={activity ? 'activity' : room?.id ?? 'none'}>{activity ? <Activity list={mentions} /> : room ? <Room room={room} /> : <Empty>채팅방을 고르세요.</Empty>}</div>
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

/** 나를 부른 메시지 · 내 글에 달린 답글 모아 보기. 누르면 그 방(스레드)으로 */
function Activity({ list: all }: { list: AppNotification[] }) {
  const { api, bump } = useApp()
  const { navigate } = useRouter()
  const [filter, setFilter] = useState(0)
  const list = all.filter(n => ACTIVITY_FILTERS[filter][1].includes(n.kind))
  const open = async (n: AppNotification) => {
    if (!n.read_at) await api.markNotificationsRead([n.id]).catch(() => undefined)
    bump()
    if (n.link) navigate(normalizePath(n.link))
  }
  const unread = list.filter(n => !n.read_at)
  return (
    <div className="chat-room">
      <div className="chat-head">
        <button type="button" className="icon-btn back-btn" onClick={() => navigate('/chat')} aria-label="채팅방 목록">
          <ArrowLeft size={18} />
        </button>
        <span className="t-bodyb">활동</span>
        <span className="chips" role="tablist" aria-label="활동 종류">
          {ACTIVITY_FILTERS.map(([label], i) => (
            <button key={label} type="button" role="tab" aria-selected={filter === i} className={`chip ${filter === i ? 'active' : ''}`} onClick={() => setFilter(i)}>
              {label}
              {i > 0 && all.some(n => !n.read_at && ACTIVITY_FILTERS[i][1].includes(n.kind)) ? ` ${all.filter(n => !n.read_at && ACTIVITY_FILTERS[i][1].includes(n.kind)).length}` : ''}
            </button>
          ))}
        </span>
        <span className="grow" />
        {unread.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.markNotificationsRead(unread.map(n => n.id)).then(bump).catch(() => undefined)}>
            모두 읽음
          </button>
        )}
      </div>
      <div className="chat-body">
        {list.length === 0 && <Empty>아직 없습니다. 다른 사람이 @이름 으로 부르거나, 내 글에 답글이 달리거나, 결재 · 할 일이 오면 여기에 모입니다.</Empty>}
        {list.map(n => (
          <button key={n.id} type="button" className={`activity-row ${n.read_at ? '' : 'unread'}`} onClick={() => void open(n)}>
            <span className="col gap-2 grow" style={{ minWidth: 0 }}>
              <span className="t-smallb">{n.title}</span>
              {n.body && <span className="t-small activity-body">{n.body}</span>}
            </span>
            <span className="t-meta nowrap">{relativeLabel(n.created_at)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Room({ room }: { room: ChatRoomSummary }) {
  const { api, me, version, profileName, profiles, toast } = useApp()
  const { navigate } = useRouter()
  const { messages, reads, send: sendMessage, sendFile, remove, edit, react } = useRoomMessages(room.id)
  const { query } = useRouter()
  const threadId = Number(query.get('thread')) || null
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
    const slash = parseSlash(content)
    if (slash ? await runSlash(slash.cmd, slash.rest) : await sendMessage(content)) {
      setText('')
      stick.current = true
    }
    setSending(false)
  }
  // / 명령: 할 일 · 일정 · 결재 · AI · 파일 (프로젝트 방이면 그 프로젝트로)
  const fileInput = useRef<HTMLInputElement>(null)
  const runSlash = async (cmd: string, rest: string): Promise<boolean> => {
    if (cmd === '파일') {
      fileInput.current?.click()
      return true
    }
    if (cmd === 'ai') {
      const agent = leadAgent(profiles)
      if (!agent) return toast('AI 팀원이 없습니다.'), false
      if (!rest) return toast('예) /ai 이번 주 할 일 정리해줘'), false
      return sendMessage(`@${agent.name} ${rest}`)
    }
    const people = profiles.filter(p => p.active)
    const p = parseTaskText(rest, people)
    if (!p.title) return toast(`무엇을 할지 적어 주세요. 예) ${cmd === '결재' ? '/결재 촬영 소품 구매' : cmd === '일정' ? '/일정 현장 미팅 10/28 14:00' : '/할일 사진 셀렉 @김하늘 내일 6시'}`), false
    try {
      if (cmd === '결재') {
        const a = await api.createApproval({ kind: approvalKindOf(p.title), title: p.title, content: null, payload: room.project_id ? { project_id: room.project_id } : {} })
        if (!room.project_id) await api.sendCard(room.id, '결재를 올렸어요', { kind: 'approval', id: a.id, title: a.title })
        toast('결재를 올렸습니다.')
      } else {
        const date = p.date ?? (cmd === '일정' ? todayKey() : null)
        const t = await api.saveTask({
          title: p.title,
          project_id: room.project_id ?? null,
          assignee_id: p.assigneeId ?? (cmd === '할일' ? dmPartner ?? me.id : me.id),
          due_date: date,
          start_date: cmd === '일정' ? date : null,
          phase: cmd === '일정' ? '일정' : null,
          remind_at: date && p.time ? remindIso(date, p.time) : null,
          status: '할 일',
        })
        if (!room.project_id) await api.sendCard(room.id, cmd === '일정' ? '일정을 넣었어요' : `할 일을 만들었어요${t.assignee_id ? ` · 담당 ${profileName(t.assignee_id)}` : ''}`, { kind: 'task', id: t.id, title: t.title })
        toast(cmd === '일정' ? '일정을 넣었습니다.' : '할 일을 만들었습니다.')
      }
      bump()
      return true
    } catch (e) {
      toast(friendlyError(e))
      return false
    }
  }
  const menu = slashMenu(text)
  const [menuSel, setMenuSel] = useState(0)
  useEffect(() => setMenuSel(0), [text])
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setMenuSel(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + menu.length) % menu.length)
      return
    }
    if (menu.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim() !== `/${menu[menuSel].cmd}`))) {
      e.preventDefault()
      setText(`/${menu[menuSel].cmd} `)
      return
    }
    if (e.key === 'Escape') {
      // Esc: 이 방 읽음 처리
      api.markRead(room.id).then(bump).catch(() => undefined)
      return
    }
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
        <label className="room-level" title="이 방 알림: 전체 = 새 글마다 · 멘션만 = @내 이름일 때만 · 끄기 = 소리 · 숫자 없음">
          <span className="t-cap">알림</span>
          <select
            className="select"
            value={room.level ?? 'all'}
            onChange={e => api.setRoomLevel(room.id, e.target.value as RoomLevel).then(bump).catch(err => toast(friendlyError(err)))}
            aria-label="이 방 알림"
          >
            {(Object.keys(ROOM_LEVEL_LABEL) as RoomLevel[]).map(k => (
              <option key={k} value={k}>
                {ROOM_LEVEL_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
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
        <CardDataProvider>
          <MessageList messages={messages} reads={reads} members={room.members} onRemove={remove} onEdit={edit} onReply={(id, c) => sendMessage(c, id)} onReact={react} thread={threadId} />
        </CardDataProvider>
        <AgentTyping messages={messages} members={room.members} />
      </div>
      <div className="composer">
        {menu.length > 0 && (
          <div className="slash-menu" role="listbox" aria-label="명령">
            {menu.map((m, i) => (
              <button
                key={m.cmd}
                type="button"
                role="option"
                aria-selected={i === menuSel}
                className={i === menuSel ? 'on' : ''}
                onMouseEnter={() => setMenuSel(i)}
                onMouseDown={e => {
                  e.preventDefault()
                  setText(`/${m.cmd} `)
                }}
              >
                <code>/{m.cmd}</code>
                <span>{m.hint}</span>
                <span className="t-meta">{m.example}</span>
              </button>
            ))}
          </div>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={e => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void sendFiles(files)
        }} />
        <div className="composer-tools">
          <AttachButton onFiles={sendFiles} />
          <AssignTaskButton assignee={dmPartner} className="assign-chip" label="업무 지시" title={dmPartner ? `${profileName(dmPartner)}님에게 업무 지시` : '업무 지시'} />
        </div>
        <textarea
          className="textarea"
          placeholder="메시지 입력 · Enter 전송 · / 명령 (할일 · 일정 · 결재 · ai)"
          title="Enter 전송 · Shift+Enter 줄바꿈 · / 로 명령 · Esc 읽음 처리 · 사진은 붙여넣기(Ctrl+V)나 끌어다 놓기도 됩니다"
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
