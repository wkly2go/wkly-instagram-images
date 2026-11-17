// 외부 협업방 주소(/c/…)의 첫 HTML — Cloudflare Pages 함수(functions/c)가 씀
//  - 화면은 인트라넷과 같은 index.html 이지만, 카톡 · 메일 링크 미리보기에 '사내 인트라넷' 문구가 나오지 않게 제목 · 설명을 바꿈
//  - 검색 노출 · 리퍼러 · 캐시를 막음. 초대 링크는 화면에서 '협업방 들어가기'를 눌러야 쓰임(미리보기 · 메일 검사기는 못 씀)
export const COLLAB_PAGE_TITLE = '프로젝트 협업방'
export const COLLAB_PAGE_DESC = '초대받은 분만 들어올 수 있는 프로젝트 협업방입니다.'

export const COLLAB_PAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}

const HEAD_EXTRA = [
  '<meta name="robots" content="noindex, nofollow" />',
  '<meta name="referrer" content="no-referrer" />',
  `<meta property="og:title" content="${COLLAB_PAGE_TITLE}" />`,
  `<meta property="og:description" content="${COLLAB_PAGE_DESC}" />`,
  '<meta property="og:type" content="website" />',
].join('\n    ')

/** index.html → 협업방용 (제목 · 설명 · 미리보기 글 바꾸고 앱 설치 정보는 뺌) */
export function collabPageHtml(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${COLLAB_PAGE_TITLE}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${COLLAB_PAGE_DESC}" />`)
    .replace(/<meta\s+name="apple-mobile-web-app-title"[^>]*>/i, `<meta name="apple-mobile-web-app-title" content="협업방" />`)
    .replace(/<link\s+rel="manifest"[^>]*>\s*/i, '')
    .replace(/<\/head>/i, `  ${HEAD_EXTRA}\n  </head>`)
}

interface Assets {
  fetch(request: Request): Promise<Response>
}

/** GET · HEAD 만 바꿔 줌 · 그 밖은 null (원래 처리로) */
export async function collabPageResponse(request: Request, assets: Assets): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const page = await assets.fetch(new Request(new URL('/', request.url)))
  if (!page.ok) return null
  const html = collabPageHtml(await page.text())
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: COLLAB_PAGE_HEADERS })
}
