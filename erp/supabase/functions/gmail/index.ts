// 회사 지메일(info@thewklyn.com) 읽기 연동 (대표 지시 2026-10-31 "지메일 연동해")
//  - 드라이브와 같은 회사 구글 계정 연결(갱신 토큰)을 씀 · 연결할 때 gmail.readonly 권한을 함께 받음
//  - 읽기만: 메일을 보내거나 지우거나 라벨을 바꾸지 않음 (에이전트 메일 발송 금지 원칙)
//  - 10분마다(x-sync-key) 새 메일의 제목 · 보낸 사람 · 받는 사람 · 날짜 · 미리보기 · 첨부 이름만 mail_index 에 저장
//    → DB 트리거가 연번 · 프로젝트 이름 · 거래처 · 연락처로 프로젝트에 연결
//  - 2026-10-31 "이메일 자료 구글 드라이브에 자동으로 분류하고 정리해, 각 업체별로 수신방에 폴더를 만들어서 저장해"
//    → 첨부를 내 드라이브 / 수신방 / <거래처> / YYMMDD_메일 제목 / 파일 로 복사 (세금계산서는 수신방 / 세금계산서 / YYYY-MM / <거래처>)
//    → 프로젝트와 연결된 메일은 프로젝트 폴더 01.협의자료/01.수신 에 바로가기, 계약서는 04.계약서 에도 바로가기
//    → 기록은 mail_files (거래처 · 프로젝트 화면 · 에이전트가 이 표로 파일을 찾음). 메일은 읽기만
//  actions: sync {days?} (관리자 · 처음엔 90일), files (관리자 · 첨부 저장만), status (팀원)
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
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

