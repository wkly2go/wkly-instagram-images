// 취재 자료 올리기 · 큰 파일 이어 올리기 주소 만들기 (대표 지시 2026-10-31 "인트라넷에 취재 자료 구분없이 올리기")
//  - 브라우저는 구글 이어 올리기 주소(Location)를 읽을 수 없어서, 서버가 회사 계정으로 주소를 만들어 건넴
//  - 요청 Origin 을 그대로 붙여 만들면 그 주소로 브라우저가 바로 PUT 할 수 있음 (CORS)
//  - 팀원만 · 취재 자료 폴더(app_settings.field_upload_folder) 아래 '<촬영 폴더>/원본' 에만 만들 수 있음
//  - 2026-11-01 "여기로 자료 끌어다 놓으면 자동으로 수신방에 분류 저장" (프로젝트 › 구글 드라이브 자료)
//    mode 'inbox'      : 수신방/<거래처>/<연번 프로젝트>/<분류> 폴더를 찾거나 만들고 그곳 이어 올리기 주소
//    mode 'inbox_done' : 올린 파일을 수신방 기록(mail_files)에 남기고 프로젝트 01.협의자료/01.수신 에 바로가기
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

const FOLDER = 'application/vnd.google-apps.folder'
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string, n = 80) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '·').replace(/\s+/g, ' ').trim().slice(0, n) || '이름 없음'
const KINDS = ['계약서', '견적서', '세금계산서', '도면', '일정표', '사진', '첨부']
const kindOf = (name: string, mime: string): string => {
  if (/세금\s?계산서|tax\s?invoice/i.test(name)) return '세금계산서'
  if (/계약서|계약|약정|agreement|contract/i.test(name)) return '계약서'
  if (/견적|quotation|estimate|quote|실행\s?율|실행\s?내역/i.test(name)) return '견적서'
  if (/도면|평면|입면|단면|상세도|\.(dwg|dxf)$/i.test(name)) return '도면'
  if (/일정|스케줄|schedule|공정표/i.test(name)) return '일정표'
  if (mime.startsWith('image/') || mime.startsWith('video/')) return '사진'
  return '첨부'
}
async function gd<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`드라이브 오류 ${r.status}`)
  return (await r.json()) as T
}
async function ensure(token: string, name: string, parent: string, create = true): Promise<string | null> {
  const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`
  const r = await gd<{ files?: { id: string }[] }>(token, `files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)
  if (r.files?.[0]) return r.files[0].id
  if (!create) return null
  return (await gd<{ id: string }>(token, 'files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id
}
async function inboxRoot(token: string): Promise<string> {
  const id = await setting('mail_inbox_folder')
  if (id) return id
  const made = (await ensure(token, '수신방', 'root'))!
  await sb.from('app_settings').upsert({ key: 'mail_inbox_folder', value: made, updated_at: new Date().toISOString() })
  return made
}
interface P { id: string; code: string | null; name: string; client_id: string | null; drive_url: string | null; clients: { name: string } | null }
async function project(id: string): Promise<P | null> {
  const { data } = await sb.from('projects').select('id,code,name,client_id,drive_url,clients(name)').eq('id', id).maybeSingle()
  return (data as unknown as P) ?? null
}
async function session(token: string, origin: string, b: { name: string; mime?: string; size: number }, parent: string): Promise<string | null> {
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': b.mime || 'application/octet-stream',
      'X-Upload-Content-Length': String(b.size),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name: b.name.slice(0, 250), parents: [parent] }),
  })
  return r.ok ? r.headers.get('Location') : null
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: member } = await caller.rpc('is_active_member')
  if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
  const b = (await req.json().catch(() => ({}))) as { mode?: string; project_id?: string; file_id?: string; folder_id?: string; kind?: string; name?: string; mime?: string; size?: number; parent?: string; origin?: string }
  const origin = b.origin && ORIGINS.test(b.origin) ? b.origin : req.headers.get('Origin') ?? ''
  // ── 수신방에 분류 저장 (프로젝트 화면에 끌어다 놓기)
  if (b.mode === 'inbox' || b.mode === 'inbox_done') {
    try {
      if (!b.project_id || !b.name) return json({ error: '파일 정보가 없습니다.' }, 400)
      const p = await project(b.project_id)
      if (!p) return json({ error: '프로젝트를 찾지 못했습니다.' }, 404)
      const token = await accessToken()
      const vendor = clean(p.clients?.name ?? '거래처 미정', 60)
      if (b.mode === 'inbox') {
        if (typeof b.size !== 'number') return json({ error: '파일 크기가 없습니다.' }, 400)
        const kind = kindOf(b.name, b.mime ?? '')
        const root = await inboxRoot(token)
        const v = (await ensure(token, vendor, root))!
        const pf = (await ensure(token, clean(p.code ? `${p.code} ${p.name}` : p.name, 70), v))!
        const folder = (await ensure(token, kind, pf))!
        const url = await session(token, origin, { name: b.name, mime: b.mime, size: b.size }, folder)
        if (!url) return json({ error: '올리기 주소를 받지 못했습니다.' }, 502)
        return json({ url, folder_id: folder, kind, vendor })
      }
      // inbox_done
      if (!b.file_id || !b.folder_id || !KINDS.includes(b.kind ?? '')) return json({ error: '올린 파일 정보가 없습니다.' }, 400)
      const f = await gd<{ id: string; name: string; mimeType?: string; size?: string; webViewLink?: string; parents?: string[] }>(token, `files/${encodeURIComponent(b.file_id)}?fields=id,name,mimeType,size,webViewLink,parents&supportsAllDrives=true`)
      if (!f.parents?.includes(b.folder_id)) return json({ error: '수신방에 올린 파일이 아닙니다.' }, 403)
      const root = p.drive_url?.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null
      const talk = root ? await ensure(token, '01.협의자료', root, false).catch(() => null) : null
      const inbox = talk ? await ensure(token, '01.수신', talk).catch(() => null) : null
      const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '')
      if (inbox) await gd(token, 'files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${day}_${f.name}`, mimeType: 'application/vnd.google-apps.shortcut', parents: [inbox], shortcutDetails: { targetId: f.id } }) }).catch(() => undefined)
      const { error } = await sb.from('mail_files').upsert(
        { source: 'drive', source_file_id: f.id, name: f.name, mime: f.mimeType ?? null, size: f.size ? Number(f.size) : null, kind: b.kind, vendor, client_id: p.client_id, project_ids: [p.id], drive_file_id: f.id, drive_url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`, folder_id: b.folder_id, sent_at: new Date().toISOString() },
        { onConflict: 'source_file_id', ignoreDuplicates: true },
      )
      if (error) return json({ error: `기록 실패: ${error.message}` }, 500)
      return json({ ok: true, shortcut: !!inbox })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : '수신방 저장 실패' }, 500)
    }
  }
  if (!b.name || !b.parent || typeof b.size !== 'number') return json({ error: '파일 정보가 없습니다.' }, 400)
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
