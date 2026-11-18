import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COLLAB_PAGE_DESC, COLLAB_PAGE_HEADERS, COLLAB_PAGE_TITLE, collabPageHtml, collabPageResponse } from '../src/lib/collabPage.ts'

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const BUILT = INDEX.replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>')

test('협업방 HTML 은 사내 인트라넷 문구 대신 협업방 제목 · 설명', () => {
  const out = collabPageHtml(BUILT)
  assert.ok(!out.includes('사내 인트라넷'))
  assert.match(out, new RegExp(`<title>${COLLAB_PAGE_TITLE}</title>`))
  assert.ok(out.includes(`<meta name="description" content="${COLLAB_PAGE_DESC}" />`))
  assert.ok(out.includes(`<meta property="og:title" content="${COLLAB_PAGE_TITLE}" />`))
  assert.ok(out.includes('<meta name="robots" content="noindex, nofollow" />'))
  assert.ok(out.includes('<meta name="referrer" content="no-referrer" />'))
  assert.ok(!out.includes('rel="manifest"'))
  assert.ok(out.includes('<script type="module" crossorigin src="/assets/index-AbC123.js"></script>'), '앱 스크립트는 그대로')
  assert.equal(out.match(/<\/head>/g)?.length, 1)
})

const assets = (body: string, status = 200) => ({
  seen: [] as string[],
  async fetch(req: Request) {
    this.seen.push(req.url)
    return new Response(body, { status })
  },
})

test('GET 은 index.html 을 바꿔 돌려주고 보안 머리말을 붙임', async () => {
  const a = assets(BUILT)
  const res = await collabPageResponse(new Request('https://wkly-erp.pages.dev/c/GwqL6TD4LiR2KRoPioigP1WtqY5bWDzgyc0EXAMPLE'), a)
  assert.ok(res)
  assert.equal(res.status, 200)
  assert.deepEqual(a.seen, ['https://wkly-erp.pages.dev/'], '초대 링크가 든 주소로 파일을 찾지 않음')
  for (const [k, v] of Object.entries(COLLAB_PAGE_HEADERS)) assert.equal(res.headers.get(k), v)
  assert.ok((await res.text()).includes(`<title>${COLLAB_PAGE_TITLE}</title>`))
})

test('HEAD 는 본문 없이 · POST 등은 원래 처리로 · 파일을 못 받으면 원래 처리로', async () => {
  const head = await collabPageResponse(new Request('https://wkly-erp.pages.dev/c', { method: 'HEAD' }), assets(BUILT))
  assert.equal(head?.status, 200)
  assert.equal(await head?.text(), '')
  assert.equal(await collabPageResponse(new Request('https://wkly-erp.pages.dev/c/x', { method: 'POST' }), assets(BUILT)), null)
  assert.equal(await collabPageResponse(new Request('https://wkly-erp.pages.dev/c/x'), assets('nope', 404)), null)
})

test('the interview form address (/i/…) gets its own title and the same no-index headers', async () => {
  const { INTERVIEW_PAGE, publicPageResponse } = await import('../src/lib/collabPage.ts')
  const res = await publicPageResponse(new Request('https://wkly-erp.pages.dev/i/0123456789abcdef0123456789abcdef0123'), assets(BUILT), INTERVIEW_PAGE)
  const html = await res!.text()
  assert.match(html, /<title>서면 인터뷰 · 더위클리<\/title>/)
  assert.doesNotMatch(html, /인트라넷|rel="manifest"/)
  assert.equal(res!.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  assert.equal(res!.headers.get('Cache-Control'), 'no-store')
  assert.ok((JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')).include as string[]).includes('/i/*'))
})
