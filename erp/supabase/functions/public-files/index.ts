// 공개 내려받기 파일 올리기 (2026-11-18 · 저장소 비공개 준비 — 대표 우선순위 6)
//  - GitHub Actions(이 저장소 main 브랜치)만: 작업이 받은 OIDC 토큰(GitHub 서명 · audience wkly-public-files)을 확인 → 비밀 키를 저장소에 두지 않음
//  - 공개 보관함 public-data 의 정해진 이름에만 덮어씀: 서울시 · 코엑스 행사 스냅샷(공공 자료) · 안드로이드 APK(원래 공개 내려받기)
//    PUT ?name=<이름> · 본문 = 파일
//  - PC 프로그램 설치 · 업데이트 파일(82~180MB)은 함수로 받지 않음: POST ?op=sign&version=&file= 이 서명 올리기 주소를 주면
//    작업이 보관함 desktop-releases 의 v<버전>/ 폴더에 바로 올림 → POST ?op=promote&version= 이 그 버전의 latest.yml · latest-mac.yml 을
//    맨 위에 두고(주소에 v<버전>/ 를 붙임 · 가리키는 파일이 다 있을 때만) 첫 설치용 latest/ 사본을 바꿈
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6'
import { versionedFeed } from './feed.ts'

const REPO = 'wkly2go/wkly-instagram-images'
const AUDIENCE = 'wkly-public-files'
const BUCKET = 'public-data'
const FILES: Record<string, { type: string; max: number }> = {
  'seoul-events.json': { type: 'application/json', max: 100_000 },
  'coex-events.json': { type: 'application/json', max: 100_000 },
  'android/wkly-erp.apk': { type: 'application/vnd.android.package-archive', max: 10 * 1024 * 1024 },
}
const DESK_BUCKET = 'desktop-releases'
const DESK_FILES: Record<string, string> = {
  'WKLY-Intranet-Setup.exe': 'application/octet-stream',
  'WKLY-Intranet-Setup.exe.blockmap': 'application/octet-stream',
  'WKLY-Intranet.dmg': 'application/x-apple-diskimage',
  'WKLY-Intranet.dmg.blockmap': 'application/octet-stream',
  'WKLY-Intranet.zip': 'application/zip',
  'WKLY-Intranet.zip.blockmap': 'application/octet-stream',
  'latest.yml': 'text/yaml',
  'latest-mac.yml': 'text/yaml',
}
const FEEDS = ['latest.yml', 'latest-mac.yml']
const INSTALLERS = ['WKLY-Intranet-Setup.exe', 'WKLY-Intranet.dmg']
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/
const URL_ = Deno.env.get('SUPABASE_URL')!
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

/** 이 저장소 main 의 GitHub Actions 작업인지 · 아니면 거절 응답 */
async function refuse(req: Request): Promise<Response | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: 'https://token.actions.githubusercontent.com', audience: AUDIENCE })
    if (payload.repository !== REPO || payload.ref !== 'refs/heads/main') return json({ error: '허용되지 않은 작업입니다.' }, 403)
    return null
  } catch {
    return json({ error: '작업 확인 실패' }, 401)
  }
}

async function putPublic(req: Request, name: string): Promise<Response> {
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
}

/** PC 프로그램 파일 한 개의 서명 올리기 주소 (2시간) */
async function signDesktop(version: string, file: string): Promise<Response> {
  if (!VERSION_RE.test(version) || !DESK_FILES[file]) return json({ error: '올릴 수 없는 버전 · 이름입니다.' }, 400)
  const path = `v${version}/${file}`
  const { data, error } = await sb.storage.from(DESK_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return json({ error: `올리기 주소를 만들지 못했습니다: ${error?.message ?? ''}` }, 500)
  return json({ url: data.signedUrl, path, type: DESK_FILES[file] })
}

async function promoteDesktop(version: string): Promise<Response> {
  if (!VERSION_RE.test(version)) return json({ error: '버전을 확인해 주세요.' }, 400)
  const store = sb.storage.from(DESK_BUCKET)
  const { data: list, error } = await store.list(`v${version}`, { limit: 100 })
  if (error) return json({ error: `목록을 읽지 못했습니다: ${error.message}` }, 500)
  const have = new Set((list ?? []).map(o => o.name))
  const promoted: string[] = []
  for (const feed of FEEDS) {
    if (!have.has(feed)) continue
    const { data: blob, error: e1 } = await store.download(`v${version}/${feed}`)
    if (e1 || !blob) return json({ error: `${feed} 를 읽지 못했습니다.` }, 500)
    const raw = await blob.text()
    const v = /^version:\s*['"]?([\d.]+)['"]?\s*$/m.exec(raw)?.[1]
    if (v !== version) return json({ error: `${feed} 의 버전(${v ?? '없음'})이 ${version} 과 다릅니다.` }, 400)
    const { text, files } = versionedFeed(raw, version)
    const missing = files.filter(f => !DESK_FILES[f] || !have.has(f))
    if (!files.length || missing.length) return json({ error: `${feed} 가 가리키는 파일이 없습니다: ${missing.join(', ') || '없음'}` }, 409)
    const { error: e2 } = await store.upload(feed, new TextEncoder().encode(text), { contentType: 'text/yaml', upsert: true, cacheControl: '60' })
    if (e2) return json({ error: `${feed} 저장 실패: ${e2.message}` }, 500)
    promoted.push(feed)
  }
  if (!promoted.length) return json({ error: '이 버전 폴더에 latest.yml · latest-mac.yml 이 없습니다.' }, 409)
  // 첫 설치용 고정 주소 (인트라넷 'PC 프로그램' 내려받기 단추)
  const copied: string[] = []
  for (const f of INSTALLERS) {
    if (!have.has(f)) continue
    await store.remove([`latest/${f}`])
    const { error: e3 } = await store.copy(`v${version}/${f}`, `latest/${f}`)
    if (!e3) copied.push(f)
  }
  return json({ ok: true, version, promoted, copied, base: `${URL_}/storage/v1/object/public/${DESK_BUCKET}` })
}

Deno.serve(async req => {
  const url = new URL(req.url)
  const op = url.searchParams.get('op')
  if (!(req.method === 'PUT' && !op) && !(req.method === 'POST' && (op === 'sign' || op === 'promote'))) return json({ error: 'PUT ?name= · POST ?op=sign|promote 만 받습니다.' }, 405)
  const no = await refuse(req)
  if (no) return no
  if (req.method === 'PUT') return await putPublic(req, url.searchParams.get('name') ?? '')
  const version = url.searchParams.get('version') ?? ''
  return op === 'sign' ? await signDesktop(version, url.searchParams.get('file') ?? '') : await promoteDesktop(version)
})
