// 인터뷰지 /i/<토큰> — 링크 미리보기용 제목 · 보안 머리말을 붙인 index.html (src/lib/collabPage.ts)
import { INTERVIEW_PAGE, publicPageResponse } from '../../src/lib/collabPage'

interface Context {
  request: Request
  env: { ASSETS: { fetch(request: Request): Promise<Response> } }
  next(): Promise<Response>
}

export async function onRequest({ request, env, next }: Context) {
  return (await publicPageResponse(request, env.ASSETS, INTERVIEW_PAGE).catch(() => null)) ?? next()
}
