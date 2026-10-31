// 취재 자료 올리기 · 큰 파일 이어 올리기 주소 만들기 (대표 지시 2026-10-31 "인트라넷에 취재 자료 구분없이 올리기")
//  - 브라우저는 구글 이어 올리기 주소(Location)를 읽을 수 없어서, 서버가 회사 계정으로 주소를 만들어 건넴
//  - 요청 Origin 을 그대로 붙여 만들면 그 주소로 브라우저가 바로 PUT 할 수 있음 (CORS)
//  - 팀원만 · 취재 자료 폴더(app_settings.field_upload_folder) 아래 '<촬영 폴더>/원본' 에만 만들 수 있음
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
const ORIGINS = /^(https:\/\/([a-z0-9-]+\.)?wkly-erp\.pages\.dev|http:\/\/localhost(:\d+)?|app:\/\/.*|file:\/\/.*)$/

async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function setting(key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  return typeof data?.value === 'string' ? data.value : null
}
async function accessToken(): Promise<string> {
  const [id, sec, refresh] = await Promise.all([setting('google_oauth_client_id'), secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (!id || !sec || !refresh) throw new Error('회사 구글 계정이 아직 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new Error(`구글 연결이 만료됐습니다. (${body.error ?? r.status})`)
  return body.access_token as string
}
async function parentOf(token: string, id: string): Promise<{ name: string; parent: string | null } | null> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,parents,trashed&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const f = (await r.json()) as { name: string; parents?: string[]; trashed?: boolean }
  return f.trashed ? null : { name: f.name, parent: f.parents?.[0] ?? null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: member } = await caller.rpc('is_active_member')
  if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
  const b = (await req.json().catch(() => ({}))) as { name?: string; mime?: string; size?: number; parent?: string; origin?: string }
  if (!b.name || !b.parent || typeof b.size !== 'number') return json({ error: '파일 정보가 없습니다.' }, 400)
  const origin = b.origin && ORIGINS.test(b.origin) ? b.origin : req.headers.get('Origin') ?? ''
  try {
    const token = await accessToken()
    // 올릴 곳이 '취재 자료 폴더 / <촬영 폴더> / 원본' 인지 확인
    const root = await setting('field_upload_folder')
    const orig = await parentOf(token, b.parent)
    const shoot = orig?.parent ? await parentOf(token, orig.parent) : null
    if (!root || !orig || orig.name !== '원본' || !shoot || shoot.parent !== root) return json({ error: '취재 자료 폴더에만 올릴 수 있습니다.' }, 403)
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': b.mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(b.size),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name: b.name.slice(0, 250), parents: [b.parent] }),
    })
    const loc = r.headers.get('Location')
    if (!r.ok || !loc) return json({ error: `올리기 주소를 받지 못했습니다 (${r.status})` }, 502)
    return json({ url: loc })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '올리기 준비 실패' }, 500)
  }
})
