import { useEffect, useState } from 'react'
import { useApp } from './app'
import { friendlyError } from './api'
import type { ChatMessage } from './types'

/** 채팅방 메시지: 불러오기 · 실시간 반영 · 읽음 처리 · 보내기 · 삭제 (채팅 탭과 빠른 기록 창이 함께 씀) */
export function useRoomMessages(roomId: string | null) {
  const { api, me, bump, toast } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    setMessages([])
    if (!roomId) return
    let alive = true
    api.listMessages(roomId).then(m => alive && setMessages(m)).catch(e => toast(friendlyError(e)))
    api.markRead(roomId).then(bump).catch(() => undefined)
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
  return { messages, send, remove }
}
