// 외부 협업방 /c/<초대 링크> — 링크 미리보기용 제목 · 보안 머리말을 붙인 index.html (src/lib/collabPage.ts)
import { collabPageResponse } from '../../src/lib/collabPage'

interface Context {
  request: Request
  env: { ASSETS: { fetch(request: Request): Promise<Response> } }
  next(): Promise<Response>
}

export async function onRequest({ request, env, next }: Context) {
  return (await collabPageResponse(request, env.ASSETS).catch(() => null)) ?? next()
}
