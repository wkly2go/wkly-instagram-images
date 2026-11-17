// 외부 협업방 — 외부인 쪽 (로그인 없음 · 2026-11-17 · docs/EXTERNAL_COLLAB.md)
//  - 초대 링크(1회용)를 처음 연 기기가 '기기 열쇠'를 받아 이 브라우저에 저장 → 그 뒤로는 열쇠로만 서버 함수 collab 을 부름
//  - 같은 링크를 같은 기기에서 다시 열면 저장된 열쇠로 들어감 (링크 해시 앞 16자로 찾음 · 링크 자체는 저장하지 않음)
//  - DB 에 직접 접근하지 않음 (외부인은 테이블 권한이 없음)
import type { CollabEvent, CollabFileRef, CollabMessage, CollabRole } from './types'

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const STORE = 'wkly-collab-keys'

export interface GuestKey {
  room_id: string
  key: string
  /** 초대 링크 SHA-256 앞 16자 (같은 링크를 다시 열 때 찾기용) */
  invite: string
  title?: string
  saved_at: string
}
export interface GuestMe {
  id: string
  name: string
  org: string | null
  role: CollabRole
  can_upload: boolean
  read_upto: number
}
export interface GuestRoomInfo {
  id: string
  title: string
  intro: string | null
  company: string
  division: string
  project: { name: string; start_date: string | null; end_date: string | null }
  files: boolean
}
export interface GuestPeople {
  u: Record<string, { name: string; title: string | null; org: string }>
  g: Record<string, { name: string; org: string | null; role: string }>
}
export interface GuestSync {
  me: GuestMe
  messages: CollabMessage[]
  people: GuestPeople
  room?: GuestRoomInfo
  events?: CollabEvent[]
}
export interface GuestFile {
  id: string
  name: string
  mime: string
  size: number | null
  modified: string | null
  folder: string
  user_id: string | null
  guest_id: string | null
}

export class GuestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message)
  }
}

/** 이 브라우저가 열쇠를 저장할 수 있는지 (사생활 보호 창 · 일부 앱 안 브라우저는 못 함) */
export let keysPersist = true
let memoryKeys: GuestKey[] = []
export function loadKeys(): GuestKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]') as GuestKey[]
    return Array.isArray(v) ? v.filter(k => k && typeof k.key === 'string' && typeof k.room_id === 'string') : memoryKeys
  } catch {
    return memoryKeys
  }
}
function saveKeys(list: GuestKey[]) {
  memoryKeys = list
  try {
    localStorage.setItem(STORE, JSON.stringify(list))
    keysPersist = localStorage.getItem(STORE) != null
  } catch {
    keysPersist = false
  }
}
export function forgetKey(roomId: string) {
  saveKeys(loadKeys().filter(k => k.room_id !== roomId))
}
export function rememberTitle(roomId: string, title: string) {
  const list = loadKeys()
  const hit = list.find(k => k.room_id === roomId)
  if (hit && hit.title !== title) saveKeys(list.map(k => (k.room_id === roomId ? { ...k, title } : k)))
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
async function inviteTag(invite: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invite))).slice(0, 16)
}
export const INVITE_RE = /^[A-Za-z0-9_-]{43}$/

async function call<T>(action: string, body: Record<string, unknown>, key?: string): Promise<T> {
  if (!BASE) throw new GuestError('이 주소에서는 협업방을 열 수 없습니다.', 'config', 0)
  let r: Response
  try {
    r = await fetch(`${BASE}/functions/v1/collab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ANON ? { apikey: ANON } : {}), ...(key ? { 'x-collab-key': key } : {}) },
      body: JSON.stringify({ action, ...body, origin: window.location.origin }),
    })
  } catch {
    throw new GuestError('인터넷 연결을 확인해 주세요.', 'network', 0)
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!r.ok || j.error) throw new GuestError(j.error ?? '잠시 뒤에 다시 시도해 주세요.', j.code ?? 'error', r.status)
  return j as T
}

/** 초대 링크 열기: 이 기기에 이미 받은 열쇠가 있으면 그대로, 없으면 링크를 열쇠로 바꿈(링크는 그 자리에서 쓸모없어짐) */
export async function openInvite(invite: string): Promise<GuestKey> {
  const tag = await inviteTag(invite)
  const hit = loadKeys().find(k => k.invite === tag)
  if (hit) return hit
  const r = await call<{ key: string; room_id: string }>('redeem', { invite })
  const entry: GuestKey = { room_id: r.room_id, key: r.key, invite: tag, saved_at: new Date().toISOString() }
  saveKeys([entry, ...loadKeys().filter(k => k.room_id !== r.room_id)])
  return entry
}
/** 이 기기가 이 링크를 이미 열었는지 (팀원 기기 경고를 건너뛸지 판단) */
export async function inviteKnown(invite: string): Promise<boolean> {
  const tag = await inviteTag(invite)
  return loadKeys().some(k => k.invite === tag)
}

export const guestApi = {
  sync: (key: string, since: number, full: boolean) => call<GuestSync>('sync', { since, full }, key),
  post: (key: string, body: string, files: string[]) => call<{ message: CollabMessage }>('post', { body, files }, key),
  read: (key: string, upto: number) => call<{ ok: boolean }>('read', { upto }, key),
  files: (key: string) => call<{ folder: boolean; files: GuestFile[] }>('files', {}, key),
  async upload(key: string, file: File, onProgress?: (ratio: number) => void): Promise<CollabFileRef> {
    const mime = file.type || 'application/octet-stream'
    const { url } = await call<{ url: string }>('upload', { name: file.name, mime, size: file.size }, key)
    const id = await putResumable(url, file, onProgress)
    return (await call<{ file: CollabFileRef }>('uploaded', { file_id: id }, key)).file
  },
  ticket: async (key: string, fileId: string, inline = false) => (await call<{ url: string }>('ticket', { file_id: fileId, inline }, key)).url,
}

/** 구글 이어 올리기 주소로 파일을 바로 올리고 드라이브 파일 id 를 돌려줌 (팀원 · 외부인 같이 씀) */
export function putResumable(url: string, file: File, onProgress?: (ratio: number) => void): Promise<string> {
  const mime = file.type || 'application/octet-stream'
  return new Promise<string>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.setRequestHeader('Content-Type', mime)
    x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total)
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        try {
          resolve((JSON.parse(x.responseText) as { id: string }).id)
        } catch {
          reject(new GuestError('올린 파일을 확인하지 못했습니다.', 'upload', x.status))
        }
      } else reject(new GuestError(`올리지 못했습니다 (${x.status})`, 'upload', x.status))
    }
    x.onerror = () => reject(new GuestError('인터넷이 끊겨 올리지 못했습니다.', 'network', 0))
    x.send(file)
  })
}

/** 이 기기에 인트라넷(팀원) 로그인이 있는지 — 팀원이 초대 링크를 직접 열면 외부인이 못 쓰게 되므로 먼저 묻기 */
export function staffSignedIn(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (/^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true
    }
  } catch {
    /* 저장소를 못 읽으면 경고 없이 */
  }
  return false
}
