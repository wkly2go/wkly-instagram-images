/**
 * 구글 드라이브 연동 (웹 브라우저): 구글 로그인 토큰 · 드라이브 API · 문서 편집 열기
 *  - 로그인은 Google Identity Services 토큰(관리자가 등록한 OAuth 클라이언트 ID). 토큰은 이 창(sessionStorage)에만, 1시간
 *  - 권한: 드라이브 전체(drive) — 보기 · 이름 바꾸기 · 복사 · 휴지통 (대표 지시 2026-10-21 "드라이브 자료 수정 · 복사 · 삭제 가능하도록")
 *  - PC 프로그램은 프로그램 안 웹 칸에서 구글 드라이브 · 문서를 그대로 쓰므로 이 토큰이 필요 없음
 */
import { desktop } from './desktop'

export const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const TOKEN_KEY = 'wkly-gdrive-token'

export interface GFile {
  id: string
  name: string
  mimeType: string
  iconLink?: string
  webViewLink?: string
  modifiedTime?: string
  owners?: { displayName?: string }[]
  shortcutDetails?: { targetId?: string; targetMimeType?: string }
  parents?: string[]
  size?: string
}

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void
  callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient: (o: object) => TokenClient
      initCodeClient: (o: object) => { requestCode: () => void }
      revoke: (t: string, cb?: () => void) => void
    }
  }
}

// 회사 구글 계정이 서버에 연결돼 있으면 그 토큰(1시간)을 씀 → 개인 구글 로그인이 아예 필요 없음
let serverCache: { token: string | null; exp: number } | null = null
export async function serverDriveToken(get: () => Promise<{ token: string; expires_at: number } | null>): Promise<string | null> {
  if (serverCache && serverCache.exp > Date.now() + 60_000) return serverCache.token
  try {
    const r = await get()
    serverCache = r ? { token: r.token, exp: r.expires_at } : { token: null, exp: Date.now() + 5 * 60_000 }
  } catch {
    serverCache = { token: null, exp: Date.now() + 60_000 }
  }
  return serverCache.token
}

/** PC 프로그램(웹 칸으로 구글 화면을 그대로 띄움)인지 */
export const nativeGoogle = () => !!desktop()?.searchOpen

const gisReady = () =>
  new Promise<Gis>((resolve, reject) => {
    const g = (window as unknown as { google?: Gis }).google
    if (g?.accounts?.oauth2) return resolve(g)
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve((window as unknown as { google: Gis }).google)
    s.onerror = () => reject(new Error('구글 로그인을 불러오지 못했습니다.'))
    document.head.appendChild(s)
  })

const listeners = new Set<(t: string | null) => void>()
export const onTokenChange = (cb: (t: string | null) => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const announce = (t: string | null) => listeners.forEach(l => l(t))

// 구글 로그인은 한 번만 (대표 지시 2026-10-23): 토큰을 이 PC 브라우저에 보관(탭 · 재시작에도 유지)하고,
// 만료되면 다음 클릭 때 저절로 다시 받음(이미 허락했으므로 창이 바로 닫힘). '로그아웃'을 누를 때만 잊음
const REMEMBER_KEY = 'wkly-gdrive-remember'
const store = () => localStorage

export function readToken(): string | null {
  try {
    const v = JSON.parse(store().getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { t: string; exp: number; s?: string } | null
    // 예전(보기 전용) 권한으로 받은 토큰은 다시 로그인
    return v && v.s === DRIVE_SCOPES && v.exp > Date.now() + 30_000 ? v.t : null
  } catch {
    return null
  }
}

let client: TokenClient | null = null
/** 구글 로그인 창을 띄워 토큰을 받음 (이미 허락한 경우 창이 바로 닫힘) */
export async function googleLogin(clientId: string, email?: string | null): Promise<string> {
  const g = await gisReady()
  return new Promise((resolve, reject) => {
    client ??= g.accounts.oauth2.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPES, hint: email ?? undefined, hd: 'thewklyn.com', callback: () => undefined })
    client.callback = r => {
      if (!r.access_token) return reject(new Error('구글 로그인을 마치지 못했습니다.'))
      try {
        store().setItem(TOKEN_KEY, JSON.stringify({ t: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, s: DRIVE_SCOPES }))
        store().setItem(REMEMBER_KEY, JSON.stringify({ clientId, email: email ?? null }))
        scheduleRenew()
      } catch {
        /* 저장 못 해도 이번 화면에서는 씀 */
      }
      announce(r.access_token)
      resolve(r.access_token)
    }
    client.requestAccessToken({ prompt: '' })
  })
}

