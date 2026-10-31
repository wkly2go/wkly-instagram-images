// 회사 지메일(info@thewklyn.com) 읽기 연동 (대표 지시 2026-10-31 "지메일 연동해")
//  - 드라이브와 같은 회사 구글 계정 연결(갱신 토큰)을 씀 · 연결할 때 gmail.readonly 권한을 함께 받음
//  - 읽기만: 메일을 보내거나 지우거나 라벨을 바꾸지 않음 (에이전트 메일 발송 금지 원칙)
//  - 10분마다(x-sync-key) 새 메일의 제목 · 보낸 사람 · 받는 사람 · 날짜 · 미리보기 · 첨부 이름만 mail_index 에 저장
//    → DB 트리거가 연번 · 프로젝트 이름 · 거래처 · 연락처로 프로젝트에 연결
//  actions: sync {days?} (관리자 · 처음엔 90일), status (팀원)
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
  const todo = ids.filter(m => !known.has(m.id)).slice(0, 1500)
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
  await sb.from('app_settings').upsert({ key: 'gmail_sync', value: { synced_at: now, fetched: ids.length, saved: rows.length }, updated_at: now })
  return { fetched: ids.length, saved: rows.length }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const syncKey = req.headers.get('x-sync-key')
  try {
    if (syncKey) {
      const want = await secret('GDRIVE_SYNC_KEY')
      if (!want || syncKey !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
      return json(await sync(0))
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