class NotConnected extends Error {}
async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
let cached: { token: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const { data } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
  const id = typeof data?.value === 'string' ? data.value : null
  const [sec, refresh] = await Promise.all([secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (!id || !sec || !refresh) throw new NotConnected('회사 구글 계정이 아직 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new NotConnected(`구글 연결이 만료됐습니다. (${body.error ?? r.status})`)
  if (typeof body.scope === 'string' && !body.scope.includes('gmail.readonly')) throw new NotConnected("지메일 권한이 없습니다. 드라이브 설정에서 '다시 연결'을 눌러 지메일 읽기도 허용해 주세요.")
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cached.token
}
async function gmail<T>(path: string): Promise<T> {
  const r = await fetch(`${GMAIL}/${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (r.status === 403) throw new NotConnected("지메일 권한이 없습니다. 드라이브 설정에서 '다시 연결'을 눌러 지메일 읽기도 허용해 주세요.")
  if (!r.ok) throw new Error(`지메일 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

interface Part { filename?: string; mimeType?: string; parts?: Part[] }
interface Msg { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[]; parts?: Part[] } }
const header = (m: Msg, n: string) => m.payload?.headers?.find(h => h.name.toLowerCase() === n)?.value ?? null
const addr = (v: string | null) => {
  if (!v) return { name: null, email: null }
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/)
  return m ? { name: m[1].trim() || null, email: m[2].trim().toLowerCase() } : { name: null, email: v.trim().toLowerCase() }
}
const files = (parts: Part[] | undefined, out: string[] = []) => {
  for (const p of parts ?? []) {
    if (p.filename) out.push(p.filename)
    files(p.parts, out)
  }
  return out
}
const decodeEntities = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function sync(days: number): Promise<{ fetched: number; saved: number }> {
  const { data: st } = await sb.from('app_settings').select('value').eq('key', 'gmail_sync').maybeSingle()
  const last = (st?.value as { synced_at?: string } | null)?.synced_at
  // 지난번에 다 못 받았으면 그 기간을 이어서
  const carry = (st?.value as { backfill_days?: number } | null)?.backfill_days ?? 0
  if (days <= 0 && carry > 0) days = carry
  // 지난번 이후(겹치게 1일) · 처음이면 days 일
  const since = last && days <= 0 ? Math.floor(new Date(last).getTime() / 1000) - 86400 : Math.floor(Date.now() / 1000) - Math.max(1, days || 90) * 86400
  const ids: { id: string }[] = []
  let pageToken: string | undefined
  for (let guard = 0; guard < 20; guard++) {
    const qs = new URLSearchParams({ q: `after:${since} -in:chats -category:promotions -category:social`, maxResults: '500', includeSpamTrash: 'false', ...(pageToken ? { pageToken } : {}) })
    const r = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`messages?${qs}`)
    ids.push(...(r.messages ?? []))
    pageToken = r.nextPageToken
    if (!pageToken) break
  }
  // 이미 저장한 것은 건너뜀
  const known = new Set<string>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from('mail_index').select('id').in('id', ids.slice(i, i + 500).map(m => m.id))
    for (const r of data ?? []) known.add(r.id as string)
  }
  const todo = ids.filter(m => !known.has(m.id)).slice(0, 400)
  const rows: Record<string, unknown>[] = []
  const now = new Date().toISOString()
  for (let i = 0; i < todo.length; i += 20) {
    const batch = await Promise.all(
      todo.slice(i, i + 20).map(m => gmail<Msg>(`messages/${m.id}?format=full&fields=id,threadId,labelIds,snippet,internalDate,payload(headers,parts(filename,mimeType,parts(filename,mimeType,parts(filename))))`).catch(() => null)),
    )
    for (const m of batch) {
      if (!m) continue
      const from = addr(header(m, 'from'))
      const to = addr((header(m, 'to') ?? '').split(',')[0] ?? null)
      const att = files(m.payload?.parts)
      rows.push({
        id: m.id,
        thread_id: m.threadId,
        from_name: from.name,
        from_addr: from.email,
        to_addr: to.email,
        subject: (header(m, 'subject') ?? '(제목 없음)').slice(0, 500),
        snippet: decodeEntities(m.snippet ?? '').slice(0, 500),
        sent_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        labels: m.labelIds ?? [],
        has_attachment: att.length > 0,
        attachments: att.slice(0, 30),
        synced_at: now,
      })
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('mail_index').upsert(rows.slice(i, i + 200))
    if (error) throw new Error(`메일 목록 저장 실패: ${error.message}`)
  }
  // 아직 못 받은 메일이 남았으면 다음 번에도 같은 기간을 다시 훑음 (이미 받은 것은 건너뜀)
  const left = ids.length - known.size - rows.length
  const prev = (st?.value as { backfill_days?: number } | null)?.backfill_days
  const backfill_days = left > 0 ? Math.max(days, prev ?? 0, 1) : 0
  await sb.from('app_settings').upsert({ key: 'gmail_sync', value: { synced_at: now, fetched: ids.length, saved: rows.length, left: Math.max(0, left), backfill_days }, updated_at: now })
  return { fetched: ids.length, saved: rows.length }
}

// ---------------------------------------------------------------- 첨부 → 드라이브 수신방
const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
async function gd<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${DRIVE}/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${await accessToken()}` } })
  if (!r.ok) throw new Error(`드라이브 오류 ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return (await r.json()) as T
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string, n = 80) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '·').replace(/\s+/g, ' ').trim().slice(0, n) || '이름 없음'
const folderCache = new Map<string, string>()
async function ensureFolder(name: string, parent: string, create = true): Promise<string | null> {
  const key = `${parent}/${name}`
  if (folderCache.has(key)) return folderCache.get(key)!
  const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`
  const r = await gd<{ files?: { id: string }[] }>(`files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)
  let id = r.files?.[0]?.id ?? null
  if (!id && create) id = (await gd<{ id: string }>('files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id
  if (id) folderCache.set(key, id)
  return id
}
async function inboxRoot(): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'mail_inbox_folder').maybeSingle()
  if (typeof data?.value === 'string' && data.value) return data.value
  const id = (await ensureFolder('수신방', 'root'))!
  await sb.from('app_settings').upsert({ key: 'mail_inbox_folder', value: id, updated_at: new Date().toISOString() })
  return id
}
async function uploadBytes(bytes: Uint8Array, name: string, mime: string, parent: string): Promise<{ id: string; webViewLink?: string }> {
  const token = await accessToken()
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ name, parents: [parent] }),
  })
  const loc = init.headers.get('Location')
  if (!init.ok || !loc) throw new Error(`올리기 주소 실패 ${init.status}`)
  const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
  if (!r.ok) throw new Error(`올리기 실패 ${r.status}`)
  return (await r.json()) as { id: string; webViewLink?: string }
}
const b64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface FullPart { filename?: string; mimeType?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number }; parts?: FullPart[] }
const walk = (p: FullPart | undefined, out: FullPart[] = []) => {
  if (!p) return out
  if (p.filename && p.body?.attachmentId) out.push(p)
  for (const c of p.parts ?? []) walk(c, out)
  return out
}
const OWN = /@thewklyn\.com$/i
const SKIP_DOMAIN = /(^|\.)(google\.com|googlemail\.com|anthropic\.com|figma\.com|notion\.so|slack\.com|github\.com|canva\.com|apple\.com|facebookmail\.com|instagram\.com|linkedin\.com|supabase\.(io|com)|cloudflare\.com|vercel\.com|stripe\.com|amazonaws\.com)$/i
const NOREPLY = /^(no-?reply|donotreply|notifications?|mailer-daemon|postmaster)@/i
const FREE = /@(gmail|googlemail|naver|hanmail|daum|kakao|nate|hotmail|outlook|icloud|yahoo)\./i
const SELF = /아트리어|더\s?위클리|위클리엔|thewkly/i
const CONTRACT = /계약서|계약|약정|agreement|contract/i

