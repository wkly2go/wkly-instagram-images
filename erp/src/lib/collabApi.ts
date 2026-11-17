// 외부 협업방 — 팀원 쪽 API (로드맵 2단계 · 2026-11-17 · docs/EXTERNAL_COLLAB.md)
//  - 방 · 외부인 · 대화 · 일정 읽기/쓰기는 DB 권한(RLS · 활성 팀원)으로 바로
//  - 방 만들기(드라이브 폴더) · 초대 링크 · 기기 끊기 · 드라이브 자료 · 받기 주소는 서버 함수 collab
//  - 외부인 쪽은 lib/collabGuest.ts (로그인 없이 기기 열쇠로 서버 함수만)
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { CollabDriveFile, CollabEvent, CollabFileRef, CollabGuest, CollabLink, CollabMessage, CollabRole, CollabRoom } from './types'

export interface CollabApi {
  /** 프로젝트의 외부 협업방 · 외부인 · 공유 일정 */
  listCollab(projectId: string): Promise<{ rooms: CollabRoom[]; guests: CollabGuest[]; events: CollabEvent[] }>
  /** 방 대화 (최근 limit 개 · 오래된 순) */
  listCollabMessages(roomId: string, limit?: number): Promise<CollabMessage[]>
  postCollabMessage(roomId: string, body: string, files?: CollabFileRef[]): Promise<CollabMessage>
  hideCollabMessage(id: number): Promise<void>
  createCollabRoom(projectId: string, title: string, intro?: string): Promise<{ room: CollabRoom; folder_error: string | null }>
  updateCollabRoom(id: string, patch: Partial<Pick<CollabRoom, 'title' | 'intro' | 'closed_at'>>): Promise<void>
  /** 초대: 링크(token)는 이때 한 번만 보임 */
  inviteCollabGuest(roomId: string, g: { name: string; org?: string; role: CollabRole; days: number; can_upload: boolean }): Promise<{ guest: CollabGuest; token: string }>
  relinkCollabGuest(guestId: string): Promise<string>
  updateCollabGuest(id: string, patch: Partial<Pick<CollabGuest, 'name' | 'org' | 'role' | 'can_upload' | 'expires_at' | 'revoked_at'>>): Promise<void>
  listCollabLinks(roomId: string): Promise<CollabLink[]>
  revokeCollabLink(roomId: string, linkId: string): Promise<void>
  /** 방 드라이브 폴더 만들기 (프로젝트 드라이브 폴더가 있을 때) · 폴더 id 또는 null */
  ensureCollabFolder(roomId: string): Promise<string | null>
  /** 방 드라이브 폴더 파일 (팀원이 드라이브에 직접 넣은 것 포함) */
  listCollabFiles(roomId: string): Promise<{ folder: boolean; files: CollabDriveFile[] }>
  /** 구글 이어 올리기 주소 (방 폴더에만 · 100MB) */
  collabUploadStart(roomId: string, f: { name: string; mime: string; size: number }): Promise<string>
  collabUploaded(roomId: string, fileId: string): Promise<CollabFileRef>
  /** 5분짜리 받기 주소 (inline 이면 브라우저에서 바로 보기) */
  collabFileUrl(roomId: string, fileId: string, inline?: boolean): Promise<string>
  saveCollabEvent(e: Partial<CollabEvent> & Pick<CollabEvent, 'kind' | 'title' | 'day'> & { room_id: string }): Promise<CollabEvent>
  deleteCollabEvent(id: string): Promise<void>
}

/** 외부인이 열 초대 주소 */
export const collabInviteUrl = (token: string) => `${window.location.origin}/c/${token}`

async function errorOf(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const b = (await ctx.clone().json()) as { error?: string }
      if (b?.error) return b.error
    } catch {
      /* 글이 아니면 기본 문구 */
    }
  }
  return fallback
}
const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new ApiError(r.error.message)
  return r.data as T
}
const MSG_COLS = 'id,room_id,user_id,guest_id,body,files,created_at,deleted_at'
const GUEST_COLS = 'id,room_id,name,org,role,can_upload,expires_at,revoked_at,last_seen_at,read_upto,invited_by,created_at'
const EVENT_COLS = 'id,room_id,kind,title,day,end_day,start_time,place,note,updated_at'

