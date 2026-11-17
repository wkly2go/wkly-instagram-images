// 외부 협업방 서버 함수 (로드맵 2단계 · 2026-11-17 · docs/EXTERNAL_COLLAB.md)
//  - 외부인: 계정 없음. 초대 링크(1회용) → 기기 열쇠(헤더 x-collab-key). 열쇠가 가리키는 방 하나만 읽고 씀 (요청의 방 id 를 믿지 않음)
//  - 팀원: 로그인 토큰(활성 팀원) — 방 만들기 · 초대 · 링크 다시 · 기기 끊기 · 드라이브 자료
//  - 파일: 드라이브 <프로젝트>/01.협의자료/03.외부공유/<방 이름>. 올리기는 구글 이어 올리기 주소로 브라우저가 바로, 받기는 5분짜리 서명 표(?dl=)
//  - 기존 드라이브 자료는 고치거나 지우지 않음 (새 폴더 · 새 파일만) · 외부로 메일 · 메시지를 보내지 않음
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-collab-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const ORIGINS = /^(https:\/\/([a-z0-9-]+\.)?wkly-erp\.pages\.dev|http:\/\/localhost(:\d+)?)$/
const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const MAX_UPLOAD = 100 * 1024 * 1024
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|js|mjs|vbs|ps1|sh|jar|apk|app|dmg|pkg|lnk|hta)$/i
const COMPANY: Record<string, string> = { AR: '아트리어디자인스튜디오', TW: '더위클리컴퍼니', RS: '더위클리컴퍼니' }
const EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
}

class Fail extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message)
  }
}