/** 관리자: 회사 구글 계정을 서버에 연결할 때 쓰는 1회용 코드 (팝업 · 오프라인 접근 허락) */
export async function googleConnectCode(clientId: string): Promise<string> {
  const g = await gisReady()
  return new Promise((resolve, reject) => {
    const c = g.accounts.oauth2.initCodeClient({
      client_id: clientId,
      // 드라이브 + 지메일 읽기 (2026-10-31 "지메일 연동해" · 메일은 읽기만, 보내지 않음)
      scope: `${DRIVE_SCOPES} https://www.googleapis.com/auth/gmail.readonly`,
      ux_mode: 'popup',
      access_type: 'offline',
      prompt: 'consent',
      callback: (r: { code?: string; error?: string }) => (r.code ? resolve(r.code) : reject(new Error('구글 연결을 마치지 못했습니다.'))),
      error_callback: () => reject(new Error('구글 연결 창이 닫혔습니다.')),
    })
    c.requestCode()
  })
}

/** 한 번 로그인한 PC: 토큰이 끝나면 다음 클릭(사용자 동작이라 창이 막히지 않음) 때 조용히 다시 받음 */
let renewArmed = false
export function scheduleRenew() {
  if (typeof window === 'undefined' || renewArmed) return
  let saved: { clientId: string; email: string | null } | null = null
  try {
    saved = JSON.parse(store().getItem(REMEMBER_KEY) ?? 'null')
  } catch {
    saved = null
  }
  if (!saved?.clientId) return
  const v = (() => {
    try {
      return JSON.parse(store().getItem(TOKEN_KEY) ?? 'null') as { exp: number } | null
    } catch {
      return null
    }
  })()
  const left = (v?.exp ?? 0) - Date.now() - 2 * 60_000
  const arm = () => {
    if (renewArmed) return
    renewArmed = true
    const once = () => {
      window.removeEventListener('pointerdown', once, true)
      renewArmed = false
      googleLogin(saved!.clientId, saved!.email).catch(() => undefined)
    }
    window.addEventListener('pointerdown', once, true)
  }
  if (left <= 0) arm()
  else window.setTimeout(arm, Math.min(left, 2 ** 31 - 1))
}
if (typeof window !== 'undefined') window.setTimeout(scheduleRenew, 1500)

export function googleLogout() {
  const t = readToken()
  if (t) (window as unknown as { google?: Gis }).google?.accounts.oauth2.revoke(t)
  try {
    store().removeItem(TOKEN_KEY)
    store().removeItem(REMEMBER_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 무시 */
  }
  announce(null)
}

export class DriveAuthError extends Error {}

/** 드라이브 API 호출 (401 이면 로그아웃 처리 후 DriveAuthError) */
export async function driveApi<T>(token: string, path: string, init?: RequestInit, base = 'https://www.googleapis.com/drive/v3'): Promise<T> {
  const r = await fetch(`${base}/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } })
  if (r.status === 401) {
    if (token === readToken()) googleLogout()
    else serverCache = null
    throw new DriveAuthError('구글 로그인이 만료됐습니다. 다시 로그인해 주세요.')
  }
  if (!r.ok) throw new Error(r.status === 403 ? '이 파일 · 폴더에 대한 권한이 없습니다 (소유자 · 편집자만 고치거나 지울 수 있음).' : r.status === 404 ? '드라이브에서 찾지 못했습니다 (지워졌거나 권한 없음).' : `드라이브 오류 (${r.status})`)
  return (await r.json()) as T
}

export const FILE_FIELDS = 'id,name,mimeType,iconLink,webViewLink,modifiedTime,owners(displayName),shortcutDetails'

export function fileMeta(token: string, id: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS}`)
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
/** 이름 바꾸기 */
export function renameFile(token: string, id: string, name: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS}`, { method: 'PATCH', ...json({ name }) })
}
/** 같은 폴더에 사본 만들기 */
export function copyFile(token: string, id: string, name: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}/copy?supportsAllDrives=true&fields=${FILE_FIELDS}`, { method: 'POST', ...json({ name }) })
}
/** 휴지통으로 (구글 드라이브 휴지통에서 30일 안에 되살릴 수 있음) */
export function trashFile(token: string, id: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, { method: 'PATCH', ...json({ trashed: true }) })
}