interface Row { id: string; thread_id: string; from_name: string | null; from_addr: string | null; subject: string | null; sent_at: string | null; labels: string[]; client_id: string | null; project_ids: string[] }
async function vendorOf(m: Row): Promise<{ vendor: string; tax: boolean }> {
  const addr = m.from_addr ?? ''
  if (/hometax\.go\.kr$/i.test(addr)) {
    // 제목 '… (공급자->공급받는자)' 에서 우리 회사가 아닌 쪽
    const pair = m.subject?.match(/\(([^()]*)->([^()]*)\)\s*$/)
    const other = pair ? (SELF.test(pair[1]) ? pair[2] : pair[1]) : '미상'
    return { vendor: clean(other.trim(), 60), tax: true }
  }
  if (m.client_id) {
    const { data } = await sb.from('clients').select('name').eq('id', m.client_id).maybeSingle()
    if (data?.name) return { vendor: clean(data.name as string, 60), tax: false }
  }
  if (FREE.test(addr)) return { vendor: clean(m.from_name || addr.split('@')[0], 60), tax: false }
  return { vendor: clean(addr.split('@')[1]?.replace(/^(www|mail|email|e)\./, '') || m.from_name || '미상', 60), tax: false }
}
const projectFolder = new Map<string, string | null>()
async function projectSub(projectId: string, sub: string): Promise<string | null> {
  const key = `${projectId}/${sub}`
  if (projectFolder.has(key)) return projectFolder.get(key)!
  const { data } = await sb.from('projects').select('drive_url').eq('id', projectId).maybeSingle()
  const root = (data?.drive_url as string | null)?.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null
  // 프로젝트 폴더에 01.협의자료 가 있을 때만 (없으면 프로젝트 폴더는 건드리지 않음)
  const talk = root ? await ensureFolder('01.협의자료', root, false).catch(() => null) : null
  const id = talk ? await ensureFolder(sub, talk).catch(() => null) : null
  projectFolder.set(key, id)
  return id
}
async function shortcut(target: string, name: string, parent: string) {
  await gd('files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.shortcut', parents: [parent], shortcutDetails: { targetId: target } }) }).catch(() => undefined)
}

