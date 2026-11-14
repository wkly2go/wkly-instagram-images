import { LookupError } from './lookupTypes.ts'
import { LOOKUP_SECRETS, OTHER_SECRETS, isLookupSource, isSampleLookup, type LookupSource } from './sources.ts'
import { procurementPlan } from './procurement.ts'
import { localityPlan } from './locality.ts'
import { marketPlan } from './market.ts'

interface SalesLookupDependencies {
  configured: boolean
  authenticate: (authorization: string) => Promise<{ id: string; active: boolean } | null>
  secret: (name: string) => string | undefined
  fetch: typeof fetch
  now?: () => number
}

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders })
const domains = new Set(['apis.data.go.kr', 'www.bizinfo.go.kr', 'bizinfo.go.kr', 'dapi.kakao.com'])

function allowLookupUrl(url: URL, source: LookupSource) {
  if (url.username || url.password || url.hash) return false
  if (isSampleLookup(source)) {
    const path = source === 'seoulEvents' ? /^\/sample\/json\/culturalEventInfo\/1\/5\/$/
      : /^\/sample\/json\/VwsmTrdarFlpopQq\/1\/5\/20\d{2}[1-4]$/
    return url.origin === 'http://openapi.seoul.go.kr:8088' && path.test(url.pathname) && !url.search
  }
  return url.protocol === 'https:' && !url.port && domains.has(url.hostname)
}

async function readJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
  if (!body) throw new Error('Missing body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('Body size exceeded')
      }
      text += decoder.decode(item.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function createSalesLookupHandler(deps: SalesLookupDependencies) {
  const lastRequests = new Map<string, number>()
  const now = deps.now ?? Date.now
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders })
    if (request.method !== 'POST') return respond({ error: '지원하지 않는 요청입니다.' }, 405)
    if (!deps.configured) return respond({ error: '서버 연결 설정을 확인해 주세요.' }, 503)

    const authorization = request.headers.get('Authorization') ?? ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) return respond({ error: '로그인이 필요합니다.' }, 401)
    let user
    try { user = await deps.authenticate(authorization) }
    catch { return respond({ error: '팀원 상태를 확인할 수 없습니다.' }, 503) }
    if (!user) return respond({ error: '로그인이 필요합니다.' }, 401)
    if (!user.active) return respond({ error: '활성 팀원만 자료를 조회할 수 있습니다.' }, 403)

    let input
    try { input = asRecord(await readJson(request.body, 4096)) } catch { input = null }
    if (!input) return respond({ error: '조회 조건의 형식이나 크기를 확인해 주세요.' }, 400)
    if (input.action === 'status') {
      return respond({ configured: Object.fromEntries(
        Object.entries({ ...LOOKUP_SECRETS, ...OTHER_SECRETS }).map(([source, secret]) => {
          try { return [source, Boolean(deps.secret(secret)?.trim())] }
          catch { return [source, null] }
        }),
      ) })
    }

    const source = input.source
    const params = asRecord(input.params)
    if (input.action !== 'search' || !isLookupSource(source) || !params) return respond({ error: '조회 출처와 조건을 확인해 주세요.' }, 400)

    const time = now()
    for (const [id, timestamp] of lastRequests) if (time - timestamp >= 2000) lastRequests.delete(id)
    if (lastRequests.has(user.id) || lastRequests.size >= 1000) return respond({ error: '잠시 기다린 뒤 다시 조회해 주세요.' }, 429)

    const sample = isSampleLookup(source)
    const key = sample ? 'sample' : deps.secret(LOOKUP_SECRETS[source])?.trim()
    if (!key) return respond({ error: '이 출처의 서버 인증키 등록이 필요합니다.' }, 503)

    try {
      const plan = procurementPlan(source, params, key) ?? localityPlan(source, params, key) ?? marketPlan(source, params, key)
      if (!plan || !allowLookupUrl(plan.url, source)) return respond({ error: '이 출처의 안전한 조회 주소를 확인할 수 없습니다.' }, 503)
      lastRequests.set(user.id, time)
      const response = await deps.fetch(plan.url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...plan.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      })
      if (response.status === 401 || response.status === 403) {
        return respond({ error: '제공기관에서 요청을 거부했습니다. 인증키·서비스 권한·접속 제한을 확인해 주세요.' }, 502)
      }
      if (!response.ok) return respond({ error: '제공기관 조회에 실패했습니다. 잠시 후 다시 확인해 주세요.' }, response.status === 429 ? 429 : 502)
      const result = plan.parse(await readJson(response.body, 2 * 1024 * 1024))
      if (!sample && key.length > 8) {
        const output = JSON.stringify(result)
        if (output.includes(key) || output.includes(encodeURIComponent(key))) {
          return respond({ error: '제공기관 응답에 인증 정보가 포함되어 표시하지 않았습니다.' }, 502)
        }
      }
      return respond({ ...result, source, sample })
    } catch (error) {
      // Transport errors can include a URL containing the provider key.
      if (error instanceof LookupError) return respond({ error: error.message }, error.status)
      return respond({ error: '제공기관 연결 또는 응답 형식을 확인하지 못했습니다.' }, 502)
    }
  }
}
