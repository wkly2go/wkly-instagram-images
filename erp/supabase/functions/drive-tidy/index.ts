// 내 드라이브 맨 위 정리 (2026-11-19 대표 지시 '이 폴더를 정리해서 항상 지금과 같은 상태로 유지 · 새로 생기는 파일들을 자료정리 폴더로 이동')
// 회사 구글 계정(info@) 내 드라이브 맨 위(root)에서, 처음 실행 때 있던 폴더(app_settings drive_root_keep)와 '자료정리' · 프로젝트 폴더 말고
// 새로 생긴 파일 · 폴더를 '자료정리' 로 옮긴다. 지우지 않고 옮기기만 함(내용 · 이름 그대로). 10분마다 예약(private.drive_tidy_tick) · x-sync-key = GDRIVE_SYNC_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const FOLDER = 'application/vnd.google-apps.folder'
const TIDY_NAME = '자료정리'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function setting<T>(key: string): Promise<T | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as T | undefined) ?? null
}
async function save(key: string, value: unknown) {
  await sb.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() })
}
async function token(): Promise<string> {
  const [id, sec, refresh] = await Promise.all([setting<string>('google_oauth_client_id'), secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (!id || !sec || !refresh) throw new Error('회사 구글 계정이 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token', scope: 'https://www.googleapis.com/auth/drive' }),
  })
  const b = await r.json()
  if (!r.ok || !b.access_token) throw new Error(`구글 연결 만료 (${b.error ?? r.status})`)
  return b.access_token as string
}
type F = { id: string; name: string; mimeType: string; createdTime?: string; ownedByMe?: boolean }
async function rootItems(t: string): Promise<F[]> {
  const out: F[] = []
  let page: string | undefined
  do {
    const qs = new URLSearchParams({ q: "'root' in parents and trashed = false", fields: 'nextPageToken,files(id,name,mimeType,createdTime,ownedByMe)', pageSize: '200', ...(page ? { pageToken: page } : {}) })
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${qs}`, { headers: { Authorization: `Bearer ${t}` } })
    const b = await r.json()
    if (!r.ok) throw new Error(`드라이브 목록 실패 (${b.error?.message ?? r.status})`)
    out.push(...(b.files ?? []))
    page = b.nextPageToken
  } while (page)
  return out
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)
  const key = await secret('GDRIVE_SYNC_KEY')
  if (!key || req.headers.get('x-sync-key') !== key) return json({ error: 'forbidden' }, 403)
  const body = await req.json().catch(() => ({})) as { dry?: boolean }
  try {
    const t = await token()
    const items = await rootItems(t)
    // removeParents 에는 'root' 별칭 대신 실제 id
    const rootId = String((await (await fetch('https://www.googleapis.com/drive/v3/files/root?fields=id', { headers: { Authorization: `Bearer ${t}` } })).json()).id ?? '')
    if (!rootId) throw new Error('내 드라이브 id 를 받지 못했습니다.')
    const tidy = items.find(f => f.mimeType === FOLDER && f.name.trim() === TIDY_NAME)
    if (!tidy) return json({ ok: false, error: `맨 위에 '${TIDY_NAME}' 폴더가 없습니다.` })
    // 처음 한 번: 지금 맨 위 폴더를 '그대로 둘 것'으로 기억 (파일은 기억하지 않음 → 옮김 대상)
    let keep = await setting<{ ids: string[]; names: string[]; at: string }>('drive_root_keep')
    if (!keep) {
      const folders = items.filter(f => f.mimeType === FOLDER)
      keep = { ids: folders.map(f => f.id), names: folders.map(f => f.name), at: new Date().toISOString() }
      if (!body.dry) await save('drive_root_keep', keep)
    }
    const { data: projects } = await sb.from('projects').select('drive_url').not('drive_url', 'is', null)
    const linked = (projects ?? []).map(p => String(p.drive_url))
    const keepIds = new Set([...keep.ids, tidy.id])
    // 방금 만들어져 아직 올라가는 중일 수 있는 것은 2분 기다림
    const fresh = Date.now() - 2 * 60_000
    // 맥이 드라이브에 만드는 숨김 파일(.VolumeIcon · ._ 등)은 다시 생기므로 건드리지 않음
    const move = items.filter(f => !f.name.startsWith('.') && !keepIds.has(f.id) && !linked.some(u => u.includes(f.id)) && (!f.createdTime || Date.parse(f.createdTime) < fresh)).slice(0, 50)
    const moved: { name: string; at: string }[] = []
    const failed: { name: string; error: string }[] = []
    for (const f of move) {
      if (body.dry) { moved.push({ name: f.name, at: '(미리보기)' }); continue }
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?addParents=${tidy.id}&removeParents=${rootId}&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: '{}' })
      if (r.ok) moved.push({ name: f.name, at: new Date().toISOString() })
      else failed.push({ name: f.name, error: String((await r.json().catch(() => ({})))?.error?.message ?? r.status).slice(0, 120) })
    }
    if (!body.dry && (moved.length || failed.length)) {
      const prev = (await setting<{ moved?: { name: string; at: string }[] }>('drive_root_tidy')) ?? {}
      await save('drive_root_tidy', { last_at: new Date().toISOString(), moved: [...moved, ...(prev.moved ?? [])].slice(0, 50), failed })
    }
    return json({ ok: true, keep: keep.names, moved, failed })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