export function createSupabaseCollabApi(sb: SupabaseClient): CollabApi {
  const fn = async <T>(action: string, body: Record<string, unknown>, fallback: string): Promise<T> => {
    const { data, error } = await sb.functions.invoke('collab', { body: { action, ...body, origin: window.location.origin } })
    if (error || data?.error) throw new ApiError(data?.error ?? (await errorOf(error, fallback)))
    return data as T
  }
  return {
    async listCollab(projectId) {
      const rooms = must(await sb.from('collab_rooms').select('id,project_id,title,intro,drive_folder_id,closed_at,created_by,created_at').eq('project_id', projectId).order('created_at')) as CollabRoom[]
      if (!rooms.length) return { rooms, guests: [], events: [] }
      const ids = rooms.map(r => r.id)
      const [guests, events] = await Promise.all([
        sb.from('collab_guests').select(GUEST_COLS).in('room_id', ids).order('created_at'),
        sb.from('collab_events').select(EVENT_COLS).in('room_id', ids).order('day').order('start_time', { nullsFirst: true }),
      ])
      return { rooms, guests: must(guests) as CollabGuest[], events: must(events) as CollabEvent[] }
    },
    async listCollabMessages(roomId, limit = 200) {
      const rows = must(await sb.from('collab_messages').select(MSG_COLS).eq('room_id', roomId).order('id', { ascending: false }).limit(limit)) as CollabMessage[]
      return rows.reverse()
    },
    async postCollabMessage(roomId, body, files = []) {
      const text = body.trim() || `파일 ${files.length}개: ${files.map(f => f.name).join(', ')}`
      return must(await sb.from('collab_messages').insert({ room_id: roomId, body: text.slice(0, 4000), files }).select(MSG_COLS).single()) as CollabMessage
    },
    async hideCollabMessage(id) {
      must(await sb.from('collab_messages').update({ deleted_at: new Date().toISOString() }).eq('id', id))
    },
    createCollabRoom: (projectId, title, intro) => fn('create_room', { project_id: projectId, title, intro }, '방을 만들지 못했습니다.'),
    async updateCollabRoom(id, patch) {
      must(await sb.from('collab_rooms').update(patch).eq('id', id))
    },
    inviteCollabGuest: (roomId, g) => fn('invite', { room_id: roomId, ...g }, '초대하지 못했습니다.'),
    async relinkCollabGuest(guestId) {
      return (await fn<{ token: string }>('relink', { guest_id: guestId }, '링크를 만들지 못했습니다.')).token
    },
    async updateCollabGuest(id, patch) {
      must(await sb.from('collab_guests').update(patch).eq('id', id))
    },
    async listCollabLinks(roomId) {
      return (await fn<{ links: CollabLink[] }>('links', { room_id: roomId }, '기기 목록을 불러오지 못했습니다.')).links
    },
    async revokeCollabLink(roomId, linkId) {
      await fn('revoke_link', { room_id: roomId, link_id: linkId }, '기기를 끊지 못했습니다.')
    },
    async ensureCollabFolder(roomId) {
      return (await fn<{ folder_id: string | null }>('folder', { room_id: roomId }, '드라이브 폴더를 만들지 못했습니다.')).folder_id
    },
    listCollabFiles: roomId => fn('files', { room_id: roomId }, '자료 목록을 불러오지 못했습니다.'),
    async collabUploadStart(roomId, f) {
      return (await fn<{ url: string }>('upload', { room_id: roomId, ...f }, '올리기 주소를 만들지 못했습니다.')).url
    },
    async collabUploaded(roomId, fileId) {
      return (await fn<{ file: CollabFileRef }>('uploaded', { room_id: roomId, file_id: fileId }, '올린 파일을 기록하지 못했습니다.')).file
    },
    async collabFileUrl(roomId, fileId, inline = false) {
      return (await fn<{ url: string }>('ticket', { room_id: roomId, file_id: fileId, inline }, '받기 주소를 만들지 못했습니다.')).url
    },
    async saveCollabEvent(e) {
      const row = { kind: e.kind, title: e.title.trim(), day: e.day, end_day: e.end_day || null, start_time: e.start_time || null, place: e.place?.trim() || null, note: e.note?.trim() || null }
      if (e.id) return must(await sb.from('collab_events').update(row).eq('id', e.id).select(EVENT_COLS).single()) as CollabEvent
      return must(await sb.from('collab_events').insert({ ...row, room_id: e.room_id }).select(EVENT_COLS).single()) as CollabEvent
    },
    async deleteCollabEvent(id) {
      must(await sb.from('collab_events').delete().eq('id', id))
    },
  }
}

/** 체험 모드: 외부 협업방은 운영 계정에서만 (자료를 두지 않음) */
export function createDemoCollabApi(): CollabApi {
  const none = async (): Promise<never> => {
    throw new ApiError('외부 협업방은 운영 계정에서만 쓸 수 있습니다.')
  }
  return {
    async listCollab() {
      return { rooms: [], guests: [], events: [] }
    },
    async listCollabMessages() {
      return []
    },
    postCollabMessage: none,
    hideCollabMessage: none,
    createCollabRoom: none,
    updateCollabRoom: none,
    inviteCollabGuest: none,
    relinkCollabGuest: none,
    updateCollabGuest: none,
    async listCollabLinks() {
      return []
    },
    revokeCollabLink: none,
    ensureCollabFolder: none,
    async listCollabFiles() {
      return { folder: false, files: [] }
    },
    collabUploadStart: none,
    collabUploaded: none,
    collabFileUrl: none,
    saveCollabEvent: none,
    deleteCollabEvent: none,
  }
}
