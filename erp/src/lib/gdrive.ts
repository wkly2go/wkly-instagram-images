/**
 * 구글 드라이브 연동 (웹 브라우저): 구글 로그인 토큰 · 드라이브 API · 문서 편집 열기
 *  - 로그인은 Google Identity Services 토큰(관리자가 등록한 OAuth 클라이언트 ID). 토큰은 이 창(sessionStorage)에만, 1시간
 *  - 권한: 보기(drive.readonly) + 인트라넷에서 올린 파일(drive.file)
 *  - PC 프로그램은 프로그램 안 웹 칸에서 구글 드라이브 · 문서를 그대로 쓰므로 이 토큰이 필요 없음
 */
import { desktop } from './desktop'

export const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file'
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
}

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void
  callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
}
interface Gis {
  accounts: { oauth2: { initTokenClient: (o: object) => TokenClient; revoke: (t: string, cb?: () => void) => void } }
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

export function readToken(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { t: string; exp: number } | null
    return v && v.exp > Date.now() + 30_000 ? v.t : null
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
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ t: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }))
      } catch {
        /* 저장 못 해도 이번 화면에서는 씀 */
      }
      announce(r.access_token)
      resolve(r.access_token)
    }
    client.requestAccessToken({ prompt: '' })
  })
}

export function googleLogout() {
  const t = readToken()
  if (t) (window as unknown as { google?: Gis }).google?.accounts.oauth2.revoke(t)
  try {
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
    googleLogout()
    throw new DriveAuthError('구글 로그인이 만료됐습니다. 다시 로그인해 주세요.')
  }
  if (!r.ok) throw new Error(r.status === 403 ? '이 파일 · 폴더를 볼 권한이 없습니다.' : r.status === 404 ? '드라이브에서 찾지 못했습니다 (지워졌거나 권한 없음).' : `드라이브 오류 (${r.status})`)
  return (await r.json()) as T
}

export const FILE_FIELDS = 'id,name,mimeType,iconLink,webViewLink,modifiedTime,owners(displayName),shortcutDetails'

export function fileMeta(token: string, id: string) {
  return driveApi<GFile>(token, `files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS}`)
}

/** 드라이브 폴더에 파일 올리기 (drive.file 권한) */
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
