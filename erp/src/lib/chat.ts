import { useEffect, useState, useSyncExternalStore } from 'react'
import { useApp } from './app'
import { friendlyError, type AgentDraft } from './api'
import { ask } from '../components/Ask'
import type { ChatMessage, ChatRead, ChatRoom, ChatRoomSummary, RoomLevel } from './types'

/**
 * 채팅 신호 (2026-10-26 "채팅이 느리고 인터벌이 생긴다"):
 *  새 메시지마다 앱 전체를 새로 고치던 것(bump)을 없애고, 채팅 숫자 · 방 목록만 이 신호로 가볍게 새로 고침
 *  - 여러 메시지가 몰려도 0.4초에 한 번만
 */
let chatTick = 0
let chatTimer: number | undefined
const chatListeners = new Set<() => void>()
export function pokeChat(delay = 400) {
  window.clearTimeout(chatTimer)
  chatTimer = window.setTimeout(() => {
    chatTick++
    for (const l of chatListeners) l()
  }, delay)
}
export function useChatTick() {
  return useSyncExternalStore(
    cb => {
      chatListeners.add(cb)
      return () => chatListeners.delete(cb)
    },
    () => chatTick,
  )
}

/** 채팅방 메시지: 불러오기 · 실시간 반영 · 읽음 처리 · 보내기 · 삭제 (채팅 탭과 빠른 기록 창이 함께 씀) */
export function useRoomMessages(roomId: string | null) {
  const { api, me, toast } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reads, setReads] = useState<ChatRead[]>([])
  // AI 팀원이 쓰는 중인 답 (팀원별 하나, 진짜 글이 오면 지움)
  const [drafts, setDrafts] = useState<Record<string, AgentDraft & { at: number }>>({})

  useEffect(() => {
    setMessages([])
    setReads([])
    setDrafts({})
    if (!roomId) return
    let alive = true
    // 읽음 표시: 누가 어디까지 읽었는지 (다른 사람이 읽으면 실시간으로 다시 불러옴)
    const loadReads = () => api.listRoomReads(roomId).then(r => alive && setReads(r)).catch(() => undefined)
    // 읽음 표시 · 읽음 처리는 몰아서 (메시지가 연달아 와도 서버 요청이 쌓이지 않게)
    let readsTimer: number | undefined
    const loadReadsSoon = () => {
      window.clearTimeout(readsTimer)
      readsTimer = window.setTimeout(loadReads, 600)
    }
    let markTimer: number | undefined
    const markSoon = () => {
      window.clearTimeout(markTimer)
      markTimer = window.setTimeout(() => api.markRead(roomId).catch(() => undefined), 800)
    }
    api.listMessages(roomId).then(m => alive && setMessages(m)).catch(e => toast(friendlyError(e)))
    api.markRead(roomId).then(() => pokeChat(0)).then(loadReads).catch(() => undefined)
    const offReads = api.subscribeChanges(['chat_reads'], loadReadsSoon)
    const off = api.subscribeMessages(roomId, ({ type, message }) => {
      setMessages(prev => {
        if (type === 'DELETE') return prev.filter(m => m.id !== message.id)
        if (type === 'UPDATE') return prev.map(m => (m.id === message.id ? message : m))
        if (prev.some(m => m.id === message.id)) return prev
        // 내가 보낸 글이 먼저 화면에 떠 있으면(보내는 중) 그 자리를 진짜 글로 바꿈
        const at = prev.findIndex(m => m.pending && m.user_id === message.user_id && m.content === message.content)
        if (at >= 0) return prev.map((m, i) => (i === at ? message : m))
        return [...prev, message]
      })
      if (type === 'INSERT' && message.user_id !== me.id) markSoon()
      if (type === 'INSERT' && message.user_id) setDrafts(prev => dropDraft(prev, message.user_id!))
    })
    const offDrafts = api.subscribeAgentDrafts(roomId, d =>
      setDrafts(prev => {
        if (d.done) return dropDraft(prev, d.agent_id)
        const old = prev[d.agent_id]
        if (old && old.seq > d.seq) return prev
        return { ...prev, [d.agent_id]: { ...d, at: Date.now() } }
      }),
    )
    return () => {
      alive = false
      window.clearTimeout(readsTimer)
      window.clearTimeout(markTimer)
      off()
      offReads()
      offDrafts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  /** 성공하면 true */
  const send = async (content: string, parentId?: number | null) => {
    if (!roomId) return false
    // 보내기 누르는 즉시 화면에 (서버 응답을 기다리지 않음)
    const temp: ChatMessage = { id: -Date.now() - Math.random(), room_id: roomId, user_id: me.id, content, created_at: new Date().toISOString(), edited_at: null, parent_id: parentId ?? null, pending: true }
    setMessages(prev => [...prev, temp])
    try {
      const m = await api.sendMessage(roomId, content, parentId)
      setMessages(prev => {
        const rest = prev.filter(x => x.id !== temp.id)
        return rest.some(x => x.id === m.id) ? rest : prev.map(x => (x.id === temp.id ? m : x))
      })
      return true
    } catch (e) {
      setMessages(prev => prev.filter(x => x.id !== temp.id))
      toast(friendlyError(e))
      return false
    }
  }
  const remove = async (id: number) => {
    if (!(await ask('이 메시지를 삭제할까요?'))) return
    try {
      await api.deleteMessage(id)
      setMessages(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  /** 사진 · 파일 보내기. 성공하면 true */
  const sendFile = async (file: File, caption?: string) => {
    if (!roomId) return false
    try {
      const m = await api.sendFile(roomId, file, caption)
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      return true
    } catch (e) {
      toast(friendlyError(e))
      return false
    }
  }
  /** 성공하면 true */
  const edit = async (id: number, content: string) => {
    try {
      const m = await api.editMessage(id, content)
      setMessages(prev => prev.map(x => (x.id === id ? m : x)))
      return true
    } catch (e) {
      toast(friendlyError(e))
      return false
    }
  }
  /** 이모지 반응 넣기/빼기 */
  const react = async (id: number, emoji: string) => {
    try {
      const reactions = await api.reactMessage(id, emoji)
      setMessages(prev => prev.map(x => (x.id === id ? { ...x, reactions } : x)))
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  return { messages, reads, drafts, send, sendFile, remove, edit, react }
}

/** 방 이름: 1:1 대화는 상대 이름, 나머지는 '# 방이름' */
export function roomTitle(room: ChatRoom, meId: string, profileName: (id: string | null | undefined) => string): string {
  if (!room.members) return `# ${room.name}`
  const others = room.members.filter(id => id !== meId)
  return `@ ${others.map(profileName).join(', ') || '나'}`
}

/**
 * 방마다 알림 단계 (2026-10-23): 방 목록을 불러올 때마다 기억해 두고, 새 메시지 소리 · 숫자에 씀
 *  - 전체: 모든 새 메시지 · 멘션만: 나를 부를 때만 · 끄기: 소리 · 숫자 없음
 */
const roomLevels = new Map<string, RoomLevel>()
export function rememberRoomLevels(rooms: ChatRoomSummary[]) {
  for (const r of rooms) roomLevels.set(r.id, r.level ?? 'all')
}
export function wantsAlert(m: ChatMessage, myName: string) {
  const level = roomLevels.get(m.room_id) ?? 'all'
  if (level === 'all') return true
  return level === 'mention' && !!myName && m.content.includes(`@${myName}`)
}
/** 탭 · 내 현황에 보일 안 읽은 수 */
export function countedUnread(r: ChatRoomSummary) {
  const level = r.level ?? 'all'
  return level === 'all' ? r.unread : level === 'mention' ? r.mentions ?? 0 : 0
}

function dropDraft<T>(prev: Record<string, T>, id: string) {
  if (!(id in prev)) return prev
  const next = { ...prev }
  delete next[id]
  return next
}
