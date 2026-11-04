// 회사 구글 드라이브 연동 (대표 지시 2026-10-21)
//  - "구글 계정은 회사 계정을 모두 공유" → 관리자가 한 번 회사 계정을 연결하면 서버가 그 계정으로 폴더를 만듦 (PC 프로그램 · 웹 모두)
//  - "현재 구글 드라이브에 있는 자료는 절대 수정 · 삭제하면 안 되고, #2026 을 만들어서 저장"
//    → 내 드라이브 최상위 '#연도' / '#ARTERIOR_연도'(아트리어) · '#WKLY_연도'(더위클리 · 내부 리서치) / '연번_프로젝트 이름'
//    → 인트라넷이 만든 그 폴더들만 이름 · 위치를 고침. 그 밖의 폴더 · 파일은 읽기만 (삭제 기능 없음)
//    → 예외(2026-11-01): 수신방 맨 위에 넣은 파일만 수신방 안 분류 폴더로 옮김 · 프로젝트 폴더 파일은 바로가기만 만듦
//  - 2026-10-31 "#2026 폴더 제거하고 내용물은 기존 폴더에 저장해"
//    → 새 폴더는 내 드라이브 최상위의 기존 '#ARTERIOR_연도' · '#WKLY_연도' · '#RESEARCH_연도' 안에 '연번 이름' 으로 만듦 (#연도 상위 폴더 없음)
//    → 드라이브가 기준: 기존 폴더 이름은 인트라넷이 바꾸지 않고, 드라이브 이름을 인트라넷이 따라감
//  actions
//   - status            : 연결 여부 (팀원 누구나)
//   - connect {code}    : 관리자 · 구글 로그인 코드(팝업, redirect 'postmessage') → 갱신 토큰을 Vault 에 보관
//   - ensure {project_id}: 팀원 · 프로젝트 폴더 만들기 · 맞추기
//   - ensure_all        : 관리자 · 모든 프로젝트
//   - token             : 팀원 · 회사 계정 드라이브 접근 토큰(1시간) → 인트라넷 탐색기가 개인 구글 로그인 없이 회사 드라이브를 다룸
//                         ("구글 계정은 회사 계정을 모두 공유" 결정에 따름 · 갱신 토큰 · 비밀번호는 서버에만)
//   - sync              : 5분 예약(x-sync-key) · 관리자 · 프로젝트 폴더 안 파일 목록을 drive_index 에 맞춤 (드라이브는 읽기만)
//                         처음 · 하루 한 번은 전체 훑기, 그 사이엔 changes API 로 바뀐 것만
//                         + 새로 넣은 자료를 수신방에 분류 · 정리 (fileInbox)
//  필요한 값: app_settings.google_oauth_client_id (관리자 등록) · Vault GOOGLE_CLIENT_SECRET (대표가 직접 등록)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

const FOLDER = 'application/vnd.google-apps.folder'
const YEAR_RE = /^#\d{4}$/
const ROOT_RE = /^#(ARTERIOR|WKLY|RESEARCH)_\d{4}$/
const DRIVE = 'https://www.googleapis.com/drive/v3'

class NotConnected extends Error {}

async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function clientId(): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
  return typeof data?.value === 'string' ? data.value : null
}