// ---------------------------------------------------------------- 탐색기 (2026-10-23 "윈도우 폴더와 똑같은 환경")
export const LIST_FIELDS = 'id,name,mimeType,iconLink,webViewLink,modifiedTime,owners(displayName),shortcutDetails,parents,size'

/** 폴더 안 전부 (페이지 넘겨 최대 1000개) */
export async function listChildren(token: string, folderId: string, opts: { foldersOnly?: boolean; driveId?: string } = {}): Promise<GFile[]> {
  const out: GFile[] = []
  let pageToken: string | undefined
  do {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false${opts.foldersOnly ? ` and mimeType = '${FOLDER_MIME}'` : ''}`
    const p = new URLSearchParams({ q, pageSize: '500', orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: `nextPageToken,files(${LIST_FIELDS})` })
    if (opts.driveId) (p.set('corpora', 'drive'), p.set('driveId', opts.driveId))
    else p.set('corpora', 'allDrives')
    if (pageToken) p.set('pageToken', pageToken)
    const r = await driveApi<{ files?: GFile[]; nextPageToken?: string }>(token, `files?${p}`)
    out.push(...(r.files ?? []))
    pageToken = r.nextPageToken
  } while (pageToken && out.length < 1000)
  return out
}
/** 새 폴더 */
export function newFolder(token: string, name: string, parent: string) {
  return driveApi<GFile>(token, `files?supportsAllDrives=true&fields=${LIST_FIELDS}`, { method: 'POST', ...json({ name, mimeType: FOLDER_MIME, parents: [parent] }) })
}
/** 옮기기 (잘라내기 → 붙여넣기 · 끌어다 놓기) */
export function moveFile(token: string, id: string, from: string, to: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&addParents=${encodeURIComponent(to)}&removeParents=${encodeURIComponent(from)}&fields=${LIST_FIELDS}`, { method: 'PATCH', ...json({}) })
}
/** 다른 폴더로 사본 (폴더는 안의 파일까지 차례로 · 최대 깊이 4) */
export async function copyInto(token: string, f: GFile, parent: string, name = f.name, depth = 0): Promise<void> {
  if (f.mimeType !== FOLDER_MIME) {
    await driveApi<GFile>(token, `files/${encodeURIComponent(f.id)}/copy?supportsAllDrives=true&fields=id`, { method: 'POST', ...json({ name, parents: [parent] }) })
    return
  }
  if (depth > 4) throw new Error('폴더가 너무 깊어 복사를 멈췄습니다 (4단계까지).')
  const made = await newFolder(token, name, parent)
  for (const c of await listChildren(token, f.id)) await copyInto(token, c, made.id, c.name, depth + 1)
}

/** 드라이브 폴더에 파일 올리기 */
export async function uploadToDrive(token: string, file: File, folderId: string | null): Promise<GFile> {
  const meta = { name: file.name, ...(folderId ? { parents: [folderId] } : {}) }
  const body = new FormData()
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
  body.append('file', file)
  return driveApi<GFile>(token, `files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`, { method: 'POST', body }, 'https://www.googleapis.com/upload/drive/v3')
}

/** 드라이브 · 문서 주소에서 파일(폴더) id */
export function driveIdOf(url: string): string | null {
  const m = url.match(/\/(?:d|folders|file\/d)\/([A-Za-z0-9_-]{10,})/) ?? url.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  return m?.[1] ?? null
}

