import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Pin, Send, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { roomTitle, useRoomMessages } from '../lib/chat'
import { timeLabel, todayKey } from '../lib/date'
import { QUICK_WINDOW, supportsPip } from '../lib/pip'
import { useRouter } from '../lib/router'
import { TODAY_STATUSES, type ChatRoomSummary, type TodayStatus, type WorkLog } from '../lib/types'
import { QuickLogForm } from '../components/LogForm'
import { AssignTaskButton } from '../components/AssignTask'
import { AgentTyping, AttachButton, DropHint, MessageList, useFileDrop } from '../components/ChatMessages'
import { TABS, useSummary } from '../components/Shell'
import { Empty, KindBadge } from '../components/ui'

type Mode = 'log' | 'chat' | 'menu'

const ROOM_KEY = 'wkly-quick-room'
const MODE_KEY = 'wkly-quick-mode'
const load = (k: string) => {
  try {
    return window.localStorage.getItem(k)
  } catch {
    return null
  }
}
const save = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v)
  } catch {
    /* 저장 못 해도 동작에는 지장 없음 */
  }
}

/**
 * 빠른 창: /quick 독립 창(전체 창을 닫아도 동작, 로그인 가능) 또는 PiP(항상 위) 에서 렌더링.
 * 기록 / 채팅 / 메뉴(전체 기능으로 이동) 전환. onClose 가 있으면 PiP.
 */
