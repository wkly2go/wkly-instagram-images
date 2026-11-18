// 자동 업데이트 파일을 어디서 받을지 (2026-11-18 · 저장소 비공개 대비)
//  - 먼저 Supabase 공개 보관함(desktop-releases) · 거기에 표가 없거나 받지 못하면 예전 GitHub 릴리스
//  - 표(latest.yml · latest-mac.yml)의 파일 주소는 받은 곳 기준 (Supabase 는 'v1.29.0/파일' · GitHub 은 이름만)
const SUPABASE_FEED = 'https://hophgcpszenrvchvbkav.supabase.co/storage/v1/object/public/desktop-releases'
const GITHUB_FEED = 'https://github.com/wkly2go/wkly-instagram-images/releases/latest/download'
const GITHUB_RELEASES = 'https://github.com/wkly2go/wkly-instagram-images/releases/download'

const looksLikeFeed = text => /^version:[ \t]*['"]?\d+\.\d+\.\d+/m.test(text || '')

/** 표를 받을 수 있는 첫 곳과 그 내용 · fetchText(url) → { ok, text } · 둘 다 안 되면 null */
async function fetchFeed(file, fetchText) {
  for (const base of [SUPABASE_FEED, GITHUB_FEED]) {
    try {
      const r = await fetchText(`${base}/${file}?t=${Date.now()}`)
      if (r && r.ok && looksLikeFeed(r.text)) return { base, text: r.text }
    } catch {
      /* 다음 곳 */
    }
  }
  return null
}

/** 맥 새 버전 zip 주소 (표의 url · 상대 경로만 믿음) */
function macZipUrl(yml, base, version) {
  const m = /^[ \t]*-[ \t]+url:[ \t]*['"]?([^'"\s]+\.zip)['"]?[ \t]*$/m.exec(yml || '')
  const found = m && /^[\w.\-/]+$/.test(m[1]) && !m[1].includes('..') ? m[1] : null
  const name = found || 'WKLY-Intranet.zip'
  if (base === GITHUB_FEED) return `${GITHUB_RELEASES}/v${version}/${name.split('/').pop()}`
  return `${base}/${name}`
}

module.exports = { SUPABASE_FEED, GITHUB_FEED, GITHUB_RELEASES, looksLikeFeed, fetchFeed, macZipUrl }
