// GitHub 릴리스의 PC 프로그램 파일을 Supabase 공개 보관함(desktop-releases)에도 둠 (2026-11-18 · 저장소 비공개 대비)
//  - GitHub Actions 안에서만 동작: OIDC 토큰(audience wkly-public-files) → 서버 함수 public-files 가 서명 올리기 주소를 줌
//  - 순서: 릴리스 파일 받기 → v<버전>/ 폴더에 올리기 → promote(표를 맨 위에 · 첫 설치용 latest/ 사본)
//  - 쓰는 법: node erp/desktop/scripts/mirror-release.mjs v1.29.0   (환경 변수 GH_TOKEN · GITHUB_REPOSITORY)
const FN = 'https://hophgcpszenrvchvbkav.supabase.co/functions/v1/public-files'
const FILES = [
  'WKLY-Intranet-Setup.exe',
  'WKLY-Intranet-Setup.exe.blockmap',
  'WKLY-Intranet.dmg',
  'WKLY-Intranet.dmg.blockmap',
  'WKLY-Intranet.zip',
  'WKLY-Intranet.zip.blockmap',
  // 표는 맨 마지막 (가리키는 파일이 먼저 올라가 있어야 promote 가 받아 줌)
  'latest.yml',
  'latest-mac.yml',
]
const tag = process.argv[2] ?? ''
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`usage: mirror-release.mjs vX.Y.Z (got "${tag}")`)
const version = tag.slice(1)
const repo = process.env.GITHUB_REPOSITORY || 'wkly2go/wkly-instagram-images'

async function oidc() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: u, ACTIONS_ID_TOKEN_REQUEST_TOKEN: t } = process.env
  if (!u || !t) throw new Error('OIDC token unavailable (the job needs permissions: id-token: write)')
  const r = await fetch(`${u}&audience=wkly-public-files`, { headers: { Authorization: `bearer ${t}` } })
  if (!r.ok) throw new Error(`OIDC ${r.status}`)
  return (await r.json()).value
}

// 부를 때마다 새 OIDC 토큰 (큰 파일을 올리는 동안 만료되지 않게)
async function call(query) {
  const r = await fetch(`${FN}?${query}`, { method: 'POST', headers: { Authorization: `Bearer ${await oidc()}` } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`public-files ${query}: ${r.status} ${body.error ?? ''}`)
  return body
}

async function github(path, accept = 'application/vnd.github+json') {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!r.ok) throw new Error(`GitHub ${path}: ${r.status}`)
  return r
}

const release = await (await github(`/releases/tags/${tag}`)).json()
const assets = new Map(release.assets.map(a => [a.name, a]))
let sent = 0
for (const name of FILES) {
  const asset = assets.get(name)
  if (!asset) continue
  const bytes = Buffer.from(await (await github(`/releases/assets/${asset.id}`, 'application/octet-stream')).arrayBuffer())
  if (bytes.length !== asset.size) throw new Error(`${name}: downloaded ${bytes.length} of ${asset.size} bytes`)
  const { url, type } = await call(`op=sign&version=${version}&file=${encodeURIComponent(name)}`)
  const up = await fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=3600' } })
  if (!up.ok) throw new Error(`upload ${name}: ${up.status} ${(await up.text()).slice(0, 300)}`)
  console.log(`uploaded ${name} (${(bytes.length / 1048576).toFixed(1)} MB)`)
  sent++
}
if (!sent) throw new Error(`${tag}: no desktop files in the release`)
console.log('promote', JSON.stringify(await call(`op=promote&version=${version}`)))
