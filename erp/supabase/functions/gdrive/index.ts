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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const [{ data: member }, { data: admin }] = await Promise.all([caller.rpc('is_active_member'), caller.rpc('is_admin')])
  if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
  const body = (await req.json().catch(() => ({}))) as { action?: string; code?: string; project_id?: string }

  try {
    if (body.action === 'status') {
      const [id, sec, refresh, acct] = await Promise.all([
        clientId(),
        secret('GOOGLE_CLIENT_SECRET'),
        secret('GOOGLE_DRIVE_REFRESH_TOKEN'),
        sb.from('app_settings').select('value').eq('key', 'google_drive_account').maybeSingle(),
      ])
      return json({ clientId: !!id, secret: !!sec, connected: !!refresh, account: (acct.data?.value as { email?: string } | null)?.email ?? null })
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
