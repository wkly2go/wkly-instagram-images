// 안드로이드 앱(APK) 서명 키 보관 (대표 지시 2026-11-04 "앱으로 설치할 수 있게")
//  - 저장소가 공개라 키를 저장소에 둘 수 없음 → Supabase Vault 에 보관
//  - GitHub Actions 빌드만 받을 수 있음: 빌드가 받은 OIDC 토큰(GitHub 서명)을 확인 · 이 저장소 main 브랜치의 android 작업만 허용
//  - get : 키 · 비밀번호 (없으면 missing)
//  - set : 첫 빌드가 만든 키를 저장 (이미 있으면 바꾸지 않음) + 지문(공개 값)을 app_settings.android_signing_fp 에
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6'

const REPO = 'wkly2go/wkly-instagram-images'
const AUDIENCE = 'wkly-android-key'
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST 만 받습니다.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: 'https://token.actions.githubusercontent.com', audience: AUDIENCE })
    if (payload.repository !== REPO || payload.ref !== 'refs/heads/main') return json({ error: '허용되지 않은 빌드입니다.' }, 403)
  } catch {
    return json({ error: '빌드 확인 실패' }, 401)
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string; keystore?: string; password?: string; fingerprint?: string }
  const get = async (n: string) => (await sb.rpc('android_key_get', { p_name: n })).data as string | null
  if (body.action === 'get') {
    const [keystore, password] = await Promise.all([get('ANDROID_KEYSTORE_B64'), get('ANDROID_KEYSTORE_PASSWORD')])
    return keystore && password ? json({ keystore, password }) : json({ missing: true })
  }
  if (body.action === 'set') {
    if (!body.keystore || !body.password || !body.fingerprint) return json({ error: '값이 없습니다.' }, 400)
    if (await get('ANDROID_KEYSTORE_B64')) return json({ error: '이미 키가 있습니다.' }, 409)
    const a = await sb.rpc('android_key_set', { p_name: 'ANDROID_KEYSTORE_B64', p_value: body.keystore })
    const b = await sb.rpc('android_key_set', { p_name: 'ANDROID_KEYSTORE_PASSWORD', p_value: body.password })
    if (a.error || b.error) return json({ error: '저장 실패' }, 500)
    await sb.from('app_settings').upsert({ key: 'android_signing_fp', value: body.fingerprint, updated_at: new Date().toISOString() })
    return json({ ok: true })
  }
  return json({ error: '알 수 없는 작업' }, 400)
})
