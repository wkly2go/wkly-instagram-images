import { useEffect, useState } from 'react'
import { useApp } from './app'
import { friendlyError } from './api'
import type { ChatMessage, ChatRead, ChatRoom } from './types'

/** 채팅방 메시지: 불러오기 · 실시간 반영 · 읽음 처리 · 보내기 · 삭제 (채팅 탭과 빠른 기록 창이 함께 씀) */
export function useRoomMessages(roomId: string | null) {
  const { api, me, bump, toast } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reads, setReads] = useState<ChatRead[]>([])

  useEffect(() => {
    setMessages([])
    setReads([])
    if (!roomId) return
    let alive = true
    // 읽음 표시: 누가 어디까지 읽었는지 (다른 사람이 읽으면 실시간으로 다시 불러옴)
    const loadReads = () => api.listRoomReads(roomId).then(r => alive && setReads(r)).catch(() => undefined)
    api.listMessages(roomId).then(m => alive && setMessages(m)).catch(e => toast(friendlyError(e)))
    api.markRead(roomId).then(bump).then(loadReads).catch(() => undefined)
    const offReads = api.subscribeChanges(['chat_reads'], loadReads)
    const off = api.subscribeMessages(roomId, ({ type, message }) => {
      setMessages(prev => {
        if (type === 'DELETE') return prev.filter(m => m.id !== message.id)
        if (type === 'UPDATE') return prev.map(m => (m.id === message.id ? message : m))
        return prev.some(m => m.id === message.id) ? prev : [...prev, message]
      })
      if (type === 'INSERT' && message.user_id !== me.id) api.markRead(roomId).catch(() => undefined)
    })
    return () => {
      alive = false
      off()
      offReads()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  /** 성공하면 true */
  const send = async (content: string) => {
    if (!roomId) return false
    try {
      const m = await api.sendMessage(roomId, content)
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      return true
    } catch (e) {
      toast(friendlyError(e))
      return false
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
  return { messages, reads, send, sendFile, remove, edit }
}

/** 방 이름: 1:1 대화는 상대 이름, 나머지는 '# 방이름' */
export function roomTitle(room: ChatRoom, meId: string, profileName: (id: string | null | undefined) => string): string {
  if (!room.members) return `# ${room.name}`
  const others = room.members.filter(id => id !== meId)
  return `@ ${others.map(profileName).join(', ') || '나'}`
}