export default function Quick({ onClose }: { onClose?: () => void }) {
  const { api, me, version, bump, toast, openQuick } = useApp()
  const pip = !!onClose
  const saved = load(MODE_KEY)
  const [mode, setMode] = useState<Mode>(saved === 'chat' || saved === 'menu' ? saved : 'log')
  const { data: rooms } = useAsync(() => api.listRooms(), [version], [] as ChatRoomSummary[])
  const unread = rooms.reduce((s, r) => s + r.unread, 0)
  const pick = (m: Mode) => {
    setMode(m)
    save(MODE_KEY, m)
  }
  // 주소로 직접 연 빠른 창도 '빠른 창으로' 돌아오기 버튼이 보이도록 창 이름을 붙임
  useEffect(() => {
    if (!pip) window.name = QUICK_WINDOW
  }, [pip])
  const setStatus = async (today_status: TodayStatus) => {
    try {
      await api.updateProfile(me.id, { today_status })
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  return (
    <div className="quick">
      {/* 흰 로고는 시리즈 블루 띠 위에만. PiP 창은 문서 주소가 달라 절대 주소로 로고를 불러옴 */}
      <div className="quick-brand">
        <img className="quick-logo" src={`${window.location.origin}/wkly-logo-white.svg`} alt="WKLY" width={120} height={38} />
      </div>
      <div className="card">
        <div className={`inner ${mode === 'chat' ? 'quick-chat' : ''}`} style={{ gap: 10 }}>
          <div className="row">
            <div className="seg" role="tablist" aria-label="빠른 창 메뉴">
              <button type="button" role="tab" aria-selected={mode === 'log'} className={mode === 'log' ? 'on' : ''} onClick={() => pick('log')}>
                빠른 기록
              </button>
              <button type="button" role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'on' : ''} onClick={() => pick('chat')}>
                채팅
                {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
              </button>
              <button type="button" role="tab" aria-selected={mode === 'menu'} className={mode === 'menu' ? 'on' : ''} onClick={() => pick('menu')}>
                메뉴
              </button>
            </div>
            <span className="grow" />
            {!pip && supportsPip() && (
              <button type="button" className="icon-btn sm" onClick={() => openQuick('pin')} aria-label="항상 위에 띄우기" title="다른 프로그램 위에 항상 떠 있게">
                <Pin size={15} />
              </button>
            )}
            {onClose && (
              <button type="button" className="icon-btn sm" onClick={onClose} aria-label="닫기">
                <X size={16} />
              </button>
            )}
          </div>
          <label className="today-is">
            <span className="t-meta">{me.name} · TODAY IS</span>
            <select value={me.today_status} onChange={e => setStatus(e.target.value as TodayStatus)} aria-label="오늘 상태">
              {TODAY_STATUSES.map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {mode === 'log' ? <QuickLog /> : mode === 'chat' ? <QuickChat rooms={rooms} /> : <QuickMenu pip={pip} />}
        </div>
      </div>
    </div>
  )
}

/** 전체 기능으로 이동. 독립 창에서는 이 창 안에서 열리고(상단 '빠른 창으로'로 복귀), PiP 에서는 원래 ERP 창에서 열림 */
function QuickMenu({ pip }: { pip: boolean }) {
  const { api, me } = useApp()
  const { navigate } = useRouter()
  const summary = useSummary()
  const go = (path: string) => {
    navigate(path)
    if (pip) window.focus()
  }
  return (
    <>
      <div className="quick-menu">
        {TABS.filter(t => !t.admin || me.role === 'admin').map(t => {
          const n = t.key === 'approvals' ? summary.pendingToDecide : t.key === 'chat' ? summary.unread : 0
          return (
            <button key={t.key} type="button" className="quick-menu-item" onClick={() => go(t.path)}>
              {t.label}
              {n > 0 && <span className="dot">{n > 99 ? '99+' : n}</span>}
            </button>
          )
        })}
        <button type="button" className="quick-menu-item" onClick={() => go('/help')}>
          사용법
        </button>
      </div>
      <span className="t-cap">{pip ? '누르면 원래 ERP 창에서 열립니다.' : "이 창 안에서 열립니다. 위쪽 '빠른 창으로'를 누르면 돌아옵니다."}</span>
      <span className="grow" />
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => api.signOut()}>
        로그아웃
      </button>
    </>
  )
}

function QuickLog() {
  const { api, me, version } = useApp()
  const today = todayKey()
  const { data } = useAsync(() => api.listWorkLogs({ date: today, userId: me.id }), [version, today, me.id], [] as WorkLog[])
  const recent = [...data].reverse().slice(0, 4)
  return (
    <>
      <QuickLogForm />
      <div className="dashed" />
      <span className="t-cap">오늘 내 기록 {data.length}건</span>
      {recent.map(l => (
        <div key={l.id} className="row t-cap">
          <span className="t-meta">{timeLabel(l.created_at)}</span>
          <KindBadge kind={l.kind} />
          <span className="truncate t-blue">{l.content}</span>
        </div>
      ))}
    </>
  )
}

function QuickChat({ rooms }: { rooms: ChatRoomSummary[] }) {
  const [chosen, setChosen] = useState(load(ROOM_KEY))
  const { me, profileName, profiles } = useApp()
  const room = rooms.find(r => r.id === chosen) ?? rooms[0] ?? null
  const roomId = room?.id ?? null
  const { messages, reads, send, sendFile, remove, edit } = useRoomMessages(roomId)
  const sendFiles = async (files: File[]) => {
    stick.current = true
    for (const f of files) if (!(await sendFile(f))) break
  }
  const drop = useFileDrop(files => void sendFiles(files))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    if (await send(content)) {
      setText('')
      stick.current = true
    }
    setSending(false)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  if (!rooms.length) return <Empty>채팅방이 없습니다. 채팅 탭에서 방을 만들어 주세요.</Empty>
  const dmPartner = room?.members?.find(id => id !== me.id && !profiles.find(p => p.id === id)?.is_agent) ?? null
  return (
    <div className={`chat-room ${drop.dragging ? 'chat-drop' : ''}`} {...drop.props}>
      {drop.dragging && <DropHint />}
      <select
        className="select"
        aria-label="채팅방"
        value={roomId ?? ''}
        onChange={e => {
          setChosen(e.target.value)
          save(ROOM_KEY, e.target.value)
          stick.current = true
        }}
      >
        {rooms.map(r => (
          <option key={r.id} value={r.id}>
            {roomTitle(r, me.id, profileName)}
            {r.unread > 0 && r.id !== roomId ? ` (${r.unread})` : ''}
          </option>
        ))}
      </select>
      <div
        className="chat-body"
        ref={bodyRef}
        onScroll={e => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <MessageList messages={messages} reads={reads} members={room?.members} onRemove={remove} onEdit={edit} />
        <AgentTyping messages={messages} members={room?.members} />
      </div>
      <div className="quick-composer">
        <div className="composer-tools">
          <AttachButton onFiles={sendFiles} />
          <AssignTaskButton assignee={dmPartner} className="assign-chip" label="지시" title={dmPartner ? `${profileName(dmPartner)}님에게 업무 지시` : '업무 지시'} />
        </div>
        <textarea className="textarea" placeholder="메시지 (Enter 전송)" value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} maxLength={4000} aria-label="메시지" />
        <button type="button" className="send-btn" onClick={submit} disabled={!text.trim() || sending} aria-label="보내기">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
