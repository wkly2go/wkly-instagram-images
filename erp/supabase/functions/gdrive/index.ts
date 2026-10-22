// 회사 구글 드라이브 연동 (대표 지시 2026-10-21)
//  - "구글 계정은 회사 계정을 모두 공유" → 관리자가 한 번 회사 계정을 연결하면 서버가 그 계정으로 폴더를 만듦 (PC 프로그램 · 웹 모두)
//  - "현재 구글 드라이브에 있는 자료는 절대 수정 · 삭제하면 안 되고, #2026 을 만들어서 저장"
//    → 내 드라이브 최상위 '#연도' / '#ARTERIOR_연도'(아트리어) · '#WKLY_연도'(더위클리 · 내부 리서치) / '연번_프로젝트 이름'
//    → 인트라넷이 만든 그 폴더들만 이름 · 위치를 고침. 그 밖의 폴더 · 파일은 읽기만 (삭제 기능 없음)
//  actions
//   - status            : 연결 여부 (팀원 누구나)
//   - connect {code}    : 관리자 · 구글 로그인 코드(팝업, redirect 'postmessage') → 갱신 토큰을 Vault 에 보관
//   - ensure {project_id}: 팀원 · 프로젝트 폴더 만들기 · 맞추기
//   - ensure_all        : 관리자 · 모든 프로젝트
//   - sync              : 5분 예약(x-sync-key) · 관리자 · 프로젝트 폴더 안 파일 목록을 drive_index 에 맞춤 (드라이브는 읽기만)
//                         처음 · 하루 한 번은 전체 훑기, 그 사이엔 changes API 로 바뀐 것만
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
const ROOT_RE = /^#(ARTERIOR|WKLY)_\d{4}$/
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
const groupName = (p: Proj) => `#${(p.division ?? p.code?.slice(0, 2) ?? 'AR') === 'AR' ? 'ARTERIOR' : 'WKLY'}_${yearOf(p)}`
const folderName = (p: Proj) => (p.code ? `${p.code}_${p.name}` : p.name).replace(/[\\/]/g, '·').trim()
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
  return ensure(groupName(p), await ensure(`#${yearOf(p)}`, 'root'))
}
/** 인트라넷이 만든 폴더인지 (부모 #그룹_연도, 그 부모 #연도) → 부모 메타 */
async function managedParent(f: Meta): Promise<Meta | null> {
  if (!f.parents?.[0]) return null
  const parent = await meta(f.parents[0]).catch(() => null)
  if (!parent || !ROOT_RE.test(parent.name) || !parent.parents?.[0]) return null
  const top = await meta(parent.parents[0]).catch(() => null)
  return top && YEAR_RE.test(top.name) ? parent : null
}

async function syncProject(p: Proj): Promise<{ url: string; action: 'created' | 'linked' | 'renamed' | 'moved' | 'ok' }> {
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
    const same = r.files?.find(f => f.name.startsWith(`${p.code}_`))
    if (same) return { url: folderUrl(same.id), action: 'linked' }
  }
  return { url: folderUrl((await create(want, group)).id), action: 'created' }
}
async function syncAndSave(p: Proj) {
  const r = await syncProject(p)
  if (r.url !== p.drive_url) await sb.from('projects').update({ drive_url: r.url }).eq('id', p.id)
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
interface Row { id: string; project_id: string; name: string; mime_type: string | null; parent_id: string | null; path: string | null; url: string | null; icon_url: string | null; size: number | null; modified_at: string | null; modified_by: string | null; synced_at: string }
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

/** 프로젝트 폴더 전체 훑기: 하위 폴더까지 (깊이 · 개수 제한) → 없어진 파일은 목록에서 뺌 */
async function scanProject(projectId: string, folderId: string, now: string): Promise<number> {
  const rows: Row[] = []
  const queue: [string, string, number][] = [[folderId, '', 0]]
  while (queue.length && rows.length < MAX_PER_PROJECT) {
    const [dir, path, depth] = queue.shift()!
    let pageToken: string | undefined
    do {
      const qs = new URLSearchParams({ q: `'${dir}' in parents and trashed = false`, fields: `nextPageToken,files(${F_FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })
      const r = await drive<{ nextPageToken?: string; files?: DFile[] }>(`files?${qs}`)
      for (const f of r.files ?? []) {
        rows.push(toRow(f, projectId, path, now))
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
    for (const [folder, project] of folders) files += await scanProject(project, folder, now).catch(() => 0)
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
      added += await scanProject(project, folder, now).catch(() => 0)
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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  // 5분 예약 실행 (DB cron → x-sync-key)
  const syncKey = req.headers.get('x-sync-key')
  if (syncKey) {
    const want = await secret('GDRIVE_SYNC_KEY')
    if (!want || syncKey !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
    try {
      return json(await syncAll(false))
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
    if (body.action === 'sync') {
      if (admin !== true) return json({ error: '관리자만 할 수 있습니다.' }, 403)
      return json(await syncAll(body.full === true))
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
