// 화이트보드 실시간 커서 (2026-11-28 대표 지시 '외부인 실시간 커서도 개발 진행해')
//  - 같은 보드를 연 팀원 · 외부인이 서로의 마우스 위치를 이름표와 함께 봄. DB 에는 아무것도 쓰지 않음(방송만)
//  - 방송 주제는 보드의 '실시간 열쇠'(live_key · 추측 불가 · 공유를 끄면 바뀜). 받은 값은 남이 보낸 것이라 여기서 거름
//  - 이 파일은 순수 규칙(시험 tests/board-cursors.test.ts) + 방송 방 열기(openCursorRoom)
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CursorPeer { id: string; name: string; x: number; y: number; at: number }
export const CURSOR_SEND_MS = 90
export const CURSOR_BEAT_MS = 3_000
export const CURSOR_STALE_MS = 8_000
export const CURSOR_MAX_PEERS = 30
const LIMIT = 10_000_000
const KEY_RE = /^[0-9a-f]{64}$/

export const cursorTopic = (liveKey: string | null | undefined) => (liveKey && KEY_RE.test(liveKey) ? `bl-${liveKey}` : null)

/** 받은 방송 한 건 → 믿을 수 있는 모양으로 (아니면 null) */
export function readCursor(raw: unknown, now: number): CursorPeer | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const id = typeof p.id === 'string' ? p.id.slice(0, 80) : ''
  const name = typeof p.name === 'string' ? p.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30) : ''
  const x = Number(p.x), y = Number(p.y)
  if (!id || !name || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > LIMIT || Math.abs(y) > LIMIT) return null
  return { id, name, x, y, at: now }
}

/** 새 위치를 넣고 오래된 사람은 뺌 (나 자신 · 한도 넘는 새 사람은 안 넣음) */
export function putCursor(list: readonly CursorPeer[], next: CursorPeer, meId: string, now: number): CursorPeer[] {
  const alive = list.filter(p => p.id !== next.id && now - p.at < CURSOR_STALE_MS)
  if (next.id === meId) return alive
  if (alive.length >= CURSOR_MAX_PEERS) return alive
  return [...alive, next]
}
export const dropCursor = (list: readonly CursorPeer[], id: string) => list.filter(p => p.id !== id)
export const pruneCursors = (list: readonly CursorPeer[], now: number) => {
  const alive = list.filter(p => now - p.at < CURSOR_STALE_MS)
  return alive.length === list.length ? (list as CursorPeer[]) : alive
}

// 밝은 화면에서 잘 보이는 색 (검정 없음) · 같은 사람은 늘 같은 색
const COLORS = ['#1f4dff', '#141414', '#5b7cff', '#555555', '#0b2fb8', '#858585', '#3a3a3a', '#7f9bff']
export function cursorColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

/** Excalidraw 에 넘길 '함께 보는 사람' 표 */
export function collaboratorsOf(list: readonly CursorPeer[]) {
  const m = new Map<string, { id: string; username: string; pointer: { x: number; y: number; tool: 'pointer' }; color: { background: string; stroke: string } }>()
  for (const p of list) {
    const c = cursorColor(p.id)
    m.set(p.id, { id: p.id, username: p.name, pointer: { x: p.x, y: p.y, tool: 'pointer' }, color: { background: c, stroke: c } })
  }
  return m
}

export interface CursorRoom { move(x: number, y: number): void; saved(version: number): void; close(): void }
export interface CursorRoomOn { cursors(list: CursorPeer[]): void; saved(p: { id: string; version: number }): void }
export const NO_CURSOR_ROOM: CursorRoom = { move() {}, saved() {}, close() {} }

/** 방송 방 열기 — 팀원(로그인한 연결) · 외부인(로그인 없는 연결) 공통. 실패하면 조용히 커서 없이. */
export function openCursorRoom(sb: SupabaseClient, liveKey: string, who: { id: string; name: string }, on: CursorRoomOn): CursorRoom {
  const topic = cursorTopic(liveKey)
  if (!topic) return NO_CURSOR_ROOM
  try {
    let list: CursorPeer[] = []
    let ready = false, closed = false
    let last: { x: number; y: number } | null = null
    let sentAt = 0, timer: number | null = null
    const set = (next: CursorPeer[]) => { if (next !== list) { list = next; on.cursors(list) } }
    const ch = sb.channel(topic, { config: { broadcast: { self: false } } })
    const send = (event: string, payload: Record<string, unknown>) => { if (ready && !closed) void ch.send({ type: 'broadcast', event, payload }).catch(() => undefined) }
    const flush = () => {
      timer = null
      if (!last) return
      sentAt = Date.now()
      send('c', { id: who.id, name: who.name, x: Math.round(last.x), y: Math.round(last.y) })
    }
    ch.on('broadcast', { event: 'c' }, ({ payload }) => {
      const now = Date.now()
      const p = readCursor(payload, now)
      if (p) set(putCursor(list, p, who.id, now))
    }).on('broadcast', { event: 'bye' }, ({ payload }) => {
      const id = (payload as { id?: unknown })?.id
      if (typeof id === 'string') set(dropCursor(list, id))
    }).on('broadcast', { event: 'saved' }, ({ payload }) => {
      const p = payload as { id?: unknown; version?: unknown }
      const v = Number(p?.version)
      if (typeof p?.id === 'string' && p.id !== who.id && Number.isInteger(v) && v > 0 && v < 1e9) on.saved({ id: p.id.slice(0, 80), version: v })
    }).subscribe(status => { ready = status === 'SUBSCRIBED'; if (ready && last) flush() })
    // 가만히 있어도 '여기 있음'을 알리고, 떠난 사람은 지움
    const beat = window.setInterval(() => {
      set(pruneCursors(list, Date.now()))
      if (last && document.visibilityState === 'visible' && Date.now() - sentAt >= CURSOR_BEAT_MS - 200) flush()
    }, CURSOR_BEAT_MS)
    const bye = () => send('bye', { id: who.id })
    window.addEventListener('pagehide', bye)
    return {
      move(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        last = { x, y }
        if (timer != null) return
        const wait = CURSOR_SEND_MS - (Date.now() - sentAt)
        if (wait <= 0) flush(); else timer = window.setTimeout(flush, wait)
      },
      saved(version) { send('saved', { id: who.id, version }) },
      close() {
        bye()
        closed = true
        window.clearInterval(beat)
        if (timer != null) window.clearTimeout(timer)
        window.removeEventListener('pagehide', bye)
        void sb.removeChannel(ch)
      },
    }
  } catch { return NO_CURSOR_ROOM }
}