let cached: { token: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const [id, sec, refresh] = await Promise.all([clientId(), secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (!id || !sec || !refresh) throw new NotConnected('회사 구글 계정이 아직 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new NotConnected(`구글 연결이 만료됐습니다. 관리자가 다시 연결해 주세요. (${body.error ?? r.status})`)
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cached.token
}

async function drive<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await accessToken()
  const r = await fetch(`${DRIVE}/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${t}` } })
  if (!r.ok) throw new Error(`드라이브 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

interface Meta { id: string; name: string; parents?: string[]; trashed?: boolean }
interface Proj { id: string; name: string; code: string | null; division: string | null; start_date: string | null; created_at: string; drive_url: string | null }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const yearOf = (p: Proj) => (p.start_date ?? p.created_at).slice(0, 4)
const groupName = (p: Proj) => {
  const d = p.division ?? p.code?.slice(0, 2) ?? 'AR'
  return `#${d === 'AR' ? 'ARTERIOR' : d === 'RS' ? 'RESEARCH' : 'WKLY'}_${yearOf(p)}`
}
const folderName = (p: Proj) => (p.code ? `${p.code} ${p.name}` : p.name).replace(/[\\/]/g, '·').trim()
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`
const idOf = (url: string) => url.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? url.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1] ?? null
const meta = (id: string) => drive<Meta>(`files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,parents,trashed`)

async function find(name: string, parent: string): Promise<Meta | null> {
  const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`
  const r = await drive<{ files?: Meta[] }>(`files?${new URLSearchParams({ q, fields: 'files(id,name,parents)', pageSize: '5' })}`)
  return r.files?.[0] ?? null
}
async function create(name: string, parent: string): Promise<Meta> {
  return drive<Meta>('files?fields=id,name,parents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })
}
/** 찾고 없으면 만들기만 (기존 폴더는 그대로) */
async function ensure(name: string, parent: string): Promise<string> {
  return ((await find(name, parent)) ?? (await create(name, parent))).id
}
async function groupFolder(p: Proj): Promise<string> {
  return ensure(groupName(p), 'root')
}
/** 예전에 인트라넷이 만든 폴더인지 (부모 #그룹_연도, 그 부모 #연도) → 부모 메타 · 이런 폴더만 기존 그룹 폴더로 옮김 */
async function managedParent(f: Meta): Promise<Meta | null> {
  if (!f.parents?.[0]) return null
  const parent = await meta(f.parents[0]).catch(() => null)
  if (!parent || !ROOT_RE.test(parent.name) || !parent.parents?.[0]) return null
  const top = await meta(parent.parents[0]).catch(() => null)
  return top && YEAR_RE.test(top.name) ? parent : null
}

async function syncProject(p: Proj): Promise<{ url: string; action: 'created' | 'linked' | 'renamed' | 'moved' | 'ok' }> {
  // 운영 칸(연번 끝 0000, 예: AR0000 경영업무)은 폴더를 만들지 않음 (대표 지시 2026-10-31 "만드는 자료가 없으면 모두 삭제해")
  if (!p.drive_url && p.code && /^[A-Z]{2}0000$/.test(p.code)) return { url: '', action: 'ok' }
  const want = folderName(p)
  const existing = p.drive_url ? idOf(p.drive_url) : null
  if (existing) {
    const f = await meta(existing).catch(() => null)
    const parent = f && !f.trashed ? await managedParent(f) : null
    if (!f || f.trashed || !parent) return { url: p.drive_url!, action: 'ok' } // 기존 드라이브 자료 · 볼 수 없는 폴더: 그대로
    const group = await groupFolder(p)
    const moving = parent.id !== group
    if (!moving && f.name === want) return { url: folderUrl(f.id), action: 'ok' }
    const qs = new URLSearchParams({ fields: 'id', ...(moving ? { addParents: group, removeParents: parent.id } : {}) })
    await drive(`files/${encodeURIComponent(f.id)}?${qs}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.name !== want ? { name: want } : {}) })
    return { url: folderUrl(f.id), action: moving ? 'moved' : 'renamed' }
  }
  const group = await groupFolder(p)
  if (p.code) {
    const q = `name contains '${esc(p.code)}' and mimeType = '${FOLDER}' and trashed = false and '${group}' in parents`
    const r = await drive<{ files?: Meta[] }>(`files?${new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5' })}`)
    const same = r.files?.find(f => new RegExp(`(^|[\\s_-])${p.code!.replace(/-/g, '\\-')}([\\s_]|$)`).test(f.name))
    if (same) return { url: folderUrl(same.id), action: 'linked' }
  }
  return { url: folderUrl((await create(want, group)).id), action: 'created' }
}
async function syncAndSave(p: Proj) {
  const r = await syncProject(p)
  if (r.url && r.url !== p.drive_url) await sb.from('projects').update({ drive_url: r.url }).eq('id', p.id)
  return r
}
const PROJ_COLS = 'id,name,code,division,start_date,created_at,drive_url'

// ---------------------------------------------------------------- 파일 목록 동기화 (읽기만)
interface DFile {
  id: string
  name: string
  mimeType?: string
  parents?: string[]
  trashed?: boolean
  webViewLink?: string
  iconLink?: string
  size?: string
  modifiedTime?: string
  lastModifyingUser?: { displayName?: string }
}
const F_FIELDS = 'id,name,mimeType,parents,trashed,webViewLink,iconLink,size,modifiedTime,lastModifyingUser(displayName)'
interface Row { id: string; project_id: string; name: string; mime_type: string | null; parent_id: string | null; path: string | null; url: string | null; icon_url: string | null; size: number | null; modified_at: string | null; modified_by: string | null; synced_at: string; first_seen_at?: string }
const toRow = (f: DFile, project: string, path: string, now: string): Row => ({
  id: f.id,
  project_id: project,
  name: f.name,
  mime_type: f.mimeType ?? null,
  parent_id: f.parents?.[0] ?? null,
  path: path || null,
  url: f.webViewLink ?? null,
  icon_url: f.iconLink ?? null,
  size: f.size ? Number(f.size) : null,
  modified_at: f.modifiedTime ?? null,
  modified_by: f.lastModifyingUser?.displayName ?? null,
  synced_at: now,
})
const MAX_PER_PROJECT = 2000
const MAX_DEPTH = 5

async function upsertRows(rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('drive_index').upsert(rows.slice(i, i + 500))
    if (error) throw new Error(`목록 저장 실패: ${error.message}`)
  }
}

/**
 * 드라이브가 기준 (대표 지시 2026-10-31 "인트라넷은 구글 드라이브에 연동돼야 해"):
 * 프로젝트 폴더 이름이 바뀌면 인트라넷 프로젝트 이름도 따라감.
 * 앞의 상태 표시(-대기- 등)와 연번(AR2609 · AR2609-03_)은 빼고 이름만 씀. 드라이브는 읽기만.
 */
const nameFromFolder = (title: string) =>
  title
    .trim()
    .replace(/^-[^-\s]{1,8}-\s*/, '')
    .replace(/^[A-Z]{2}\d{4}(-\d{1,3})?[_\s]+/, '')
    .trim()
async function pullName(projectId: string, folderTitle: string) {
  const name = nameFromFolder(folderTitle)
  if (!name || name.length > 200) return
  await sb.from('projects').update({ name, updated_at: new Date().toISOString() }).eq('id', projectId).neq('name', name)
}

/** 프로젝트 폴더 전체 훑기: 하위 폴더까지 (깊이 · 개수 제한) → 없어진 파일은 목록에서 뺌 */
/** old = 처음 연결된 폴더: 그 안 기존 파일은 '새로 넣은 자료'가 아님 (수신방 정리 대상에서 뺌) */
async function scanProject(projectId: string, folderId: string, now: string, old = false): Promise<number> {
  const rows: Row[] = []
  const queue: [string, string, number][] = [[folderId, '', 0]]
  while (queue.length && rows.length < MAX_PER_PROJECT) {
    const [dir, path, depth] = queue.shift()!
    let pageToken: string | undefined
    do {
      const qs = new URLSearchParams({ q: `'${dir}' in parents and trashed = false`, fields: `nextPageToken,files(${F_FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })
      const r = await drive<{ nextPageToken?: string; files?: DFile[] }>(`files?${qs}`)
      for (const f of r.files ?? []) {
        rows.push(old ? { ...toRow(f, projectId, path, now), first_seen_at: '2000-01-01T00:00:00Z' } : toRow(f, projectId, path, now))
        if (f.mimeType === FOLDER && depth + 1 < MAX_DEPTH) queue.push([f.id, path ? `${path}/${f.name}` : f.name, depth + 1])
      }
      pageToken = r.nextPageToken
    } while (pageToken && rows.length < MAX_PER_PROJECT)
  }
  await upsertRows(rows)
  // 이번에 못 본 파일 = 지워졌거나 밖으로 옮겨짐 → 목록에서만 뺌 (드라이브는 건드리지 않음)
  if (rows.length < MAX_PER_PROJECT) await sb.from('drive_index').delete().eq('project_id', projectId).lt('synced_at', now)
  return rows.length
}

interface SyncState { token?: string; full_at?: string; folders?: string[] }
async function readState(): Promise<SyncState> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'gdrive_sync').maybeSingle()
  return (data?.value as SyncState | null) ?? {}
}
async function writeState(v: SyncState & { synced_at: string; files?: number; changed?: number }) {
  await sb.from('app_settings').upsert({ key: 'gdrive_sync', value: v, updated_at: new Date().toISOString() })
}

async function syncAll(force: boolean): Promise<{ mode: 'full' | 'changes'; files: number; changed: number }> {
  const now = new Date().toISOString()
  const { data } = await sb.from('projects').select('id,drive_url').not('drive_url', 'is', null)
  const folders = new Map<string, string>() // 드라이브 폴더 id → 프로젝트 id
  for (const p of (data ?? []) as { id: string; drive_url: string }[]) {
    const id = idOf(p.drive_url)
    if (id) folders.set(id, p.id)
  }
  const state = await readState()
  const fullDue = force || !state.token || !state.full_at || Date.now() - new Date(state.full_at).getTime() > 24 * 3600_000
  if (fullDue) {
    // 시작 표시를 먼저 받아 두면 훑는 동안 바뀐 것도 다음 번에 잡힘
    const start = await drive<{ startPageToken: string }>('changes/startPageToken?supportsAllDrives=true')
    let files = 0
    const known = new Set(state.folders ?? [])
    // 상태를 먼저 저장: 함수 제한 시간에 끊겨도 다음 번엔 바뀐 것만 훑음 (예전엔 매번 전체 훑기에서 끊겨 상태가 저장되지 않았음)
    await writeState({ token: start.startPageToken, full_at: now, folders: [...folders.keys()], synced_at: now, files: 0, changed: 0 })
    for (const [folder, project] of folders) {
      files += await scanProject(project, folder, now, !known.has(folder)).catch(() => 0)
      const meta = await drive<DFile>(`files/${encodeURIComponent(folder)}?supportsAllDrives=true&fields=id,name,trashed`).catch(() => null)
      if (meta && !meta.trashed) await pullName(project, meta.name).catch(() => undefined)
    }
    // 연결이 끊긴 프로젝트(폴더 주소가 바뀌거나 지워짐)의 예전 목록 정리
    const keep = [...folders.values()]
    if (keep.length) await sb.from('drive_index').delete().not('project_id', 'in', `(${keep.join(',')})`)
    await writeState({ token: start.startPageToken, full_at: now, folders: [...folders.keys()], synced_at: now, files, changed: 0 })
    return { mode: 'full', files, changed: 0 }
  }

  // 새로 연결된 프로젝트 폴더는 바로 전체 훑기
  const seen = new Set(state.folders ?? [])
  let added = 0
  for (const [folder, project] of folders)
    if (!seen.has(folder)) {
      added += await scanProject(project, folder, now, true).catch(() => 0)
      seen.add(folder)
    }

  // 바뀐 것만: 각 파일의 부모를 거슬러 올라가 어느 프로젝트 폴더 안인지 찾음
  const where = new Map<string, { project: string; path: string } | null>()
  for (const [f, p] of folders) where.set(f, { project: p, path: '' })
  const locate = async (parent: string | undefined, depth = 0): Promise<{ project: string; path: string } | null> => {
    if (!parent || depth > MAX_DEPTH) return null
    if (where.has(parent)) return where.get(parent)!
    const known = await sb.from('drive_index').select('project_id,path,name,mime_type').eq('id', parent).maybeSingle()
    if (known.data && known.data.mime_type === FOLDER) {
      const v = { project: known.data.project_id as string, path: [known.data.path, known.data.name].filter(Boolean).join('/') }
      where.set(parent, v)
      return v
    }
    const m = await drive<DFile>(`files/${encodeURIComponent(parent)}?supportsAllDrives=true&fields=id,name,parents`).catch(() => null)
    const up = m ? await locate(m.parents?.[0], depth + 1) : null
    const v = up && m ? { project: up.project, path: up.path ? `${up.path}/${m.name}` : m.name } : null
    where.set(parent, v)
    return v
  }
  let token = state.token!
  let changed = 0
  const rows: Row[] = []
  const gone: string[] = []
  for (let guard = 0; guard < 20; guard++) {
    const qs = new URLSearchParams({ pageToken: token, fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${F_FIELDS}))`, pageSize: '1000', includeRemoved: 'true', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
    const r = await drive<{ nextPageToken?: string; newStartPageToken?: string; changes?: { fileId: string; removed?: boolean; file?: DFile }[] }>(`changes?${qs}`)
    for (const c of r.changes ?? []) {
      // 프로젝트 폴더 자체의 이름이 바뀌었으면 프로젝트 이름도
      if (!c.removed && c.file && !c.file.trashed && folders.has(c.fileId)) {
        await pullName(folders.get(c.fileId)!, c.file.name).catch(() => undefined)
        continue
      }
      if (c.removed || !c.file || c.file.trashed) {
        gone.push(c.fileId)
        continue
      }
      const at = await locate(c.file.parents?.[0])
      if (at) {
        rows.push(toRow(c.file, at.project, at.path, now))
        // 폴더가 새로 들어왔으면 그 안 파일 위치도 바로 알 수 있게
        if (c.file.mimeType === FOLDER) where.set(c.file.id, { project: at.project, path: at.path ? `${at.path}/${c.file.name}` : c.file.name })
      } else gone.push(c.fileId) // 프로젝트 폴더 밖으로 옮겨짐
    }
    changed += r.changes?.length ?? 0
    if (r.newStartPageToken) {
      token = r.newStartPageToken
      break
    }
    if (!r.nextPageToken) break
    token = r.nextPageToken
  }
  await upsertRows(rows)
  for (let i = 0; i < gone.length; i += 200) await sb.from('drive_index').delete().in('id', gone.slice(i, i + 200))
  await writeState({ ...state, token, folders: [...seen].filter(f => folders.has(f)), synced_at: now, changed })
  return { mode: 'changes', files: rows.length + added, changed }
}

// ---------------------------------------------------------------- 드라이브에 넣은 자료 → 수신방 (대표 지시 2026-11-01)
//  날짜별 폴더 (대표 지시 2026-11-01 "날짜별로 폴더를 만들어서 저장"): 수신방/<YYMMDD>/<연번 프로젝트>/<분류> · 못 찾으면 수신방/<YYMMDD>/미분류
//  ① 프로젝트 폴더에 새로 넣은 파일 → 수신방/<YYMMDD>/<연번 프로젝트>/<분류> 에 바로가기 (원본은 그대로)
//  ② 수신방 맨 위에 바로 넣은 파일 → 이름으로 프로젝트 · 거래처를 찾아 수신방/<YYMMDD>/<연번 프로젝트>/<분류> 로 옮김 (못 찾으면 미분류)
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const INBOX_FROM = '2026-11-01T00:00:00Z' // 이때부터 들어온 파일만 (예전 자료는 그대로)
const clean = (s: string, n = 80) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '·').replace(/\s+/g, ' ').trim().slice(0, n) || '이름 없음'
const kindOf = (name: string, mime: string | null): string => {
  if (/세금\s?계산서|tax\s?invoice/i.test(name)) return '세금계산서'
  if (/계약서|계약|약정|agreement|contract/i.test(name)) return '계약서'
  if (/견적|quotation|estimate|quote|실행\s?율|실행\s?내역/i.test(name)) return '견적서'
  if (/도면|평면|입면|단면|상세도|\.(dwg|dxf)$/i.test(name)) return '도면'
  if (/일정|스케줄|schedule|공정표/i.test(name)) return '일정표'
  if ((mime ?? '').startsWith('image/') || (mime ?? '').startsWith('video/')) return '사진'
  return '첨부'
}
const fcache = new Map<string, string>()
async function sub(name: string, parent: string): Promise<string> {
  const k = `${parent}/${name}`
  if (!fcache.has(k)) fcache.set(k, await ensure(name, parent))
  return fcache.get(k)!
}
async function inboxRoot(): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'mail_inbox_folder').maybeSingle()
  if (typeof data?.value === 'string' && data.value) return data.value
  const id = await ensure('수신방', 'root')
  await sb.from('app_settings').upsert({ key: 'mail_inbox_folder', value: id, updated_at: new Date().toISOString() })
  return id
}
interface PInfo { id: string; code: string | null; name: string; client_id: string | null; client: string | null; drive_url: string | null }
let pinfo: PInfo[] | null = null
async function projectsInfo(): Promise<PInfo[]> {
  if (pinfo) return pinfo
  const { data } = await sb.from('projects').select('id,code,name,client_id,drive_url,clients(name)')
  pinfo = ((data ?? []) as unknown as (Omit<PInfo, 'client'> & { clients: { name: string } | null })[]).map(p => ({ ...p, client: p.clients?.name ?? null }))
  return pinfo
}
const projFolderName = (p: PInfo) => clean(p.code ? `${p.code} ${p.name}` : p.name, 70)
/** 파일 이름으로 프로젝트 찾기: 연번 → 프로젝트 이름 → 거래처 이름 (하나만 맞을 때) */
async function guessProject(name: string): Promise<PInfo | null> {
  const ps = await projectsInfo()
  const norm = (s: string) => s.replace(/\s|_|-|·/g, '').toLowerCase()
  const n = norm(name)
  const code = name.match(/[A-Z]{2}\d{4}(-\d{1,3})?/)?.[0]
  if (code) {
    const hit = ps.filter(p => p.code === code)
    if (hit.length === 1) return hit[0]
  }
  const byName = ps.filter(p => norm(p.name).length >= 4 && n.includes(norm(p.name)))
  if (byName.length === 1) return byName[0]
  const words = ps.filter(p => p.name.split(/\s+/).some(w => w.length >= 3 && n.includes(norm(w))))
  if (words.length === 1) return words[0]
  const byClient = ps.filter(p => p.client && norm(p.client).length >= 2 && n.includes(norm(p.client.replace(/㈜|\(주\)|주식회사/g, ''))))
  return byClient.length === 1 ? byClient[0] : null
}
async function projectInbox(p: PInfo): Promise<string | null> {
  const root = p.drive_url ? idOf(p.drive_url) : null
  if (!root) return null
  const talk = await find('01.협의자료', root).catch(() => null)
  return talk ? sub('01.수신', talk.id).catch(() => null) : null
}
async function shortcutTo(target: string, name: string, parent: string) {
  await drive('files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: SHORTCUT, parents: [parent], shortcutDetails: { targetId: target } }) })
}
const today6 = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '')

async function fileInbox(deadline: number): Promise<{ filed: number; sorted: number }> {
  const root = await inboxRoot()
  let filed = 0
  let sorted = 0
  // ② 수신방 맨 위에 넣은 파일 → 분리해서 옮김
  const top = await drive<{ files?: DFile[] }>(`files?${new URLSearchParams({ q: `'${root}' in parents and trashed = false and mimeType != '${FOLDER}' and mimeType != '${SHORTCUT}'`, fields: `files(${F_FIELDS})`, pageSize: '50' })}`).catch(() => ({ files: [] as DFile[] }))
  for (const f of top.files ?? []) {
    if (Date.now() > deadline) break
    const p = await guessProject(f.name)
    const kind = kindOf(f.name, f.mimeType ?? null)
    const dest = p ? await sub(kind, await sub(projFolderName(p), await sub(today6(), root))) : await sub('미분류', await sub(today6(), root))
    await drive(`files/${encodeURIComponent(f.id)}?addParents=${dest}&removeParents=${root}&supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (p) {
      const inbox = await projectInbox(p)
      if (inbox) await shortcutTo(f.id, `${today6()}_${f.name}`, inbox).catch(() => undefined)
      await sb.from('mail_files').upsert(
        { source: 'drive', source_file_id: f.id, name: f.name, mime: f.mimeType ?? null, size: f.size ? Number(f.size) : null, kind, vendor: p.client ?? '거래처 미정', client_id: p.client_id, project_ids: [p.id], drive_file_id: f.id, drive_url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`, folder_id: dest, sent_at: f.modifiedTime ?? new Date().toISOString() },
        { onConflict: 'source_file_id', ignoreDuplicates: true },
      )
    }
    sorted++
  }
  // ① 프로젝트 폴더에 새로 넣은 파일 → 수신방에 바로가기
  const { data: done } = await sb.from('mail_files').select('source_file_id').eq('source', 'drive').gte('created_at', INBOX_FROM)
  const seen = new Set((done ?? []).map(r => r.source_file_id as string))
  const { data: fresh } = await sb
    .from('drive_index')
    .select('id,project_id,name,mime_type,path,url,size,modified_at,first_seen_at')
    .gte('first_seen_at', INBOX_FROM)
    .not('mime_type', 'in', `("${FOLDER}","${SHORTCUT}")`)
    .order('first_seen_at', { ascending: true })
    .limit(200)
  const ps = await projectsInfo()
  type Fresh = { id: string; project_id: string; name: string; mime_type: string | null; path: string | null; url: string | null; size: number | null; modified_at: string | null; first_seen_at: string }
  const rows = (fresh ?? []) as Fresh[]
  // 다른 프로젝트 폴더에 먼저 있던 파일(이름 · 크기 같음)을 복사해 넣은 것 → 이 프로젝트 수신 자료로 올리지 않음
  // (2026-11-01 로제코 폴더에 나름대로 실행내역 사본이 들어가 로제코 수신방에 나름대로 자료가 보인 일)
  const names = [...new Set(rows.filter(f => !seen.has(f.id)).map(f => f.name))]
  const earlier = new Map<string, { project_id: string; size: number | null; first_seen_at: string }[]>()
  for (let i = 0; i < names.length; i += 100) {
    const { data: same } = await sb.from('drive_index').select('name,project_id,size,first_seen_at').in('name', names.slice(i, i + 100))
    for (const r of (same ?? []) as { name: string; project_id: string; size: number | null; first_seen_at: string }[]) earlier.set(r.name, [...(earlier.get(r.name) ?? []), r])
  }
  const copiedFromOther = (f: Fresh) =>
    (earlier.get(f.name) ?? []).some(o => o.project_id !== f.project_id && o.size === f.size && Date.parse(o.first_seen_at) < Date.parse(f.first_seen_at))
  for (const f of rows) {
    if (Date.now() > deadline || filed >= 40) break
    if (seen.has(f.id)) continue
    if (/^01\.협의자료\/01\.수신/.test(f.path ?? '')) continue // 메일에서 온 바로가기 자리
    if (copiedFromOther(f)) continue
    const p = ps.find(x => x.id === f.project_id)
    if (!p) continue
    const kind = kindOf(f.name, f.mime_type)
    const vendor = clean(p.client ?? '거래처 미정', 60)
    const day = new Date(Date.parse(f.first_seen_at) + 9 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '')
    const dest = await sub(kind, await sub(projFolderName(p), await sub(day, root)))
    // 기록을 먼저 남기고(한 번만) 바로가기 → 같은 파일에 바로가기가 두 번 생기지 않게
    const { data: ins, error } = await sb.from('mail_files').upsert(
      { source: 'drive', source_file_id: f.id, name: f.name, mime: f.mime_type, size: f.size, kind, vendor, client_id: p.client_id, project_ids: [p.id], drive_file_id: f.id, drive_url: f.url ?? `https://drive.google.com/file/d/${f.id}/view`, folder_id: dest, sent_at: f.modified_at ?? new Date().toISOString() },
      { onConflict: 'source_file_id', ignoreDuplicates: true },
    ).select('id')
    if (error || !ins?.length) continue
    await shortcutTo(f.id, f.name, dest).catch(() => undefined)
    filed++
  }
  return { filed, sorted }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  // 5분 예약 실행 (DB cron → x-sync-key)
  const syncKey = req.headers.get('x-sync-key')
  if (syncKey) {
    const want = await secret('GDRIVE_SYNC_KEY')
    if (!want || syncKey !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
    try {
      // 수신방 정리를 먼저 (짧게) → 그다음 목록 동기화 (오래 걸릴 수 있음)
      const inbox = await fileInbox(Date.now() + 40_000).catch(e => ({ error: e instanceof Error ? e.message : '수신방 정리 실패' }))
      const r = await syncAll(false)
      return json({ ...r, inbox })
    } catch (e) {
      if (e instanceof NotConnected) return json({ error: e.message, not_connected: true }, 409)
      return json({ error: e instanceof Error ? e.message : '동기화 실패' }, 500)
    }
  }
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const [{ data: member }, { data: admin }] = await Promise.all([caller.rpc('is_active_member'), caller.rpc('is_admin')])
  if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
  const body = (await req.json().catch(() => ({}))) as { action?: string; code?: string; project_id?: string; full?: boolean }

  try {
    if (body.action === 'status') {
      const [id, sec, refresh, acct, sync] = await Promise.all([
        clientId(),
        secret('GOOGLE_CLIENT_SECRET'),
        secret('GOOGLE_DRIVE_REFRESH_TOKEN'),
        sb.from('app_settings').select('value').eq('key', 'google_drive_account').maybeSingle(),
        sb.from('app_settings').select('value').eq('key', 'gdrive_sync').maybeSingle(),
      ])
      const st = (sync.data?.value ?? null) as { synced_at?: string; full_at?: string } | null
      return json({ clientId: !!id, secret: !!sec, connected: !!refresh, account: (acct.data?.value as { email?: string } | null)?.email ?? null, syncedAt: st?.synced_at ?? null, fullAt: st?.full_at ?? null })
    }
    if (body.action === 'connect') {
      if (admin !== true) return json({ error: '관리자만 연결할 수 있습니다.' }, 403)
      const [id, sec] = await Promise.all([clientId(), secret('GOOGLE_CLIENT_SECRET')])
      if (!id) return json({ error: "먼저 '구글 로그인 연결'에 OAuth 클라이언트 ID를 등록해 주세요." }, 400)
      if (!sec) return json({ error: 'Supabase › Vault 에 GOOGLE_CLIENT_SECRET (OAuth 클라이언트 보안 비밀번호)을 먼저 넣어 주세요.' }, 400)
      if (!body.code) return json({ error: '구글 로그인 코드가 없습니다.' }, 400)
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: body.code, client_id: id, client_secret: sec, redirect_uri: 'postmessage', grant_type: 'authorization_code' }),
      })
      const tok = await r.json()
      if (!r.ok) return json({ error: `구글 연결 실패: ${tok.error_description ?? tok.error ?? r.status}` }, 400)
      if (!tok.refresh_token) return json({ error: '구글이 갱신 토큰을 주지 않았습니다. 구글 계정 › 보안 › 서드파티 앱 접근에서 이 앱을 지운 뒤 다시 연결해 주세요.' }, 400)
      const { error } = await sb.rpc('gdrive_secret_set', { p_name: 'GOOGLE_DRIVE_REFRESH_TOKEN', p_value: tok.refresh_token })
      if (error) return json({ error: `저장 실패: ${error.message}` }, 500)
      cached = { token: tok.access_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 }
      const about = await drive<{ user?: { emailAddress?: string } }>('about?fields=user(emailAddress)').catch(() => null)
      const email = about?.user?.emailAddress ?? null
      await sb.from('app_settings').upsert({ key: 'google_drive_account', value: { email, connected_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
      return json({ ok: true, account: email })
    }
    if (body.action === 'ensure') {
      if (!body.project_id) return json({ error: 'project_id 가 없습니다.' }, 400)
      const { data: p } = await sb.from('projects').select(PROJ_COLS).eq('id', body.project_id).maybeSingle()
      if (!p) return json({ error: '프로젝트를 찾지 못했습니다.' }, 404)
      return json(await syncAndSave(p as Proj))
    }
    if (body.action === 'token') {
      const token = await accessToken()
      return json({ token, expires_at: cached?.exp ?? Date.now() + 50 * 60_000 })
    }
    if (body.action === 'sync') {
      if (admin !== true) return json({ error: '관리자만 할 수 있습니다.' }, 403)
      // 수신방 정리를 먼저 (짧게) → 그다음 목록 동기화 (오래 걸릴 수 있음)
      const inbox = await fileInbox(Date.now() + 40_000).catch(e => ({ error: e instanceof Error ? e.message : '수신방 정리 실패' }))
      const r = await syncAll(body.full === true)
      return json({ ...r, inbox })
    }
    if (body.action === 'ensure_all') {
      if (admin !== true) return json({ error: '관리자만 할 수 있습니다.' }, 403)
      const { data } = await sb.from('projects').select(PROJ_COLS).order('code')
      const out = { made: 0, fixed: 0, fail: [] as string[] }
      for (const p of (data ?? []) as Proj[]) {
        try {
          const r = await syncAndSave(p)
          if (r.action === 'created' || r.action === 'linked') out.made++
          else if (r.action !== 'ok') out.fixed++
        } catch (e) {
          out.fail.push(`${p.code ?? ''} ${p.name}: ${e instanceof Error ? e.message : '오류'}`)
        }
      }
      return json(out)
    }
    return json({ error: '알 수 없는 작업입니다.' }, 400)
  } catch (e) {
    if (e instanceof NotConnected) return json({ error: e.message, not_connected: true }, 409)
    return json({ error: e instanceof Error ? e.message : '드라이브 작업 실패' }, 500)
  }
})
