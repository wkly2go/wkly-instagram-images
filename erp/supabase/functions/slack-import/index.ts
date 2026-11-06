// 슬랙 대화 · 자료를 프로젝트로 가져오기 (대표 지시 2026-11-05 "슬랙의 채팅과 자료 공유를 프로젝트 폴더에 가져오기")
//  - 관리자가 슬랙 앱(봇) 토큰을 인트라넷에서 넣으면 Vault 에 저장 (대화로 받지 않음)
//  - 프로젝트 ↔ 채널 연결 뒤 '가져오기': 새 대화를 slack_messages 에 쌓고,
//    공유 파일은 드라이브 <프로젝트 폴더>/01.협의자료/02.슬랙/<YYMMDD>/ 에 저장 (프로젝트 폴더가 없으면 수신방/<YYMMDD>/<연번 프로젝트>/슬랙)
//    가져온 대화는 같은 폴더에 'YYMMDD_HHmm #채널 대화.txt' 로도 남김
//  - 드라이브 기존 자료는 건드리지 않음 (새 폴더 · 새 파일만 만듦)
//  - 함수 시간 제한 때문에 한 번에 메시지 300개 · 파일 20개까지, 남으면 more: true (화면이 이어서 부름)
//  action: status · set_token(관리자) · channels · link · unlink · import · (x-sync-key) 2분마다 전체 자동 가져오기
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

const MAX_MSGS = 300
const MAX_FILES = 20
const MAX_FILE_BYTES = 80 * 1024 * 1024
const kst = (ms: number) => new Date(ms + 9 * 3600_000).toISOString()
const day6 = (ms: number) => kst(ms).slice(2, 10).replace(/-/g, '')

// ── 슬랙
async function slackToken(): Promise<string | null> {
  const { data } = await sb.rpc('slack_secret_get')
  return typeof data === 'string' && data ? data : null
}
async function slack<T>(token: string, method: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v))
  const r = await fetch(`https://slack.com/api/${method}?${q}`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 429) throw new Error('슬랙이 잠시 요청을 막았습니다. 1분 뒤 다시 눌러 주세요.')
  const b = (await r.json()) as { ok: boolean; error?: string } & T
  if (!b.ok) throw new Error(slackError(b.error))
  return b
}
const slackError = (e?: string) =>
  e === 'not_in_channel'
    ? '슬랙 앱이 이 채널에 없습니다. 슬랙 채널에서 /invite @앱이름 으로 초대해 주세요.'
    : e === 'invalid_auth' || e === 'not_authed' || e === 'token_revoked'
      ? '슬랙 연결이 끊겼습니다. 관리자가 토큰을 다시 넣어 주세요.'
      : e === 'missing_scope'
        ? '슬랙 앱 권한이 부족합니다. 안내된 권한(scope)을 모두 넣고 다시 설치해 주세요.'
        : `슬랙 오류 (${e ?? '알 수 없음'})`

interface SFile { id: string; name?: string; title?: string; mimetype?: string; size?: number; url_private_download?: string; url_private?: string; permalink?: string; mode?: string }
interface SMsg { ts: string; thread_ts?: string; user?: string; bot_id?: string; username?: string; text?: string; subtype?: string; files?: SFile[]; reply_count?: number; latest_reply?: string }

