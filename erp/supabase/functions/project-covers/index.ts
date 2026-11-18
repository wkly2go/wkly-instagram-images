// 프로젝트 대표 사진 (2026-11-17 대표 우선순위 1 'Houzz Pro 식 화면 개편' · 디자인 계획 '사진이 앞에 오는 카드')
//  - 10분 예약(DB cron → x-sync-key = Vault GDRIVE_SYNC_KEY)만 받음 · 로그인 확인 없음(verify_jwt false)
//  - 회사 구글 계정(gdrive 함수와 같은 갱신 토큰)으로 drive_index 사진 중 하나를 골라(cover.ts pickCover)
//    드라이브가 만들어 둔 미리보기(긴 변 800px)만 받아 비공개 보관함 project-covers 에 넣음 · 드라이브는 읽기만
//  - 한 번에 4곳 · 사진 없는 프로젝트 먼저(진행 · 문의 · 상담협의 먼저) · 자동으로 고른 사진은 3일마다 다시 고름 · 'manual' 은 그대로
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { pickCover, type CoverFile } from './cover.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

async function secret(name: string): Promise<string | null> {
  const { data } = await sb.rpc('gdrive_secret_get', { p_name: name })
  return typeof data === 'string' && data ? data : null
}
async function accessToken(): Promise<string> {
  const [{ data: idRow }, sec, refresh] = await Promise.all([
    sb.from('app_settings').select('value').eq('key', 'google_oauth_client_id').maybeSingle(),
    secret('GOOGLE_CLIENT_SECRET'),
    secret('GOOGLE_DRIVE_REFRESH_TOKEN'),
  ])
  const id = typeof idRow?.value === 'string' ? idRow.value : null
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

async function refreshCovers(deadline: number, max = 4) {
  const [{ data: projs }, { data: covers }] = await Promise.all([
    sb.from('projects').select('id, status'),
    sb.from('project_covers').select('project_id, drive_id, path, source, updated_at'),
  ])
  type Cover = { drive_id: string; path: string; source: string; updated_at: string }
  const have = new Map((covers ?? []).map(c => [c.project_id as string, c as Cover]))
  const active = (s: string) => s === '진행' || s === '문의' || s === '상담협의'
  const stale = (c: Cover) => c.source === 'auto' && Date.now() - Date.parse(c.updated_at) > 3 * 864e5
  const todo = ((projs ?? []) as { id: string; status: string }[])
    .filter(p => !have.has(p.id) || stale(have.get(p.id)!))
    .sort((a, b) => Number(have.has(a.id)) - Number(have.has(b.id)) || Number(active(b.status)) - Number(active(a.status)))
  let token: string | null = null
  const out = { made: 0, kept: 0, none: 0 }
  for (const p of todo) {
    if (out.made >= max || Date.now() > deadline) break
    const cur = have.get(p.id)
    const { data: imgs } = await sb.from('drive_index').select('id, name, path, mime_type, size, modified_at').eq('project_id', p.id).like('mime_type', 'image/%').limit(3000)
    const pick = pickCover((imgs ?? []) as CoverFile[])
    if (!pick) { out.none++; continue }
    if (cur && cur.drive_id === pick.id) {
      await sb.from('project_covers').update({ updated_at: new Date().toISOString() }).eq('project_id', p.id)
      out.kept++
      continue
    }
    token ??= await accessToken()
    const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(pick.id)}?fields=thumbnailLink&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null)).catch(() => null) as { thumbnailLink?: string } | null
    if (!meta?.thumbnailLink) continue
    const r = await fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s800'), { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (!r?.ok) continue
    const type = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
    if (!/^image\/(jpeg|png|webp)$/.test(type)) continue
    const bytes = new Uint8Array(await r.arrayBuffer())
    const path = `${p.id}/${pick.id}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`
    const up = await sb.storage.from('project-covers').upload(path, bytes, { contentType: type, upsert: true })
    if (up.error) continue
    await sb.from('project_covers').upsert({ project_id: p.id, drive_id: pick.id, name: pick.name, path, source: 'auto', updated_at: new Date().toISOString() })
    if (cur && cur.path !== path) await sb.storage.from('project-covers').remove([cur.path]).catch(() => undefined)
    out.made++
  }
  return out
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const key = req.headers.get('x-sync-key') ?? ''
  const want = await secret('GDRIVE_SYNC_KEY')
  if (!want || key !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
  try {
    return json({ ok: true, ...(await refreshCovers(Date.now() + 60_000)) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '대표 사진 실패' }, 500)
  }
})
