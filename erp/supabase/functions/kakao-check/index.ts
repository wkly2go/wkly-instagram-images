// 카카오톡 내보내기 파일 점검 (2026-11-18 · 로드맵 1단계 점검)
//  - 드라이브에 있는 내보내기 파일(.txt · .csv)을 인트라넷 화면과 같은 읽기(kakao.ts = src/lib/kakao.ts 사본)로 읽어 숫자만 돌려줌
//  - 대화 내용은 돌려주지 않음: 개수 · 기간 · 보낸 사람 수 · 첨부 수 · 머리 줄 모양(글자는 가림)
//  - 예약 작업과 같은 열쇠(x-sync-key = Vault GDRIVE_SYNC_KEY)로만 · 읽기만 (드라이브 파일을 고치지 않음)
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { parseKakao } from './kakao.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const secret = async (name: string) => {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function google(): Promise<string> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle()
  const [sec, refresh] = await Promise.all([secret('GOOGLE_CLIENT_SECRET'), secret('GOOGLE_DRIVE_REFRESH_TOKEN')])
  if (typeof data?.value !== 'string' || !sec || !refresh) throw new Error('회사 구글 계정이 연결되지 않았습니다.')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: data.value, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }) })
  const body = await r.json()
  if (!r.ok || !body.access_token) throw new Error('구글 연결 만료')
  return body.access_token as string
}
/** 글자는 가리고 숫자 · 기호 · 날짜 낱말만 남김 (모양 확인용) */
const mask = (line: string) =>
  line
    .replace(/(오전|오후|AM|PM|년|월|일|요일|저장한 날짜|카카오톡 대화|님과)/g, m => `\u0001${m}\u0002`)
    .split(/(\u0001[^\u0002]*\u0002)/)
    .map(part => (part.startsWith('\u0001') ? part.slice(1, -1) : part.replace(/[가-힣]+/g, '○○').replace(/[A-Za-z]+/g, 'aa')))
    .join('')
    .slice(0, 80)

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405)
  const want = await secret('GDRIVE_SYNC_KEY')
  if (!want || req.headers.get('x-sync-key') !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
  const b = (await req.json().catch(() => ({}))) as { file_ids?: string[] }
  const ids = (b.file_ids ?? []).filter(x => /^[A-Za-z0-9_-]{10,}$/.test(x)).slice(0, 10)
  const token = await google()
  const out = []
  for (const id of ids) {
    const meta = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })).json()
    if (!/^text\/(plain|csv)$/.test(meta.mimeType ?? '') || Number(meta.size) > 3_000_000) {
      out.push({ id, name: meta.name, skipped: '텍스트(.txt · .csv) 3MB 이하만' })
      continue
    }
    const raw = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })).text()
    const { title, messages } = parseKakao(raw)
    const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())
    const starts = lines.filter(l => /^(\d{4}[.년-]|\[[^\]]+\] \[)/.test(l)).length
    const days = messages.map(m => m.sent_at.slice(0, 10)).sort()
    out.push({
      id,
      name: meta.name,
      size: Number(meta.size),
      title_found: title !== '카카오톡 대화',
      format: /^Date,User,Message/i.test(lines[0] ?? '') ? 'CSV' : messages.length && /^\[/.test(lines.find(l => /^\[/.test(l)) ?? '') ? 'PC' : 'mobile',
      messages: messages.length,
      lines: lines.length,
      date_like_lines: starts,
      senders: new Set(messages.map(m => m.sender)).size,
      attachments: messages.filter(m => m.attachment).length,
      first_day: days[0] ?? null,
      last_day: days[days.length - 1] ?? null,
      head: lines.slice(0, 4).map(mask),
    })
  }
  return json({ files: out })
})