// ── 구글 드라이브 (회사 계정 · drive-upload 와 같은 방식)
async function gsecret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function setting(key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  return typeof data?.value === 'string' ? data.value : null
}
async function googleToken(): Promise<string> {
  const [id, sec, refresh] = await Promise.all([setting('google_oauth_client_id'), gsecret('GOOGLE_CLIENT_SECRET'), gsecret('GOOGLE_DRIVE_REFRESH_TOKEN')])
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
const FOLDER = 'application/vnd.google-apps.folder'
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const clean = (s: string, n = 80) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, '·').replace(/\s+/g, ' ').trim().slice(0, n) || '이름 없음'
async function gd<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`드라이브 오류 ${r.status}`)
  return (await r.json()) as T
}
async function ensure(token: string, name: string, parent: string): Promise<string> {
  const q = `name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false and '${parent}' in parents`
  const r = await gd<{ files?: { id: string }[] }>(token, `files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)
  if (r.files?.[0]) return r.files[0].id
  return (await gd<{ id: string }>(token, 'files?fields=id&supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id
}
async function upload(token: string, parent: string, name: string, mime: string, bytes: Uint8Array): Promise<{ id: string; webViewLink?: string }> {
  const boundary = `wkly${crypto.randomUUID()}`
  const meta = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: name.slice(0, 250), parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`)
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(meta.length + bytes.length + tail.length)
  body.set(meta, 0)
  body.set(bytes, meta.length)
  body.set(tail, meta.length + bytes.length)
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!r.ok) throw new Error(`드라이브 저장 실패 ${r.status}`)
  return (await r.json()) as { id: string; webViewLink?: string }
}

interface P { id: string; code: string | null; name: string; drive_url: string | null }
/** 저장할 드라이브 폴더: <프로젝트 폴더>/01.협의자료/02.슬랙/<YYMMDD> · 없으면 수신방/<YYMMDD>/<연번 프로젝트>/슬랙 */
async function targetFolder(token: string, p: P, day: string): Promise<string> {
  const root = p.drive_url?.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null
  if (root) {
    const talk = await ensure(token, '01.협의자료', root)
    const sl = await ensure(token, '02.슬랙', talk)
    return ensure(token, day, sl)
  }
  let inbox = await setting('mail_inbox_folder')
  if (!inbox) {
    inbox = await ensure(token, '수신방', 'root')
    await sb.from('app_settings').upsert({ key: 'mail_inbox_folder', value: inbox, updated_at: new Date().toISOString() })
  }
  const df = await ensure(token, day, inbox)
  const pf = await ensure(token, clean(p.code ? `${p.code} ${p.name}` : p.name, 70), df)
  return ensure(token, '슬랙', pf)
}