// ── 열쇠 · 서명 ──────────────────────────────────────────────────────────
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const newToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)))
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/
let hkey: CryptoKey | null = null
async function hmac(s: string): Promise<string> {
  hkey ??= await crypto.subtle.importKey('raw', enc.encode(`${SERVICE}:collab-download`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', hkey, enc.encode(s))))
}
async function makeTicket(roomId: string, fileId: string, inline: boolean): Promise<string> {
  const base = `${fileId}.${roomId}.${Math.floor(Date.now() / 1000) + 300}.${inline ? 'v' : 'd'}`
  return `${URL_}/functions/v1/collab?dl=${base}.${await hmac(base)}`
}
async function readTicket(t: string): Promise<{ fileId: string; roomId: string; inline: boolean } | null> {
  const m = t.match(/^([A-Za-z0-9_-]{10,})\.([0-9a-f-]{36})\.(\d{10})\.([vd])\.([A-Za-z0-9_-]{43})$/)
  if (!m || Number(m[3]) * 1000 < Date.now()) return null
  const sig = await hmac(`${m[1]}.${m[2]}.${m[3]}.${m[4]}`)
  let d = sig.length ^ m[5].length
  for (let i = 0; i < Math.min(sig.length, m[5].length); i++) d |= sig.charCodeAt(i) ^ m[5].charCodeAt(i)
  return d === 0 ? { fileId: m[1], roomId: m[2], inline: m[4] === 'v' } : null
}

// ── 구글 드라이브 (회사 계정) ─────────────────────────────────────────────
let gtok: { v: string; until: number } | null = null
async function google(): Promise<string> {
  if (gtok && gtok.until > Date.now()) return gtok.v
  const sec = async (name: string) => {
    const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
    return typeof data === 'string' && data ? data : null
  }
  const { data: idRow } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
  const [secret, refresh] = await Promise.all([sec('GOOGLE_CLIENT_SECRET'), sec('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (typeof idRow?.value !== 'string' || !secret || !refresh) throw new Fail(503, '회사 구글 계정이 아직 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: idRow.value, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new Fail(503, `구글 연결이 만료됐습니다. (${body.error ?? r.status})`)
  gtok = { v: body.access_token as string, until: Date.now() + (Number(body.expires_in ?? 3600) - 300) * 1000 }
  return gtok.v
}
async function gd<T>(t: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${DRIVE}/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${t}` } })
  if (!r.ok) throw new Fail(502, `드라이브 오류 ${r.status}`)
  return (await r.json()) as T
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string, n = 120) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, n) || '이름 없음'
const ALL = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }
interface DFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[]; trashed?: boolean }
async function children(t: string, parent: string, onlyFolders = false): Promise<DFile[]> {
  const q = `'${parent}' in parents and trashed = false${onlyFolders ? ` and mimeType = '${FOLDER}'` : ''}`
  const r = await gd<{ files?: DFile[] }>(t, `files?${new URLSearchParams({ q, fields: 'files(id,name,mimeType,size,modifiedTime)', pageSize: '200', orderBy: 'modifiedTime desc', ...ALL })}`)
  return r.files ?? []
}
/** 하위 폴더 찾기 (맥에서 만든 폴더는 한글이 풀어쓴 형태라 글자 비교) · 없으면 만듦 */
async function folder(t: string, name: string, parent: string, skip: Set<string> = new Set()): Promise<string> {
  const same = (await children(t, parent, true)).find(f => f.name.normalize('NFC') === name.normalize('NFC') && !skip.has(f.id))
  if (same) return same.id
  return (await gd<{ id: string }>(t, 'files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id
}

// ── 방 · 프로젝트 ────────────────────────────────────────────────────────
interface Room { id: string; project_id: string; title: string; intro: string | null; drive_folder_id: string | null; closed_at: string | null; created_by: string | null }
interface Proj { id: string; name: string; code: string | null; division: string | null; drive_url: string | null; start_date: string | null; end_date: string | null; owner_id: string | null }
interface Guest { id: string; room_id: string; name: string; org: string | null; role: string; can_upload: boolean; expires_at: string; revoked_at: string | null; last_seen_at: string | null; read_upto: number; invited_by: string | null }
const ROOM_COLS = 'id,project_id,title,intro,drive_folder_id,closed_at,created_by'
async function roomOf(id: string): Promise<{ room: Room; proj: Proj }> {
  if (!UUID_RE.test(id)) throw new Fail(400, '방을 찾을 수 없습니다.')
  const { data: room } = await sb.from('collab_rooms').select(ROOM_COLS).eq('id', id).maybeSingle()
  if (!room) throw new Fail(404, '방을 찾을 수 없습니다.')
  const { data: proj } = await sb.from('projects').select('id,name,code,division,drive_url,start_date,end_date,owner_id').eq('id', room.project_id).single()
  return { room: room as Room, proj: proj as Proj }
}
/** 방 폴더: 01.협의자료/03.외부공유/<방 이름> (방마다 따로 · 다른 방이 쓰는 폴더는 다시 쓰지 않음) */
async function roomFolder(room: Room, proj: Proj): Promise<string | null> {
  if (room.drive_folder_id) return room.drive_folder_id
  const root = proj.drive_url?.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1]
  if (!root) return null
  const t = await google()
  const talk = await folder(t, '01.협의자료', root)
  const share = await folder(t, '03.외부공유', talk)
  const { data: used } = await sb.from('collab_rooms').select('drive_folder_id').eq('project_id', proj.id).not('drive_folder_id', 'is', null)
  const mine = await folder(t, clean(room.title, 80), share, new Set((used ?? []).map(r => r.drive_folder_id as string)))
  await sb.from('collab_rooms').update({ drive_folder_id: mine }).eq('id', room.id)
  room.drive_folder_id = mine
  return mine
}
/** 그 파일이 방 폴더(하위 2단계까지) 안에 있는지 — 드라이브 공유 설정은 보지도 바꾸지도 않음 */
async function inRoom(t: string, room: Room, fileId: string): Promise<DFile | null> {
  if (!room.drive_folder_id || !DRIVE_ID_RE.test(fileId)) return null
  const f = await gd<DFile>(t, `files/${fileId}?fields=id,name,mimeType,size,parents,trashed&supportsAllDrives=true`).catch(() => null)
  if (!f || f.trashed || f.mimeType === FOLDER || f.mimeType === SHORTCUT) return null
  let ps = f.parents ?? []
  for (let depth = 0; depth < 3 && ps.length; depth++) {
    if (ps.includes(room.drive_folder_id)) return f
    if (depth === 2) break
    ps = (await gd<{ parents?: string[] }>(t, `files/${ps[0]}?fields=parents&supportsAllDrives=true`).catch(() => null))?.parents ?? []
  }
  return null
}
async function listFiles(room: Room) {
  if (!room.drive_folder_id) return { folder: false, files: [] }
  const t = await google()
  const top = await children(t, room.drive_folder_id)
  const out: { id: string; name: string; mime: string; size: number | null; modified: string | null; folder: string }[] = []
  const push = (f: DFile, folderName: string) => out.push({ id: f.id, name: f.name, mime: f.mimeType, size: f.size ? Number(f.size) : null, modified: f.modifiedTime ?? null, folder: folderName })
  for (const f of top) if (f.mimeType !== FOLDER && f.mimeType !== SHORTCUT) push(f, '')
  for (const sub of top.filter(f => f.mimeType === FOLDER).slice(0, 12))
    for (const f of await children(t, sub.id)) if (f.mimeType !== FOLDER && f.mimeType !== SHORTCUT) push(f, sub.name)
  const { data: recs } = await sb.from('collab_files').select('drive_id,user_id,guest_id').eq('room_id', room.id)
  const by = new Map((recs ?? []).map(r => [r.drive_id as string, r]))
  return { folder: true, files: out.map(f => ({ ...f, user_id: by.get(f.id)?.user_id ?? null, guest_id: by.get(f.id)?.guest_id ?? null })) }
}
async function uploadSession(room: Room, proj: Proj, b: Record<string, unknown>, origin: string) {
  const name = clean(String(b.name ?? ''), 200)
  const size = Number(b.size)
  const mime = typeof b.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(b.mime) ? b.mime : 'application/octet-stream'
  if (!size || size < 0 || size > MAX_UPLOAD) throw new Fail(400, '파일은 100MB 까지 올릴 수 있습니다.')
  if (BLOCKED.test(name)) throw new Fail(400, '실행 파일은 올릴 수 없습니다.')
  const parent = await roomFolder(room, proj)
  if (!parent) throw new Fail(400, '이 프로젝트에 드라이브 폴더가 없어 파일을 올릴 수 없습니다.')
  const t = await google()
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ name, parents: [parent] }),
  })
  const url = r.ok ? r.headers.get('Location') : null
  if (!url) throw new Fail(502, `올리기 주소를 만들지 못했습니다 (${r.status})`)
  return { url, name }
}
async function recordUpload(room: Room, fileId: string, who: { user_id?: string; guest_id?: string }) {
  const t = await google()
  const f = await inRoom(t, room, fileId)
  if (!f || !(f.parents ?? []).includes(room.drive_folder_id!)) throw new Fail(400, '방 폴더에 올라간 파일이 아닙니다.')
  const meta = { id: f.id, name: f.name, mime: f.mimeType, size: f.size ? Number(f.size) : null }
  await sb.from('collab_files').upsert({ room_id: room.id, drive_id: f.id, name: f.name.slice(0, 250), mime: f.mimeType, size: meta.size, user_id: who.user_id ?? null, guest_id: who.guest_id ?? null }, { onConflict: 'room_id,drive_id', ignoreDuplicates: true })
  return meta
}
async function download(t: string, room: Room, fileId: string, inline: boolean): Promise<Response> {
  const f = await inRoom(t, room, fileId)
  if (!f) return json({ error: '받을 수 없는 파일입니다.' }, 404)
  const ex = EXPORT[f.mimeType]
  if (!ex && f.mimeType.startsWith('application/vnd.google-apps.')) return json({ error: '이 구글 문서는 받을 수 없습니다.' }, 415)
  const url = ex ? `${DRIVE}/files/${f.id}/export?mimeType=${encodeURIComponent(ex.mime)}` : `${DRIVE}/files/${f.id}?alt=media&supportsAllDrives=true`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } })
  if (!r.ok || !r.body) return json({ error: `파일을 가져오지 못했습니다 (${r.status})` }, 502)
  const name = ex ? `${f.name}${ex.ext}` : f.name
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const len = r.headers.get('Content-Length')
  const type = ex?.mime ?? f.mimeType ?? 'application/octet-stream'
  // 브라우저에서 바로 보기는 사진 · PDF 만 (올린 HTML · SVG 가 이 주소에서 실행되지 않게 나머지는 늘 내려받기)
  const show = inline && INLINE_OK.test(type)
  return new Response(r.body, {
    headers: {
      ...cors,
      'Content-Type': type,
      'Content-Disposition': `${show ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(type === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }),
      ...(len ? { 'Content-Length': len } : {}),
    },
  })
}

// ── 사람 · 알림 ─────────────────────────────────────────────────────────
const deviceOf = (ua: string) => {
  const app = /KAKAOTALK/i.test(ua) ? '카카오톡' : /NAVER/i.test(ua) ? '네이버' : /SamsungBrowser/i.test(ua) ? '삼성 인터넷' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? '크롬' : /Safari\//.test(ua) ? '사파리' : '브라우저'
  const os = /iPhone|iPad/.test(ua) ? '아이폰' : /Android/.test(ua) ? '안드로이드' : /Windows/.test(ua) ? '윈도' : /Mac OS X/.test(ua) ? '맥' : ''
  return [os, app].filter(Boolean).join(' · ').slice(0, 80)
}
async function people(userIds: string[], guestIds: string[], division: string | null) {
  const company = COMPANY[division ?? 'AR'] ?? COMPANY.AR
  const us = userIds.length ? ((await sb.from('profiles').select('id,name,title').in('id', userIds)).data ?? []) : []
  const gs = guestIds.length ? ((await sb.from('collab_guests').select('id,name,org,role').in('id', guestIds)).data ?? []) : []
  return {
    u: Object.fromEntries(us.map(u => [u.id as string, { name: (u.name as string) || '팀원', title: (u.title as string | null) ?? null, org: company }])),
    g: Object.fromEntries(gs.map(g => [g.id as string, { name: g.name as string, org: (g.org as string | null) ?? null, role: g.role as string }])),
  }
}
async function notifyStaff(room: Room, proj: Proj, guest: Guest, text: string) {
  const { data: mem } = await sb.from('project_members').select('profile_id').eq('project_id', proj.id)
  const ids = [...new Set([proj.owner_id, room.created_by, guest.invited_by, ...(mem ?? []).map(m => m.profile_id as string)].filter((x): x is string => !!x))]
  if (!ids.length) return
  const { data: staff } = await sb.from('profiles').select('id').in('id', ids).eq('active', true).not('is_agent', 'is', true)
  const title = `외부 협업방 · ${guest.name}${guest.org ? ` (${guest.org})` : ''}`.slice(0, 120)
  const rows = (staff ?? []).map(p => ({ user_id: p.id, kind: '멘션', title, body: `${room.title} — ${text}`.slice(0, 300), link: `/projects?id=${proj.id}&collab=${room.id}` }))
  if (rows.length) await sb.from('notifications').insert(rows)
}

// ── 외부인 ──────────────────────────────────────────────────────────────
async function guestOf(key: string) {
  if (!TOKEN_RE.test(key)) throw new Fail(401, '접속 정보가 없습니다. 받은 초대 링크로 다시 들어와 주세요.', 'bad')
  const { data: link } = await sb.from('collab_links').select('id,guest_id,revoked_at,last_seen_at').eq('session_hash', await sha(key)).maybeSingle()
  if (!link) throw new Fail(401, '이 기기의 접속 정보가 없습니다. 담당자에게 새 링크를 요청해 주세요.', 'bad')
  if (link.revoked_at) throw new Fail(403, '이 기기는 접속이 해제됐습니다. 담당자에게 문의해 주세요.', 'revoked')
  const { data: g } = await sb.from('collab_guests').select('*').eq('id', link.guest_id).single()
  const guest = g as Guest
  if (guest.revoked_at) throw new Fail(403, '접속이 해제됐습니다. 담당자에게 문의해 주세요.', 'revoked')
  if (Date.parse(guest.expires_at) < Date.now()) throw new Fail(403, '초대 기간이 끝났습니다. 담당자에게 문의해 주세요.', 'expired')
  const { room, proj } = await roomOf(guest.room_id)
  if (room.closed_at) throw new Fail(403, '이 협업방은 닫혔습니다.', 'closed')
  if (!guest.last_seen_at || Date.now() - Date.parse(guest.last_seen_at) > 60_000) {
    const now = new Date().toISOString()
    await Promise.all([sb.from('collab_guests').update({ last_seen_at: now }).eq('id', guest.id), sb.from('collab_links').update({ last_seen_at: now }).eq('id', link.id)])
  }
  return { guest, room, proj }
}

async function redeem(b: Record<string, unknown>, ua: string) {
  const invite = String(b.invite ?? '')
  if (!TOKEN_RE.test(invite)) throw new Fail(400, '초대 링크가 올바르지 않습니다.', 'bad')
  const h = await sha(invite)
  const { data: link } = await sb.from('collab_links').select('id,guest_id,invite_expires_at,revoked_at').eq('invite_hash', h).maybeSingle()
  if (!link) throw new Fail(410, '이미 사용했거나 없는 초대 링크입니다. 처음 연 기기에서 다시 열거나, 담당자에게 새 링크를 요청해 주세요.', 'used')
  if (link.revoked_at) throw new Fail(403, '취소된 초대 링크입니다.', 'revoked')
  if (Date.parse(link.invite_expires_at) < Date.now()) throw new Fail(410, '초대 링크 기간이 지났습니다. 담당자에게 새 링크를 요청해 주세요.', 'expired')
  const { data: g } = await sb.from('collab_guests').select('id,room_id,revoked_at,expires_at').eq('id', link.guest_id).single()
  if (!g || g.revoked_at) throw new Fail(403, '접속이 해제됐습니다. 담당자에게 문의해 주세요.', 'revoked')
  if (Date.parse(g.expires_at) < Date.now()) throw new Fail(403, '초대 기간이 끝났습니다.', 'expired')
  const { room } = await roomOf(g.room_id)
  if (room.closed_at) throw new Fail(403, '이 협업방은 닫혔습니다.', 'closed')
  const key = newToken()
  const now = new Date().toISOString()
  // 동시에 두 기기가 열어도 하나만 (초대 해시가 그대로일 때만 바꿈)
  const { data: won } = await sb.from('collab_links').update({ invite_hash: null, session_hash: await sha(key), redeemed_at: now, last_seen_at: now, device: deviceOf(ua) }).eq('id', link.id).eq('invite_hash', h).select('id')
  if (!won?.length) throw new Fail(410, '이미 사용한 초대 링크입니다.', 'used')
  await sb.from('collab_guests').update({ last_seen_at: now }).eq('id', g.id)
  return { key, room_id: g.room_id }
}

async function guestAction(action: string, b: Record<string, unknown>, key: string, origin: string) {
  const { guest, room, proj } = await guestOf(key)
  const me = { id: guest.id, name: guest.name, org: guest.org, role: guest.role, can_upload: guest.can_upload, read_upto: guest.read_upto }
  switch (action) {
    case 'sync': {
      const since = Math.max(0, Math.floor(Number(b.since) || 0))
      const q = sb.from('collab_messages').select('id,user_id,guest_id,body,files,created_at,deleted_at').eq('room_id', room.id)
      const { data: rows } = since ? await q.gt('id', since).order('id', { ascending: true }).limit(200) : await q.order('id', { ascending: false }).limit(150)
      const msgs = (since ? rows ?? [] : (rows ?? []).reverse()).map(m => (m.deleted_at ? { ...m, body: '', files: [] } : m))
      const full = !since || b.full === true
      const { data: ev } = full ? await sb.from('collab_events').select('id,kind,title,day,end_day,start_time,place,note,updated_at').eq('room_id', room.id).order('day').order('start_time', { nullsFirst: true }) : { data: null }
      const guestIds = [...new Set(msgs.map(m => m.guest_id).filter(Boolean))] as string[]
      let allGuests: string[] = guestIds
      if (full) {
        const { data: gs } = await sb.from('collab_guests').select('id').eq('room_id', room.id).is('revoked_at', null)
        allGuests = [...new Set([...guestIds, ...(gs ?? []).map(x => x.id as string)])]
      }
      const who = await people([...new Set(msgs.map(m => m.user_id).filter(Boolean))] as string[], allGuests, proj.division)
      return {
        me,
        messages: msgs,
        people: who,
        ...(full
          ? {
              room: { id: room.id, title: room.title, intro: room.intro, company: COMPANY[proj.division ?? 'AR'] ?? COMPANY.AR, division: proj.division ?? 'AR', project: { name: proj.name, start_date: proj.start_date, end_date: proj.end_date }, files: !!room.drive_folder_id || !!proj.drive_url },
              events: ev ?? [],
            }
          : {}),
      }
    }
    case 'post': {
      const text = String(b.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000)
      const ids = (Array.isArray(b.files) ? b.files : []).map(String).filter(x => DRIVE_ID_RE.test(x)).slice(0, 10)
      if (!text && !ids.length) throw new Fail(400, '내용을 적어 주세요.')
      const { count } = await sb.from('collab_messages').select('id', { count: 'exact', head: true }).eq('guest_id', guest.id).gt('created_at', new Date(Date.now() - 60_000).toISOString())
      if ((count ?? 0) >= 20) throw new Fail(429, '잠시 뒤에 다시 보내 주세요.')
      let files: { id: string; name: string; mime: string | null; size: number | null }[] = []
      if (ids.length) {
        const { data: recs } = await sb.from('collab_files').select('drive_id,name,mime,size').eq('room_id', room.id).in('drive_id', ids)
        files = (recs ?? []).map(r => ({ id: r.drive_id as string, name: r.name as string, mime: (r.mime as string) ?? null, size: (r.size as number) ?? null }))
        if (files.length !== ids.length) throw new Fail(400, '이 방에 올린 파일만 붙일 수 있습니다.')
      }
      const body = text || `파일 ${files.length}개: ${files.map(f => f.name).join(', ')}`.slice(0, 4000)
      const { data: msg, error } = await sb.from('collab_messages').insert({ room_id: room.id, guest_id: guest.id, user_id: null, body, files }).select('id,user_id,guest_id,body,files,created_at,deleted_at').single()
      if (error) throw new Fail(500, '보내지 못했습니다.')
      await sb.from('collab_guests').update({ read_upto: msg.id }).eq('id', guest.id)
      await notifyStaff(room, proj, guest, files.length && !text ? `파일 ${files.length}개를 올렸습니다` : text.slice(0, 140)).catch(() => undefined)
      return { message: msg }
    }
    case 'read': {
      const upto = Math.floor(Number(b.upto) || 0)
      if (upto > guest.read_upto) await sb.from('collab_guests').update({ read_upto: upto }).eq('id', guest.id)
      return { ok: true }
    }
    case 'files':
      return await listFiles(room)
    case 'upload':
      if (!guest.can_upload) throw new Fail(403, '이 방에서는 파일을 올릴 수 없습니다. 담당자에게 문의해 주세요.')
      return await uploadSession(room, proj, b, origin)
    case 'uploaded':
      if (!guest.can_upload) throw new Fail(403, '이 방에서는 파일을 올릴 수 없습니다.')
      return { file: await recordUpload(room, String(b.file_id ?? ''), { guest_id: guest.id }) }
    case 'ticket':
      if (!(await inRoom(await google(), room, String(b.file_id ?? '')))) throw new Fail(404, '받을 수 없는 파일입니다.')
      return { url: await makeTicket(room.id, String(b.file_id), b.inline === true) }
    default:
      throw new Fail(400, '알 수 없는 작업입니다.')
  }
}

// ── 팀원 ────────────────────────────────────────────────────────────────
async function staffOf(req: Request): Promise<string> {
  const a = req.headers.get('Authorization') ?? ''
  if (!a.startsWith('Bearer ')) throw new Fail(401, '로그인이 필요합니다.')
  const { data: u } = await sb.auth.getUser(a.slice(7))
  if (!u?.user) throw new Fail(401, '로그인이 필요합니다.')
  const { data: p } = await sb.from('profiles').select('active').eq('id', u.user.id).maybeSingle()
  if (!p?.active) throw new Fail(403, '팀원만 쓸 수 있습니다.')
  return u.user.id
}
const linkFor = async (guestId: string, uid: string, days: number) => {
  const token = newToken()
  const { error } = await sb.from('collab_links').insert({ guest_id: guestId, invite_hash: await sha(token), invite_expires_at: new Date(Date.now() + Math.min(14, days) * 86400e3).toISOString(), created_by: uid })
  if (error) throw new Fail(500, '링크를 만들지 못했습니다.')
  return token
}
async function staffAction(action: string, b: Record<string, unknown>, uid: string, origin: string) {
  if (action === 'create_room') {
    const pid = String(b.project_id ?? '')
    if (!UUID_RE.test(pid)) throw new Fail(400, '프로젝트를 골라 주세요.')
    const { data: proj } = await sb.from('projects').select('id,name,code,division,drive_url,start_date,end_date,owner_id').eq('id', pid).maybeSingle()
    if (!proj) throw new Fail(404, '프로젝트를 찾을 수 없습니다.')
    const title = clean(String(b.title ?? '') || `${proj.name} 협업방`, 80)
    const intro = typeof b.intro === 'string' && b.intro.trim() ? b.intro.trim().slice(0, 1000) : null
    const { data: room, error } = await sb.from('collab_rooms').insert({ project_id: pid, title, intro, created_by: uid }).select(ROOM_COLS).single()
    if (error || !room) throw new Fail(500, '방을 만들지 못했습니다.')
    let folderError: string | null = null
    await roomFolder(room as Room, proj as Proj).catch(e => (folderError = e instanceof Error ? e.message : String(e)))
    return { room, folder_error: folderError }
  }
  if (action === 'invite' || action === 'relink' || action === 'links' || action === 'revoke_link') {
    if (action === 'relink') {
      const gid = String(b.guest_id ?? '')
      if (!UUID_RE.test(gid)) throw new Fail(400, '사람을 골라 주세요.')
      const { data: g } = await sb.from('collab_guests').select('id,revoked_at,expires_at').eq('id', gid).maybeSingle()
      if (!g) throw new Fail(404, '사람을 찾을 수 없습니다.')
      if (g.revoked_at) throw new Fail(400, '접속이 해제된 사람입니다. 해제를 풀고 다시 만들어 주세요.')
      const left = Math.max(1, Math.ceil((Date.parse(g.expires_at) - Date.now()) / 86400e3))
      return { token: await linkFor(gid, uid, left) }
    }
    const { room } = await roomOf(String(b.room_id ?? ''))
    if (action === 'invite') {
      const name = String(b.name ?? '').trim().slice(0, 40)
      if (!name) throw new Fail(400, '이름을 적어 주세요.')
      const role = ['발주처', '협력사', '기타'].includes(String(b.role)) ? String(b.role) : '발주처'
      const days = Math.min(365, Math.max(1, Math.floor(Number(b.days) || 60)))
      const { data: g, error } = await sb.from('collab_guests').insert({ room_id: room.id, name, org: String(b.org ?? '').trim().slice(0, 60) || null, role, can_upload: b.can_upload !== false, expires_at: new Date(Date.now() + days * 86400e3).toISOString(), invited_by: uid }).select('*').single()
      if (error || !g) throw new Fail(500, '초대하지 못했습니다.')
      return { guest: g, token: await linkFor(g.id, uid, days) }
    }
    const { data: gs } = await sb.from('collab_guests').select('id').eq('room_id', room.id)
    const gids = (gs ?? []).map(g => g.id as string)
    if (action === 'revoke_link') {
      const lid = String(b.link_id ?? '')
      if (!UUID_RE.test(lid)) throw new Fail(400, '기기를 골라 주세요.')
      const { data: done } = await sb.from('collab_links').update({ revoked_at: new Date().toISOString(), invite_hash: null }).eq('id', lid).in('guest_id', gids.length ? gids : ['00000000-0000-0000-0000-000000000000']).select('id')
      if (!done?.length) throw new Fail(404, '기기를 찾을 수 없습니다.')
      return { ok: true }
    }
    if (!gids.length) return { links: [] }
    const { data: ls } = await sb.from('collab_links').select('id,guest_id,invite_hash,invite_expires_at,device,created_at,redeemed_at,last_seen_at,revoked_at').in('guest_id', gids).order('created_at', { ascending: false })
    return { links: (ls ?? []).map(({ invite_hash, ...l }) => ({ ...l, pending: !!invite_hash })) }
  }
  const { room, proj } = await roomOf(String(b.room_id ?? ''))
  switch (action) {
    case 'files':
      return await listFiles(room)
    case 'folder':
      return { folder_id: await roomFolder(room, proj) }
    case 'upload':
      return await uploadSession(room, proj, b, origin)
    case 'uploaded':
      return { file: await recordUpload(room, String(b.file_id ?? ''), { user_id: uid }) }
    case 'ticket':
      if (!(await inRoom(await google(), room, String(b.file_id ?? '')))) throw new Fail(404, '방 폴더 밖의 파일입니다.')
      return { url: await makeTicket(room.id, String(b.file_id), b.inline === true) }
    default:
      throw new Fail(400, '알 수 없는 작업입니다.')
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') {
      const t = await readTicket(new URL(req.url).searchParams.get('dl') ?? '')
      if (!t) return json({ error: '받기 주소가 만료됐습니다. 화면에서 다시 눌러 주세요.' }, 403)
      const { room } = await roomOf(t.roomId)
      return await download(await google(), room, t.fileId, t.inline)
    }
    if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(b.action ?? '')
    const o = String(b.origin ?? req.headers.get('Origin') ?? '')
    const origin = ORIGINS.test(o) ? o : ''
    if (action === 'redeem') return json(await redeem(b, req.headers.get('User-Agent') ?? ''))
    const key = req.headers.get('x-collab-key')
    if (key) return json(await guestAction(action, b, key, origin))
    return json(await staffAction(action, b, await staffOf(req), origin))
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message, code: e.code }, e.status)
    console.error(e)
    return json({ error: '잠시 뒤에 다시 시도해 주세요.' }, 500)
  }
})
