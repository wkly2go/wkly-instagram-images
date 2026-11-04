// 현장 실측 페이지(/field/fossil-1103) → 구글 드라이브 날짜 폴더 저장
//  - 페이지(브라우저)가 치수선 사진·원본·CSV·녹음을 만들어 올리고, 이 함수는 회사 계정으로 이어 올리기 주소만 만들어 건넴
//  - 정해 둔 20261103_현장실측 하위 폴더 5곳에만 쓸 수 있음. 같은 이름 파일이 있으면 새 내용으로 바꿈 (다시 저장해도 중복 안 생김)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const ORIGINS = /^(https:\/\/([a-z0-9-]+\.)?wkly-erp\.pages\.dev|http:\/\/localhost(:\d+)?)$/
const FOLDERS: Record<string, string> = {
  '00': '1akrFSZ3-JNy90Zhg2G7p1idJ1yuYxVdG', // 00_실측표
  '01': '1eZXDtqukg0cXwU8w3sHVsSIwFnIDrmXM', // 01_치수사진_스토어
  '02': '1cMSTIs9-8Psvxv9rbuihKfKtYU3KLu8J', // 02_치수사진_크리스마스
  '03': '1BBLRWLcQNL_RL4gAt9JYbAbUpE3qHmae', // 03_원본사진
  '04': '1YuzDT9aQCs5H4851cT37x_nDcKU0n2FY', // 04_회의녹음
}
const MIMES = /^(image\/jpeg|text\/csv|text\/markdown|audio\/(webm|mp4|ogg|mpeg|aac|x-m4a|wav))$/

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
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(0, 180)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 만 됩니다.' }, 405)
  const b = (await req.json().catch(() => ({}))) as { folder?: string; name?: string; mime?: string; size?: number; origin?: string }
  const origin = b.origin && ORIGINS.test(b.origin) ? b.origin : req.headers.get('Origin') ?? ''
  if (!ORIGINS.test(origin)) return json({ error: '허용되지 않은 주소입니다.' }, 403)
  const parent = FOLDERS[b.folder ?? '']
  const name = clean(b.name ?? '')
  const mime = (b.mime ?? '').split(';')[0]
  if (!parent || !name || !MIMES.test(mime) || !b.size || b.size > 60 * 1024 * 1024) return json({ error: '저장할 수 없는 파일입니다.' }, 400)
  try {
    const token = await accessToken()
    const q = `name = '${esc(name)}' and '${parent}' in parents and trashed = false`
    const found = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`, { headers: { Authorization: `Bearer ${token}` } })
    const existing = found.ok ? ((await found.json()).files?.[0]?.id as string | undefined) : undefined
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink'
    const r = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(b.size),
        Origin: origin,
      },
      body: JSON.stringify(existing ? {} : { name, parents: [parent] }),
    })
    const loc = r.headers.get('Location')
    if (!r.ok || !loc) return json({ error: `드라이브 오류 ${r.status}` }, 502)
    return json({ url: loc, replaced: !!existing })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