/** 슬랙 글의 <@U123> · <#C1|이름> · <http://..|글> 을 읽기 쉽게 */
function plain(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_, id) => `@${names.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 한 프로젝트에 연결된 채널들의 새 대화 · 파일 가져오기 (화면 '지금 가져오기' 와 2분 자동 가져오기가 같이 씀) */
async function runImport(p: P, token: string): Promise<{ ok?: boolean; error?: string; messages?: number; files?: number; more?: boolean; errors?: string[] }> {
    const { data: links } = await sb.from('slack_links').select('*').eq('project_id', p.id)
    if (!links?.length) return { error: '연결된 슬랙 채널이 없습니다.' }
    const names = new Map<string, string>()
    const nameOf = async (id?: string): Promise<string> => {
      if (!id) return ''
      if (names.has(id)) return names.get(id)!
      const u = await slack<{ user: { real_name?: string; profile?: { display_name?: string; real_name?: string }; name?: string } }>(token, 'users.info', { user: id }).catch(() => null)
      const n = u?.user.profile?.display_name || u?.user.profile?.real_name || u?.user.real_name || u?.user.name || id
      names.set(id, n)
      return n
    }
    let gtoken: string | null = null
    let msgs = 0
    let files = 0
    let more = false
    const errors: string[] = []
    for (const link of links) {
      if (msgs >= MAX_MSGS || files >= MAX_FILES) {
        more = true
        break
      }
      // 지난번 이후 새 글 (오래된 것부터)
      const got: SMsg[] = []
      let cursor: string | undefined
      try {
        for (let i = 0; i < 5 && got.length < MAX_MSGS - msgs; i++) {
          const r = await slack<{ messages: SMsg[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>(token, 'conversations.history', {
            channel: link.channel_id,
            oldest: link.last_ts ?? undefined,
            limit: 200,
            cursor,
          })
          got.push(...r.messages)
          cursor = r.response_metadata?.next_cursor || undefined
          if (!cursor) break
        }
      } catch (e) {
        // 한 채널이 막혀도 다른 채널은 계속
        errors.push(`#${link.channel_name}: ${e instanceof Error ? e.message : '가져오기 실패'}`)
        continue
      }
      // 지난 14일 안의 예전 글에 새로 달린 스레드 답글도 (자동 가져오기는 2분마다라 대부분 이 경우)
      if (link.last_ts) {
        const since = String(Math.max(0, Number(link.last_ts) - 14 * 86400))
        const recent = await slack<{ messages: SMsg[] }>(token, 'conversations.history', { channel: link.channel_id, oldest: since, limit: 200 }).catch(() => null)
        for (const m of recent?.messages ?? []) {
          if (m.reply_count && m.latest_reply && Number(m.latest_reply) > Number(link.last_ts) && !got.some(x => x.ts === m.ts)) got.push(m)
        }
      }
      // 스레드 답글도 함께 (답글이 있는 글만)
      for (const m of [...got]) {
        if (!m.reply_count || got.length > MAX_MSGS * 2) continue
        const rp = await slack<{ messages: SMsg[] }>(token, 'conversations.replies', { channel: link.channel_id, ts: m.ts, limit: 200, oldest: link.last_ts ?? undefined }).catch(() => null)
        for (const x of rp?.messages ?? []) if (x.ts !== m.ts) got.push(x)
      }
      const list = got
        .filter(m => !m.subtype || ['file_share', 'thread_broadcast', 'bot_message'].includes(m.subtype))
        .filter(m => !link.last_ts || Number(m.ts) > Number(link.last_ts))
        .sort((a, c) => Number(a.ts) - Number(c.ts))
      if (!list.length) continue
      let lastTs = link.last_ts as string | null
      let saved = 0
      let savedFiles = 0
      const logLines: string[] = []
      for (const m of list) {
        if (msgs >= MAX_MSGS || files >= MAX_FILES) {
          more = true
          break
        }
        const ms = Math.round(Number(m.ts) * 1000)
        const user = m.user ? await nameOf(m.user) : m.username || '봇'
        const text = plain(m.text ?? '', names)
        const fileRows: { name: string; mime: string; size: number; drive_id?: string; drive_url?: string; slack_url?: string; skipped?: string }[] = []
        for (const f of m.files ?? []) {
          const fname = clean(f.name || f.title || `슬랙파일_${f.id}`, 120)
          const row = { name: fname, mime: f.mimetype ?? '', size: f.size ?? 0, slack_url: f.permalink }
          if (f.mode === 'external' || f.mode === 'tombstone' || !f.url_private_download) {
            fileRows.push({ ...row, skipped: '외부 링크 · 삭제된 파일' })
            continue
          }
          if ((f.size ?? 0) > MAX_FILE_BYTES) {
            fileRows.push({ ...row, skipped: '80MB 넘음 · 슬랙에서 직접 받기' })
            continue
          }
          try {
            const dl = await fetch(f.url_private_download, { headers: { Authorization: `Bearer ${token}` } })
            if (!dl.ok) throw new Error(`슬랙 파일 받기 실패 ${dl.status}`)
            const bytes = new Uint8Array(await dl.arrayBuffer())
            gtoken ??= await googleToken()
            const folder = await targetFolder(gtoken, p as P, day6(ms))
            const up = await upload(gtoken, folder, fname, f.mimetype ?? '', bytes)
            fileRows.push({ ...row, drive_id: up.id, drive_url: up.webViewLink ?? `https://drive.google.com/file/d/${up.id}/view` })
            files++
            savedFiles++
          } catch (e) {
            fileRows.push({ ...row, skipped: e instanceof Error ? e.message : '저장 실패' })
            errors.push(`${fname}: ${e instanceof Error ? e.message : '저장 실패'}`)
          }
        }
        const { error } = await sb.from('slack_messages').upsert(
          { project_id: p.id, channel_id: link.channel_id, channel_name: link.channel_name, ts: m.ts, thread_ts: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null, user_name: user, text, files: fileRows, posted_at: new Date(ms).toISOString() },
          { onConflict: 'project_id,channel_id,ts', ignoreDuplicates: true },
        )
        if (error) {
          errors.push(`대화 저장 실패: ${error.message}`)
          break
        }
        const hhmm = kst(ms).slice(5, 16).replace('T', ' ')
        logLines.push(`[${hhmm}] ${user}${m.thread_ts && m.thread_ts !== m.ts ? ' (답글)' : ''}: ${text}${fileRows.length ? `\n    첨부: ${fileRows.map(x => x.name + (x.drive_url ? ` → ${x.drive_url}` : x.skipped ? ` (${x.skipped})` : '')).join(' · ')}` : ''}`)
        if (!lastTs || Number(m.ts) > Number(lastTs)) lastTs = m.ts
        saved++
        msgs++
      }
      // 가져온 대화도 드라이브 같은 폴더에 글 파일로 남김
      if (logLines.length) {
        try {
          gtoken ??= await googleToken()
          const now = Date.now()
          const folder = await targetFolder(gtoken, p as P, day6(now))
          const head = `슬랙 #${link.channel_name} → ${p.code ? `${p.code} ` : ''}${p.name}\n가져온 때: ${kst(now).slice(0, 16).replace('T', ' ')} (한국 시간)\n\n`
          await upload(gtoken, folder, `${day6(now)}_${kst(now).slice(11, 16).replace(':', '')} #${clean(link.channel_name, 40)} 대화.txt`, 'text/plain', new TextEncoder().encode(head + logLines.join('\n') + '\n'))
        } catch (e) {
          errors.push(`대화 기록 파일: ${e instanceof Error ? e.message : '저장 실패'}`)
        }
      }
      await sb
        .from('slack_links')
        .update({ last_ts: lastTs, imported_count: (link.imported_count ?? 0) + saved, file_count: (link.file_count ?? 0) + savedFiles, last_imported_at: new Date().toISOString() })
        .eq('id', link.id)
    }
    return { ok: true, messages: msgs, files, more, errors: errors.slice(0, 5) }
  
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  // 2분마다 자동 가져오기 (DB 예약 → x-sync-key) — 대표 지시 2026-11-06 "모든 외부 연결은 실시간으로 추적해서 가져와"
  const syncKey = req.headers.get('x-sync-key')
  if (syncKey) {
    const want = await gsecret('GDRIVE_SYNC_KEY')
    if (!want || syncKey !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
    const token = await slackToken()
    if (!token) return json({ ok: true, skipped: '슬랙 미연결' })
    const started = Date.now()
    const { data: rows } = await sb.from('slack_links').select('project_id')
    const ids = [...new Set((rows ?? []).map(r => r.project_id as string))]
    const out: { project: string; messages: number; files: number; error?: string }[] = []
    for (const id of ids) {
      if (Date.now() - started > 100_000) break
      const { data: p } = await sb.from('projects').select('id,code,name,drive_url').eq('id', id).maybeSingle()
      if (!p) continue
      try {
        const r = await runImport(p as P, token)
        out.push({ project: p.name, messages: r.messages ?? 0, files: r.files ?? 0, error: r.error })
      } catch (e) {
        out.push({ project: p.name, messages: 0, files: 0, error: e instanceof Error ? e.message : '실패' })
      }
    }
    return json({ ok: true, synced: out })
  }
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: member } = await caller.rpc('is_active_member')
  if (member !== true) return json({ error: '팀원만 쓸 수 있습니다.' }, 403)
  const { data: who } = await caller.auth.getUser()
  const uid = who.user?.id ?? null
  const b = (await req.json().catch(() => ({}))) as { action?: string; token?: string; project_id?: string; channel_id?: string; channel_name?: string }

  try {
    if (b.action === 'set_token') {
      const { data: me } = await sb.from('profiles').select('role').eq('id', uid ?? '').maybeSingle()
      if (me?.role !== 'admin') return json({ error: '관리자만 슬랙을 연결할 수 있습니다.' }, 403)
      const t = (b.token ?? '').trim()
      if (!t) {
        await sb.rpc('slack_secret_set', { p_value: '' })
        return json({ ok: true, connected: false })
      }
      if (!/^xox[bp]-/.test(t)) return json({ error: "슬랙 봇 토큰은 'xoxb-' 로 시작합니다." }, 400)
      const a = await slack<{ team?: string; user?: string }>(t, 'auth.test')
      const { error } = await sb.rpc('slack_secret_set', { p_value: t })
      if (error) return json({ error: `저장 실패: ${error.message}` }, 500)
      return json({ ok: true, connected: true, team: a.team ?? '', bot: a.user ?? '' })
    }

    const token = await slackToken()
    if (b.action === 'status') {
      if (!token) return json({ connected: false })
      try {
        const a = await slack<{ team?: string; user?: string }>(token, 'auth.test')
        return json({ connected: true, team: a.team ?? '', bot: a.user ?? '' })
      } catch (e) {
        return json({ connected: false, error: e instanceof Error ? e.message : '연결 확인 실패' })
      }
    }
    if (!token) return json({ error: '슬랙이 아직 연결되지 않았습니다. 관리자가 슬랙 앱 토큰을 넣어 주세요.' }, 400)

    if (b.action === 'channels') {
      const out: { id: string; name: string; is_private: boolean; is_member: boolean }[] = []
      let cursor: string | undefined
      for (let i = 0; i < 5; i++) {
        const r = await slack<{ channels: { id: string; name: string; is_private?: boolean; is_member?: boolean; is_archived?: boolean }[]; response_metadata?: { next_cursor?: string } }>(token, 'conversations.list', {
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        })
        for (const c of r.channels) out.push({ id: c.id, name: c.name, is_private: !!c.is_private, is_member: !!c.is_member })
        cursor = r.response_metadata?.next_cursor || undefined
        if (!cursor) break
      }
      out.sort((a, b2) => Number(b2.is_member) - Number(a.is_member) || a.name.localeCompare(b2.name))
      return json({ channels: out })
    }

    if (!b.project_id) return json({ error: '프로젝트가 없습니다.' }, 400)
    const { data: p } = await sb.from('projects').select('id,code,name,drive_url').eq('id', b.project_id).maybeSingle()
    if (!p) return json({ error: '프로젝트를 찾지 못했습니다.' }, 404)

    if (b.action === 'link') {
      if (!b.channel_id) return json({ error: '채널을 고르세요.' }, 400)
      // 공개 채널이면 앱이 스스로 들어감 (비공개는 슬랙에서 /invite 필요)
      await slack(token, 'conversations.join', { channel: b.channel_id }).catch(() => undefined)
      const { error } = await sb.from('slack_links').upsert({ project_id: p.id, channel_id: b.channel_id, channel_name: b.channel_name ?? '', created_by: uid }, { onConflict: 'project_id,channel_id' })
      if (error) return json({ error: `연결 실패: ${error.message}` }, 500)
      return json({ ok: true })
    }
    if (b.action === 'unlink') {
      if (!b.channel_id) return json({ error: '채널이 없습니다.' }, 400)
      await sb.from('slack_links').delete().eq('project_id', p.id).eq('channel_id', b.channel_id)
      return json({ ok: true })
    }

    if (b.action === 'import') {
      const r = await runImport(p as P, token)
      return r.error ? json({ error: r.error }, 400) : json(r)
    }
    return json({ error: '알 수 없는 요청입니다.' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '슬랙 처리 실패' }, 500)
  }
})
