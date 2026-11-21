// 인스타그램 다시 연결 (2026-11-21)
//  - 인트라넷 '인스타그램 다시 연결' → instagram_oauth_start() 가 만든 로그인 주소 → 인스타그램 로그인 · [허용]
//  - 인스타그램이 이 함수로 code · state 를 돌려줌 → 짧은 토큰 → 60일 장기 토큰으로 바꿈
//  - 우리 계정(@theweekly_magazine)인지 확인한 뒤 instagram_oauth_finish 가 금고에 저장 · 상태 기록 · 알림
//  - 로그인 없이 열리는 주소라 verify_jwt false · state(관리자가 15분 안에 만든 한 번짜리)가 없으면 아무것도 안 함
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const APP_ID = '2635151180272025'
const OUR_IG = '17841475999645207'
const OUR_NAME = 'theweekly_magazine'
const REDIRECT = 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/instagram-oauth'
const BACK = 'https://wkly-erp.pages.dev/sales'
const server = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

const back = (ok: boolean, msg: string) =>
  new Response(null, { status: 302, headers: { Location: `${BACK}?ig=${ok ? 'ok' : 'fail'}&msg=${encodeURIComponent(msg.slice(0, 200))}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })

async function readJson(r: Response): Promise<Record<string, unknown>> {
  return await r.json().catch(() => ({})) as Record<string, unknown>
}
const errText = (d: Record<string, unknown>) => {
  const e = (d.error ?? d) as Record<string, unknown>
  return String(e?.error_message ?? e?.message ?? d.error_message ?? '').slice(0, 160)
}

Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
  const q = new URL(req.url).searchParams
  const state = q.get('state') ?? ''
  if (q.get('error')) return back(false, q.get('error_reason') === 'user_denied' ? '[허용]을 누르지 않아 연결하지 않았습니다.' : `인스타그램이 연결을 거절했습니다: ${q.get('error_description') ?? q.get('error')}`)
  const code = (q.get('code') ?? '').replace(/#_$/, '')
  if (!/^[0-9a-f]{48}$/.test(state) || !code) return back(false, '연결 정보가 없습니다. 인트라넷에서 다시 눌러 주세요.')
  try {
    const sec = await server.rpc('instagram_secret_get', { p_name: 'INSTAGRAM_APP_SECRET' })
    if (sec.error || typeof sec.data !== 'string' || !sec.data) return back(false, '앱 시크릿이 없습니다. 영업 › Instagram DM 연결에서 앱 시크릿을 먼저 넣어 주세요.')
    // 1) code → 짧은 토큰
    const r1 = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: APP_ID, client_secret: sec.data, grant_type: 'authorization_code', redirect_uri: REDIRECT, code }),
    })
    const d1 = await readJson(r1)
    const short = String(d1.access_token ?? '')
    if (!r1.ok || !short) return back(false, `로그인 코드를 토큰으로 바꾸지 못했습니다. ${errText(d1)}`)
    // 2) 짧은 토큰 → 장기 토큰(60일)
    const r2 = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(sec.data)}&access_token=${encodeURIComponent(short)}`)
    const d2 = await readJson(r2)
    const long = String(d2.access_token ?? '')
    if (!r2.ok || !long) return back(false, `장기 토큰으로 바꾸지 못했습니다. ${errText(d2)}`)
    // 3) 우리 계정인지 확인
    const r3 = await fetch(`https://graph.instagram.com/v21.0/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${long}` } })
    const me = await readJson(r3)
    const uid = String(me.user_id ?? ''), name = String(me.username ?? '')
    if (!r3.ok || (uid !== OUR_IG && name.toLowerCase() !== OUR_NAME)) return back(false, `@${name || '알 수 없음'} 계정으로 로그인했습니다. @${OUR_NAME} 계정으로 다시 로그인해 주세요.`)
    // 4) 저장
    const fin = await server.rpc('instagram_oauth_finish', { p_state: state, p_token: long, p_expires_in: Number(d2.expires_in ?? 5184000), p_username: name })
    const f = fin.data as { ok?: boolean; error?: string } | null
    if (fin.error || !f?.ok) return back(false, f?.error ?? '토큰을 저장하지 못했습니다.')
    return back(true, `@${name} 연결을 마쳤습니다.`)
  } catch (e) {
    return back(false, `연결 중 오류: ${String((e as Error)?.message ?? e).slice(0, 120)}`)
  }
})