async function saveFiles(deadline: number): Promise<{ mails: number; files: number }> {
  const { data: st } = await sb.from('app_settings').select('value').eq('key', 'mail_files_since').maybeSingle()
  const since = typeof st?.value === 'string' ? st.value : '2026-10-01'
  const { data: todo } = await sb
    .from('mail_index')
    .select('id,thread_id,from_name,from_addr,subject,sent_at,labels,client_id,project_ids')
    .eq('has_attachment', true)
    .is('files_done_at', null)
    .gte('sent_at', since)
    .order('sent_at', { ascending: true })
    .limit(25)
  let mails = 0
  let files = 0
  if (!todo?.length) return { mails, files }
  const root = await inboxRoot()
  for (const m of todo as Row[]) {
    if (Date.now() > deadline) break
    const addr = m.from_addr ?? ''
    const skip = OWN.test(addr) || (m.labels ?? []).includes('SENT') || (SKIP_DOMAIN.test(addr.split('@')[1] ?? '') ) || (NOREPLY.test(addr) && !/hometax\.go\.kr$/i.test(addr))
    if (!skip) {
      const full = await gmail<{ payload?: FullPart }>(`messages/${m.id}?format=full`).catch(() => null)
      const { vendor, tax } = await vendorOf(m)
      const day = (m.sent_at ?? new Date().toISOString()).slice(0, 10)
      const yymmdd = day.slice(2).replace(/-/g, '')
      let parent: string | null = null
      for (const part of walk(full?.payload)) {
        const name = clean(part.filename!, 150)
        const mime = part.mimeType || 'application/octet-stream'
        const size = part.body?.size ?? 0
        if (/\.html?$/i.test(name) && !tax) continue
        if (mime.startsWith('image/') && size < 30 * 1024) continue
        if (size > 25 * 1024 * 1024) continue
        // 같은 대화에 같은 파일이 또 붙으면 한 번만
        const { count } = await sb.from('mail_files').select('id', { count: 'exact', head: true }).eq('thread_id', m.thread_id).eq('name', name).eq('size', size)
        if (count) continue
        if (!parent) {
          parent = tax
            ? await ensureFolder(vendor, (await ensureFolder(day.slice(0, 7), (await ensureFolder('세금계산서', root))!))!)
            : await ensureFolder(clean(`${yymmdd}_${m.subject ?? '제목 없음'}`, 70), (await ensureFolder(vendor, root))!)
        }
        const att = await gmail<{ data?: string }>(`messages/${m.id}/attachments/${part.body!.attachmentId}`).catch(() => null)
        if (!att?.data) continue
        const fileName = tax ? clean(`${yymmdd}_${(m.subject?.match(/\(([^()]*)\)\s*$/)?.[1] ?? vendor)}_세금계산서${name.match(/\.[^.]+$/)?.[0] ?? '.html'}`, 150) : name
        const up = await uploadBytes(b64(att.data), fileName, mime, parent!)
        const kind = tax ? '세금계산서' : CONTRACT.test(name) ? '계약서' : '첨부'
        await sb.from('mail_files').upsert(
          { mail_id: m.id, thread_id: m.thread_id, name, mime, size, kind, vendor, client_id: m.client_id, project_ids: m.project_ids ?? [], drive_file_id: up.id, drive_url: up.webViewLink ?? `https://drive.google.com/file/d/${up.id}/view`, folder_id: parent!, sent_at: m.sent_at },
          { onConflict: 'mail_id,name,size', ignoreDuplicates: true },
        )
        files++
        for (const pid of m.project_ids ?? []) {
          const inbox = await projectSub(pid, '01.수신')
          if (inbox) await shortcut(up.id, `${yymmdd}_${vendor}_${name}`, inbox)
          if (kind === '계약서') {
            const c = await projectSub(pid, '04.계약서')
            if (c) await shortcut(up.id, `${yymmdd}_${vendor}_${name}`, c)
          }
        }
      }
    }
    await sb.from('mail_index').update({ files_done_at: new Date().toISOString() }).eq('id', m.id)
    mails++
  }
  return { mails, files }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const syncKey = req.headers.get('x-sync-key')
  try {
    if (syncKey) {
      const want = await secret('GDRIVE_SYNC_KEY')
      if (!want || syncKey !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
      const b = (await req.json().catch(() => ({}))) as { days?: number }
      const t0 = Date.now()
      const r = await sync(Math.min(365, Math.max(0, b.days ?? 0)))
      // 남은 시간 동안 첨부를 수신방에 (함수 제한 시간 안에서)
      const f = await saveFiles(t0 + 90_000).catch(e => ({ mails: 0, files: 0, error: e instanceof Error ? e.message : String(e) }))
      return json({ ...r, attachments: f })
    }
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
    const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const [{ data: member }, { data: admin }] = await Promise.all([caller.rpc('is_active_member'), caller.rpc('is_admin')])
    if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
    const body = (await req.json().catch(() => ({}))) as { action?: string; days?: number }
    if (body.action === 'status') {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'gmail_sync').maybeSingle()
      const ok = await accessToken().then(() => true).catch(() => false)
      return json({ connected: ok, ...((data?.value as object | null) ?? {}) })
    }
    if (body.action === 'files') {
      if (admin !== true) return json({ error: '관리자만 할 수 있습니다.' }, 403)
      return json(await saveFiles(Date.now() + 100_000))
    }
    if (body.action === 'sync') {
      if (admin !== true) return json({ error: '관리자만 할 수 있습니다.' }, 403)
      return json(await sync(Math.min(365, Math.max(1, body.days ?? 90))))
    }
    return json({ error: '알 수 없는 작업입니다.' }, 400)
  } catch (e) {
    if (e instanceof NotConnected) return json({ error: e.message, not_connected: true }, 409)
    return json({ error: e instanceof Error ? e.message : '지메일 작업 실패' }, 500)
  }
})
