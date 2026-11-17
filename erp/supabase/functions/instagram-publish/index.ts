// 콘텐츠·배포 › 인스타그램 버전을 인트라넷에서 바로 게시 (2026-11-17)
//  - check   : 게시할 글 · 이미지 수 · 계정 · 오늘 게시 한도 확인 (아무것도 올리지 않음)
//  - publish : 활성 관리자가 확인 창에서 누를 때만. 이미지 1장 = 단일 게시물, 2~10장 = 캐러셀
//  - 게시 뒤 인스타그램 버전을 '발행'으로 바꾸고 발행 주소 · 게시물 ID 를 기록 (growth_ig_publish_finish)
//  - 접근 토큰은 금고 INSTAGRAM_ACCESS_TOKEN (영업 › Instagram DM 연결에서 넣은 것) · 이미지는 marketing-assets 의 1시간 서명 주소
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { igCaption, igCaptionIssues } from '../../../src/lib/instagramCaption.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const server = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const GRAPH = 'https://graph.instagram.com/v21.0'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class UserError extends Error {}
type Prep = { job: string | null; title: string; body: string; tags: string; assets: { id: string; name: string; path: string; mime: string }[] }
type GraphFail = { code?: number; error_subcode?: number; message?: string; error_user_msg?: string }

function friendly(e: GraphFail | undefined, status: number): string {
  const code = e?.code, sub = e?.error_subcode
  if (code === 190) return '인스타그램 접근 토큰이 만료됐습니다. 영업 › Instagram DM 연결에서 새 토큰을 넣어 주세요.'
  if (code === 10 || code === 200) return '이 토큰에는 게시 권한(instagram_business_content_publish)이 없습니다.'
  if (code === 4 || code === 9 || sub === 2207042) return '인스타그램 게시 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요.'
  if (sub === 2207052 || sub === 2207026 || code === 9004) return '인스타그램이 이미지를 내려받지 못했습니다. JPG · 8MB 이하 · 가로세로 비율(4:5~1.91:1)을 확인해 주세요.'
  if (sub === 2207004 || sub === 2207009) return '이미지 비율이 맞지 않습니다. 세로는 4:5, 가로는 1.91:1 까지 올릴 수 있습니다.'
  return `인스타그램 오류 ${status}${code ? ` (${code}${sub ? `/${sub}` : ''})` : ''}: ${(e?.error_user_msg ?? e?.message ?? '').slice(0, 200)}`
}
async function graph<T>(path: string, token: string, body?: Record<string, string>): Promise<T> {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
    redirect: 'error',
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.error) throw new UserError(friendly(data?.error, r.status))
  return data as T
}
async function token(): Promise<string> {
  const r = await server.rpc('instagram_secret_get', { p_name: 'INSTAGRAM_ACCESS_TOKEN' })
  if (r.error || typeof r.data !== 'string' || !r.data) throw new UserError('인스타그램 접근 토큰이 없습니다. 영업 › Instagram DM 연결에서 토큰을 먼저 넣어 주세요.')
  return r.data
}
/** 컨테이너가 준비될 때까지 기다림 (이미지는 보통 몇 초) */
async function ready(id: string, tok: string) {
  for (let i = 0; i < 20; i++) {
    const s = await graph<{ status_code?: string }>(`${id}?fields=status_code`, tok)
    if (s.status_code === 'FINISHED') return
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new UserError('인스타그램이 이미지를 처리하지 못했습니다. JPG 파일과 비율을 확인해 주세요.')
    await new Promise(r => setTimeout(r, 1500))
  }
  throw new UserError('인스타그램 이미지 처리가 늦어지고 있습니다. 잠시 뒤 다시 시도해 주세요.')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.' }, 401)
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; revision?: number }
  if (!['check', 'publish'].includes(body.action ?? '') || !UUID.test(body.id ?? '') || !Number.isSafeInteger(body.revision)) return json({ error: '요청 형식을 확인해 주세요.' }, 400)
  const publish = body.action === 'publish'
  let job: string | null = null
  try {
    const p = await server.rpc('growth_ig_publish_prepare', { p_item: body.id, p_revision: body.revision, p_user: user.id, p_claim: publish })
    if (p.error) throw new UserError(p.error.message)
    const prep = p.data as Prep
    job = prep.job
    const caption = igCaption(prep)
    const issues = igCaptionIssues(caption)
    const tok = await token()
    const me = await graph<{ user_id: string; username: string }>('me?fields=user_id,username', tok)
    if (!publish) {
      const q = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`${me.user_id}/content_publishing_limit?fields=quota_usage,config`, tok).catch(() => ({ data: [] }))
      return json({ caption, issues, username: me.username, images: prep.assets.map(a => a.name), quota: { used: q.data?.[0]?.quota_usage ?? null, total: q.data?.[0]?.config?.quota_total ?? null } })
    }
    if (issues.length) throw new UserError(issues.join(' '))
    const signed = await server.storage.from('marketing-assets').createSignedUrls(prep.assets.map(a => a.path), 3600)
    const urls = (signed.data ?? []).map(s => s.signedUrl).filter(Boolean)
    if (signed.error || urls.length !== prep.assets.length) throw new UserError('이미지 주소를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    let container: string
    if (urls.length === 1) {
      container = (await graph<{ id: string }>(`${me.user_id}/media`, tok, { image_url: urls[0], caption })).id
    } else {
      const children: string[] = []
      for (const u of urls) children.push((await graph<{ id: string }>(`${me.user_id}/media`, tok, { image_url: u, is_carousel_item: 'true' })).id)
      for (const c of children) await ready(c, tok)
      container = (await graph<{ id: string }>(`${me.user_id}/media`, tok, { media_type: 'CAROUSEL', children: children.join(','), caption })).id
    }
    await ready(container, tok)
    const media = (await graph<{ id: string }>(`${me.user_id}/media_publish`, tok, { creation_id: container })).id
    const link = await graph<{ permalink?: string }>(`${media}?fields=permalink`, tok).catch(() => ({ permalink: undefined }))
    const permalink = link.permalink ?? `https://www.instagram.com/${me.username}/`
    const done = await server.rpc('growth_ig_publish_finish', { p_job: job, p_media: media, p_permalink: permalink, p_error: null })
    job = null
    if (done.error) return json({ ok: true, permalink, warning: '게시는 됐지만 기록을 저장하지 못했습니다. 발행 주소를 직접 적어 주세요.' })
    return json({ ok: true, permalink, item: done.data })
  } catch (e) {
    const message = e instanceof UserError ? e.message : '인스타그램 게시 중 오류가 났습니다. 인스타그램에서 실제 게시 여부를 확인한 뒤 다시 시도해 주세요.'
    if (job) { try { await server.rpc('growth_ig_publish_finish', { p_job: job, p_media: null, p_permalink: null, p_error: message }) } catch { /* the stale job expires after 10 minutes */ } }
    return json({ error: message }, 400)
  }
})
