// 공개 내려받기 파일 올리기 (2026-11-18 · 저장소 비공개 준비 — 대표 우선순위 6)
//  - GitHub Actions(이 저장소 main 브랜치)만: 작업이 받은 OIDC 토큰(GitHub 서명 · audience wkly-public-files)을 확인 → 비밀 키를 저장소에 두지 않음
//  - 공개 보관함 public-data 의 정해진 이름에만 덮어씀: 서울시 · 코엑스 행사 스냅샷(공공 자료) · 안드로이드 APK(원래 공개 내려받기)
//  - PUT ?name=<이름> · 본문 = 파일
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6'

const REPO = 'wkly2go/wkly-instagram-images'
const AUDIENCE = 'wkly-public-files'
const BUCKET = 'public-data'
const FILES: Record<string, { type: string; max: number }> = {
  'seoul-events.json': { type: 'application/json', max: 100_000 },
  'coex-events.json': { type: 'application/json', max: 100_000 },
  'android/wkly-erp.apk': { type: 'application/vnd.android.package-archive', max: 10 * 1024 * 1024 },
}
const URL_ = Deno.env.get('SUPABASE_URL')!
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'PUT') return json({ error: 'PUT 만 받습니다.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: 'https://token.actions.githubusercontent.com', audience: AUDIENCE })
    if (payload.repository !== REPO || payload.ref !== 'refs/heads/main') return json({ error: '허용되지 않은 작업입니다.' }, 403)
  } catch {
    return json({ error: '작업 확인 실패' }, 401)
  }
  const name = new URL(req.url).searchParams.get('name') ?? ''
  const spec = FILES[name]
  if (!spec) return json({ error: '올릴 수 없는 이름입니다.' }, 400)
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.length || bytes.length > spec.max) return json({ error: '파일 크기를 확인해 주세요.' }, 400)
  if (spec.type === 'application/json') {
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes)) as { events?: unknown; rows?: unknown }
      if (!Array.isArray(data.events) && !Array.isArray(data.rows)) throw new Error('shape')
    } catch {
      return json({ error: '행사 스냅샷 모양이 아닙니다.' }, 400)
    }
  } else if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    return json({ error: 'APK 파일이 아닙니다.' }, 400)
  }
  const { error } = await sb.storage.from(BUCKET).upload(name, bytes, { contentType: spec.type, upsert: true, cacheControl: '300' })
  if (error) return json({ error: `저장 실패: ${error.message}` }, 500)
  return json({ ok: true, url: `${URL_}/storage/v1/object/public/${BUCKET}/${name}`, size: bytes.length })
})
