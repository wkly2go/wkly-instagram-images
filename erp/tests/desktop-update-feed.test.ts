import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { versionedFeed } from '../supabase/functions/public-files/feed.ts'

const require = createRequire(import.meta.url)
const feed = require('../desktop/update-feed.js') as {
  SUPABASE_FEED: string
  GITHUB_FEED: string
  GITHUB_RELEASES: string
  looksLikeFeed(text: string): boolean
  fetchFeed(file: string, fetchText: (url: string) => Promise<{ ok: boolean; text: string }>): Promise<{ base: string; text: string } | null>
  macZipUrl(yml: string, base: string, version: string): string
}

// v1.28.0 릴리스에 실제로 올라간 표 그대로
const WIN = `version: 1.28.0
files:
  - url: WKLY-Intranet-Setup.exe
    sha512: JPEPvd7d69HGDnce8IJlDiRsvtAFqEsRDqSDwankKTHNqcc1kf/W0bO7NFlmK92oKUhKWuSLMsAPtto1+6LYBQ==
    size: 81969770
path: WKLY-Intranet-Setup.exe
sha512: JPEPvd7d69HGDnce8IJlDiRsvtAFqEsRDqSDwankKTHNqcc1kf/W0bO7NFlmK92oKUhKWuSLMsAPtto1+6LYBQ==
releaseDate: '2026-10-29T01:50:55.789Z'
`
const MAC = `version: 1.28.0
files:
  - url: WKLY-Intranet.zip
    sha512: XLSazN2D8j6VcIINCidXqeweaW10R1iF+aUNc4ZljdvvOHfUdhQVBLi8dNSNTy8oMSNP8Y0R/ucIhOtfLQNT8A==
    size: 174151089
  - url: WKLY-Intranet.dmg
    sha512: OYfBUGHTQkfQfUku0GCzt7vbiJRDNo6+3Fb3hXnNuEotl9rAUgk6l+ZhZuMBnEpSoFuQaZUJaZP3bbLDqjCjxQ==
    size: 180015665
path: WKLY-Intranet.zip
sha512: XLSazN2D8j6VcIINCidXqeweaW10R1iF+aUNc4ZljdvvOHfUdhQVBLi8dNSNTy8oMSNP8Y0R/ucIhOtfLQNT8A==
releaseDate: '2026-10-29T01:53:05.720Z'
`
// main.js 의 zipSha512 와 같은 식
const zipSha512 = (yml: string) => /-\s*url:\s*\S+\.zip\s*\n\s*sha512:\s*(\S+)/.exec(yml)?.[1] ?? null

test('보관함 맨 위 표: 파일 주소에 버전 폴더를 붙이고 나머지 줄은 그대로', () => {
  const w = versionedFeed(WIN, '1.28.0')
  assert.deepEqual(w.files, ['WKLY-Intranet-Setup.exe'])
  assert.ok(w.text.includes('  - url: v1.28.0/WKLY-Intranet-Setup.exe\n'))
  assert.ok(w.text.includes('\npath: v1.28.0/WKLY-Intranet-Setup.exe\n'))
  assert.equal(w.text.split('\n').length, WIN.split('\n').length)
  assert.equal(w.text.replace(/v1\.28\.0\//g, ''), WIN)
  const m = versionedFeed(MAC, '1.28.0')
  assert.deepEqual(m.files.sort(), ['WKLY-Intranet.dmg', 'WKLY-Intranet.zip'])
  assert.equal(zipSha512(m.text), zipSha512(MAC), '맥 zip 확인 값은 그대로 읽힘')
  assert.equal(versionedFeed(m.text, '1.28.0').text, m.text, '두 번 해도 같음')
})

test('맥 zip 주소: Supabase 는 표의 버전 폴더 · GitHub 은 릴리스 버전 주소 · 수상한 주소는 무시', () => {
  const m = versionedFeed(MAC, '1.28.0').text
  assert.equal(feed.macZipUrl(m, feed.SUPABASE_FEED, '1.28.0'), `${feed.SUPABASE_FEED}/v1.28.0/WKLY-Intranet.zip`)
  assert.equal(feed.macZipUrl(MAC, feed.GITHUB_FEED, '1.28.0'), `${feed.GITHUB_RELEASES}/v1.28.0/WKLY-Intranet.zip`)
  const evil = MAC.replace('url: WKLY-Intranet.zip', 'url: https://evil.example/x.zip')
  assert.equal(feed.macZipUrl(evil, feed.SUPABASE_FEED, '1.28.0'), `${feed.SUPABASE_FEED}/WKLY-Intranet.zip`)
  const up = MAC.replace('url: WKLY-Intranet.zip', 'url: ../../x.zip')
  assert.equal(feed.macZipUrl(up, feed.SUPABASE_FEED, '1.28.0'), `${feed.SUPABASE_FEED}/WKLY-Intranet.zip`)
})

test('받을 곳 고르기: Supabase 표가 있으면 그곳 · 없거나 이상하면 GitHub · 둘 다 안 되면 null', async () => {
  const seen: string[] = []
  const serve = (map: Record<string, { ok: boolean; text: string } | Error>) => async (url: string) => {
    seen.push(url)
    const hit = Object.entries(map).find(([k]) => url.startsWith(k))?.[1]
    if (hit instanceof Error) throw hit
    return hit ?? { ok: false, text: '' }
  }
  const s = await feed.fetchFeed('latest.yml', serve({ [feed.SUPABASE_FEED]: { ok: true, text: WIN } }))
  assert.equal(s?.base, feed.SUPABASE_FEED)
  assert.match(seen[0], /desktop-releases\/latest\.yml\?t=\d+$/)
  const g = await feed.fetchFeed('latest.yml', serve({ [feed.SUPABASE_FEED]: { ok: false, text: '' }, [feed.GITHUB_FEED]: { ok: true, text: WIN } }))
  assert.equal(g?.base, feed.GITHUB_FEED)
  const html = await feed.fetchFeed('latest.yml', serve({ [feed.SUPABASE_FEED]: { ok: true, text: '<html>error</html>' }, [feed.GITHUB_FEED]: { ok: true, text: WIN } }))
  assert.equal(html?.base, feed.GITHUB_FEED, '표 모양이 아니면 넘어감')
  const thrown = await feed.fetchFeed('latest.yml', serve({ [feed.SUPABASE_FEED]: new Error('proxy'), [feed.GITHUB_FEED]: { ok: true, text: WIN } }))
  assert.equal(thrown?.base, feed.GITHUB_FEED)
  assert.equal(await feed.fetchFeed('latest.yml', serve({})), null)
})

test('PC 프로그램 설치본에 main.js 가 불러오는 파일이 모두 들어감', () => {
  const pkg = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')) as { build: { files: string[] } }
  const main = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
  const local = [...main.matchAll(/require\('\.\/([^']+)'\)/g)].map(m => (m[1].endsWith('.js') ? m[1] : `${m[1]}.js`))
  assert.ok(local.includes('update-feed.js'))
  for (const f of local) assert.ok(pkg.build.files.includes(f), `${f} 가 build.files 에 없음`)
})
