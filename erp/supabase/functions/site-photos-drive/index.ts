// 현장 실측 사진 → 프로젝트 드라이브 '03.현장일보 / 01.현장사진 / <YYMMDD>_실측사진' (대표 지시 2026-11-13 하이브 연말 파티)
//  - 회사 구글 계정으로 올림. 인증: 짧게 쓰는 열쇠(app_settings 'site_photos_drive_token' · 만료 시각 · 허용 폴더) 만
//  - action prepare {project_id}: 폴더(원본 · 치수선) 준비 + 사진 목록 · 1시간짜리 받기 주소
//  - action put ?folder=&name= (본문 = 파일): 허용 폴더에만, 같은 이름이 있으면 새 내용으로 바꿈
//  - 기존 드라이브 자료는 고치거나 지우지 않음 (새 폴더 · 새 파일만)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const KEY = 'site_photos_drive_token'

async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function accessToken(): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
  const [sec, refresh] = await Promise.all([secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (typeof data?.value !== 'string' || !sec || !refresh) throw new Error('회사 구글 계정이 아직 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: data.value, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new Error(`구글 연결이 만료됐습니다. (${body.error ?? r.status})`)
  return body.access_token as string
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(0, 180)
async function gd<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${DRIVE}/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`드라이브 오류 ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return (await r.json()) as T
}
async function child(token: string, name: string, parent: string, create: boolean): Promise<string | null> {
  const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`
  const r = await gd<{ files?: { id: string }[] }>(token, `files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)
  if (r.files?.[0]?.id) return r.files[0].id
  // 맥에서 만든 폴더는 한글이 풀어쓴 형태(NFD)라 이름 검색에 안 걸림 → 하위 폴더를 훑어 같은 글자인지 비교
  const all = await gd<{ files?: { id: string; name: string }[] }>(token, `files?${new URLSearchParams({ q: `mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`, fields: 'files(id,name)', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)
  const same = all.files?.find(f => f.name.normalize('NFC') === name.normalize('NFC'))
  if (same) return same.id
  if (!create) return null
  return (await gd<{ id: string }>(token, 'files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id
}
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString()

interface Tok { token: string; exp: string; folders?: string[] }
async function readTok(): Promise<Tok | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  const v = data?.value as Tok | undefined
  return v && typeof v.token === 'string' && v.token.length >= 32 && Date.parse(v.exp) > Date.now() ? v : null
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 만 됩니다.' }, 405)
  const tok = await readTok()
  if (!tok || req.headers.get('x-put-token') !== tok.token) return json({ error: '열쇠가 맞지 않거나 만료됐습니다.' }, 403)
  const u = new URL(req.url)
  try {
    const token = await accessToken()
    if (u.searchParams.get('action') === 'put') {
      const folder = u.searchParams.get('folder') ?? ''
      const name = clean(u.searchParams.get('name') ?? '')
      const mime = (req.headers.get('Content-Type') ?? '').split(';')[0]
      if (!tok.folders?.includes(folder) || !name || !/^(image\/jpeg|text\/csv)$/.test(mime)) return json({ error: '올릴 수 없는 파일입니다.' }, 400)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length || bytes.length > 40 * 1024 * 1024) return json({ error: '파일 크기를 확인해 주세요.' }, 400)
      const q = `name = '${esc(name)}' and '${folder}' in parents and trashed = false`
      const found = await gd<{ files?: { id: string }[] }>(token, `files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)
      const existing = found.files?.[0]?.id
      const init = await fetch(existing
        ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink', {
        method: existing ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
        body: JSON.stringify(existing ? {} : { name, parents: [folder] }),
      })
      const loc = init.headers.get('Location')
      if (!init.ok || !loc) return json({ error: `올리기 주소 실패 ${init.status}` }, 502)
      const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
      if (!r.ok) return json({ error: `올리기 실패 ${r.status}` }, 502)
      return json({ ...(await r.json()), replaced: !!existing })
    }
    const b = (await req.json().catch(() => ({}))) as { action?: string; project_id?: string }
    if (b.action !== 'prepare' || !b.project_id) return json({ error: '알 수 없는 작업입니다.' }, 400)
    const { data: p } = await sb.from('projects').select('id,code,name,drive_url').eq('id', b.project_id).maybeSingle()
    const root = (p?.drive_url as string | null)?.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1]
    if (!p || !root) return json({ error: '프로젝트 드라이브 폴더가 없습니다.' }, 404)
    const { data: photos } = await sb.from('site_photos').select('id,path,memo,marks,created_at').eq('project_id', p.id).order('created_at')
    if (!photos?.length) return json({ error: '실측 사진이 없습니다.' }, 404)
    const day = kst(photos[0].created_at as string).slice(2, 10).replace(/-/g, '')
    const daily = await child(token, '03.현장일보', root, false)
    if (!daily) return json({ error: "프로젝트 폴더에 '03.현장일보'가 없습니다." }, 404)
    const pics = await child(token, '01.현장사진', daily, true)
    const top = await child(token, `${day}_실측사진`, pics!, true)
    const marked = await child(token, '치수선', top!, true)
    const orig = await child(token, '원본', top!, true)
    await sb.from('app_settings').update({ value: { ...tok, folders: [top, marked, orig] }, updated_at: new Date().toISOString() }).eq('key', KEY)
    const list = []
    for (const [i, ph] of photos.entries()) {
      const { data: s } = await sb.storage.from('site-photos').createSignedUrl(ph.path as string, 3600)
      const t = kst(ph.created_at as string)
      list.push({ no: i + 1, id: ph.id, name: `${t.slice(2, 10).replace(/-/g, '')}_${t.slice(11, 16).replace(':', '')}_실측${String(i + 1).padStart(2, '0')}`, memo: ph.memo, marks: ph.marks ?? [], url: s?.signedUrl ?? null })
    }
    return json({ project: `${p.code ?? ''} ${p.name}`.trim(), folders: { top, marked, orig }, folder_url: `https://drive.google.com/drive/folders/${top}`, photos: list })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