/** 주소로 종류 짐작 (토큰 없을 때 아이콘 · 이름용) */
export function kindOfUrl(url: string): { mime: string; label: string } {
  if (/docs\.google\.com\/document\//.test(url)) return { mime: 'application/vnd.google-apps.document', label: '구글 문서' }
  if (/docs\.google\.com\/spreadsheets\//.test(url)) return { mime: 'application/vnd.google-apps.spreadsheet', label: '구글 시트' }
  if (/docs\.google\.com\/presentation\//.test(url)) return { mime: 'application/vnd.google-apps.presentation', label: '구글 슬라이드' }
  if (/docs\.google\.com\/forms\//.test(url)) return { mime: 'application/vnd.google-apps.form', label: '구글 설문' }
  if (/\/folders\//.test(url)) return { mime: FOLDER_MIME, label: '드라이브 폴더' }
  return { mime: 'application/octet-stream', label: '드라이브 파일' }
}

/** 구글 문서 · 시트 · 슬라이드면 편집 주소, 아니면 그대로 */
export function editUrl(url: string): string {
  const m = url.match(/^(https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+)/)
  return m ? `${m[1]}/edit` : url
}
/** 구글 문서 · 시트 · 슬라이드 · 설문 편집 주소인지 (인트라넷 안 편집 대상) */
export const isGoogleEditor = (url: string) => /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\//.test(url)
/** 인트라넷 안 편집 칸(iframe)에 넣을 주소: 편집기는 그대로, 그 밖의 드라이브 파일은 미리 보기 */
export function embedUrl(url: string): string | null {
  if (/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/create/.test(url)) return url
  if (isGoogleEditor(url)) return editUrl(url)
  return previewUrl(url)
}
/** 인트라넷 안에서 미리 보기 가능한 주소 (구글이 다른 화면 안에 넣는 것을 허용하는 preview) */
export function previewUrl(url: string): string | null {
  const m = url.match(/^(https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+)/)
  if (m) return `${m[1]}/preview`
  const id = driveIdOf(url)
  if (id && /drive\.google\.com\/(file|open)/.test(url)) return `https://drive.google.com/file/d/${id}/preview`
  return null
}

/* ------------------------------------------------------------------ */
/* 프로젝트 폴더 연동 (대표 지시 2026-10-21)                              */
/*  - 회사 구글 계정 하나를 모두 같이 씀 → 그 계정 드라이브에 정리          */
/*  - "현재 구글 드라이브에 있는 자료는 절대 수정 · 삭제하면 안 되고, #2026 을 만들어서 저장"   */
/*    → 인트라넷은 최상위에 새로 만든 '#연도' 폴더 안에서만 만들고 고침. 그 밖의 폴더 · 파일은 읽기만 */
/*  - 구조: #2026 / #ARTERIOR_2026 (아트리어) · #WKLY_2026 (더위클리 · 내부 리서치) / 연번_프로젝트 이름 */
/*    연도가 바뀌면 #2027 … 을 새로 만듦 (프로젝트 시작일 기준, 없으면 만든 날)                   */
/* ------------------------------------------------------------------ */
export const YEAR_RE = /^#\d{4}$/
export const ROOT_RE = /^#(ARTERIOR|WKLY)_\d{4}$/

const yearOf = (p: { start_date?: string | null; created_at?: string }) => (p.start_date ?? p.created_at ?? new Date().toISOString()).slice(0, 4)
export function projectRootName(p: { division?: string | null; code?: string | null; start_date?: string | null; created_at?: string }): string {
  const div = p.division ?? p.code?.slice(0, 2) ?? 'AR'
  return `#${div === 'AR' ? 'ARTERIOR' : 'WKLY'}_${yearOf(p)}`
}
export const projectFolderName = (p: { code?: string | null; name: string }) => (p.code ? `${p.code}_${p.name}` : p.name).replace(/[\\/]/g, '·').trim()
export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
interface FolderMeta { id: string; name: string; parents?: string[]; trashed?: boolean }

async function findFolder(token: string, name: string, parent: string): Promise<FolderMeta | null> {
  const cond = [`name = '${q(name)}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', `'${parent}' in parents`].join(' and ')
  const p = new URLSearchParams({ q: cond, fields: 'files(id,name,parents)', pageSize: '5' })
  const r = await driveApi<{ files?: FolderMeta[] }>(token, `files?${p}`)
  return r.files?.[0] ?? null
}
async function createFolder(token: string, name: string, parent: string): Promise<FolderMeta> {
  return driveApi<FolderMeta>(token, 'files?fields=id,name,parents', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    headers: { 'Content-Type': 'application/json' },
  })
}
const folderCache = new Map<string, string>()
/** 있으면 찾고 없으면 만듦 (만들기만 · 기존 폴더는 그대로) */
async function ensureFolder(token: string, name: string, parent: string): Promise<string> {
  const key = `${parent}/${name}`
  const hit = folderCache.get(key)
  if (hit) return hit
  const f = (await findFolder(token, name, parent)) ?? (await createFolder(token, name, parent))
  folderCache.set(key, f.id)
  return f.id
}
/** #2026 / #ARTERIOR_2026 처럼 인트라넷 전용 연도 · 그룹 폴더 */
async function ensureGroupFolder(token: string, p: Parameters<typeof projectRootName>[0]): Promise<string> {
  const year = await ensureFolder(token, `#${yearOf(p)}`, 'root')
  return ensureFolder(token, projectRootName(p), year)
}
const meta = (token: string, id: string) => driveApi<FolderMeta>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,parents,trashed`)
/** 인트라넷이 만든 폴더인지: 부모가 #ARTERIOR_연도 · #WKLY_연도 이고 그 부모가 내 드라이브 최상위의 #연도 */
async function isManaged(token: string, f: FolderMeta): Promise<FolderMeta | null> {
  const parentId = f.parents?.[0]
  if (!parentId) return null
  const parent = await meta(token, parentId).catch(() => null)
  if (!parent || !ROOT_RE.test(parent.name) || !parent.parents?.[0]) return null
  const top = await meta(token, parent.parents[0]).catch(() => null)
  return top && YEAR_RE.test(top.name) ? parent : null
}

/**
 * 프로젝트 폴더를 맞춤
 *  - 연결된 폴더가 없으면: #연도 / #그룹_연도 아래 '연번_이름' 폴더를 새로 만듦 (같은 연번 폴더가 이미 그 안에 있으면 연결만)
 *  - 연결된 폴더가 인트라넷이 만든 것(#연도 안)이면: 이름 · 그룹 폴더를 맞춤
 *  - 그 밖의 기존 폴더(사람이 정리한 드라이브)는 절대 건드리지 않음
 */
export async function ensureProjectFolder(
  token: string,
  p: { name: string; code?: string | null; division?: string | null; start_date?: string | null; created_at?: string; drive_url?: string | null },
): Promise<{ url: string; action: 'created' | 'linked' | 'renamed' | 'moved' | 'ok' }> {
  const want = projectFolderName(p)
  const existingId = p.drive_url ? driveIdOf(p.drive_url) : null
  if (existingId) {
    const f = await meta(token, existingId).catch(() => null)
    if (f && !f.trashed) {
      const parent = await isManaged(token, f)
      if (!parent) return { url: p.drive_url!, action: 'ok' } // 기존 드라이브 자료: 읽기만
      const groupId = await ensureGroupFolder(token, p)
      const moving = parent.id !== groupId
      if (!moving && f.name === want) return { url: folderUrl(f.id), action: 'ok' }
      const qs = new URLSearchParams({ fields: 'id', ...(moving ? { addParents: groupId, removeParents: parent.id } : {}) })
      await driveApi(token, `files/${encodeURIComponent(f.id)}?${qs}`, { method: 'PATCH', body: JSON.stringify(f.name !== want ? { name: want } : {}), headers: { 'Content-Type': 'application/json' } })
      return { url: folderUrl(f.id), action: moving ? 'moved' : 'renamed' }
    }
    return { url: p.drive_url!, action: 'ok' } // 휴지통에 있거나 볼 수 없는 폴더(다른 계정 · 공유 드라이브)도 그대로 둠
  }
  const groupId = await ensureGroupFolder(token, p)
  if (p.code) {
    const cond = [`name contains '${q(p.code)}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', `'${groupId}' in parents`].join(' and ')
    const r = await driveApi<{ files?: FolderMeta[] }>(token, `files?${new URLSearchParams({ q: cond, fields: 'files(id,name)', pageSize: '5' })}`)
    const same = r.files?.find(f => f.name.startsWith(`${p.code!}_`))
    if (same) return { url: folderUrl(same.id), action: 'linked' }
  }
  const made = await createFolder(token, want, groupId)
  return { url: folderUrl(made.id), action: 'created' }
}
